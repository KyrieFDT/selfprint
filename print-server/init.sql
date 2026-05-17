-- ============================================================
-- 自助打印系统 数据库初始化 SQL
-- PostgreSQL 15+
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 枚举类型
DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'pending_pay', 'paid', 'printing', 'completed', 'picked', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE color_mode AS ENUM ('bw', 'color');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE duplex_mode AS ENUM ('single', 'double');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE layout_mode AS ENUM ('1in1', '2in1', '4in1');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE binding_type AS ENUM ('none', 'staple', 'glue', 'punch');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE printer_type AS ENUM ('bw', 'color');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('wechat', 'cash', 'balance');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 店铺表
CREATE TABLE IF NOT EXISTS shops (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  address       VARCHAR(255),
  phone         VARCHAR(20),
  wx_appid      VARCHAR(32),
  wx_mchid      VARCHAR(32),
  wx_api_key    VARCHAR(64),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- 顾客表
CREATE TABLE IF NOT EXISTS customers (
  id            SERIAL PRIMARY KEY,
  shop_id       INT NOT NULL REFERENCES shops(id),
  wx_openid     VARCHAR(64) NOT NULL,
  wx_nickname   VARCHAR(100),
  wx_avatar     VARCHAR(512),
  phone         VARCHAR(20),
  total_orders  INT DEFAULT 0,
  total_spent   DECIMAL(12,2) DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW(),
  last_visit_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(shop_id, wx_openid)
);

CREATE INDEX IF NOT EXISTS idx_customers_openid ON customers(wx_openid);

-- 店员表
CREATE TABLE IF NOT EXISTS staffs (
  id            SERIAL PRIMARY KEY,
  shop_id       INT NOT NULL REFERENCES shops(id),
  wx_openid     VARCHAR(64),
  name          VARCHAR(50) NOT NULL,
  role          VARCHAR(20) DEFAULT 'staff',
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- 订单表
CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  order_no          VARCHAR(32) NOT NULL UNIQUE,
  shop_id           INT NOT NULL REFERENCES shops(id),
  customer_id       INT REFERENCES customers(id),
  staff_id          INT REFERENCES staffs(id),
  status            order_status NOT NULL DEFAULT 'pending_pay',

  total_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_amount       DECIMAL(10,2) DEFAULT 0,
  payment_method    payment_method DEFAULT 'wechat',
  paid_at           TIMESTAMP,

  file_url          VARCHAR(512) NOT NULL,
  file_name         VARCHAR(255) NOT NULL,
  file_pages        INT NOT NULL DEFAULT 0,
  format_version    VARCHAR(20) DEFAULT 'original',  -- 'original' / 'formatted'

  color_mode        color_mode NOT NULL DEFAULT 'bw',
  duplex            duplex_mode NOT NULL DEFAULT 'single',
  paper_size        VARCHAR(20) NOT NULL DEFAULT 'A4',
  copies            INT NOT NULL DEFAULT 1,
  layout            layout_mode NOT NULL DEFAULT '1in1',
  binding           binding_type NOT NULL DEFAULT 'none',
  print_range       VARCHAR(50),

  total_sides       INT NOT NULL DEFAULT 0,
  unit_price        DECIMAL(10,2) NOT NULL DEFAULT 0,
  binding_fee       DECIMAL(10,2) DEFAULT 0,
  estimated_seconds INT NOT NULL DEFAULT 0,

  actual_seconds    INT,
  printer_id        INT,
  is_expedited      BOOLEAN DEFAULT FALSE,
  remark            TEXT,

  created_at        TIMESTAMP DEFAULT NOW(),
  started_at        TIMESTAMP,
  completed_at      TIMESTAMP,
  picked_up_at      TIMESTAMP,
  cancelled_at      TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_shop_status ON orders(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders(paid_at) WHERE status = 'paid';

-- 定价配置表
CREATE TABLE IF NOT EXISTS price_configs (
  id            SERIAL PRIMARY KEY,
  shop_id       INT NOT NULL REFERENCES shops(id),
  item_key      VARCHAR(50) NOT NULL,
  display_name  VARCHAR(100) NOT NULL,
  price         DECIMAL(10,2) NOT NULL,
  unit          VARCHAR(20) NOT NULL DEFAULT '面',
  sort_order    INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  updated_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(shop_id, item_key)
);

-- 打印机配置表
CREATE TABLE IF NOT EXISTS printers (
  id              SERIAL PRIMARY KEY,
  shop_id         INT NOT NULL REFERENCES shops(id),
  name            VARCHAR(100) NOT NULL,
  printer_type    printer_type NOT NULL,
  speed_base_sec  DECIMAL(5,1) NOT NULL DEFAULT 10.0,
  is_active       BOOLEAN DEFAULT TRUE,
  agent_id        VARCHAR(64),
  agent_status    VARCHAR(20) DEFAULT 'offline',
  last_heartbeat  TIMESTAMP,
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- 店面配置表
CREATE TABLE IF NOT EXISTS shop_configs (
  id            SERIAL PRIMARY KEY,
  shop_id       INT NOT NULL REFERENCES shops(id),
  config_key    VARCHAR(50) NOT NULL,
  config_value  JSONB NOT NULL,
  updated_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(shop_id, config_key)
);

-- 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
  id            SERIAL PRIMARY KEY,
  shop_id       INT NOT NULL REFERENCES shops(id),
  staff_id      INT REFERENCES staffs(id),
  action        VARCHAR(50) NOT NULL,
  target_type   VARCHAR(50),
  target_id     INT,
  detail        JSONB,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_shop ON operation_logs(shop_id, created_at DESC);

-- 支付流水表
CREATE TABLE IF NOT EXISTS payment_transactions (
  id              SERIAL PRIMARY KEY,
  order_id        INT NOT NULL REFERENCES orders(id),
  transaction_id  VARCHAR(64),
  out_trade_no    VARCHAR(64) NOT NULL,
  total_fee       INT NOT NULL,
  trade_type      VARCHAR(20) DEFAULT 'JSAPI',
  trade_state     VARCHAR(32),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- 默认数据插入（店铺1）
INSERT INTO shops (id, name) VALUES (1, '默认店铺')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO price_configs (shop_id, item_key, display_name, price, unit, sort_order) VALUES
  (1, 'a4_bw_single',   'A4黑白单面',  1.00, '面', 1),
  (1, 'a4_bw_double',   'A4黑白双面',  1.50, '面', 2),
  (1, 'a4_color_single', 'A4彩色单面', 3.00, '面', 3),
  (1, 'a4_color_double', 'A4彩色双面', 5.00, '面', 4),
  (1, 'a3_multiplier',   'A3倍率',     2.00, '倍', 10),
  (1, 'copy_premium',    '复印溢价倍率', 1.00, '倍', 11)
  ON CONFLICT (shop_id, item_key) DO NOTHING;

INSERT INTO printers (shop_id, name, printer_type, speed_base_sec) VALUES
  (1, '默认打印机', 'bw', 10.0)
  ON CONFLICT DO NOTHING;

INSERT INTO shop_configs (shop_id, config_key, config_value) VALUES
  (1, 'business_hours', '{"open":"08:00","close":"22:00"}'),
  (1, 'order_options',  '{"duplex":true,"binding":true,"paper_size":true,"layout":true,"print_range":true}'),
  (1, 'defaults',       '{"paper_size":"A4","color_mode":"bw","duplex":"single","copies":1}'),
  (1, 'queue_settings', '{"max_queue":20,"auto_cancel_hours":48}')
  ON CONFLICT (shop_id, config_key) DO NOTHING;
