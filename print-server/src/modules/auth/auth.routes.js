const Router = require('koa-router');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { query } = require('../../config/database');
const auth = require('../../middleware/auth');

const router = new Router({ prefix: '/api/auth' });

router.post('/login', async (ctx) => {
  const { code, nickname, avatar } = ctx.request.body;

  let wxOpenid;
  if (config.env === 'development' && (!code || code === 'dev')) {
    wxOpenid = 'dev_openid_' + (nickname || 'tester');
  } else {
    wxOpenid = 'wx_' + code;
  }

  let { rows } = await query(
    'SELECT id, shop_id, wx_nickname, wx_avatar, phone FROM customers WHERE shop_id = $1 AND wx_openid = $2',
    [1, wxOpenid]
  );

  let customer;
  if (rows.length === 0) {
    rows = await query(
      `INSERT INTO customers (shop_id, wx_openid, wx_nickname, wx_avatar, last_visit_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING id, shop_id, wx_nickname, wx_avatar, phone`,
      [1, wxOpenid, nickname || '用户', avatar || '']
    );
    customer = rows.rows[0];
  } else {
    customer = rows[0];
    await query('UPDATE customers SET last_visit_at = NOW() WHERE id = $1', [customer.id]);
  }

  const staffRows = await query(
    'SELECT id, role FROM staffs WHERE shop_id = $1 AND wx_openid = $2 AND is_active = true',
    [1, wxOpenid]
  );
  const staffInfo = staffRows.rows[0];

  const token = jwt.sign(
    {
      customerId: customer.id,
      shopId: customer.shop_id || 1,
      role: staffInfo?.role || 'customer',
      staffId: staffInfo?.id || null,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  ctx.body = {
    success: true,
    data: {
      token,
      customer: {
        id: customer.id,
        nickname: customer.wx_nickname,
        avatar: customer.wx_avatar,
        phone: customer.phone,
      },
      isStaff: !!staffInfo,
      isOwner: staffInfo?.role === 'owner',
    },
  };
});

router.get('/profile', auth(), async (ctx) => {
  const { rows } = await query(
    'SELECT id, wx_nickname, wx_avatar, phone, total_orders, total_spent FROM customers WHERE id = $1',
    [ctx.state.customerId]
  );
  ctx.body = { success: true, data: rows[0] };
});

module.exports = router;
