const RedisMock = require('ioredis-mock');

const redis = new RedisMock();
const pub = new RedisMock();
const sub = new RedisMock();

redis.on('connect', () => console.log('[DevRedis] 内存Redis已就绪'));
pub.on('connect', () => {});
sub.on('connect', () => {});

module.exports = { redis, pub, sub };
