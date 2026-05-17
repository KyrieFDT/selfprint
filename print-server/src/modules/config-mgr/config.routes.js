const Router = require('koa-router');
const auth = require('../../middleware/auth');
const { query, transaction } = require('../../config/database');
const { redis } = require('../../config/redis');
const configService = require('./config.service');

const router = new Router({ prefix: '/api/config' });

router.get('/customer', auth(), async (ctx) => {
  const data = await configService.getCustomerConfig(ctx.state.shopId);
  ctx.body = { success: true, data };
});

router.get('/prices', auth(), async (ctx) => {
  const { rows } = await query(
    'SELECT id, item_key, display_name, price, unit, sort_order, is_active FROM price_configs WHERE shop_id = $1 ORDER BY sort_order',
    [ctx.state.shopId]
  );
  ctx.body = { success: true, data: rows };
});

router.put('/prices', auth({ roles: ['owner'] }), async (ctx) => {
  const { prices } = ctx.request.body;
  const shopId = ctx.state.shopId;

  await transaction(async (client) => {
    for (const item of prices) {
      await client.query(
        `INSERT INTO price_configs (shop_id, item_key, display_name, price, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (shop_id, item_key) DO UPDATE SET price = $4, updated_at = NOW()`,
        [shopId, item.item_key, item.display_name || item.item_key, item.price]
      );
    }
  });

  const cacheKey = configService.CACHE_PREFIX + shopId + ':prices';
  await redis.del(cacheKey);

  await query(
    'INSERT INTO operation_logs (shop_id, action, target_type, detail) VALUES ($1, $2, $3, $4)',
    [shopId, 'price_updated', 'price_config', JSON.stringify(prices)]
  );

  ctx.body = { success: true, message: '定价已更新' };
});

router.get('/printers', auth(), async (ctx) => {
  const rows = await configService.getPrinters(ctx.state.shopId);
  ctx.body = { success: true, data: rows };
});

router.put('/printers', auth({ roles: ['owner'] }), async (ctx) => {
  const { printers } = ctx.request.body;
  const shopId = ctx.state.shopId;

  await transaction(async (client) => {
    for (const p of printers) {
      if (p.id) {
        await client.query(
          `UPDATE printers SET name = $1, printer_type = $2, speed_base_sec = $3, updated_at = NOW()
           WHERE id = $4 AND shop_id = $5`,
          [p.name, p.printer_type, p.speed_base_sec, p.id, shopId]
        );
      } else {
        await client.query(
          `INSERT INTO printers (shop_id, name, printer_type, speed_base_sec)
           VALUES ($1, $2, $3, $4)`,
          [shopId, p.name, p.printer_type, p.speed_base_sec]
        );
      }
    }
  });

  ctx.body = { success: true, message: '打印机配置已更新' };
});

router.get('/options', auth(), async (ctx) => {
  const options = await configService.getOrderOptions(ctx.state.shopId);
  ctx.body = { success: true, data: options };
});

router.put('/options', auth({ roles: ['owner'] }), async (ctx) => {
  const { options } = ctx.request.body;
  const shopId = ctx.state.shopId;

  await query(
    `INSERT INTO shop_configs (shop_id, config_key, config_value, updated_at)
     VALUES ($1, 'order_options', $2, NOW())
     ON CONFLICT (shop_id, config_key) DO UPDATE SET config_value = $2, updated_at = NOW()`,
    [shopId, JSON.stringify(options)]
  );

  const cacheKey = configService.CACHE_PREFIX + shopId + ':options';
  await redis.del(cacheKey);

  await query(
    'INSERT INTO operation_logs (shop_id, action, target_type, detail) VALUES ($1, $2, $3, $4)',
    [shopId, 'options_updated', 'shop_config', JSON.stringify(options)]
  );

  ctx.body = { success: true, message: '选项配置已更新' };
});

router.get('/defaults', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const defaults = await configService.getDefaults(ctx.state.shopId);
  ctx.body = { success: true, data: defaults };
});

router.put('/defaults', auth({ roles: ['owner'] }), async (ctx) => {
  const { defaults } = ctx.request.body;
  const shopId = ctx.state.shopId;

  await query(
    `INSERT INTO shop_configs (shop_id, config_key, config_value, updated_at)
     VALUES ($1, 'defaults', $2, NOW())
     ON CONFLICT (shop_id, config_key) DO UPDATE SET config_value = $2, updated_at = NOW()`,
    [shopId, JSON.stringify(defaults)]
  );

  const cacheKey = configService.CACHE_PREFIX + shopId + ':defaults';
  await redis.del(cacheKey);

  ctx.body = { success: true, message: '默认值已更新' };
});

router.get('/shop', auth({ roles: ['staff', 'owner'] }), async (ctx) => {
  const [hours, queueSettings] = await Promise.all([
    configService.getBusinessHours(ctx.state.shopId),
    configService.getQueueSettings(ctx.state.shopId),
  ]);
  ctx.body = { success: true, data: { business_hours: hours, queue_settings: queueSettings } };
});

router.put('/shop', auth({ roles: ['owner'] }), async (ctx) => {
  const { business_hours, queue_settings } = ctx.request.body;
  const shopId = ctx.state.shopId;

  if (business_hours) {
    await query(
      `INSERT INTO shop_configs (shop_id, config_key, config_value, updated_at)
       VALUES ($1, 'business_hours', $2, NOW())
       ON CONFLICT (shop_id, config_key) DO UPDATE SET config_value = $2, updated_at = NOW()`,
      [shopId, JSON.stringify(business_hours)]
    );
  }

  if (queue_settings) {
    await query(
      `INSERT INTO shop_configs (shop_id, config_key, config_value, updated_at)
       VALUES ($1, 'queue_settings', $2, NOW())
       ON CONFLICT (shop_id, config_key) DO UPDATE SET config_value = $2, updated_at = NOW()`,
      [shopId, JSON.stringify(queue_settings)]
    );
  }

  ctx.body = { success: true, message: '营业设置已更新' };
});

module.exports = router;
