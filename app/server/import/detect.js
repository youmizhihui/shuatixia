'use strict';
/**
 * detect.js — 文件格式探测（扩展名 + 内容嗅探）
 * 返回 'excel' | 'word' | 'pdf' | 'unknown'
 */

function sniffZip(buf) {
  const s = buf.toString('latin1');
  if (s.includes('xl/')) return 'excel';
  if (s.includes('word/')) return 'word';
  return 'unknown';
}

function detectFormat(filename, buffer) {
  const name = (filename || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';

  if (buffer && buffer.length >= 4) {
    const magic = buffer.slice(0, 4).toString('latin1');
    if (magic.startsWith('%PDF')) return 'pdf';
    if (magic.startsWith('PK')) {
      const z = sniffZip(buffer);
      if (z !== 'unknown') return z;
    }
    // RTF / txt / md 按扩展名继续
  }

  switch (ext) {
    case 'pdf': return 'pdf';
    case 'docx': return 'word';
    case 'xlsx':
    case 'xls':
    case 'csv': return 'excel';
    case 'txt':
    case 'md':
    case 'rtf': return 'text';
    default: return 'unknown';
  }
}

module.exports = { detectFormat };
