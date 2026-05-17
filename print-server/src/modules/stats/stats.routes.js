const Router = require('koa-router');
const auth = require('../../middleware/auth');
const { query } = require('../../config/database');

const router = new Router({ prefix: '/api/stats' });

router.get('/dashboard', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const shopId = ctx.state.shopId;
  const today = new Date().toISOString().slice(0, 10);

  const [todayStats, monthStats, printers] = await Promise.all([
    query(
      `SELECT
         COUNT(*) as total_orders,
         COALESCE(SUM(CASE WHEN status NOT IN ('pending_pay', 'cancelled') THEN total_amount ELSE 0 END), 0) as revenue,
         COUNT(CASE WHEN status = 'paid' THEN 1 END) as waiting,
         COUNT(CASE WHEN status = 'printing' THEN 1 END) as printing,
         COUNT(CASE WHEN status IN ('completed', 'picked') THEN 1 END) as completed
       FROM orders
       WHERE shop_id = $1 AND created_at::date = $2`,
      [shopId, today]
    ),
    query(
      `SELECT
         COUNT(*) as total_orders,
         COALESCE(SUM(CASE WHEN status NOT IN ('pending_pay', 'cancelled') THEN total_amount ELSE 0 END), 0) as revenue
       FROM orders
       WHERE shop_id = $1 AND date_trunc('month', created_at) = date_trunc('month', NOW())`,
      [shopId]
    ),
    query(
      'SELECT id, name, printer_type, agent_status FROM printers WHERE shop_id = $1 AND is_active = true',
      [shopId]
    ),
  ]);

  ctx.body = {
    success: true,
    data: {
      today: todayStats.rows[0],
      month: monthStats.rows[0],
      printers: printers.rows,
    },
  };
});

router.get('/daily', auth({ roles: ['owner'] }), async (ctx) => {
  const { date } = ctx.query;
  const targetDate = date || new Date().toISOString().slice(0, 10);

  const { rows } = await query(
    `SELECT
       color_mode, paper_size, duplex,
       COUNT(*) as count,
       COALESCE(SUM(total_amount), 0) as revenue
     FROM orders
     WHERE shop_id = $1 AND created_at::date = $2 AND status NOT IN ('pending_pay', 'cancelled')
     GROUP BY color_mode, paper_size, duplex
     ORDER BY revenue DESC`,
    [ctx.state.shopId, targetDate]
  );

  ctx.body = { success: true, data: { date: targetDate, breakdown: rows } };
});

router.get('/hourly', auth({ roles: ['owner'] }), async (ctx) => {
  const { date } = ctx.query;
  const targetDate = date || new Date().toISOString().slice(0, 10);

  const { rows } = await query(
    `SELECT
       EXTRACT(HOUR FROM created_at) as hour,
       COUNT(*) as count
     FROM orders
     WHERE shop_id = $1 AND created_at::date = $2
     GROUP BY hour
     ORDER BY hour`,
    [ctx.state.shopId, targetDate]
  );

  ctx.body = { success: true, data: { date: targetDate, hourly: rows } };
});

module.exports = router;
