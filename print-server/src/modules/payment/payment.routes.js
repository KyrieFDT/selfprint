const Router = require('koa-router');
const config = require('../../config');
const auth = require('../../middleware/auth');
const { query } = require('../../config/database');
const queueEngine = require('../queue/queue.engine');
const { validateStatusChange } = require('../../utils/order-state-machine');

const router = new Router({ prefix: '/api/pay' });

router.post('/unified-order', auth(), async (ctx) => {
  const { order_id } = ctx.request.body;

  const { rows } = await query(
    'SELECT id, order_no, total_amount, status FROM orders WHERE id = $1 AND customer_id = $2',
    [order_id, ctx.state.customerId]
  );

  if (rows.length === 0) {
    ctx.status = 404;
    ctx.body = { success: false, message: '订单不存在' };
    return;
  }

  const order = rows[0];
  if (order.status !== 'pending_pay') {
    ctx.status = 400;
    ctx.body = { success: false, message: '订单状态不正确' };
    return;
  }

  const payParams = {
    timeStamp: String(Math.floor(Date.now() / 1000)),
    nonceStr: Math.random().toString(36).slice(2, 17),
    package: `prepay_id=wx_dev_${order.order_no}`,
    signType: 'RSA',
    paySign: 'DEV_MODE_SIGN',
  };

  await query(
    `INSERT INTO payment_transactions (order_id, out_trade_no, total_fee)
     VALUES ($1, $2, $3)`,
    [order.id, order.order_no, Math.round(parseFloat(order.total_amount) * 100)]
  );

  ctx.body = {
    success: true,
    data: {
      order_id: order.id,
      order_no: order.order_no,
      total_amount: parseFloat(order.total_amount),
      pay_params: payParams,
    },
  };
});

router.post('/notify', async (ctx) => {
  const body = ctx.request.body;

  // 微信支付签名验证
  const isProduction = config.env === 'production';
  if (isProduction) {
    const crypto = require('crypto');
    const sign = body.sign;
    delete body.sign;
    const signStr = Object.keys(body)
      .filter(k => k !== 'sign' && body[k] !== '' && body[k] !== undefined && body[k] !== null)
      .sort()
      .map(k => `${k}=${body[k]}`)
      .join('&') + `&key=${config.wechat.apiKey}`;
    const expectedSign = crypto.createHash('md5').update(signStr).digest('hex').toUpperCase();
    if (sign !== expectedSign) {
      console.error('[Pay] 签名验证失败');
      ctx.status = 400;
      ctx.body = { code: 'FAIL', message: '签名验证失败' };
      return;
    }
  } else {
    console.log('[Pay] 开发模式跳过签名验证');
  }

  const { out_trade_no, transaction_id, total_fee, trade_state } = body;

  if (trade_state !== 'SUCCESS') {
    ctx.body = { code: 'FAIL', message: '支付未成功' };
    return;
  }

  const { rows } = await query(
    'SELECT id, shop_id, total_sides, estimated_seconds FROM orders WHERE order_no = $1 AND status = $2',
    [out_trade_no, 'pending_pay']
  );

  if (rows.length === 0) {
    ctx.body = { code: 'SUCCESS', message: '订单已处理' };
    return;
  }

  const order = rows[0];

  validateStatusChange('pending_pay', 'paid');

  await query(
    `UPDATE orders SET
       status = 'paid', paid_amount = total_amount, paid_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'pending_pay'`,
    [order.id]
  );

  await query(
    'UPDATE payment_transactions SET transaction_id = $1, trade_state = $2, updated_at = NOW() WHERE out_trade_no = $3',
    [transaction_id, trade_state, out_trade_no]
  );

  await queueEngine.enqueue(order.shop_id, order.id, order.estimated_seconds);

  if (ctx.io) {
    ctx.io.to(`shop:${order.shop_id}`).emit('queue_update', {
      type: 'new_order',
      order_id: order.id,
    });
  }

  ctx.body = { code: 'SUCCESS', message: 'OK' };
});

router.get('/query/:orderId', auth(), async (ctx) => {
  const { rows } = await query(
    'SELECT o.status, o.paid_at, pt.transaction_id FROM orders o LEFT JOIN payment_transactions pt ON o.id = pt.order_id WHERE o.id = $1',
    [ctx.params.orderId]
  );

  if (rows.length === 0) {
    ctx.status = 404;
    ctx.body = { success: false, message: '订单不存在' };
    return;
  }

  ctx.body = { success: true, data: rows[0] };
});

router.post('/simulate-pay', auth(), async (ctx) => {
  const { order_id, payment_method = 'wechat' } = ctx.request.body;

  const { rows } = await query(
    'SELECT id, shop_id, total_sides, estimated_seconds, total_amount FROM orders WHERE id = $1 AND customer_id = $2 AND status = $3',
    [order_id, ctx.state.customerId, 'pending_pay']
  );

  if (rows.length === 0) {
    ctx.status = 400;
    ctx.body = { success: false, message: '订单不存在或已支付' };
    return;
  }

  const order = rows[0];

  await query(
    `UPDATE orders SET
       status = 'paid', payment_method = $1,
       paid_amount = total_amount, paid_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [payment_method, order.id]
  );

  await query(
    `INSERT INTO payment_transactions (order_id, out_trade_no, total_fee, trade_state)
     VALUES ($1, $2, $3, 'SUCCESS')`,
    [order.id, 'SIM_' + order.id, Math.round(parseFloat(order.total_amount) * 100)]
  );

  await queueEngine.enqueue(order.shop_id, order.id, order.estimated_seconds);

  if (ctx.io) {
    ctx.io.to(`shop:${order.shop_id}`).emit('queue_update', {
      type: 'new_order',
      order_id: order.id,
    });
  }

  ctx.body = { success: true, message: '模拟支付成功' };
});

module.exports = router;
