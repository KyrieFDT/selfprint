const { newDb } = require('pg-mem');
const fs = require('fs');
const path = require('path');

const db = newDb();

db.public.registerFunction({
  name: 'ceil',
  args: ['float'],
  returns: 'integer',
  implementation: (x) => Math.ceil(x),
});

db.public.registerFunction({
  name: 'NOW',
  returns: 'timestamp',
  implementation: () => new Date(),
});

const pool = {
  connect: async () => ({
    query: async (sql, params) => {
      try {
        const result = db.public.many(sql.replace(/\$(\d+)/g, (_, n) => {
          const val = params[parseInt(n) - 1];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          return val;
        }));
        return { rows: result, rowCount: result.length };
      } catch (e) {
        db.public.none(sql.replace(/\$(\d+)/g, (_, n) => {
          const val = params[parseInt(n) - 1];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          return val;
        }));
        return { rows: [], rowCount: 0 };
      }
    },
    release: () => {},
  }),
  query: async () => ({ rows: [], rowCount: 0 }),
  on: () => {},
};

const query = async (sql, params = []) => {
  try {
    const result = db.public.many(sql.replace(/\$(\d+)/g, (_, n) => {
      const val = params[parseInt(n) - 1];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
      if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
      return val;
    }));
    return { rows: result, rowCount: result.length };
  } catch (e) {
    return { rows: [], rowCount: 0 };
  }
};

const transaction = async (fn) => {
  const client = {
    query: async (sql, params = []) => {
      try {
        const result = db.public.many(sql.replace(/\$(\d+)/g, (_, n) => {
          const val = params[parseInt(n) - 1];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          return val;
        }));
        return { rows: result, rowCount: result.length };
      } catch (e) {
        return { rows: [], rowCount: 0 };
      }
    },
  };
  return fn(client);
};

function initDevSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'init.sql'), 'utf-8');
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    const cleanStmt = stmt.replace(/--.*$/gm, '').trim();
    if (!cleanStmt) continue;
    if (cleanStmt.toUpperCase().includes('CREATE EXTENSION')) continue;
    if (cleanStmt.toUpperCase().includes('DO $$')) continue;
    if (cleanStmt.toUpperCase().includes('CREATE TYPE')) continue;
    if (cleanStmt.toUpperCase().includes('CREATE OR REPLACE FUNCTION')) continue;

    try {
      if (cleanStmt.toUpperCase().startsWith('CREATE TABLE')) {
        const tableMatch = cleanStmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
        if (tableMatch) {
          const tableName = tableMatch[1];
          try {
            db.public.none(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
          } catch (e) {}
        }
      }

      if (!cleanStmt.toUpperCase().includes('CREATE INDEX') &&
          !cleanStmt.toUpperCase().includes('INSERT INTO')) {
        continue;
      }

      if (cleanStmt.toUpperCase().startsWith('INSERT INTO')) {
        const insertSql = cleanStmt
          .replace(/ON CONFLICT.*DO NOTHING/i, '')
          .replace(/ON CONFLICT.*DO UPDATE.*$/i, '');
        try { db.public.none(insertSql); } catch (e) {}
      }
    } catch (e) {}
  }

  console.log('[DevDB] 内存数据库已初始化');
}

