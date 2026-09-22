'use strict';
/**
 * spec.js — 导入格式规范（AI 识别格式 → 用户确认 → 存模板复用）
 *
 * 规范（spec）是描述"文件排版如何映射到系统字段"的 JSON：
 *  - kind='text'  ：一组 JS 正则（题干/选项/答案/解析/章节/题型），组结构有约定
 *  - kind='excel' ：表头行 + 列名映射（哪列是题干/答案/选项…）
 *
 * 签名（signature）：对格式做"指纹"，同一排版的不同文件命中同一规范。
 *  - text ：前 N 个非空行的"行首模式码"序列哈希
 *  - excel：表头行规范化哈希
 *
 * 流程：上传 → 规则解析 → 结果差时手动「AI 识别格式」→ AI 出 spec → 确认 →
 *       按 spec 解析全文 → 存 import_specs → 下次同格式自动命中。
 */
const crypto = require('node:crypto');
const { parseText } = require('./rules');

const SAMPLE_LINES = 30;   // 文本签名/样例行数
const SAMPLE_CHARS = 4000; // 文本样例字符上限

// ==================== 签名 ====================

/** 单行"行首模式码"：Q=编号开头 O=字母选项 A=答案 E=解析 C=章节标题 T=题型标注 X=其他 */
function lineMode(line) {
  const l = String(line || '').trim();
  if (!l) return null;
  if (/^\d{1,4}\s*[.、．)）]/.test(l)) return 'Q';
  if (/^[A-H]\s*[.、．)）]/.test(l)) return 'O';
  if (/^(?:【答案】|答案|参考答案|正确答案|答)[:：]?\s*/.test(l)) return 'A';
  if (/^【?解析】?[:：]?\s*/.test(l)) return 'E';
  if (/^第\s*[一二三四五六七八九十百零0-9]+\s*[章节篇][节篇]?\s*/.test(l)) return 'C';
  if (/^【?(单选|多选|判断)题?】?[:：]?\s*$/.test(l)) return 'T';
  if (/\[[QJT]\s*\]/.test(l)) return 'M'; // 标记格式
  return 'X';
}

/** 文本格式签名：前 SAMPLE_LINES 个非空行的模式码序列 → sha1 */
function textSignature(text) {
  const modes = String(text || '')
    .replace(/\r\n?/g, '\n').split('\n')
    .map(lineMode).filter((m) => m !== null).slice(0, SAMPLE_LINES);
  return 't:' + crypto.createHash('sha1').update(modes.join(',')).digest('hex').slice(0, 16);
}

/** Excel 表头签名：表头单元格规范化连接 → sha1 */
function excelSignature(headerCells) {
  const norm = (Array.isArray(headerCells) ? headerCells : []).map((c) => String(c).trim()).join('|');
  return 'e:' + crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

/** 文本样例：前 N 行（供 AI 与签名用） */
function textSample(text, n = SAMPLE_LINES) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.trim()).filter((l) => l.length > 0);
  let out = lines.slice(0, n).join('\n');
  if (out.length > SAMPLE_CHARS) out = out.slice(0, SAMPLE_CHARS);
  return out;
}

// ==================== 按规范解析 ====================

/** 组数约定：字段 → 需要的捕获组数（含第0组全长共 N+1 组） */
const TEXT_GROUP_RULE = {
  stem: 2,        // 题干（可含题号组=2 组，也可只有题干=1 组）→ exec 后 length≥2
  options: 3,     // 字母 + 文本 → length=3
  answer: 2,      // 答案 → length=2
  explanation: 2, // 解析 → length=2
  chapter: 3,     // 前缀 + 章节名 → length=3
  chapterTitle: 2,
  typeMark: 2,
};

/**
 * 校验文本规范：正则可编译；对样例逐行匹配时捕获组数符合约定
 * @returns {string|null} 错误信息；null=通过
 */
