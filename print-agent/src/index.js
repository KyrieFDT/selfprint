const agent = require('./agent');

agent.start().catch((err) => {
  console.error('[Agent] 启动失败:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('[Agent] 已停止');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Agent] 已停止');
  process.exit(0);
});
