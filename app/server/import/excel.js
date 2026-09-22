'use strict';
/**
 * excel.js — Excel/CSV 题库解析
 * 两种模式：
 *  1) 表格式：存在含「题干/题目/问题」的表头行 → 按列映射生成题目
 *  2) 文本式：无结构化表头 → 每行单元格以 Tab 连接，交给规则通道
 */
const XLSX = require('xlsx');
const { parseText, normalizeQuestion } = require('./rules');

const STEM_KEYS = /题干|题目|问题|question|stem|title/i;
const OPT_KEYS = /^选项|option|^A\b/i;
const ANS_KEYS = /答案|answer|参考答案/i;
const EXP_KEYS = /解析|讲解|explanation/i;
const CH_KEYS = /章节|知识点|考点|chapter/i;
const TYPE_KEYS = /题型|type/i;

function pickHeader(cols, re) {
  const i = cols.findIndex((c) => re.test(String(c).trim()));
  return i;
}

function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const questions = [];
  const failed = [];
  const textLines = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

    // ---- 模式 1：表格式 ----
    const headerIdx = rows.findIndex((r) => r.some((c) => STEM_KEYS.test(String(c).trim())));
    if (headerIdx >= 0) {
      const header = rows[headerIdx];
      const iStem = pickHeader(header, STEM_KEYS);
      const iAns = pickHeader(header, ANS_KEYS);
      const iExp = pickHeader(header, EXP_KEYS);
      const iCh = pickHeader(header, CH_KEYS);
      const iType = pickHeader(header, TYPE_KEYS);
      // 选项列：匹配 选项A/A/选项1 或 直接 A/B/C/D 作为单独列
      const optCols = [];
      for (let c = 0; c < header.length; c++) {
        const h = String(header[c]).trim();
        if (/^(选项\s*[A-H]|[A-H]\s*$|option\s*[A-H]|选项\s*\d|\d\s*$)/i.test(h)) optCols.push(c);
      }

      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.every((c) => String(c).trim() === '')) continue;
        const stem = String(row[iStem] || '').trim();
        if (!stem) continue;
        const options = optCols.map((c, idx) => ({
          k: String.fromCharCode(65 + idx),
          text: String(row[c] || '').trim(),
        })).filter((o) => o.text !== '');

        const q = {
          seq: questions.length + 1,
          type: iType >= 0 ? String(row[iType]).trim() : null,
          stem,
          options,
          answer: iAns >= 0 ? String(row[iAns]).trim() : '',
          explanation: iExp >= 0 ? String(row[iExp]).trim() : '',
          chapter: iCh >= 0 ? String(row[iCh]).trim() : null,
          confidence: 0.9,
        };
        normalizeQuestion(q);
        if (!q.answer || q.type === 'unknown') {
          failed.push(`行 ${r + 1}：${stem}`);
        }
        questions.push(q);
      }
      continue;
    }

    // ---- 模式 2：文本式 ----
    for (const row of rows) {
      const line = row.map((c) => String(c).trim()).filter((c) => c !== '').join('\t');
      if (line) textLines.push(line);
    }
  }

  if (questions.length === 0 && textLines.length > 0) {
    const parsed = parseText(textLines.join('\n'));
    return {
      mode: 'text',
      questions: parsed.questions,
      failed: [...failed, ...parsed.failed],
      raw: textLines.join('\n').slice(0, 2000),
    };
  }

  return { mode: 'table', questions, failed, raw: '' };
}

module.exports = { parseExcel };