function validateTextSpec(spec, sample) {
  const lines = String(sample || '').replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.trim()).filter((l) => l.length > 0).slice(0, 20);
  for (const [k, needLen] of Object.entries(TEXT_GROUP_RULE)) {
    const r = spec[k] && spec[k].regex;
    if (!r) continue; // 未提供 = 忽略该字段
    let re;
    try { re = new RegExp(r); } catch (e) { return `${k} 正则语法错误：${e.message}`; }
    if (re.global || re.sticky) return `${k} 正则不能带 g/y 标志`;
    // 对样例每行 exec：只要有一行匹配，就必须满足组数约定
    let matched = false;
    for (const l of lines) {
      const m = re.exec(l);
      if (m) {
        matched = true;
        if (m.length < needLen) {
          return `${k} 正则捕获组数量不对（需要 ${needLen - 1} 个捕获组，实际 ${m.length - 1} 个）`;
        }
        break;
      }
    }
    if (!matched && k === 'stem') return '题干正则与文件样例不匹配，请检查后重试';
  }
  return null;
}

/**
 * 文本按规范解析：spec 正则覆盖默认规则后走规则通道
 * @param {string} text
 * @param {object} spec { kind:'text', stem:{regex}, options:{regex}, answer:{regex},
 *                       explanation:{regex}, chapter:{regex}, chapterTitle:{regex},
 *                       typeMark:{regex}, defaultType?:'single'|'multiple'|'judge'|null }
 * @returns {{questions:Array, failed:Array<string>}}
 */
function parseTextWithSpec(text, spec) {
  const re = spec && spec.kind === 'text' ? spec : null;
  const customRe = {};
  if (re) {
    if (re.stem && re.stem.regex) customRe.qStart = new RegExp(re.stem.regex);
    if (re.options && re.options.regex) customRe.optStart = new RegExp(re.options.regex);
    if (re.answer && re.answer.regex) customRe.answer = new RegExp(re.answer.regex);
    if (re.explanation && re.explanation.regex) customRe.explain = new RegExp(re.explanation.regex);
    if (re.chapter && re.chapter.regex) customRe.chapter = new RegExp(re.chapter.regex);
    if (re.chapterTitle && re.chapterTitle.regex) customRe.chapterTitle = new RegExp(re.chapterTitle.regex);
    if (re.typeMark && re.typeMark.regex) customRe.typeMark = new RegExp(re.typeMark.regex);
  }
  const parsed = parseText(text, Object.keys(customRe).length ? customRe : null);
  // 固定题型兜底：规则通道判不出时按 defaultType 填
  const def = re && re.defaultType;
  if (def && ['single', 'multiple', 'judge'].includes(def)) {
    for (const q of parsed.questions) if (!q.type) q.type = def;
  }
  return parsed;
}

/**
 * Excel/CSV 按规范解析：按表头行 + 列名映射逐行生成题目
 * @param {Buffer} buffer
 * @param {object} spec { kind:'excel', headerRow:number, columns:{ stem, answer, options[], explanation?, chapter?, type? } }
 * @returns {{questions:Array, failed:Array<string>, mode:'table', raw:''}}
 */
