'use strict';
/**
 * rules.js — 规则通道（fast path）
 * 对抽取出的纯文本按常见排版正则切分题目，产出结构化题目并计算置信度。
 * 支持两种格式：
 *  1) 普通排版：编号 + 选项 + 答案/解析 + 章节
 *  2) 标记格式：[Q]题干 [A]选项 [T]答案 [P]知识点 [I]题型码（无线电/驾考导出）
 */

const RE = {
  // 题目起始：1. / 1、 / 1． / 1) / 1） 等
  qStart: /^\s*(\d{1,4})\s*[.、．)）]\s*(.+)$/,
  // 选项行：A.xxx / A、xxx / A．xxx / A) xxx
  optStart: /^\s*([A-H])\s*[.、．)）]\s*(.+)$/,
  // 同行多选项：A.xxx B.xxx C.xxx
  inlineOpts: /(?:\s|^)([A-H])\s*[.、．)）]\s*([^\sA-H][^A-H]{0,40}?)(?=\s[A-H]\s*[.、．)）]|$)/g,
  // 答案
  answer: /(?:【答案】|答案[:：]\s*|参考答案[:：]?\s*|正确答案[:：是]?\s*|答[:：]\s*|答案\s*[:：]?\s*)\s*([A-H\s,，、√×TF对错正确错误]+)/i,
  // 解析
  explain: /^\s*【?解析】?\s*[:：]?\s*(.+)$/,
  // 章节/知识点
  chapter: /^\s*【?(章节|知识点|考点)】?\s*[:：]?\s*(.+)$/,
  // 章节标题："第一章 有理数" / "第1节 xxx"
  chapterTitle: /^\s*第\s*[一二三四五六七八九十百零0-9]+\s*[章节篇][节篇]?\s*(.*)$/,
  // 判定题型行：单选/多选/判断 标注
  typeMark: /^\s*【?(单选|多选|判断)题?】?\s*[:：]?\s*$/,
};

/** 归一化多选答案串："A C D" / "A,C,D" / "ACD" → "ACD" */
function normAnswer(str) {
  if (!str) return '';
  return String(str).toUpperCase().replace(/[\s,，、.;；]+/g, '');
}

/** 判断题答案归一化："对/√/T/正确" → true；"错/×/F/错误" → false；A/B 按上下文处理 */
function normJudge(v) {
  const s = String(v).trim().toUpperCase();
  if (/^(对|正确|√|T|TRUE|A)$/.test(s)) return 'true';
  if (/^(错|错误|×|X|F|FALSE|B)$/.test(s)) return 'false';
  return null;
}

/** 题型码映射（标记格式：[I]MC1 / MC2 / MC3 / TF） */
const TYPECODE = {
  MC1: 'single',
  MC2: 'multiple',
  MC3: 'multiple',
  MC4: 'multiple',
  MC5: 'multiple',
  TF: 'judge',
  TF1: 'judge',
};

/**
 * 归一化单个题目：题型判定 + 判断题答案归一（不重算置信度）
 * 供 parseText 与 excel 表格式共用
 */
function normalizeQuestion(q) {
  // 判断题：选项全部为判断词（对/错/√/×/T/F/正确/错误）→ judge 类型
  if (q.options.length > 0 && q.options.every((o) => /^(对|错|正确|错误|√|×|T|F)$/i.test(o.text.trim()))) {
    q.type = 'judge';
    if (/^[AB]$/.test(String(q.answer).trim().toUpperCase())) {
      const idx = String(q.answer).trim().toUpperCase() === 'A' ? 0 : 1;
      q.answer = normJudge(q.options[idx].text);
    } else {
      q.answer = normJudge(q.answer);
    }
  } else if (q.options.length > 0) {
    if (!q.type) q.type = (String(q.answer).length > 1) ? 'multiple' : 'single';
  } else if (q.answer) {
    const jv = normJudge(q.answer);
    if (jv) { q.type = 'judge'; q.answer = jv; }
    else if (q.answer.length === 1 && /^[A-H]$/.test(q.answer)) q.type = 'single';
    else q.type = 'unknown';
  } else {
    q.type = 'unknown';
  }
  return q;
}

/** 收尾：题型判定 + 置信度 + failed 收集（普通与标记格式共用） */
function finalizeQuestion(q, pending, failed) {
  normalizeQuestion(q);

  let hits = 0;
  if (q.stem) hits++;
  if (q.options.length) hits++;
  if (q.answer) hits++;
  if (q.explanation) hits += 0.5;
  if (q.chapter) hits += 0.3;
  q.confidence = Math.min(0.95, 0.3 + hits * 0.18);

  if (q.type === 'unknown' || !q.answer) {
    failed.push(pending.join('\n'));
  }
}

/**
 * 解析标记格式（[Q]题干 [A]选项 [T]答案 [P]知识点 [I]题型码）
 * 常见于无线电/驾考等导出的结构化题库。按 token 流解析，不依赖换行。
 */
