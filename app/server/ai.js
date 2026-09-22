'use strict';
/**
 * ai.js — ★ 全部 AI 调用集中于此（可审计）
 *
 * 设计约束（方案 v2.0 第 8 章，用户已确认）：
 *  - 完全手动触发：本模块只提供能力，不自动发起任何调用
 *  - Key 仅存 NAS 数据目录（ai_config.json），接口永不回传，仅返回脱敏尾号
 *  - 每题 AI 讲解：按需生成 + 本地缓存（explanation_ai），同题不重复计费
 *  - 导入 AI 解析：只送失败/待处理原文，按字符预算分批（单批 ≤ 20 块 / ≤ 6000 字符）
 *  - ai_usage 只记 时间/类型/模型/题数/字符数，不存题目内容
 *  - 无 Key / 上游失败 → 抛错由上层转成提示，核心功能不受影响
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REQUEST_TIMEOUT = 60 * 1000;
const MAX_BLOCK_CHARS = 6000;   // 单批原文字符预算
const MAX_BLOCK_NUM = 20;       // 单批块数上限

// ==================== 配置存储 ====================

let configFile = null;

function setConfigFile(dataDir) {
  configFile = dataDir ? path.join(dataDir, 'ai_config.json') : null;
}

function getConfig() {
  if (!configFile || !fs.existsSync(configFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveConfig({ baseUrl, apiKey, model }) {
  if (!configFile) throw new Error('AI 配置目录未初始化');
  const old = getConfig() || {};
  const next = {
    baseUrl: String(baseUrl || old.baseUrl || '').trim(),
    model: String(model || old.model || '').trim(),
    apiKey: String(apiKey || old.apiKey || '').trim(),
  };
  if (!next.baseUrl) throw new Error('API 地址不能为空');
  if (!next.model) throw new Error('模型名称不能为空');
  if (!next.apiKey) throw new Error('API Key 不能为空');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  // Key 落盘权限收紧（类 Unix 环境生效；Windows 无效果）
  try { fs.writeFileSync(configFile, JSON.stringify(next, null, 2), { mode: 0o600 }); }
  catch (e) { fs.writeFileSync(configFile, JSON.stringify(next, null, 2)); }
  return next;
}

/** 脱敏：sk-****f7e7（前 4 后 4） */
function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// ==================== OpenAI 兼容调用 ====================

/**
 * 调用 OpenAI 兼容 /chat/completions
 * @param {object} cfg {baseUrl, apiKey, model}
 * @param {Array} messages
 * @param {object} opts { json: boolean }
 * @returns {Promise<{text:string, usage:{prompt_tokens?:number, completion_tokens?:number}}>}
 */
async function callLLM(cfg, messages, opts = {}) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const payload = {
    model: cfg.model,
    messages,
    temperature: 0.3,
  };
  if (opts.json) payload.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error('无法连接模型服务：' + (e.name === 'AbortError' ? '请求超时（60s）' : e.message));
    err.status = 502;
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`模型服务返回错误（HTTP ${res.status}）${detail ? '：' + detail.slice(0, 120) : ''}`);
    err.status = res.status === 401 ? 502 : 502;
    throw err;
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) {
    const err = new Error('模型未返回内容');
    err.status = 502;
    throw err;
  }
  return { text, usage: data.usage || {} };
}

/** 宽松 JSON 解析：整体 JSON 优先；再退代码块、对象、数组提取（数组提取放最后，避免误吞对象内嵌套数组） */
function looseParse(content) {
  const t = String(content).trim();
  try { return JSON.parse(t); } catch (e) { /* fallthrough */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch (e) { /* fallthrough */ }
  }
  const objMatch = t.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (e) { /* fallthrough */ }
  }
  const arrMatch = t.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch (e) { /* fallthrough */ }
  }
  return null;
}

// ==================== 审计 ====================

