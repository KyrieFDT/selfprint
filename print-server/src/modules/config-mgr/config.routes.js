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
          `INSERT INTO printers (shop_id, name, printer_type, speed_base_sec, is_active)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [shopId, p.name, p.printer_type, p.speed_base_sec]
        );
      }
    }
  });

  ctx.body = { success: true, message: '打印机配置已更新' };
});

router.get('/printers/active', auth(), async (ctx) => {
  const { rows } = await query(
    "SELECT config_value FROM shop_configs WHERE shop_id = $1 AND config_key = 'active_printer'",
    [ctx.state.shopId]
  );
  ctx.body = { success: true, data: { printer_name: rows[0]?.config_value || null } };
});

// 删除打印机（软删除：设置 is_active = false）
router.delete('/printers/:id', auth({ roles: ['owner'] }), async (ctx) => {
  const printerId = parseInt(ctx.params.id);
  const shopId = ctx.state.shopId;

  const { rows } = await query(
    'SELECT id, name FROM printers WHERE id = $1 AND shop_id = $2',
    [printerId, shopId]
  );
  if (rows.length === 0) {
    ctx.status = 404;
    ctx.body = { success: false, message: '打印机不存在' };
    return;
  }

  await query(
    "UPDATE printers SET is_active = FALSE, agent_id = NULL, agent_status = 'offline', updated_at = NOW() WHERE id = $1",
    [printerId]
  );

  // 如果选中的正是被删的打印机，清理 active_printer
  const { rows: activeRows } = await query(
    "SELECT config_value FROM shop_configs WHERE shop_id = $1 AND config_key = 'active_printer'",
    [shopId]
  );
  if (activeRows[0]?.config_value === rows[0].name) {
    await query(
      "DELETE FROM shop_configs WHERE shop_id = $1 AND config_key = 'active_printer'",
      [shopId]
    );
  }

  await query(
    'INSERT INTO operation_logs (shop_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)',
    [shopId, 'printer_deleted', 'printer', printerId, JSON.stringify({ name: rows[0].name })]
  );

  ctx.body = { success: true, message: '打印机已删除' };
});

// 选择当前使用的打印机（店主从后台下拉切换）
router.put('/printers/select', auth({ roles: ['owner'] }), async (ctx) => {
  const { printer_name } = ctx.request.body;
  const shopId = ctx.state.shopId;

  if (!printer_name) {
    ctx.status = 400;
    ctx.body = { success: false, message: '请指定打印机名称' };
    return;
  }

  // 验证打印机存在
  const { rows } = await query(
    'SELECT id FROM printers WHERE shop_id = $1 AND name = $2 AND is_active = true',
    [shopId, printer_name]
  );
  if (rows.length === 0) {
    ctx.status = 400;
    ctx.body = { success: false, message: '打印机不存在' };
    return;
  }

  // pg-mem 不兼容 ON CONFLICT，用先删后插
  await query(
    "DELETE FROM shop_configs WHERE shop_id = $1 AND config_key = 'active_printer'",
    [shopId]
  );
  await query(
    "INSERT INTO shop_configs (shop_id, config_key, config_value, updated_at) VALUES ($1, 'active_printer', $2, NOW())",
    [shopId, printer_name]
  );

  // 通过 WebSocket 通知代理切换打印机
  const io = ctx.app.context.io;
  if (io) {
    io.emit('printer_change', { printer_name });
  }

  await query(
    'INSERT INTO operation_logs (shop_id, action, target_type, detail) VALUES ($1, $2, $3, $4)',
    [shopId, 'printer_selected', 'printer', JSON.stringify({ printer_name })]
  );

  ctx.body = { success: true, message: `已切换为: ${printer_name}` };
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
