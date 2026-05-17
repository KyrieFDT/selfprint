const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { UPLOAD_DIR } = require('../utils/storage');
const config = require('../config');

function cleanupOldFiles() {
  const now = Date.now();
  const maxAge = config.upload.retentionHours * 3600 * 1000;

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        try {
          const remaining = fs.readdirSync(fullPath);
          if (remaining.length === 0) {
            fs.rmdirSync(fullPath);
          }
        } catch (e) { /* ignore */ }
      } else {
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > maxAge) {
            fs.unlinkSync(fullPath);
            console.log(`[Cleanup] 已删除: ${path.relative(UPLOAD_DIR, fullPath)}`);
          }
        } catch (e) { /* ignore */ }
      }
    }
  }

  walk(UPLOAD_DIR);
  console.log('[Cleanup] 文件清理完成');
}

function startCleanupJob() {
  cron.schedule('0 * * * *', () => {
    cleanupOldFiles();
  });

  console.log('[Cleanup] 定时任务已启动 (每小时执行)');
}

module.exports = { cleanupOldFiles, startCleanupJob };
