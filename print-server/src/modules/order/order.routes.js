const Router = require('koa-router');
const auth = require('../../middleware/auth');
const { query, transaction } = require('../../config/database');
const { redis } = require('../../config/redis');
const { generateOrderNo } = require('../../utils/order-no');
const fileService = require('../file/file.service');
const queueEngine = require('../queue/queue.engine');
const configService = require('../config-mgr/config.service');

const router = new Router({ prefix: '/api/orders' });

router.post('/calc-price', auth(), async (ctx) => {
  const params = ctx.request.body;
  try {
    const prices = await configService.getPrices(ctx.state.shopId);
    const PriceCalc = require('../../utils/price-calc');
    const calc = new PriceCalc(prices);
    const result = calc.calculate(params);
    ctx.body = { success: true, data: result };
  } catch (err) {
    ctx.status = 400;
    ctx.body = { success: false, message: err.message };
  }
});

router.post('/create', auth(), async (ctx) => {
  const body = ctx.request.body;
  const shopId = ctx.state.shopId;
  const customerId = ctx.state.customerId;

  const prices = await configService.getPrices(shopId);
  const PriceCalc = require('../../utils/price-calc');
  const calc = new PriceCalc(prices);
  const priceResult = calc.calculate(body);

  const orderNo = generateOrderNo(shopId);

  const result = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO orders (
        order_no, shop_id, customer_id, status,
        total_amount, file_url, file_name, file_pages, format_version,
        color_mode, duplex, paper_size, copies, layout, binding, print_range,
        total_sides, unit_price, binding_fee, estimated_seconds, content_scale
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING id, order_no, total_amount, status, created_at`,
      [
        orderNo, shopId, customerId, 'pending_pay',
        priceResult.total_amount, body.file_id, body.file_name, body.file_pages, body.format_version || 'original',
        body.color_mode || 'bw', body.duplex || 'single', body.paper_size || 'A4',
        body.copies || 1, body.layout || '1in1', body.binding || 'none', body.print_range || null,
        priceResult.total_sides, priceResult.unit_price, priceResult.binding_fee,
        priceResult.estimated_seconds,
        body.content_scale || 100,
      ]
    );

    return rows[0];
  });

  if (!result) {
    ctx.status = 500;
    ctx.body = { success: false, message: '订单创建失败，请重试' };
    return;
  }

  const payParams = {
    timeStamp: String(Math.floor(Date.now() / 1000)),
    nonceStr: Math.random().toString(36).slice(2),
    package: `prepay_id=${orderNo}`,
    signType: 'RSA',
    paySign: 'DEV_SIGN',
  };

  ctx.body = {
    success: true,
    data: {
      order_id: result.id,
      order_no: result.order_no,
      total_amount: parseFloat(result.total_amount),
      status: result.status,
      created_at: result.created_at,
      pay_params: payParams,
    },
  };
});

router.get('/my', auth(), async (ctx) => {
  const { page = 1, limit = 20 } = ctx.query;
  const offset = (page - 1) * limit;

  const { rows } = await query(
    `SELECT id, order_no, status, total_amount, file_name, file_pages,
            paper_size, color_mode, duplex, copies, created_at
     FROM orders
     WHERE customer_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [ctx.state.customerId, limit, offset]
  );

  const { rows: countRows } = await query(
    'SELECT COUNT(*) as total FROM orders WHERE customer_id = $1',
    [ctx.state.customerId]
  );

  ctx.body = {
    success: true,
    data: {
      list: rows,
      total: parseInt(countRows[0].total),
      page: parseInt(page),
    },
  };
});

router.get('/:id', auth(), async (ctx) => {
  const { rows } = await query(
    `SELECT o.*, c.wx_nickname as customer_name
     FROM orders o
     LEFT JOIN customers c ON o.customer_id = c.id
     WHERE o.id = $1 AND o.shop_id = $2`,
    [ctx.params.id, ctx.state.shopId]
  );

  if (rows.length === 0) {
    ctx.status = 404;
    ctx.body = { success: false, message: '订单不存在' };
    return;
  }

  const order = rows[0];
  const queueInfo = await queueEngine.getQueuePosition(ctx.state.shopId, order.id);

  ctx.body = {
    success: true,
    data: { ...order, queue_position: queueInfo.position, queue_total: queueInfo.total },
  };
});

router.post('/:id/format', auth(), async (ctx) => {
  const { rows } = await query(
    'SELECT id, file_url, file_name FROM orders WHERE id = $1 AND customer_id = $2',
    [ctx.params.id, ctx.state.customerId]
  );

  if (rows.length === 0) {
    ctx.status = 404;
    ctx.body = { success: false, message: '订单不存在' };
    return;
  }

  const order = rows[0];
  const path = require('path');
  const { getAbsPath } = require('../../utils/storage');
  const filePath = getAbsPath(order.file_url);
  const ext = path.extname(order.file_name).toLowerCase();

  const formatPath = await fileService.formatDocument(filePath, ext);
  const { getRelPath } = require('../../utils/storage');
  const formatRelPath = getRelPath(formatPath);

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  const previewResult = await fileService.generatePreviews(formatPath, '.pdf', 999, dateStr);

  await query(
    'UPDATE orders SET file_url = $1, format_version = $2, updated_at = NOW() WHERE id = $3',
    [formatRelPath, 'formatted', order.id]
  );

  ctx.body = {
    success: true,
    data: {
      file_id: formatRelPath,
      preview_urls: previewResult.urls,
      preview_truncated: previewResult.truncated || false,
      preview_total_pages: previewResult.total_pages || 0,
    },
  };
});

router.put('/:id/cancel', auth(), async (ctx) => {
  const isStaff = ['staff', 'owner'].includes(ctx.state.role);
  const { rows } = await query(
    isStaff
      ? 'SELECT id, status FROM orders WHERE id = $1 AND shop_id = $2'
      : 'SELECT id, status FROM orders WHERE id = $1 AND customer_id = $2',
    isStaff ? [ctx.params.id, ctx.state.shopId] : [ctx.params.id, ctx.state.customerId]
  );

  if (rows.length === 0) {
    ctx.status = 404;
    ctx.body = { success: false, message: '订单不存在' };
    return;
  }

  if (!['pending_pay', 'paid'].includes(rows[0].status)) {
    ctx.status = 400;
    ctx.body = { success: false, message: '当前状态不可取消' };
    return;
  }

  await query(
    "UPDATE orders SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1",
    [ctx.params.id]
  );

  if (rows[0].status === 'paid') {
    await queueEngine.dequeue(ctx.state.shopId, ctx.params.id);
  }

  ctx.body = { success: true, message: '已取消' };
});

module.exports = router;
