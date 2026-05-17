const config = require('./index');

if (process.env.DB_MODE === 'memory') {
  console.log('[Redis] 使用内存Redis模式');
  module.exports = require('./dev-redis');
} else {
  const Redis = require('ioredis');

  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 200, 2000);
    },
    maxRetriesPerRequest: 3,
  });

  redis.on('connect', () => console.log('[Redis] 已连接'));
  redis.on('error', (err) => console.error('[Redis] 错误:', err.message));

  const pub = new Redis({
    host: config.redis.host,
    port: config.redis.port,
  });

  const sub = new Redis({
    host: config.redis.host,
    port: config.redis.port,
  });

  module.exports = { redis, pub, sub };
}
