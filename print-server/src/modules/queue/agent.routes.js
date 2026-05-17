const Router = require('koa-router');
const config = require('../../config');
const { query } = require('../../config/database');
const queueEngine = require('./queue.engine');

const router = new Router({ prefix: '/api/agent' });

function agentAuth(ctx, next) {
  const token = ctx.headers.authorization?.replace('Bearer ', '');
  if (token !== config.pcAgentSecret) {
    ctx.status = 401;
    ctx.body = { success: false, message: 'Unauthorized' };
    return;
  }
  return next();
}

router.get('/pending-jobs', agentAuth, async (ctx) => {
  const { agent_id } = ctx.query;

  await query(
    "UPDATE printers SET agent_status = 'online', last_heartbeat = NOW() WHERE agent_id = $1",
    [agent_id]
  );

  const { rows } = await query(
    `SELECT o.id, o.order_no, o.file_url, o.file_name, o.file_pages,
            o.color_mode, o.duplex, o.paper_size, o.copies, o.layout,
            o.total_sides, o.content_scale, o.customer_id
     FROM orders o
     WHERE o.shop_id = 1 AND o.status = 'paid'
     ORDER BY o.paid_at ASC
     LIMIT 1`
  );

  if (rows.length > 0) {
    const order = rows[0];
    await query(
      "UPDATE orders SET status = 'printing', printer_id = (SELECT id FROM printers WHERE agent_id = $1 LIMIT 1), started_at = NOW(), updated_at = NOW() WHERE id = $2",
      [agent_id, order.id]
    );

    await query(
      "UPDATE printers SET agent_status = 'printing', last_heartbeat = NOW() WHERE agent_id = $1",
      [agent_id]
    );

    await queueEngine.dequeue(1, order.id);

    ctx.body = { success: true, data: { has_job: true, job: order } };
  } else {
    ctx.body = { success: true, data: { has_job: false, job: null } };
  }
});

router.post('/job-complete', agentAuth, async (ctx) => {
  const { agent_id, order_id, success, error_message } = ctx.request.body;

  if (success) {
    const { rows } = await query(
      "SELECT started_at, total_sides, printer_id FROM orders WHERE id = $1",
      [order_id]
    );

    const actualSeconds = rows[0]?.started_at
      ? Math.round((Date.now() - new Date(rows[0].started_at).getTime()) / 1000)
      : 0;

    await query(
      "UPDATE orders SET status = 'completed', actual_seconds = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2",
      [actualSeconds, order_id]
    );

    if (rows[0]?.printer_id) {
      await queueEngine.calibratePrinterSpeed(1, rows[0].printer_id, rows[0].total_sides, actualSeconds);
    }
  } else {
    await query(
      "UPDATE orders SET status = 'paid', remark = $1, updated_at = NOW() WHERE id = $2",
      ['打印失败: ' + (error_message || '未知错误'), order_id]
    );
  }

  await query(
    "UPDATE printers SET agent_status = 'idle', last_heartbeat = NOW() WHERE agent_id = $1",
    [agent_id]
  );

  ctx.body = { success: true };
});

router.post('/report-printers', agentAuth, async (ctx) => {
  const { agent_id, printers: detectedPrinters } = ctx.request.body;

  if (!detectedPrinters || !Array.isArray(detectedPrinters)) {
    ctx.status = 400;
    ctx.body = { success: false, message: '打印机列表无效' };
    return;
  }

  for (const p of detectedPrinters) {
    const existing = await query(
      'SELECT id FROM printers WHERE shop_id = 1 AND name = $1',
      [p.name]
    );

    if (existing.rows.length > 0) {
      await query(
        'UPDATE printers SET agent_id = $1, agent_status = $2, updated_at = NOW() WHERE id = $3',
        [agent_id, 'online', existing.rows[0].id]
      );
    } else {
      await query(
        `INSERT INTO printers (shop_id, name, printer_type, speed_base_sec, agent_id, agent_status)
         VALUES (1, $1, $2, 10.0, $3, 'online')`,
        [p.name, p.is_default ? 'bw' : 'bw', agent_id]
      );
    }
  }

  console.log(`[Agent] ${agent_id} 上报了 ${detectedPrinters.length} 台打印机`);
  ctx.body = { success: true, message: `已保存 ${detectedPrinters.length} 台打印机` };
});

router.post('/heartbeat', agentAuth, async (ctx) => {
  const { agent_id, status = 'idle' } = ctx.request.body;

  await query(
    "UPDATE printers SET agent_status = $1, last_heartbeat = NOW(), updated_at = NOW() WHERE agent_id = $2",
    [status, agent_id]
  );

  ctx.body = { success: true };
});

module.exports = router;
