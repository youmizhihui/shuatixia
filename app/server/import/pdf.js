'use strict';
/**
 * pdf.js — PDF 题库解析（文本型 PDF：直接抽取文本；扫描型暂返回空由上层提示）
 * 使用 pdfjs-dist（Node 动态 import ESM build），替代已停维护、存在原型污染风险的 pdf-parse。
 */
let pdfjsPromise = null;
function getPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function parsePdf(buffer) {
  try {
    const pdfjs = await getPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    let text = '';
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        text += (tc.items || []).map((it) => (it && it.str) || '').join(' ') + '\n';
        if (page.cleanup) page.cleanup();
      }
    } finally {
      if (doc.destroy) doc.destroy();
    }
    return text;
  } catch (e) {
    return '';
  }
}

module.exports = { parsePdf };
