const { redis, pub } = require('../../config/redis');
const { query } = require('../../config/database');

class QueueEngine {
  constructor() {
    this.QUEUE_KEY_PREFIX = 'print_queue:';
    this.WAIT_KEY_PREFIX = 'wait_seconds:';
  }

  async enqueue(shopId, orderId, estimatedSeconds) {
    const queueKey = this.QUEUE_KEY_PREFIX + shopId;

    await redis.rpush(queueKey, JSON.stringify({
      order_id: orderId,
      estimated_seconds: estimatedSeconds,
      enqueued_at: Date.now(),
    }));

    await this._recalcWaitTimes(shopId);

    await pub.publish(`queue:${shopId}`, JSON.stringify({
      type: 'enqueued',
      order_id: orderId,
    }));

    return this.getQueuePosition(shopId, orderId);
  }

  async dequeue(shopId, orderId) {
    const queueKey = this.QUEUE_KEY_PREFIX + shopId;
    const queue = await redis.lrange(queueKey, 0, -1);

    for (let i = 0; i < queue.length; i++) {
      const item = JSON.parse(queue[i]);
      if (item.order_id === orderId) {
        await redis.lrem(queueKey, 1, queue[i]);
        break;
      }
    }

    await this._recalcWaitTimes(shopId);

    await pub.publish(`queue:${shopId}`, JSON.stringify({
      type: 'dequeued',
      order_id: orderId,
    }));
  }

  async getQueuePosition(shopId, orderId) {
    const queueKey = this.QUEUE_KEY_PREFIX + shopId;
    const queue = await redis.lrange(queueKey, 0, -1);

    for (let i = 0; i < queue.length; i++) {
      const item = JSON.parse(queue[i]);
      if (item.order_id === orderId) {
        return { position: i + 1, total: queue.length };
      }
    }
    return { position: 0, total: queue.length };
  }

  async getQueue(shopId) {
    const queueKey = this.QUEUE_KEY_PREFIX + shopId;
    const queue = await redis.lrange(queueKey, 0, -1);
    const items = queue.map((item, index) => {
      const parsed = JSON.parse(item);
      return { ...parsed, position: index + 1 };
    });

    const orderIds = items.map(i => i.order_id);
    if (orderIds.length === 0) return [];

    const { rows } = await query(
      `SELECT id, order_no, file_name, file_url, file_pages, total_sides, paper_size, color_mode,
              duplex, copies, total_amount, estimated_seconds, paid_at, is_expedited,
              c.wx_nickname as customer_name
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = ANY($1) AND o.status = 'paid'
       ORDER BY o.paid_at ASC`,
      [orderIds]
    );

    const orderMap = {};
    for (const row of rows) {
      orderMap[row.id] = row;
    }

    return items.map(item => ({
      ...item,
      order_info: orderMap[item.order_id] || null,
    }));
  }

  async _recalcWaitTimes(shopId) {
    const queueKey = this.QUEUE_KEY_PREFIX + shopId;
    const queue = await redis.lrange(queueKey, 0, -1);

    let cumulativeWait = 0;
    const updatedItems = [];

    for (const item of queue) {
      const parsed = JSON.parse(item);
      cumulativeWait += parsed.estimated_seconds;
      parsed.wait_seconds = cumulativeWait;

      const waitKey = this.WAIT_KEY_PREFIX + shopId + ':' + parsed.order_id;
      await redis.setex(waitKey, 3600, cumulativeWait);

      updatedItems.push(JSON.stringify(parsed));
    }

    if (updatedItems.length > 0) {
      await redis.del(queueKey);
      const multi = redis.multi();
      for (const item of updatedItems) {
        multi.rpush(queueKey, item);
      }
      await multi.exec();
    }

    await pub.publish(`queue:${shopId}`, JSON.stringify({
      type: 'wait_time_updated',
      queue: updatedItems.map(i => JSON.parse(i)),
    }));
  }

  async calibratePrinterSpeed(shopId, printerId, totalSides, actualSeconds) {
    if (totalSides <= 0 || actualSeconds <= 0) return null;

    const printerKey = `printer_speed:${printerId}`;
    const actualSpeed = actualSeconds / totalSides;

    let currentBase = await redis.get(printerKey);
    if (!currentBase) {
      const { rows } = await query(
        'SELECT speed_base_sec FROM printers WHERE id = $1', [printerId]
      );
      currentBase = rows[0]?.speed_base_sec || 10;
    } else {
      currentBase = parseFloat(currentBase);
    }

    const newBase = Math.round((0.7 * currentBase + 0.3 * actualSpeed) * 10) / 10;

    await redis.set(printerKey, newBase);

    setImmediate(async () => {
      await query(
        'UPDATE printers SET speed_base_sec = $1, updated_at = NOW() WHERE id = $2',
        [newBase, printerId]
      );
    });

    return newBase;
  }

  async getWaitingTime(shopId, orderId) {
    const waitKey = this.WAIT_KEY_PREFIX + shopId + ':' + orderId;
    let waitSeconds = await redis.get(waitKey);
    let position = 0;
    let total = 0;

    if (waitSeconds === null) {
      const queueKey = this.QUEUE_KEY_PREFIX + shopId;
      const queue = await redis.lrange(queueKey, 0, -1);
      let cumulative = 0;
      let found = false;

      for (let i = 0; i < queue.length; i++) {
        const item = JSON.parse(queue[i]);
        cumulative += item.estimated_seconds;

        if (item.order_id === parseInt(orderId)) {
          found = true;
          position = i + 1;
          waitSeconds = cumulative;
        }
      }
      total = queue.length;

      if (found && waitSeconds > 0) {
        await redis.setex(waitKey, 60, waitSeconds);
      } else {
        waitSeconds = 0;
      }
    } else {
      waitSeconds = parseInt(waitSeconds);
      const posInfo = await this.getQueuePosition(shopId, parseInt(orderId));
      position = posInfo.position;
      total = posInfo.total;
    }

    return {
      position,
      total,
      wait_seconds: waitSeconds || 0,
      wait_display: position === 0
        ? '即将开始打印'
        : `预计等待约 ${Math.ceil((waitSeconds || 0) / 60)} 分钟`,
    };
  }
}

module.exports = new QueueEngine();
