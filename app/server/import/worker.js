'use strict';
/**
 * worker.js — 识别引擎统一入口
 * 流程：格式探测 → 解析器抽取 → 规则通道结构化 → 汇总
 * 对应方案设计 v2.0 第 7 章「识别引擎分层降级链」：规则通道失败部分保留原文 + 手动 [用 AI 解析]
 */
const { detectFormat } = require('./detect');
const { parseExcel } = require('./excel');
const { parseWord } = require('./word');
const { parsePdf } = require('./pdf');
const { parseText } = require('./rules');

const MAX_TEXT = 500000; // 单文件文本抽取上限（保护内存）

function wrapTableResult(result, filename, format) {
  return {
    format,
    name: filename,
    ok: true,
    mode: result.mode,
    questions: result.questions,
    failed: result.failed,
    summary: summarize(result.questions, result.failed),
  };
}

function summarize(questions, failed) {
  const byType = {};
  for (const q of questions) byType[q.type] = (byType[q.type] || 0) + 1;
  const lowConf = questions.filter((q) => q.confidence < 0.6).length;
  const needAi = failed.length + lowConf;
  return {
    total: questions.length,
    failed: failed.length,
    lowConf,
    needAi,
    byType,
  };
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<object>}
 */
async function parseFile(buffer, filename) {
  const format = detectFormat(filename, buffer);
  let text = '';
  let excelResult = null;

  switch (format) {
    case 'excel': {
      excelResult = parseExcel(buffer);
      if (excelResult.mode === 'table' && excelResult.questions.length > 0) {
        return wrapTableResult(excelResult, filename, format);
      }
      text = excelResult.raw || '';
      break;
    }
    case 'word':
      text = await parseWord(buffer);
      break;
    case 'pdf':
      text = await parsePdf(buffer);
      break;
    case 'text':
      text = buffer.toString('utf8');
      break;
    default:
      return { format, name: filename, ok: false, error: '暂不支持的文件格式（支持 .xlsx/.xls/.csv/.docx/.pdf/.txt）' };
  }

  if (!text || !text.trim()) {
    return {
      format,
      name: filename,
      ok: true,
      mode: 'text',
      questions: [],
      failed: [],
      empty: true,
      summary: { total: 0, failed: 0, lowConf: 0, needAi: 0, byType: {} },
      hint: format === 'pdf' ? '未从 PDF 中提取到文本：可能是扫描版/图片型 PDF，可在导入设置中先用 OCR 识别后再导入。' : '未从文件中提取到可识别内容。',
    };
  }

  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
  const parsed = parseText(text);
  const failed = [...(excelResult && excelResult.failed ? excelResult.failed : []), ...parsed.failed];
  return {
    format,
    name: filename,
    ok: true,
    mode: 'text',
    questions: parsed.questions,
    failed,
    raw: text.slice(0, 2000),
    summary: summarize(parsed.questions, failed),
  };
}

module.exports = { parseFile, summarize };
