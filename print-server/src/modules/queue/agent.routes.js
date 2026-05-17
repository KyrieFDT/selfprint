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

// 代理查询当前应使用的打印机
router.get('/config', agentAuth, async (ctx) => {
  const { agent_id } = ctx.query;
  const { rows } = await query(
    "SELECT config_value FROM shop_configs WHERE shop_id = 1 AND config_key = 'active_printer'"
  );
  const activePrinter = rows[0]?.config_value || null;

  // 如果未设置，取该 agent 上报的第一台在线打印机
  if (!activePrinter) {
    const pRows = await query(
      "SELECT name FROM printers WHERE shop_id = 1 AND agent_id = $1 AND is_active = true ORDER BY sort_order LIMIT 1",
      [agent_id]
    );
    ctx.body = { success: true, data: { printer_name: pRows.rows[0]?.name || null } };
    return;
  }

  ctx.body = { success: true, data: { printer_name: activePrinter } };
});

router.get('/pending-jobs', agentAuth, async (ctx) => {
  const { agent_id, printer_type } = ctx.query;
  const myType = printer_type || 'bw';

  await query(
    "UPDATE printers SET agent_status = 'online', last_heartbeat = NOW() WHERE agent_id = $1",
    [agent_id]
  );

  // 根据打印机类型路由订单
  let orderQuery, queryParams;
  if (myType === 'photo') {
    // 照片打印机: 只取图片文件订单
    orderQuery = `SELECT o.id, o.order_no, o.file_url, o.file_name, o.file_pages,
            o.color_mode, o.duplex, o.paper_size, o.copies, o.layout,
            o.total_sides, o.content_scale, o.customer_id
     FROM orders o
     WHERE o.shop_id = 1 AND o.status = 'paid'
       AND (LOWER(o.file_name) LIKE '%.jpg'
         OR LOWER(o.file_name) LIKE '%.jpeg'
         OR LOWER(o.file_name) LIKE '%.png'
         OR LOWER(o.file_name) LIKE '%.bmp'
         OR LOWER(o.file_name) LIKE '%.tiff'
         OR LOWER(o.file_name) LIKE '%.tif'
         OR LOWER(o.file_name) LIKE '%.heic')
     ORDER BY o.paid_at ASC LIMIT 1`;
    queryParams = [];
  } else if (myType === 'color') {
    // 彩色打印机: 优先彩色订单，无彩色时承接黑白
    orderQuery = `SELECT o.id, o.order_no, o.file_url, o.file_name, o.file_pages,
            o.color_mode, o.duplex, o.paper_size, o.copies, o.layout,
            o.total_sides, o.content_scale, o.customer_id
     FROM orders o
     WHERE o.shop_id = 1 AND o.status = 'paid'
     ORDER BY CASE WHEN o.color_mode = 'color' THEN 0 ELSE 1 END, o.paid_at ASC
     LIMIT 1`;
    queryParams = [];
  } else {
    // 黑白打印机: 只取黑白订单。彩色订单超时5分钟后才降级承接
    orderQuery = `SELECT o.id, o.order_no, o.file_url, o.file_name, o.file_pages,
            o.color_mode, o.duplex, o.paper_size, o.copies, o.layout,
            o.total_sides, o.content_scale, o.customer_id
     FROM orders o
     WHERE o.shop_id = 1 AND o.status = 'paid'
       AND (o.color_mode = 'bw'
         OR (o.color_mode = 'color' AND o.paid_at < NOW() - INTERVAL '5 minutes'))
     ORDER BY o.paid_at ASC LIMIT 1`;
    queryParams = [];
  }

  const { rows } = await query(orderQuery, queryParams);

  if (rows.length > 0) {
    const order = rows[0];

    // 降级日志
    if (myType === 'bw' && order.color_mode === 'color') {
      console.log(`[Router] 降级: BW打印机 ${agent_id} 承接彩色订单 #${order.id}`);
    }
    if (myType === 'color' && order.color_mode === 'bw') {
      console.log(`[Router] 降级: 彩色打印机 ${agent_id} 承接黑白订单 #${order.id}`);
    }

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
      // 恢复软删除的打印机 + 更新状态
      await query(
        'UPDATE printers SET agent_id = $1, agent_status = $2, is_active = TRUE, updated_at = NOW() WHERE id = $3',
        [agent_id, 'online', existing.rows[0].id]
      );
    } else {
      // 优先使用代理上报的 printer_type，否则根据 is_default 猜测
      const reqPrinterType = ctx.request.body.printer_type;
      const pType = reqPrinterType || (p.is_default ? 'bw' : 'bw');
      await query(
        `INSERT INTO printers (shop_id, name, printer_type, speed_base_sec, agent_id, agent_status)
         VALUES (1, $1, $2, 10.0, $3, 'online')`,
        [p.name, pType, agent_id]
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
