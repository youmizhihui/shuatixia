'use strict';
/**
 * pdf.js — PDF 题库解析（文本型 PDF：直接抽取文本；扫描型暂返回空由上层提示）
 */
const pdfParse = require('pdf-parse');

async function parsePdf(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (e) {
    return '';
  }
}

module.exports = { parsePdf };
