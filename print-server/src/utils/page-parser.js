const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

class PageParser {
  async parse(filePath, ext) {
    const extLower = (ext || path.extname(filePath)).toLowerCase();

    if (extLower === '.pdf') {
      return this._parsePDF(filePath);
    }

    if (['.doc', '.docx'].includes(extLower)) {
      return this._parseWord(filePath);
    }

    if (['.jpg', '.jpeg', '.png', '.bmp', '.heic', '.tiff', '.tif'].includes(extLower)) {
      return 1;
    }

    throw new Error(`不支持的文件格式: ${extLower}`);
  }

  async _parsePDF(filePath) {
    try {
      const buffer = await fs.promises.readFile(filePath);
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return doc.getPageCount();
    } catch (err) {
      console.error('PDF解析失败:', err.message);
      return 1;
    }
  }

  async _parseWord(filePath) {
    try {
      const mammoth = require('mammoth');
      const buffer = await fs.promises.readFile(filePath);
      const result = await mammoth.convertToHtml({ buffer });
      const pageBreaks = (result.value.match(/<div[^>]*page-break[^>]*>/gi) || []).length;
      return Math.max(1, pageBreaks + 1);
    } catch (err) {
      console.warn('Word解析失败，默认1页:', err.message);
      return 1;
    }
  }
}

module.exports = new PageParser();
