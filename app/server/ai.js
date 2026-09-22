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

/** 宽松 JSON 解析：优先找 [...]; 再试 {...} */
function looseParse(content) {
  const t = String(content).trim();
  const arrMatch = t.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch (e) { /* fallthrough */ }
  }
  const objMatch = t.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (e) { /* fallthrough */ }
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
};
