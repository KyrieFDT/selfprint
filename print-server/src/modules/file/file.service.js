const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { PDFDocument } = require('pdf-lib');
const { getUploadPath, UPLOAD_DIR } = require('../../utils/storage');

const LIBREOFFICE_PATHS = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
];
let libreOfficePath = null;

function findLibreOffice() {
  if (libreOfficePath !== null) return libreOfficePath;
  for (const p of LIBREOFFICE_PATHS) {
    if (fs.existsSync(p)) { libreOfficePath = p; return p; }
  }
  libreOfficePath = false;
  return null;
}

const MAX_PREVIEW_PAGES = 50;

async function generatePreviews(filePath, ext, pages, dateStr) {
  const urls = [];
  let totalPages = pages || 0;
  const baseName = uuidv4();

  if (ext === '.pdf') {
    try {
      const previewDir = path.join(UPLOAD_DIR, dateStr, 'previews');
      if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });

      const pdfBuffer = fs.readFileSync(filePath);
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
      totalPages = pdfDoc.getPageCount();
      const previewCount = Math.min(totalPages, MAX_PREVIEW_PAGES);

      for (let i = 0; i < previewCount; i++) {
        const subDoc = await PDFDocument.create();
        const [copiedPage] = await subDoc.copyPages(pdfDoc, [i]);
        subDoc.addPage(copiedPage);
        const pageBytes = await subDoc.save();
        const pagePath = path.join(previewDir, `${baseName}_p${i + 1}.pdf`);
        fs.writeFileSync(pagePath, pageBytes);

        const relPath = path.relative(UPLOAD_DIR, pagePath).replace(/\\/g, '/');
        urls.push(`/api/files/preview/${relPath}`);
      }
    } catch (err) {
      console.error('[Preview] PDF preview generation failed:', err.message);
      const fb = fallbackPreview(filePath, ext, UPLOAD_DIR);
      return { urls: fb, total_pages: totalPages, preview_count: fb.length, truncated: false };
    }
    return { urls, total_pages: totalPages, preview_count: urls.length, truncated: totalPages > MAX_PREVIEW_PAGES };
  }

  if (['.doc', '.docx'].includes(ext)) {
    try {
      const previewDir = path.join(UPLOAD_DIR, dateStr, 'previews');
      if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });

      const pdfOutput = path.join(previewDir, `${baseName}_converted.pdf`);
      const soPath = findLibreOffice();
      if (!soPath) throw new Error('LibreOffice not found');
      await new Promise((resolve, reject) => {
        const cmd = `"${soPath}" --headless --convert-to pdf --outdir "${previewDir}" "${filePath}"`;
        exec(cmd, { timeout: 30000 }, (err) => {
          if (err) reject(err); else resolve();
        });
      });

      let convPath = path.join(previewDir, path.basename(filePath, ext) + '.pdf');
      if (!fs.existsSync(convPath)) {
        const altPath = path.join(previewDir, path.basename(filePath).replace(/\.[^.]+$/, '.pdf'));
        if (fs.existsSync(altPath)) convPath = altPath;
      }
      if (fs.existsSync(convPath)) {
        fs.renameSync(convPath, pdfOutput);
      }

      if (fs.existsSync(pdfOutput)) {
        return generatePreviews(pdfOutput, '.pdf', pages, dateStr);
      }
    } catch (err) {
      console.error('[Preview] Word preview generation failed:', err.message);
    }
    return { urls: [], total_pages: 0, preview_count: 0, truncated: false };
  }

  if (['.jpg', '.jpeg', '.png', '.bmp', '.heic', '.tiff', '.tif'].includes(ext)) {
    const relPath = path.relative(UPLOAD_DIR, filePath).replace(/\\/g, '/');
    urls.push(`/api/files/preview/${relPath}`);
    return { urls, total_pages: 1, preview_count: 1, truncated: false };
  }

  return { urls: [], total_pages: 0, preview_count: 0, truncated: false };
}

function fallbackPreview(filePath, uploadDir) {
  console.log('[Preview] Using fallback - serving original file');
  const relPath = path.relative(uploadDir, filePath).replace(/\\/g, '/');
  return [`/api/files/preview/${relPath}`];
}

async function formatDocument(filePath, ext) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  const outputDir = path.join(UPLOAD_DIR, dateStr, 'formatted');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const baseName = uuidv4();
  const pdfOutput = path.join(outputDir, `${baseName}.pdf`);

  if (ext === '.pdf') {
    try {
      const pdfBuffer = fs.readFileSync(filePath);
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const newDoc = await PDFDocument.create();

      for (const page of pages) {
        const { width, height } = page.getSize();
        const [copiedPage] = await newDoc.copyPages(pdfDoc, [pages.indexOf(page)]);
        copiedPage.setSize(width, height);
        newDoc.addPage(copiedPage);
      }

      const newBytes = await newDoc.save();
      fs.writeFileSync(pdfOutput, newBytes);
    } catch (err) {
      console.error('[Format] PDF format failed:', err.message);
      throw err;
    }
    return pdfOutput;
  }

  if (['.doc', '.docx'].includes(ext)) {
    try {
      const soPath2 = findLibreOffice();
      if (!soPath2) throw new Error('LibreOffice not found');
      await new Promise((resolve, reject) => {
        const cmd = `"${soPath2}" --headless --convert-to pdf --outdir "${outputDir}" "${filePath}"`;
        exec(cmd, { timeout: 30000 }, (err) => {
          if (err) reject(err); else resolve();
        });
      });

      const expectedPath = path.join(outputDir, path.basename(filePath, ext) + '.pdf');
      if (fs.existsSync(expectedPath)) {
        fs.renameSync(expectedPath, pdfOutput);
      }
    } catch (err) {
      console.error('[Format] Word format failed:', err.message);
      throw err;
    }
    return pdfOutput;
  }

  return filePath;
}

module.exports = { generatePreviews, formatDocument, MAX_PREVIEW_PAGES };