function parseMarked(text) {
  const tokens = [];
  const re = /\[([QJPIABCDEFGHT])\]\s*([^\[]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = m[2].trim();
    if (v) tokens.push({ k: m[1].toUpperCase(), v });
  }

  const questions = [];
  const failed = [];
  let cur = null;
  let pending = [];
  let pendingMeta = { chapter: null, typeCode: null }; // [Q] 之前的 [P]/[I] 元数据

  const push = () => {
    if (cur) { finalizeQuestion(cur, pending, failed); questions.push(cur); }
    cur = null;
    // pendingMeta 不在此重置：由 [Q] 分支读取后消费重置
  };

  for (const t of tokens) {
    if (t.k === 'Q') {
      push();
      const meta = pendingMeta;
      pendingMeta = { chapter: null, typeCode: null }; // 消费前置元数据
      cur = {
        seq: questions.length + 1,
        type: meta.typeCode ? TYPECODE[meta.typeCode] || null : null,
        stem: t.v,
        options: [],
        answer: '',
        explanation: '',
        chapter: meta.chapter,
        confidence: 0.5,
      };
      pending = ['[Q] ' + t.v];
      continue;
    }
    if (!cur) {
      if (t.k === 'P') { pendingMeta.chapter = t.v; continue; }
      if (t.k === 'I') { pendingMeta.typeCode = t.v.toUpperCase(); continue; }
      continue; // 前置编号等忽略
    }

    if (t.k === 'A' || t.k === 'B' || t.k === 'C' || t.k === 'D' || t.k === 'E' || t.k === 'F' || t.k === 'G' || t.k === 'H') {
      if (cur.options.length < 8) { cur.options.push({ k: t.k, text: t.v }); pending.push(`[${t.k}] ${t.v}`); }
      continue;
    }
    if (t.k === 'T') { cur.answer = normAnswer(t.v); pending.push('[T] ' + t.v); continue; }
    if (t.k === 'P') { cur.chapter = t.v; continue; }
    if (t.k === 'I') { const code = t.v.toUpperCase(); if (TYPECODE[code]) cur.type = TYPECODE[code]; continue; }
    if (t.k === 'J') {
      // 编号行：题目分隔符（下一题元数据 [P]/[I] 前置时先收尾当前题）
      if (cur && cur.stem && (cur.answer || cur.options.length)) push();
      continue;
    }
  }
  push();
  return { questions, failed };
}

/**
 * 解析纯文本为题目列表
 * @param {string} text
 * @returns {{questions:Array, failed:Array<string>}}
 */
function parseText(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 标记格式（[Q]题干 [T]答案）优先，按 token 流解析（不依赖换行）
  if (text.includes('[Q]') && (text.includes('[T]') || text.includes('[I]'))) {
    return parseMarked(text);
  }

  const questions = [];
  const failed = [];
  let cur = null;       // 当前题目
  let curTypeMark = null;
  let curChapter = null; // 章节上下文（"第一章 xxx"标题继承给后续题目）
  let pending = [];     // 当前题目的原文行（供 failed 收集）

  const pushCur = () => {
    if (!cur) return;
    finalizeQuestion(cur, pending, failed);
    questions.push(cur);
    cur = null;
    curTypeMark = null;
  };

  for (const line of lines) {
    // 章节标题行（"第一章 有理数"）：更新章节上下文，不当作题目
    const ct = line.match(RE.chapterTitle);
    if (ct) {
      if (ct[1] && ct[1].trim()) curChapter = line.replace(/^\s*第\s*[一二三四五六七八九十百零0-9]+\s*[章节篇][节篇]?\s*/, '').trim();
      continue;
    }

    // 章节/知识点行（独立于题目，或跟在题目后）
    const ch = line.match(RE.chapter);
    if (ch && cur && cur.stem && !cur.answer && !cur.options.length) {
      cur.chapter = ch[2].trim();
      continue;
    }

    // 题型标注行
    const tm = line.match(RE.typeMark);
    if (tm) {
      curTypeMark = tm[1];
      continue;
    }

    // 新题目起始
    const qs = line.match(RE.qStart);
    if (qs) {
      pushCur();
      cur = {
        seq: parseInt(qs[1], 10),
        type: curTypeMark || null,
        stem: qs[2].trim(),
        options: [],
        answer: '',
        explanation: '',
        chapter: curChapter,
        confidence: 0.5,
      };
      pending = [line];
      continue;
    }

    if (!cur) {
      // 题目开始前的零散行：尝试作为题干开头（无编号）
      cur = {
        seq: questions.length + 1,
        type: curTypeMark || null,
        stem: line,
        options: [],
        answer: '',
        explanation: '',
        chapter: curChapter,
        confidence: 0.3,
      };
      pending = [line];
      continue;
    }

    // 选项行
    const os = line.match(RE.optStart);
    if (os && cur.options.length < 8) {
      cur.options.push({ k: os[1], text: os[2].trim() });
      pending.push(line);
      continue;
    }

    // 答案行
    const as = line.match(RE.answer);
    if (as) {
      cur.answer = normAnswer(as[1]);
      pending.push(line);
      continue;
    }

    // 解析行
    const ex = line.match(RE.explain);
    if (ex) {
      cur.explanation = (cur.explanation ? cur.explanation + '\n' : '') + ex[1].trim();
      pending.push(line);
      continue;
    }

    // 其他行：若题目已有答案/解析则忽略（下一题标题前）；否则并入题干或解析
    if (cur.stem && !cur.options.length && !cur.answer) {
      cur.stem += '\n' + line;
    } else if (cur.answer && !cur.explanation) {
      cur.explanation += line;
    }
    pending.push(line);
  }
  pushCur();

  // 同行内联选项拆解（处理 "A.xxx B.xxx" 单行）
  for (const q of questions) {
    if (q.options.length === 0 && /[A-H]\s*[.、．)）]/.test(q.stem)) {
      q.stem = q.stem.replace(RE.inlineOpts, (m, k, t) => {
        if (q.options.length < 8) q.options.push({ k, text: t.trim() });
        return '\n';
      }).replace(/\n+/g, '\n').trim();
    }
  }

  return { questions, failed };
}

module.exports = { parseText, normalizeQuestion, normAnswer, normJudge };
