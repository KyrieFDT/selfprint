const { redis } = require('../../config/redis');
const { query, transaction } = require('../../config/database');

class ConfigService {
  constructor() {
    this.CACHE_PREFIX = 'shop_config:';
    this.CACHE_TTL = 3600;
  }

  async getPrices(shopId) {
    const cacheKey = this.CACHE_PREFIX + shopId + ':prices';
    let prices = await redis.get(cacheKey);
    if (prices) return JSON.parse(prices);

    const { rows } = await query(
      'SELECT item_key, price FROM price_configs WHERE shop_id = $1 AND is_active = true',
      [shopId]
    );

    prices = {};
    for (const row of rows) {
      prices[row.item_key] = parseFloat(row.price);
    }

    await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(prices));
    return prices;
  }

  async getOrderOptions(shopId) {
    const cacheKey = this.CACHE_PREFIX + shopId + ':options';
    let options = await redis.get(cacheKey);
    if (options) return JSON.parse(options);

    const { rows } = await query(
      "SELECT config_value FROM shop_configs WHERE shop_id = $1 AND config_key = 'order_options'",
      [shopId]
    );

    options = rows[0]?.config_value || {};
    await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(options));
    return options;
  }

  async getDefaults(shopId) {
    const cacheKey = this.CACHE_PREFIX + shopId + ':defaults';
    let defaults = await redis.get(cacheKey);
    if (defaults) return JSON.parse(defaults);

    const { rows } = await query(
      "SELECT config_value FROM shop_configs WHERE shop_id = $1 AND config_key = 'defaults'",
      [shopId]
    );

    defaults = rows[0]?.config_value || { paper_size: 'A4', color_mode: 'bw', duplex: 'single', copies: 1 };
    await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(defaults));
    return defaults;
  }

  async getBusinessHours(shopId) {
    const { rows } = await query(
      "SELECT config_value FROM shop_configs WHERE shop_id = $1 AND config_key = 'business_hours'",
      [shopId]
    );
    return rows[0]?.config_value || { open: '08:00', close: '22:00' };
  }

  async getQueueSettings(shopId) {
    const { rows } = await query(
      "SELECT config_value FROM shop_configs WHERE shop_id = $1 AND config_key = 'queue_settings'",
      [shopId]
    );
    return rows[0]?.config_value || { max_queue: 20, auto_cancel_hours: 48 };
  }

  async getPrinters(shopId) {
    const { rows } = await query(
      'SELECT id, name, printer_type, speed_base_sec, agent_status, last_heartbeat FROM printers WHERE shop_id = $1 AND is_active = true ORDER BY sort_order',
      [shopId]
    );
    return rows;
  }

  async getCustomerConfig(shopId) {
    const [prices, options, defaults, hours] = await Promise.all([
      this.getPrices(shopId),
      this.getOrderOptions(shopId),
      this.getDefaults(shopId),
      this.getBusinessHours(shopId),
    ]);

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [openH, openM] = (hours.open || '08:00').split(':').map(Number);
    const [closeH, closeM] = (hours.close || '22:00').split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;
    const isOpen = currentMinutes >= openMinutes && currentMinutes <= closeMinutes;

    return {
      prices,
      options,
      defaults,
      is_open: isOpen,
      business_hours: hours,
    };
  }
}

module.exports = new ConfigService();
