const Router = require('koa-router');
const auth = require('../../middleware/auth');
const { query } = require('../../config/database');
const queueEngine = require('./queue.engine');

const router = new Router({ prefix: '/api/queue' });

router.get('/staff', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const queue = await queueEngine.getQueue(ctx.state.shopId);

  const { rows: printing } = await query(
    `SELECT o.id, o.order_no, o.file_name, o.file_url, o.started_at, p.name as printer_name
     FROM orders o
     LEFT JOIN printers p ON o.printer_id = p.id
     WHERE o.shop_id = $1 AND o.status = 'printing'
     ORDER BY o.started_at DESC
     LIMIT 5`,
    [ctx.state.shopId]
  );

  const { rows: printers } = await query(
    'SELECT id, name, printer_type, agent_status FROM printers WHERE shop_id = $1 AND is_active = true',
    [ctx.state.shopId]
  );

  ctx.body = {
    success: true,
    data: { queue, printing, printers },
  };
});

router.get('/staff/recent-completed', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const { rows } = await query(
    `SELECT o.id, o.order_no, o.file_name, o.total_amount, o.completed_at,
            c.wx_nickname as customer_name
     FROM orders o
     LEFT JOIN customers c ON o.customer_id = c.id
     WHERE o.shop_id = $1 AND o.status = 'completed'
     ORDER BY o.completed_at DESC
     LIMIT 20`,
    [ctx.state.shopId]
  );

  ctx.body = { success: true, data: rows };
});

router.get('/:orderId/waiting', auth(), async (ctx) => {
  const result = await queueEngine.getWaitingTime(ctx.state.shopId, ctx.params.orderId);
  ctx.body = { success: true, data: result };
});

router.put('/:orderId/start', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const { printer_id } = ctx.request.body;

  const { rows } = await query(
    "SELECT id, status FROM orders WHERE id = $1 AND shop_id = $2",
    [ctx.params.orderId, ctx.state.shopId]
  );

  if (rows.length === 0) {
    ctx.status = 404;
    ctx.body = { success: false, message: '订单不存在' };
    return;
  }

  if (rows[0].status !== 'paid') {
    ctx.status = 400;
    ctx.body = { success: false, message: '订单状态不正确' };
    return;
  }

  await query(
    "UPDATE orders SET status = 'printing', printer_id = $1, started_at = NOW(), updated_at = NOW() WHERE id = $2",
    [printer_id, ctx.params.orderId]
  );

  await queueEngine.dequeue(ctx.state.shopId, parseInt(ctx.params.orderId));

  ctx.body = { success: true, message: '已开始打印' };
});

router.put('/:orderId/complete', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const { is_normal = true, remark = null } = ctx.request.body;

  const { rows } = await query(
    "SELECT id, status, started_at, total_sides, printer_id FROM orders WHERE id = $1 AND shop_id = $2",
    [ctx.params.orderId, ctx.state.shopId]
  );

  if (rows.length === 0) {
    ctx.status = 404;
    ctx.body = { success: false, message: '订单不存在' };
    return;
  }

  if (rows[0].status !== 'printing') {
    ctx.status = 400;
    ctx.body = { success: false, message: '订单状态不正确' };
    return;
  }

  const order = rows[0];
  const actualSeconds = order.started_at
    ? Math.round((Date.now() - new Date(order.started_at).getTime()) / 1000)
    : 0;

  if (is_normal) {
    await query(
      "UPDATE orders SET status = 'completed', actual_seconds = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2",
      [actualSeconds, order.id]
    );

    if (order.printer_id) {
      await queueEngine.calibratePrinterSpeed(
        ctx.state.shopId, order.printer_id, order.total_sides, actualSeconds
      );
    }
  } else {
    await query(
      "UPDATE orders SET status = 'paid', actual_seconds = $1, remark = $2, updated_at = NOW() WHERE id = $3",
      [actualSeconds, remark || '打印异常', order.id]
    );
    await queueEngine.enqueue(ctx.state.shopId, order.id, order.total_sides * 3 + 20);
  }

  ctx.body = {
    success: true,
    data: { order_id: order.id, status: is_normal ? 'completed' : 'paid', actual_seconds: actualSeconds },
  };
});

