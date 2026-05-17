const cron = require('node-cron');
const { query } = require('../config/database');
const queueEngine = require('../modules/queue/queue.engine');

const STUCK_TIMEOUT_MINUTES = 30;

async function recoverStuckOrders() {
  try {
    const { rows } = await query(
      `UPDATE orders SET
         status = 'paid',
         remark = COALESCE(remark, '') || ' [Agent超时自动回退 ' || NOW()::text || ']',
         updated_at = NOW()
       WHERE status = 'printing'
         AND started_at < NOW() - INTERVAL '${STUCK_TIMEOUT_MINUTES} minutes'
       RETURNING id, shop_id, total_sides, estimated_seconds`,
    );

    if (rows.length > 0) {
      console.log(`[Recovery] 恢复 ${rows.length} 个卡住的订单`);
      for (const order of rows) {
        await queueEngine.enqueue(order.shop_id, order.id, order.estimated_seconds || order.total_sides * 3 + 20);
      }
    }
  } catch (err) {
    console.error('[Recovery] 订单恢复失败:', err.message);
  }
}

async function checkAgentHeartbeat() {
  try {
    await query(
      `UPDATE printers SET agent_status = 'offline', updated_at = NOW()
       WHERE agent_status IN ('online', 'printing', 'idle')
         AND last_heartbeat < NOW() - INTERVAL '5 minutes'`,
    );
  } catch (err) {
    console.error('[Recovery] Agent心跳检查失败:', err.message);
  }
}

function startRecoveryJob() {
  cron.schedule('*/5 * * * *', async () => {
    await checkAgentHeartbeat();
    await recoverStuckOrders();
  });
  console.log('[Recovery] 卡单恢复任务已启动 (每5分钟)');
}

module.exports = { startRecoveryJob, recoverStuckOrders };