function parseExcelWithSpec(buffer, spec) {
  const XLSX = require('xlsx');
  const { normalizeQuestion } = require('./rules');
  const questions = [];
  const failed = [];
  if (!spec || spec.kind !== 'excel' || !spec.columns || !spec.columns.stem) {
    return { mode: 'table', questions, failed, raw: '' };
  }
  const cols = spec.columns;
  const colIndex = (row, name) => {
    if (!name) return -1;
    const i = row.findIndex((c) => String(c).trim() === String(name).trim());
    return i;
  };

  const wb = XLSX.read(buffer, { type: 'buffer' });
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    if (rows.length === 0) continue;
    const headerRow = Math.min(Math.max(0, spec.headerRow || 0), rows.length - 1);
    const header = rows[headerRow];
    const iStem = colIndex(header, cols.stem);
    const iAns = colIndex(header, cols.answer);
    const iExp = colIndex(header, cols.explanation);
    const iCh = colIndex(header, cols.chapter);
    const iType = colIndex(header, cols.type);
    const optIdx = (Array.isArray(cols.options) ? cols.options : []).map((n) => colIndex(header, n)).filter((i) => i >= 0);

    if (iStem < 0) {
      for (let r = headerRow + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.every((c) => String(c).trim() === '')) continue;
        failed.push(`行 ${r + 1}：表头中未找到题干列「${cols.stem}」`);
      }
      continue;
    }

    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c) => String(c).trim() === '')) continue;
      const stem = iStem >= 0 ? String(row[iStem] || '').trim() : '';
      if (!stem) continue;
      const options = optIdx.map((c, idx) => ({
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
      if (!q.answer || q.type === 'unknown') failed.push(`行 ${r + 1}：${stem}`);
      questions.push(q);
    }
  }
  return { mode: 'table', questions, failed, raw: '' };
}

/** Excel 表头 + 样例（供 AI 识别与确认 UI） */
function excelPreview(buffer, maxRows = 5) {
  const XLSX = require('xlsx');
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { headers: [], rows: [] };
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    if (rows.length === 0) return { headers: [], rows: [] };
    const headers = rows[0].map((c) => String(c).trim()).filter((c) => c !== '');
    const samples = rows.slice(1, 1 + maxRows).map((r) =>
      r.map((c) => String(c).trim()).filter((c) => c !== ''));
    return { headers, rows: samples };
  } catch (e) {
    return { headers: [], rows: [] };
  }
}

/**
 * 校验 Excel 规范：columns 结构完整、列名都是字符串
 * @returns {string|null} 错误信息；null=通过
 */
function validateExcelSpec(spec) {
  const cols = spec && spec.columns;
  if (!cols || typeof cols !== 'object') return 'columns 字段缺失';
  if (typeof cols.stem !== 'string' || !cols.stem.trim()) return 'columns.stem（题干列名）不能为空';
  const str = (v, name) => {
    if (v !== undefined && v !== null && v !== '' && typeof v !== 'string') return `${name} 应为字符串`;
    return null;
  };
  const e = str(cols.answer, 'columns.answer') || str(cols.explanation, 'columns.explanation') ||
    str(cols.chapter, 'columns.chapter') || str(cols.type, 'columns.type');
  if (e) return e;
  if (cols.options !== undefined && !Array.isArray(cols.options)) return 'columns.options 应为字符串数组';
  if (Array.isArray(cols.options) && cols.options.some((o) => typeof o !== 'string')) return 'columns.options 应全为字符串';
  return null;
}

// ==================== 规范存取（import_specs 表）====================

function getSpec(db, ownerId, kind, signature) {
  const row = db.prepare('SELECT spec FROM import_specs WHERE owner_id=? AND kind=? AND signature=?')
    .get(ownerId, kind, signature);
  if (!row) return null;
  try { return JSON.parse(row.spec); } catch (e) { return null; }
}

function saveSpec(db, genId, nowLocal, ownerId, kind, signature, spec) {
  db.prepare(
    'INSERT INTO import_specs (id, owner_id, kind, signature, spec, hits, created_at) VALUES (?,?,?,?,?,0,?) ' +
    'ON CONFLICT(owner_id, kind, signature) DO UPDATE SET spec=excluded.spec'
  ).run(genId('spec'), ownerId, kind, signature, JSON.stringify(spec), nowLocal());
}

function bumpSpecHit(db, ownerId, kind, signature) {
  db.prepare('UPDATE import_specs SET hits=hits+1 WHERE owner_id=? AND kind=? AND signature=?')
    .run(ownerId, kind, signature);
}

module.exports = {
  textSignature, excelSignature, textSample, excelPreview,
  parseTextWithSpec, parseExcelWithSpec, validateTextSpec, validateExcelSpec,
  getSpec, saveSpec, bumpSpecHit,
};
