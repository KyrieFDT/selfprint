const config = require('./index');

if (process.env.DB_MODE === 'memory') {
  console.log('[DB] 使用内存数据库模式');
  module.exports = require('./dev-database');
} else {
  const { Pool } = require('pg');

  const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    max: config.db.max,
    idleTimeoutMillis: config.db.idleTimeoutMillis,
  });

  pool.on('error', (err) => {
    console.error('[DB] 连接池异常:', err.message);
  });

  async function query(sql, params) {
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount };
    } finally {
      client.release();
    }
  }

  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  module.exports = { pool, query, transaction };
}
