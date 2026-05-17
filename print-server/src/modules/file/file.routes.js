const Router = require('koa-router');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');
const auth = require('../../middleware/auth');
const { getUploadPath, getRelPath, getAbsPath, UPLOAD_DIR } = require('../../utils/storage');
const pageParser = require('../../utils/page-parser');
const fileService = require('./file.service');

const router = new Router({ prefix: '/api/files' });

router.post('/upload', auth(), async (ctx) => {
  const file = ctx.request.files?.file;
  if (!file) {
    ctx.status = 400;
    ctx.body = { success: false, message: '请选择文件' };
    return;
  }

  const rawName = file.originalFilename || file.newFilename || 'unknown';
  const sanitizedName = rawName.replace(/[<>&"']/g, '').replace(/\\/g, '/').replace(/\.\./g, '.');
  const ext = path.extname(sanitizedName).toLowerCase();
  const allowedExts = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.bmp', '.heic', '.tiff', '.tif'];
  if (!allowedExts.includes(ext)) {
    ctx.status = 400;
    ctx.body = { success: false, message: `不支持的文件格式: ${ext}` };
    return;
  }

  const dateStr = dayjs().format('YYYY/MM/DD');
  const filename = uuidv4() + ext;
  const destPath = getUploadPath(dateStr, filename);

  fs.copyFileSync(file.filepath || file.path, destPath);

  const fileSize = fs.statSync(destPath).size;
  if (fileSize === 0) {
    fs.unlinkSync(destPath);
    ctx.status = 400;
    ctx.body = { success: false, message: '文件为空，请检查后重新上传' };
    return;
  }

  const relPath = getRelPath(destPath);
  let pages;
  try {
    pages = await pageParser.parse(destPath, ext);
  } catch (err) {
    pages = 1;
  }

  const previewResult = await fileService.generatePreviews(destPath, ext, pages, dateStr);

  ctx.body = {
    success: true,
    data: {
      file_id: relPath,
      file_name: sanitizedName,
      file_pages: pages,
      file_size: fileSize,
      preview_urls: previewResult.urls,
      preview_truncated: previewResult.truncated || false,
      preview_total_pages: previewResult.total_pages || pages,
    },
  };
});

router.get('/preview/:path(.*)', auth({ required: false }), async (ctx) => {
  const fileRelPath = ctx.params.path;
  const absPath = getAbsPath(fileRelPath);

  if (!fs.existsSync(absPath)) {
    ctx.status = 404;
    ctx.body = { success: false, message: '文件不存在或已过期' };
    return;
  }

  const ext = path.extname(absPath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.bmp': 'image/bmp', '.gif': 'image/gif', '.webp': 'image/webp',
    '.pdf': 'application/pdf',
  };

  ctx.set('Content-Type', mimeMap[ext] || 'application/octet-stream');
  ctx.set('Cache-Control', 'private, max-age=3600');
  ctx.body = fs.createReadStream(absPath);
});

module.exports = router;
