const config = require('../config');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', config.upload.dir);

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function getUploadPath(dateStr, filename) {
  const dir = path.join(UPLOAD_DIR, dateStr);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, filename);
}

function getRelPath(fullPath) {
  return path.relative(UPLOAD_DIR, fullPath).replace(/\\/g, '/');
}

function getAbsPath(relPath) {
  return path.join(UPLOAD_DIR, relPath);
}

module.exports = { ensureUploadDir, getUploadPath, getRelPath, getAbsPath, UPLOAD_DIR };
