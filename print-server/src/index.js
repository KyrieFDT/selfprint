const http = require('http');
const app = require('./app');
const config = require('./config');
const { initSocket } = require('./socket');
const { redis, sub } = require('./config/redis');
const { startCleanupJob } = require('./jobs/file-cleanup');
const { startRecoveryJob } = require('./jobs/stuck-order-recovery');

if (!config.pcAgentSecret && config.env !== 'development') {
  console.error('[FATAL] PC_AGENT_SECRET 未设置，请配置环境变量');
  process.exit(1);
}
if (config.env === 'development' && !config.pcAgentSecret) {
  config.pcAgentSecret = 'agent-dev-secret';
}

const server = http.createServer(app.callback());

const io = initSocket(server);

app.context.io = io;
app.context.redis = redis;
app.context.sub = sub;

startCleanupJob();
startRecoveryJob();

restoreQueue();

server.listen(config.port, () => {
  console.log(`[Server] 自助打印系统已启动: http://localhost:${config.port}`);
  console.log(`[Server] 环境: ${config.env}`);
});

async function restoreQueue() {
  try {
    const { query } = require('./config/database');
    const queueEngine = require('./modules/queue/queue.engine');
    const { rows } = await query(
      "SELECT id, shop_id, estimated_seconds FROM orders WHERE status = 'paid' ORDER BY paid_at ASC"
    );
    if (rows.length > 0) {
      console.log(`[Startup] 恢复 ${rows.length} 个排队订单到队列`);
      for (const order of rows) {
        await queueEngine.enqueue(order.shop_id, order.id, order.estimated_seconds);
      }
    }
  } catch (err) {
    console.error('[Startup] 队列恢复失败:', err.message);
  }
}

module.exports = server;