function recordUsage(db, userId, kind, model, questions, chars) {
  db.prepare('INSERT INTO ai_usage (user_id, kind, model, questions, chars, created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, kind, model || null, questions, chars, require('./db').nowLocal());
}

// ==================== 每题 AI 讲解 ====================

/**
 * 生成/读取一道题的 AI 讲解（缓存优先）
 * @returns {Promise<{cached:boolean, text:string}>}
 */
async function explainQuestion(db, questionId, userId, cfg) {
  const q = db.prepare(
    'SELECT q.*, b.owner_id FROM questions q JOIN question_banks b ON b.id=q.bank_id WHERE q.id=?'
  ).get(questionId);
  if (!q) { const e = new Error('题目不存在'); e.status = 404; throw e; }
  if (q.owner_id !== userId) { const e = new Error('无权访问该题目'); e.status = 403; throw e; }

  if (q.explanation_ai) return { cached: true, text: q.explanation_ai };

  const opts = q.options ? JSON.parse(q.options) : [];
  const lines = [`题目：${q.stem}`];
  if (opts.length) lines.push('选项：' + opts.map((o) => `${o.k}. ${o.text}`).join('；'));
  lines.push(`答案：${q.answer}`);
  if (q.explanation) lines.push(`自带解析：${q.explanation}`);
  const userText = lines.join('\n');

  const { text } = await callLLM(cfg, [
    {
      role: 'system',
      content: '你是耐心的刷题讲解老师。请用简体中文白话讲解这道题，控制在 300 字以内，分三部分：考点、正确思路、易错点。不要重复题干原文，不要输出 JSON。',
    },
    { role: 'user', content: userText },
  ]);

  db.prepare('UPDATE questions SET explanation_ai=? WHERE id=?').run(text, questionId);
  recordUsage(db, userId, 'explain', cfg.model, 1, userText.length);
  return { cached: false, text };
}

// ==================== 导入 AI 解析 ====================

const PARSE_SYSTEM = `你是题库结构化解析助手。把用户提供的题目原文解析为 JSON 对象：
{
  "questions": [
    {"stem":"题干","type":"single|multiple|judge","options":[{"k":"A","text":"选项内容"}],"answer":"A 或 AC 或 true/false","explanation":"简短解析，可空字符串","chapter":"知识点，可空字符串"}
  ]
}
规则：type 单选 single、多选 multiple、判断 judge（答案写 true 或 false）；题干缺失或完全无法解析的条目 type 填 "unknown"；选项缺失时 options 可为空数组；不要编造原文没有的信息。只输出 JSON，不要输出其他文字。`;

function splitBlocks(blocks, maxChars = MAX_BLOCK_CHARS, maxNum = MAX_BLOCK_NUM) {
  const batches = [];
  let cur = [];
  let curChars = 0;
  for (const b of blocks) {
    const c = String(b || '').length;
    if (cur.length >= maxNum || (curChars + c > maxChars && cur.length > 0)) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(b);
    curChars += c;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/**
 * 批量解析待处理原文块（仅手动触发）
 * @param {Array<string>} blocks 原文块
 * @param {object} cfg LLM 配置
 * @param {object} opts { onBatch, usage:{db,userId} }
 * @returns {Promise<Array>} 全部解析出的题目（顺序）
 */
async function parseBlocks(blocks, cfg, opts = {}) {
  const rules = require('./import/rules');
  const batches = splitBlocks(blocks);
  const all = [];
  let seq = 0;
  let sentChars = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const text = batch.map((b, j) => `【原文${j + 1}】\n${b}`).join('\n\n');
    const { text: content } = await callLLM(cfg, [
      { role: 'system', content: PARSE_SYSTEM },
      { role: 'user', content: text },
    ], { json: true });

    const parsed = looseParse(content);
    const arr = parsed && Array.isArray(parsed.questions) ? parsed.questions
      : Array.isArray(parsed) ? parsed : [];
    const questions = arr.map((it) => {
      const stem = String(it.stem || '').trim();
      if (!stem) return null;
      const rawAns = String(it.answer || '').trim();
      const q = {
        seq: ++seq,
        type: String(it.type || '').toLowerCase() === 'unknown' ? 'unknown' : null,
        stem,
        options: Array.isArray(it.options) ? it.options.filter((o) => o && o.text).map((o) => ({ k: String(o.k).toUpperCase(), text: String(o.text).trim() })) : [],
        answer: rawAns,
        explanation: String(it.explanation || ''),
        chapter: String(it.chapter || '').trim() || null,
        confidence: 0.7,
      };
      rules.normalizeQuestion(q); // 答案归一：judge→true/false、多选答案合并、题型判定
      return q;
    }).filter(Boolean);
    all.push(...questions);
    sentChars += text.length;
    if (opts.onBatch) opts.onBatch(questions, i);
  }
  if (opts.usage) {
    const u = opts.usage;
    recordUsage(u.db, u.userId, 'parse', cfg.model, blocks.length, sentChars);
  }
  return all;
}

// ==================== AI 识别格式（生成解析规范） ====================

const SPEC_TEXT_SYSTEM = `你是题库文件格式分析助手。下面是某题库文件的样例（前若干行）。请分析它的排版结构，输出一个"解析规范" JSON，供程序用正则切分题目。只输出 JSON，不要输出其他文字。

规范格式（JavaScript 正则，注意转义；**捕获组数量有约定**，程序按组索引取内容）：
{
  "kind": "text",
  "stem": { "regex": "题干行正则，第1组必须是题干文本；若行带题号，可用2组（第1组题号、第2组题干），也可只用1组（仅题干）；例如 ^(\\d{1,4})[.、．)）]\\s*(.+)$ 或 ^【题目】\\s*(.+)$" },
  "options": { "regex": "选项行正则，必须恰好 2 个捕获组：第1组=选项字母、第2组=选项文本；例如 ^([A-H])[.、．)）]\\s*(.+)$ 或 ^选项\\s*([A-H])[：:]\\s*(.+)$" },
  "answer": { "regex": "答案行正则，第1组为答案；例如 ^(?:【答案】|答案[:：]\\s*|正确答案[:：]\\s*)([A-H\\s,，、√×TF对错]+)$" },
  "explanation": { "regex": "解析行正则，第1组为解析文本；没有则空字符串" },
  "chapter": { "regex": "章节/知识点行正则，必须 2 个捕获组且第2组为章节名；没有则空字符串" },
  "chapterTitle": { "regex": "章节标题行正则，第1组为标题；没有则空字符串" },
  "typeMark": { "regex": "题型标注行正则，第1组为 单选/多选/判断；没有则空字符串" },
  "defaultType": "single 或 multiple 或 judge 或 null（整份文件固定题型时填写）"
}
要点：正则必须与样例实际结构一致；无法确定结构的字段给 ""（程序忽略该字段）；选项与章节正则的捕获组数量必须符合上述约定。`;

const SPEC_EXCEL_SYSTEM = `你是题库文件格式分析助手。下面是某 Excel/CSV 题库文件的表头行与数据样例。请输出一个完整的"字段映射规范" JSON 对象，把每个表头列名映射到系统字段。只输出 JSON 对象，不要输出数组、不要输出其他文字。

必须输出的完整结构（示例，列名请按实际表头替换）：
{"kind":"excel","headerRow":0,"columns":{"stem":"题目","answer":"答案","options":["选项A","选项B","选项C","选项D"],"explanation":"解析","chapter":"章节","type":"题型"}}
要求：列名必须逐字来自表头，不得改写；选项最多 8 列；找不到对应字段填空字符串 ""。`;

/** 文本规范结构校验 */
function isTextSpec(s) {
  return !!s && typeof s === 'object' && !Array.isArray(s) &&
    s.stem && typeof s.stem === 'object' && typeof s.stem.regex === 'string' &&
    s.options && typeof s.options === 'object' && typeof s.options.regex === 'string';
}

/** Excel 规范结构校验 */
function isExcelSpec(s) {
  return !!s && typeof s === 'object' && !Array.isArray(s) &&
    s.columns && typeof s.columns === 'object' &&
    typeof s.columns.stem === 'string' && !!s.columns.stem;
}

/** Excel 规范归一化：兼容 options 数组与 option1..option8 两种 AI 输出形式 */
function normalizeExcelSpec(s) {
  if (!isExcelSpec(s)) return null;
  const c = s.columns;
  let opts = Array.isArray(c.options) ? c.options.filter((o) => typeof o === 'string' && o) : [];
  if (!opts.length) {
    for (let i = 1; i <= 8; i++) {
      if (typeof c['option' + i] === 'string' && c['option' + i]) opts.push(c['option' + i]);
    }
  }
  return {
    kind: 'excel',
    headerRow: typeof s.headerRow === 'number' ? s.headerRow : 0,
    columns: {
      stem: c.stem,
      answer: typeof c.answer === 'string' ? c.answer : '',
      options: opts.slice(0, 8),
      explanation: typeof c.explanation === 'string' ? c.explanation : '',
      chapter: typeof c.chapter === 'string' ? c.chapter : '',
      type: typeof c.type === 'string' ? c.type : '',
    },
  };
}

/**
 * AI 生成格式规范（仅手动触发）
 * @param {string} kind 'text' | 'excel'
 * @param {string} sample 样例文本（text=前若干行；excel=表头+样例行拼接）
 * @param {object} cfg LLM 配置
 * @param {object} usage { db, userId, model }
 * @returns {Promise<object>} 规范 JSON
 */
async function suggestFormat(kind, sample, cfg, usage) {
  const system = kind === 'excel' ? SPEC_EXCEL_SYSTEM : SPEC_TEXT_SYSTEM;
  let spec = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const userMsg = attempt === 0
      ? '文件样例：\n' + sample
      : '上次输出结构不正确。请严格按要求的 JSON 对象结构重新输出（不要数组、不要多余文字）。\n文件样例：\n' + sample;
    const { text } = await callLLM(cfg, [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ], { json: true });
    const parsed = looseParse(text);
    if (kind === 'excel') {
      const norm = normalizeExcelSpec(parsed);
      if (norm) { spec = norm; break; }
    } else if (isTextSpec(parsed)) {
      spec = parsed;
      break;
    }
  }
  if (!spec) {
    const e = new Error('AI 返回的格式规范结构不完整，请重试；或稍后手动在预览页填写');
    e.status = 502;
    throw e;
  }
  spec.kind = kind;
  if (usage) recordUsage(usage.db, usage.userId, 'format-suggest', cfg.model, 0, sample.length);
  return spec;
}

module.exports = {
  setConfigFile,
  getConfig,
  saveConfig,
  maskKey,
  callLLM,
  looseParse,
  explainQuestion,
  parseBlocks,
  splitBlocks,
  suggestFormat,
};