router.get('/staff/pending-pay', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const { rows } = await query(
    `SELECT o.id, o.order_no, o.file_name, o.file_pages, o.total_amount,
            o.paper_size, o.color_mode, o.duplex, o.copies, o.created_at,
            c.wx_nickname as customer_name
     FROM orders o
     LEFT JOIN customers c ON o.customer_id = c.id
     WHERE o.shop_id = $1 AND o.status = 'pending_pay'
     ORDER BY o.created_at ASC
     LIMIT 50`,
    [ctx.state.shopId]
  );
  ctx.body = { success: true, data: rows };
});

router.put('/:orderId/confirm-pay', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const { rows } = await query(
    "SELECT id, shop_id, total_sides, estimated_seconds, total_amount FROM orders WHERE id = $1 AND shop_id = $2 AND status = 'pending_pay'",
    [ctx.params.orderId, ctx.state.shopId]
  );

  if (rows.length === 0) {
    ctx.status = 400;
    ctx.body = { success: false, message: '订单不存在或状态不正确' };
    return;
  }

  const order = rows[0];

  await query(
    `UPDATE orders SET status = 'paid', payment_method = 'cash',
       paid_amount = total_amount, paid_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [order.id]
  );

  const queueEngine = require('./queue.engine');
  await queueEngine.enqueue(order.shop_id, order.id, order.estimated_seconds);

  ctx.body = { success: true, message: '收款已确认，订单进入打印队列' };
});

router.put('/:orderId/pick', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  await query(
    "UPDATE orders SET status = 'picked', picked_up_at = NOW(), updated_at = NOW() WHERE id = $1 AND shop_id = $2",
    [ctx.params.orderId, ctx.state.shopId]
  );

  ctx.body = { success: true, message: '已取件' };
});

router.put('/:orderId/expedite', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const { rows } = await query(
    "SELECT id FROM orders WHERE id = $1 AND shop_id = $2 AND status = 'paid'",
    [ctx.params.orderId, ctx.state.shopId]
  );

  if (rows.length === 0) {
    ctx.status = 400;
    ctx.body = { success: false, message: '仅排队中的订单可加急' };
    return;
  }

  await query(
    'UPDATE orders SET is_expedited = TRUE, updated_at = NOW() WHERE id = $1',
    [ctx.params.orderId]
  );

  await queueEngine.dequeue(ctx.state.shopId, parseInt(ctx.params.orderId));
  await queueEngine.enqueue(ctx.state.shopId, parseInt(ctx.params.orderId),
    rows[0].total_sides * 3 + 20 - 5);

  ctx.body = { success: true, message: '已加急，将优先处理' };
});

router.post('/create-by-staff', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const body = ctx.request.body;
  const shopId = ctx.state.shopId;
  const { query, transaction } = require('../../config/database');
  const { generateOrderNo } = require('../../utils/order-no');
  const configService = require('../config-mgr/config.service');

  const prices = await configService.getPrices(shopId);
  const PriceCalc = require('../../utils/price-calc');
  const calc = new PriceCalc(prices);
  const priceResult = calc.calculate(body);

  const orderNo = generateOrderNo(shopId);

  const result = await transaction(async (client) => {
    const { rows: custRows } = await client.query(
      'INSERT INTO customers (shop_id, wx_openid, wx_nickname) VALUES ($1, $2, $3) RETURNING id',
      [shopId, 'staff_order_' + orderNo, body.customer_name || '到店顾客']
    );

    const { rows } = await client.query(
      `INSERT INTO orders (
        order_no, shop_id, customer_id, staff_id, status,
        total_amount, payment_method, paid_amount, paid_at,
        file_url, file_name, file_pages,
        color_mode, duplex, paper_size, copies, layout, binding, print_range,
        total_sides, unit_price, binding_fee, estimated_seconds
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING id, order_no, total_amount, status`,
      [
        orderNo, shopId, custRows[0].id, ctx.state.staffId, 'paid',
        priceResult.total_amount, body.payment_method || 'cash', priceResult.total_amount,
        body.file_id, body.file_name, body.file_pages,
        body.color_mode || 'bw', body.duplex || 'single', body.paper_size || 'A4',
        body.copies || 1, body.layout || '1in1', body.binding || 'none', body.print_range || null,
        priceResult.total_sides, priceResult.unit_price, priceResult.binding_fee,
        priceResult.estimated_seconds,
      ]
    );

    return rows[0];
  });

  await queueEngine.enqueue(shopId, result.id, priceResult.estimated_seconds);

  ctx.body = { success: true, data: { order_id: result.id, order_no: result.order_no } };
});

module.exports = router;
