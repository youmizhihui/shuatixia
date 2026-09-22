'use strict';
/**
 * word.js — Word (docx) 题库解析：抽取纯文本交给规则通道
 */
const mammoth = require('mammoth');

async function parseWord(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

module.exports = { parseWord };