function initDevTables() {
  const tables = [
    `CREATE TABLE shops (id SERIAL PRIMARY KEY, name VARCHAR(100), address VARCHAR(255), phone VARCHAR(20), wx_appid VARCHAR(32), wx_mchid VARCHAR(32), wx_api_key VARCHAR(64), is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP, updated_at TIMESTAMP)`,
    `CREATE TABLE customers (id SERIAL PRIMARY KEY, shop_id INT, wx_openid VARCHAR(64), wx_nickname VARCHAR(100), wx_avatar VARCHAR(512), phone VARCHAR(20), total_orders INT DEFAULT 0, total_spent DECIMAL(12,2) DEFAULT 0, created_at TIMESTAMP, last_visit_at TIMESTAMP)`,
    `CREATE TABLE staffs (id SERIAL PRIMARY KEY, shop_id INT, wx_openid VARCHAR(64), name VARCHAR(50), role VARCHAR(20) DEFAULT 'staff', is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP, updated_at TIMESTAMP)`,
    `CREATE TABLE orders (id SERIAL PRIMARY KEY, order_no VARCHAR(32), shop_id INT, customer_id INT, staff_id INT, status VARCHAR(20) DEFAULT 'pending_pay', total_amount DECIMAL(10,2) DEFAULT 0, paid_amount DECIMAL(10,2) DEFAULT 0, payment_method VARCHAR(20) DEFAULT 'wechat', paid_at TIMESTAMP, file_url VARCHAR(512), file_name VARCHAR(255), file_pages INT DEFAULT 0, format_version VARCHAR(20) DEFAULT 'original', color_mode VARCHAR(10) DEFAULT 'bw', duplex VARCHAR(10) DEFAULT 'single', paper_size VARCHAR(20) DEFAULT 'A4', copies INT DEFAULT 1, layout VARCHAR(10) DEFAULT '1in1', binding VARCHAR(10) DEFAULT 'none', print_range VARCHAR(50), content_scale INT DEFAULT 100, total_sides INT DEFAULT 0, unit_price DECIMAL(10,2) DEFAULT 0, binding_fee DECIMAL(10,2) DEFAULT 0, estimated_seconds INT DEFAULT 0, actual_seconds INT, printer_id INT, is_expedited BOOLEAN DEFAULT FALSE, remark TEXT, created_at TIMESTAMP, started_at TIMESTAMP, completed_at TIMESTAMP, picked_up_at TIMESTAMP, cancelled_at TIMESTAMP, updated_at TIMESTAMP)`,
    `CREATE TABLE price_configs (id SERIAL PRIMARY KEY, shop_id INT, item_key VARCHAR(50), display_name VARCHAR(100), price DECIMAL(10,2), unit VARCHAR(20) DEFAULT '面', sort_order INT DEFAULT 0, is_active BOOLEAN DEFAULT TRUE, updated_at TIMESTAMP)`,
    `CREATE TABLE printers (id SERIAL PRIMARY KEY, shop_id INT, name VARCHAR(100), printer_type VARCHAR(10), speed_base_sec DECIMAL(5,1) DEFAULT 10.0, is_active BOOLEAN DEFAULT TRUE, agent_id VARCHAR(64), agent_status VARCHAR(20) DEFAULT 'offline', last_heartbeat TIMESTAMP, sort_order INT DEFAULT 0, created_at TIMESTAMP, updated_at TIMESTAMP)`,
    `CREATE TABLE shop_configs (id SERIAL PRIMARY KEY, shop_id INT, config_key VARCHAR(50), config_value TEXT, updated_at TIMESTAMP)`,
    `CREATE TABLE operation_logs (id SERIAL PRIMARY KEY, shop_id INT, staff_id INT, action VARCHAR(50), target_type VARCHAR(50), target_id INT, detail TEXT, created_at TIMESTAMP)`,
    `CREATE TABLE payment_transactions (id SERIAL PRIMARY KEY, order_id INT, transaction_id VARCHAR(64), out_trade_no VARCHAR(64), total_fee INT, trade_type VARCHAR(20) DEFAULT 'JSAPI', trade_state VARCHAR(32), created_at TIMESTAMP, updated_at TIMESTAMP)`,
  ];

  for (const sql of tables) {
    try { db.public.none(sql); } catch (e) { console.log('Table error:', e.message.slice(0, 50)); }
  }

  try { db.public.none(`INSERT INTO shops (id, name) VALUES (1, '默认店铺')`); } catch (e) {}
  try { db.public.none(`INSERT INTO price_configs (shop_id, item_key, display_name, price, unit, sort_order) VALUES (1, 'a4_bw_single', 'A4黑白单面', 1.00, '面', 1)`); } catch (e) {}
  try { db.public.none(`INSERT INTO price_configs (shop_id, item_key, display_name, price, unit, sort_order) VALUES (1, 'a4_bw_double', 'A4黑白双面', 1.50, '面', 2)`); } catch (e) {}
  try { db.public.none(`INSERT INTO price_configs (shop_id, item_key, display_name, price, unit, sort_order) VALUES (1, 'a4_color_single', 'A4彩色单面', 3.00, '面', 3)`); } catch (e) {}
  try { db.public.none(`INSERT INTO price_configs (shop_id, item_key, display_name, price, unit, sort_order) VALUES (1, 'a4_color_double', 'A4彩色双面', 5.00, '面', 4)`); } catch (e) {}
  try { db.public.none(`INSERT INTO price_configs (shop_id, item_key, display_name, price, unit, sort_order) VALUES (1, 'a3_multiplier', 'A3倍率', 2.00, '倍', 10)`); } catch (e) {}
  try { db.public.none(`INSERT INTO price_configs (shop_id, item_key, display_name, price, unit, sort_order) VALUES (1, 'copy_premium', '复印溢价倍率', 1.00, '倍', 11)`); } catch (e) {}
  try { db.public.none(`INSERT INTO printers (shop_id, name, printer_type, speed_base_sec, agent_id) VALUES (1, '默认打印机', 'bw', 10.0, 'agent-dev-001')`); } catch (e) {}
  try { db.public.none(`INSERT INTO shop_configs (shop_id, config_key, config_value) VALUES (1, 'business_hours', '{"open":"08:00","close":"22:00"}')`); } catch (e) {}
  try { db.public.none(`INSERT INTO shop_configs (shop_id, config_key, config_value) VALUES (1, 'order_options', '{"duplex":true,"binding":true,"paper_size":true,"layout":true,"print_range":true}')`); } catch (e) {}
  try { db.public.none(`INSERT INTO shop_configs (shop_id, config_key, config_value) VALUES (1, 'defaults', '{"paper_size":"A4","color_mode":"bw","duplex":"single","copies":1}')`); } catch (e) {}
  try { db.public.none(`INSERT INTO shop_configs (shop_id, config_key, config_value) VALUES (1, 'queue_settings', '{"max_queue":20,"auto_cancel_hours":48}')`); } catch (e) {}
  try { db.public.none(`INSERT INTO staffs (shop_id, wx_openid, name, role) VALUES (1, 'dev_openid_staff', '店员小王', 'staff')`); } catch (e) {}
  try { db.public.none(`INSERT INTO staffs (shop_id, wx_openid, name, role) VALUES (1, 'dev_openid_owner', '店主老张', 'owner')`); } catch (e) {}

  console.log('[DevDB] 表结构和种子数据已创建');
}

initDevTables();

module.exports = { pool, query, transaction };
