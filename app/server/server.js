'use strict';
/**
 * server.js — AI刷题侠后端
 * 纯 Node 内置模块（node:http / node:sqlite），解析库仅 xlsx / mammoth / pdf-parse（纯 JS，无原生编译）。
 *
 * 运行模式：
 *  - fnOS：Unix Socket（TRIM_APPDEST/app.sock），数据存共享目录（TRIM_DATA_SHARE_PATHS 首项）或 TRIM_PKGVAR/data
 *  - 本地调试：node server.js --port 18099 --data-dir .devdb
 *
 * API 前缀：本地无前缀；fnOS 网关转发 /app/shuatixia → 本服务（自动剥离前缀）。
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { initDb, getDb, genId, nowLocal, migrate } = require('./db');
const { parseFile } = require('./import/worker');
const judge = require('./judge');
const ai = require('./ai');

/** 导入预览缓存：token → { bankId, result, ts }（10 分钟有效） */
const importCache = new Map();
const IMPORT_TTL = 10 * 60 * 1000;
const MAX_BODY = 4 * 1024 * 1024;  // JSON 体上限
const MAX_FILE = 32 * 1024 * 1024; // 上传文件上限

// ==================== 参数解析 ====================
const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = parseInt(argVal('port', '0'), 10);

function resolveDataDir() {
  const explicit = argVal('data-dir', null);
  if (explicit) return explicit;
  const sharePaths = process.env.TRIM_DATA_SHARE_PATHS;
  if (sharePaths) {
    const first = sharePaths.split(':')[0];
    if (first && fs.existsSync(first)) return first;
  }
  const pkgVar = process.env.TRIM_PKGVAR;
  if (pkgVar) return path.join(pkgVar, 'data');
  return null;
}
const DATA_DIR = resolveDataDir();

// 老数据迁移：TRIM_PKGVAR/shuatixia.db → DATA_DIR/shuatixia.db（v1 用户升级保留）
function migrateOldData() {
  const pkgVar = process.env.TRIM_PKGVAR;
  if (!pkgVar || !DATA_DIR || DATA_DIR === pkgVar) return;
  const oldDb = path.join(pkgVar, 'shuatixia.db');
  const newDb = path.join(DATA_DIR, 'shuatixia.db');
  if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.renameSync(oldDb, newDb);
      console.log('[shuatixia] migrated db to shared data dir');
    } catch (e) {
      console.error('[shuatixia] db migration failed:', e.message);
    }
  }
}
migrateOldData();

const SOCKET_PATH = PORT === 0 && process.env.TRIM_APPDEST
  ? path.join(process.env.TRIM_APPDEST, argVal('socket', 'app.sock'))
  : null;
const WWW_ROOT = path.resolve(__dirname, '..', 'www');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

// ==================== 工具 ====================
function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function readRaw(req, maxSize) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxSize) { reject(new Error('file too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 简易 multipart/form-data 解析（单文件，字段名 file） */
function parseMultipart(buf, contentType) {
  const m = /boundary=(.+)$/i.exec(contentType || '');
  if (!m) return [];
  const boundary = '--' + m[1].replace(/^"|"$/g, '');
  const parts = [];
  const text = buf.toString('latin1');
  const blocks = text.split(boundary);
  for (const block of blocks) {
    const idx = block.indexOf('\r\n\r\n');
    if (idx < 0) continue;
    const head = block.slice(0, idx);
    const bodyStart = idx + 4;
    let bodyEnd = block.length;
    if (block.endsWith('\r\n')) bodyEnd -= 2;
    const nameM = /name="([^"]*)"/.exec(head);
    const fnM = /filename="([^"]*)"/.exec(head);
    if (nameM) {
      const raw = block.slice(bodyStart, bodyEnd);
      const body = Buffer.from(raw, 'latin1');
      parts.push({ name: nameM[1], filename: fnM ? fnM[1] : null, body });
    }
  }
  return parts;
}

/** 可信用户身份：网关头优先（本地调试回退 local-user；生产环境无身份返回 null） */
function getUser(req) {
  const uid = req.headers['x-trim-userid'];
  const name = req.headers['x-trim-username'];
  if (!uid && process.env.TRIM_APPNAME) return null;
  return { uid: uid || 'local-user', name: name || uid || 'local-user' };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** 路径参数匹配：'GET /api/banks/:id' 等 */
function paramMatch(pattern, urlPath) {
  const pp = pattern.split('/');
  const up = urlPath.split('/');
  if (pp.length !== up.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(up[i]);
    else if (pp[i] !== up[i]) return null;
  }
  return params;
}

/** 题库读权限：存在→bank，无权限→false，不存在→null */
function canReadBank(db, bankId, uid) {
  const bank = db.prepare('SELECT id, owner_id, visibility, total_count FROM question_banks WHERE id=?').get(bankId);
  if (!bank) return null;
  if (bank.owner_id === uid || bank.visibility === 'shared') return bank;
  return false;
}

/** 题库管理权限：仅属主（写操作：导入/删除/改设置） */
function canManageBank(db, bankId, uid) {
  const bank = db.prepare('SELECT id, owner_id FROM question_banks WHERE id=?').get(bankId);
  if (!bank) return null;
  if (bank.owner_id === uid) return bank;
  return false;
}

/** 从 importCache 取结果并做过期清理 */
function getImport(token) {
  const hit = importCache.get(token);
  if (!hit) return null;
  if (Date.now() - hit.ts > IMPORT_TTL) { importCache.delete(token); return null; }
  return hit;
}

// ==================== 业务 ====================
function bankDetail(bankId) {
  const db = getDb();
  const bank = db.prepare('SELECT * FROM question_banks WHERE id=?').get(bankId);
  if (!bank) return null;
  const cnt = db.prepare('SELECT COUNT(*) c FROM questions WHERE bank_id=?').get(bankId).c;
  return { ...bank, question_count: cnt };
}

function listBanks(uid) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT b.*, (SELECT COUNT(*) FROM questions q WHERE q.bank_id=b.id) AS question_count ' +
    'FROM question_banks b WHERE b.owner_id=? OR b.visibility=\'shared\' ORDER BY b.updated_at DESC'
  ).all(uid);
  return rows;
}

function insertQuestions(bankId, questions, ownerId) {
  const db = getDb();
  const now = nowLocal();
  const ins = db.prepare(
    'INSERT INTO questions (id, bank_id, seq, type, stem, options, answer, explanation, chapter, confidence, created_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  );
  // 追加模式：同题库多次导入（分批章节）不清空已有题目，seq 续排
  const maxSeq = db.prepare('SELECT COALESCE(MAX(seq),0) m FROM questions WHERE bank_id=?').get(bankId).m;
  const tx = db.prepare('BEGIN');
  tx.run();
  try {
    let seq = maxSeq + 1;
    for (const q of questions) {
      const type = q.type || 'unknown';
      const answer = String(q.answer || '').trim();
      const stem = String(q.stem || '').trim();
      if (!stem) continue;
      ins.run(
        genId('q'),
        bankId,
        seq++,
        type,
        stem,
        q.options && q.options.length ? JSON.stringify(q.options) : null,
        answer,
        q.explanation || null,
        q.chapter || null,
        typeof q.confidence === 'number' ? q.confidence : 0.5,
        now
      );
    }
    db.prepare('UPDATE question_banks SET total_count=total_count+?, updated_at=? WHERE id=?').run(seq - 1 - maxSeq, now, bankId);
    db.prepare('COMMIT').run();
    return seq - 1 - maxSeq;
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
}

// ==================== 路由 ====================
function createRouter() {
  const router = {};

  // ---- 系统 ----
  router['GET /api/health'] = () => ({ ok: true, name: 'AI刷题侠', version: '0.2.0' });

  // ---- 题库 ----
  router['GET /api/banks'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    return { banks: listBanks(u.uid) };
  };

  router['POST /api/banks'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const name = String(body.name || '').trim();
    if (!name) throw httpError(400, '题库名称不能为空');
    const db = getDb();
    const now = nowLocal();
    const id = genId('bk');
    db.prepare(
      'INSERT INTO question_banks (id, owner_id, name, category, visibility, source_format, total_count, created_at, updated_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(id, u.uid, name, String(body.category || '').trim() || null, 'private', null, 0, now, now);
    return bankDetail(id);
  };

  router['GET /api/banks/:id'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const perm = canReadBank(db, params.id, u.uid);
    if (perm === null) throw httpError(404, '题库不存在');
    if (perm === false) throw httpError(403, '无权访问该题库');
    const b = bankDetail(params.id);
    if (!b) throw httpError(404, '题库不存在');
    return b;
  };

  router['GET /api/banks/:id/questions'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const q = new URL(req.url, 'http://x').searchParams;
    const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(q.get('size') || '20', 10) || 20));
    const perm = canReadBank(db, params.id, u.uid);
    if (perm === null) throw httpError(404, '题库不存在');
    if (perm === false) throw httpError(403, '无权访问该题库');
    const total = db.prepare('SELECT COUNT(*) c FROM questions WHERE bank_id=?').get(params.id).c;
    const rows = db.prepare(
      'SELECT id, seq, type, stem, options, answer, explanation, chapter, confidence FROM questions ' +
      'WHERE bank_id=? ORDER BY seq LIMIT ? OFFSET ?'
    ).all(params.id, size, (page - 1) * size);
    const questions = rows.map((r) => ({
      ...r,
      options: r.options ? JSON.parse(r.options) : null,
    }));
    return { total, page, size, questions };
  };

  // ---- 导入（上传 → 识别 → 预览 → 确认入库）----
  router['POST /api/banks/:id/import'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const bank = canManageBank(db, params.id, u.uid);
    if (bank === null) throw httpError(404, '题库不存在');
    if (bank === false) throw httpError(403, '无权向该题库导入题目');
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) throw httpError(400, '请以 multipart/form-data 上传文件');
    const raw = await readRaw(req, MAX_FILE);
    const parts = parseMultipart(raw, ct);
    const file = parts.find((p) => p.name === 'file' && p.body.length > 0);
    if (!file) throw httpError(400, '未收到文件（字段名应为 file）');

    const result = await parseFile(file.body, file.filename || 'upload.bin');
    const crypto = require('node:crypto');
    const fingerprint = 'sha1:' + crypto.createHash('sha1').update(file.body).digest('hex').slice(0, 24);
    const tpl = db.prepare('SELECT template FROM import_templates WHERE owner_id=? AND fingerprint=?').get(u.uid, fingerprint);
    const token = genId('imp');
    importCache.set(token, { bankId: params.id, result, fingerprint, ts: Date.now() });
    return { token, summary: result.summary || null, format: result.format, name: file.filename, ok: result.ok, empty: !!result.empty, hint: result.hint, error: result.error, template_hit: tpl ? JSON.parse(tpl.template) : null };
  };

  router['GET /api/imports/:token'] = async (body, params) => {
    const hit = getImport(params.token);
    if (!hit) throw httpError(404, '导入预览已过期，请重新上传');
    return hit.result;
  };

  router['POST /api/imports/:token/commit'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const hit = getImport(params.token);
    if (!hit) throw httpError(404, '导入预览已过期，请重新上传');
    const db = getDb();
    const perm = canManageBank(db, hit.bankId, u.uid);
    if (perm === null) throw httpError(404, '题库不存在');
    if (perm === false) throw httpError(403, '无权向该题库导入题目');
    const qs = Array.isArray(body.questions) ? body.questions : null;
    const source = qs || hit.result.questions;
    if (!Array.isArray(source)) throw httpError(400, '没有可入库的题目');
    const n = insertQuestions(hit.bankId, source);
    // 模板记忆：记录文件指纹，同源文件二次导入可直接复用
    if (hit.fingerprint) {
      db.prepare('INSERT INTO import_templates (id, owner_id, format, fingerprint, template, created_at) VALUES (?,?,?,?,?,?) ' +
        'ON CONFLICT(fingerprint, owner_id) DO UPDATE SET template=excluded.template')
        .run(genId('tpl'), u.uid, hit.format || 'unknown', hit.fingerprint,
          JSON.stringify({ bank_id: hit.bankId, imported: n, ts: Date.now() }), nowLocal());
    }
    importCache.delete(params.token);
    return { bank_id: hit.bankId, imported: n };
  };

  // ---- 设置与 AI ----
  router['GET /api/settings'] = async () => {
    const db = getDb();
    const row = db.prepare("SELECT value FROM setting WHERE key='theme'").get();
    const cfg = ai.getConfig();
    return {
      theme: row ? row.value : 'system',
      llm_configured: !!cfg,
      llm_model: cfg ? cfg.model : null,
      llm_base: cfg ? cfg.baseUrl : null,
      llm_key_tail: cfg ? ai.maskKey(cfg.apiKey) : null,
    };
  };

  router['PUT /api/settings'] = async (body) => {
    const db = getDb();
    if (body && body.theme) {
      db.prepare('INSERT INTO setting (key, value) VALUES (\'theme\', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run(String(body.theme));
    }
    return { ok: true };
  };

  router['PUT /api/settings/llm'] = async (body) => {
    const cfg = ai.saveConfig({
      baseUrl: body && body.baseUrl,
      apiKey: body && body.apiKey,
      model: body && body.model,
    });
    return { llm_configured: true, llm_model: cfg.model, llm_base: cfg.baseUrl, llm_key_tail: ai.maskKey(cfg.apiKey) };
  };

  router['GET /api/ai/usage'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const rows = db.prepare('SELECT id, kind, model, questions, chars, created_at FROM ai_usage WHERE user_id=? ORDER BY id DESC LIMIT 50').all(u.uid);
    return { usage: rows };
  };

  // ---- AI：讲解（按需 + 缓存）----
  router['POST /api/ai/explain'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const cfg = ai.getConfig();
    if (!cfg) throw httpError(400, '尚未配置 AI 模型，请先在设置页填写 API 地址与 Key');
    const qid = String((body && body.question_id) || '').trim();
    if (!qid) throw httpError(400, '缺少 question_id');
    const db = getDb();
    const row = db.prepare('SELECT q.bank_id FROM questions q WHERE q.id=?').get(qid);
    if (!row) throw httpError(404, '题目不存在');
    const perm = canReadBank(db, row.bank_id, u.uid);
    if (perm === false) throw httpError(403, '无权访问该题目');
    const r = await ai.explainQuestion(db, qid, u.uid, cfg);
    return r;
  };

  // ---- AI：导入解析（仅手动触发，分批，结果回填）----
  router['POST /api/ai/parse'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const cfg = ai.getConfig();
    if (!cfg) throw httpError(400, '尚未配置 AI 模型，请先在设置页填写 API 地址与 Key');
    const token = String((body && body.token) || '').trim();
    const hit = getImport(token);
    if (!hit) throw httpError(404, '导入预览已过期，请重新上传');
    const blocks = hit.result.failed && hit.result.failed.length
      ? hit.result.failed
      : (hit.result.raw ? [hit.result.raw] : []);
    if (!blocks.length) throw httpError(400, '没有可 AI 解析的原文块');
    const questions = await ai.parseBlocks(blocks, cfg, { usage: { db: getDb(), userId: u.uid } });
    return { questions, parsed: questions.length, remaining_blocks: Math.max(0, blocks.length - questions.length) };
  };

  // ---- 练习（顺序 + 断点续练）----
  router['GET /api/banks/:id/practice'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const bank = canReadBank(db, params.id, u.uid);
    if (bank === null) throw httpError(404, '题库不存在');
    if (bank === false) throw httpError(403, '无权访问该题库');
    const prog = db.prepare('SELECT last_seq FROM practice_progress WHERE user_id=? AND bank_id=?').get(u.uid, params.id);
    const lastSeq = prog ? prog.last_seq : 0;
    const q = db.prepare(
      'SELECT id, seq, type, stem, options, chapter FROM questions WHERE bank_id=? AND seq>? ORDER BY seq LIMIT 1'
    ).get(params.id, lastSeq);
    return {
      total: bank.total_count,
      last_seq: lastSeq,
      question: q ? { ...q, options: q.options ? JSON.parse(q.options) : null } : null,
    };
  };

  router['POST /api/banks/:id/practice/answer'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const qid = String((body && body.question_id) || '').trim();
    const userAnswer = String((body && body.answer) || '').trim();
    if (!qid) throw httpError(400, '缺少 question_id');
    const perm = canReadBank(db, params.id, u.uid);
    if (perm === null) throw httpError(404, '题库不存在');
    if (perm === false) throw httpError(403, '无权访问该题库');
    const q = db.prepare('SELECT * FROM questions WHERE id=? AND bank_id=?').get(qid, params.id);
    if (!q) throw httpError(404, '题目不存在');
    const bank = db.prepare('SELECT total_count FROM question_banks WHERE id=?').get(params.id);
    const correct = judge.isCorrect(q, userAnswer);
    const now = nowLocal();

    // 答题记录
    db.prepare('INSERT INTO answer_records (id, user_id, bank_id, question_id, source, user_answer, is_correct, answered_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(genId('ar'), u.uid, params.id, qid, 'practice', userAnswer || null, correct === null ? 0 : (correct ? 1 : 0), now);

    // 错题归集（答错才记；空答视为跳过不计错）
    if (correct === false) {
      db.prepare('INSERT INTO wrong_questions (user_id, bank_id, question_id, wrong_count, last_wrong_at, status) VALUES (?,?,?,1,?,1) ' +
        'ON CONFLICT(user_id, question_id) DO UPDATE SET wrong_count=wrong_count+1, last_wrong_at=excluded.last_wrong_at, status=1')
        .run(u.uid, params.id, qid, now);
    } else if (correct === true) {
      // 答对：保留错题记录，但标记已掌握（status=0），可手动移除
      db.prepare('UPDATE wrong_questions SET status=0 WHERE user_id=? AND question_id=?').run(u.uid, qid);
    }

    // 推进进度
    if (correct !== null) {
      const prog = db.prepare('SELECT last_seq FROM practice_progress WHERE user_id=? AND bank_id=?').get(u.uid, params.id);
      const nextSeq = Math.max(prog ? prog.last_seq : 0, q.seq);
      db.prepare('INSERT INTO practice_progress (user_id, bank_id, last_seq, updated_at) VALUES (?,?,?,?) ' +
        'ON CONFLICT(user_id, bank_id) DO UPDATE SET last_seq=excluded.last_seq, updated_at=excluded.updated_at')
        .run(u.uid, params.id, nextSeq, now);
    }

    return {
      correct, // true/false/null（null=未作答跳过）
      answer: q.answer,
      explanation: q.explanation || null,
      explanation_ai: q.explanation_ai || null,
      next_seq: q.seq + 1,
      finished: q.seq >= (bank.total_count),
    };
  };

  // 重新开始一轮：进度归零（答完一轮后手动触发）
  router['POST /api/banks/:id/practice/reset'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const perm = canReadBank(db, params.id, u.uid);
    if (perm === null) throw httpError(404, '题库不存在');
    if (perm === false) throw httpError(403, '无权访问该题库');
    db.prepare('INSERT INTO practice_progress (user_id, bank_id, last_seq, updated_at) VALUES (?,?,0,?) ' +
      'ON CONFLICT(user_id, bank_id) DO UPDATE SET last_seq=0, updated_at=excluded.updated_at')
      .run(u.uid, params.id, nowLocal());
    return { reset: true };
  };

  // ---- 收藏 ----
  router['POST /api/questions/:questionId/favorite'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const qid = params.questionId;
    const row = db.prepare('SELECT bank_id FROM questions WHERE id=?').get(qid);
    if (!row) throw httpError(404, '题目不存在');
    const perm = canReadBank(db, row.bank_id, u.uid);
    if (perm === false) throw httpError(403, '无权访问该题目');
    const fav = body && body.favorite !== undefined ? !!body.favorite : true;
    if (fav) {
      db.prepare('INSERT INTO favorites (user_id, bank_id, question_id, created_at) VALUES (?,?,?,?) ' +
        'ON CONFLICT(user_id, question_id) DO UPDATE SET created_at=excluded.created_at')
        .run(u.uid, row.bank_id, qid, nowLocal());
    } else {
      db.prepare('DELETE FROM favorites WHERE user_id=? AND question_id=?').run(u.uid, qid);
    }
    return { favorited: fav };
  };

  router['GET /api/favorites'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const bankId = new URL(req.url, 'http://x').searchParams.get('bank_id');
    const sql = bankId
      ? 'SELECT f.created_at AS fav_at, q.id, q.bank_id, q.seq, q.type, q.stem, q.options, q.answer, q.explanation, q.chapter FROM favorites f JOIN questions q ON q.id=f.question_id WHERE f.user_id=? AND f.bank_id=? ORDER BY f.created_at DESC'
      : 'SELECT f.created_at AS fav_at, q.id, q.bank_id, q.seq, q.type, q.stem, q.options, q.answer, q.explanation, q.chapter FROM favorites f JOIN questions q ON q.id=f.question_id WHERE f.user_id=? ORDER BY f.created_at DESC';
    const rows = db.prepare(sql).all(u.uid, ...(bankId ? [bankId] : []));
    return { favorites: rows.map((r) => ({ ...r, options: r.options ? JSON.parse(r.options) : null })) };
  };

  // ---- 统计 ----
  router['GET /api/stats'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    // 总答题与正确率（含练习 + 试卷）
    const rec = one('SELECT COUNT(*) c, COALESCE(SUM(is_correct),0) ok FROM answer_records WHERE user_id=?', u.uid);
    const answered = rec.c, correctCount = rec.ok;
    // 错题：总数 + 已掌握
    const wr = one('SELECT COUNT(*) c FROM wrong_questions WHERE user_id=?', u.uid);
    const mastered = one('SELECT COUNT(*) c FROM wrong_questions WHERE user_id=? AND status=0', u.uid);
    // 收藏数 / 试卷数 / 练习天数
    const favs = one('SELECT COUNT(*) c FROM favorites WHERE user_id=?', u.uid).c;
    const papers = one('SELECT COUNT(*) c FROM papers WHERE user_id=?', u.uid).c;
    const days = one('SELECT COUNT(DISTINCT substr(answered_at,1,10)) c FROM answer_records WHERE user_id=?', u.uid).c;
    // 题型正确率
    const byType = db.prepare(
      'SELECT q.type, COUNT(*) c, SUM(r.is_correct) ok FROM answer_records r JOIN questions q ON q.id=r.question_id WHERE r.user_id=? GROUP BY q.type'
    ).all(u.uid).map((r) => ({ type: r.type, count: r.c, correct: r.ok || 0, rate: r.c ? Math.round((100 * (r.ok || 0)) / r.c) : 0 }));
    // 章节正确率（top 8）
    const byChapter = db.prepare(
      'SELECT q.chapter, COUNT(*) c, SUM(r.is_correct) ok FROM answer_records r JOIN questions q ON q.id=r.question_id WHERE r.user_id=? AND q.chapter IS NOT NULL GROUP BY q.chapter ORDER BY c DESC LIMIT 8'
    ).all(u.uid).map((r) => ({ chapter: r.chapter, count: r.c, correct: r.ok || 0, rate: r.c ? Math.round((100 * (r.ok || 0)) / r.c) : 0 }));
    // 近 14 天趋势
    const t14 = new Date(Date.now() - 13 * 864e5);
    const since14 = t14.getFullYear() + '-' + String(t14.getMonth() + 1).padStart(2, '0') + '-' + String(t14.getDate()).padStart(2, '0');
    const trendRows = db.prepare(
      'SELECT substr(answered_at,1,10) d, COUNT(*) c, SUM(is_correct) ok FROM answer_records WHERE user_id=? AND answered_at>=? GROUP BY d ORDER BY d'
    ).all(u.uid, since14);
    const trend = trendRows.map((r) => ({ date: r.d, count: r.c, correct: r.ok || 0 }));
    return {
      answered, correct: correctCount, wrong_rate: answered ? Math.round((100 * (answered - correctCount)) / answered) : 0,
      wrong_total: wr.c, wrong_mastered: mastered.c,
      favorites: favs, papers, active_days: days,
      by_type: byType, by_chapter: byChapter, trend,
    };
  };

  // ---- 模拟卷 ----
  router['POST /api/banks/:id/papers'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const bank = canReadBank(db, params.id, u.uid);
    if (bank === null) throw httpError(404, '题库不存在');
    if (bank === false) throw httpError(403, '无权访问该题库');
    const count = Math.min(bank.total_count, Math.max(1, parseInt((body && body.count) || '20', 10) || 20));
    const rows = db.prepare('SELECT id FROM questions WHERE bank_id=? ORDER BY RANDOM() LIMIT ?').all(params.id, count);
    if (!rows.length) throw httpError(400, '题库还没有题目');
    const now = nowLocal();
    const pid = genId('pp');
    const title = String((body && body.title) || '').trim() || `模拟卷 ${rows.length} 题`;
    db.prepare('INSERT INTO papers (id, user_id, bank_id, title, config, question_ids, status, total, started_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(pid, u.uid, params.id, title, JSON.stringify({ count: rows.length }), JSON.stringify(rows.map((r) => r.id)), 'in_progress', rows.length, now);
    return { paper: paperDetail(pid) };
  };

  router['GET /api/papers'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const rows = db.prepare(
      'SELECT id, bank_id, title, status, score, total, started_at, submitted_at FROM papers WHERE user_id=? ORDER BY started_at DESC LIMIT 50'
    ).all(u.uid);
    return { papers: rows };
  };

  router['GET /api/papers/:id'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const paper = paperDetail(params.id);
    if (!paper) throw httpError(404, '试卷不存在');
    if (paper.user_id !== u.uid) throw httpError(403, '无权访问该试卷');
    return { paper };
  };

  router['POST /api/papers/:id/submit'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const paper = db.prepare('SELECT * FROM papers WHERE id=?').get(params.id);
    if (!paper) throw httpError(404, '试卷不存在');
    if (paper.user_id !== u.uid) throw httpError(403, '无权交卷');
    if (paper.status === 'submitted') throw httpError(400, '试卷已交卷');
    const answers = (body && body.answers) || {};
    const ids = JSON.parse(paper.question_ids);
    const now = nowLocal();
    const ins = db.prepare('INSERT INTO answer_records (id, user_id, bank_id, question_id, source, paper_id, user_answer, is_correct, answered_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const results = [];
    let score = 0;
    const tx = db.prepare('BEGIN');
    tx.run();
    try {
      for (const qid of ids) {
        const q = db.prepare('SELECT * FROM questions WHERE id=?').get(qid);
        const ua = answers[qid] !== undefined && answers[qid] !== null ? String(answers[qid]).trim() : '';
        const correct = judge.isCorrect(q, ua);
        if (correct === true) score++;
        if (correct === false) {
          db.prepare('INSERT INTO wrong_questions (user_id, bank_id, question_id, wrong_count, last_wrong_at, status) VALUES (?,?,?,1,?,1) ' +
            'ON CONFLICT(user_id, question_id) DO UPDATE SET wrong_count=wrong_count+1, last_wrong_at=excluded.last_wrong_at, status=1')
            .run(u.uid, paper.bank_id, qid, now);
        }
        ins.run(genId('ar'), u.uid, paper.bank_id, qid, 'paper', params.id, ua || null, correct === null ? 0 : (correct ? 1 : 0), now);
        results.push({ question_id: qid, seq: q.seq, correct, user_answer: ua, answer: q.answer });
      }
      db.prepare('UPDATE papers SET status=\'submitted\', score=?, submitted_at=? WHERE id=?').run(score, now, params.id);
      db.prepare('COMMIT').run();
    } catch (e) {
      db.prepare('ROLLBACK').run();
      throw e;
    }
    return { score, total: ids.length, results };
  };

  // ---- 错题集 ----
  router['GET /api/wrong'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    const bankId = new URL(req.url, 'http://x').searchParams.get('bank_id');
    const sql = bankId
      ? 'SELECT w.wrong_count, w.last_wrong_at, w.status, q.id, q.bank_id, q.seq, q.type, q.stem, q.options, q.answer, q.explanation FROM wrong_questions w JOIN questions q ON q.id=w.question_id WHERE w.user_id=? AND w.bank_id=? ORDER BY w.last_wrong_at DESC'
      : 'SELECT w.wrong_count, w.last_wrong_at, w.status, q.id, q.bank_id, q.seq, q.type, q.stem, q.options, q.answer, q.explanation FROM wrong_questions w JOIN questions q ON q.id=w.question_id WHERE w.user_id=? ORDER BY w.last_wrong_at DESC';
    const rows = db.prepare(sql).all(u.uid, ...(bankId ? [bankId] : []));
    return { wrong: rows.map((r) => ({ ...r, options: r.options ? JSON.parse(r.options) : null })) };
  };

  router['DELETE /api/wrong/:questionId'] = async (body, params, req) => {
    const u = getUser(req);
    if (!u) throw httpError(401, '未登录，请先登录飞牛');
    const db = getDb();
    db.prepare('DELETE FROM wrong_questions WHERE user_id=? AND question_id=?').run(u.uid, params.questionId);
    return { removed: true };
  };

  return router;
}

/** 试卷详情（含题目；已交卷回看带用户答案） */
function paperDetail(pid) {
  const db = getDb();
  const paper = db.prepare('SELECT * FROM papers WHERE id=?').get(pid);
  if (!paper) return null;
  const ids = JSON.parse(paper.question_ids);
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, seq, type, stem, options, answer, explanation FROM questions WHERE id IN (${ph})`).all(...ids);
  const byId = Object.fromEntries(rows.map((r) => [r.id, { ...r, options: r.options ? JSON.parse(r.options) : null }]));
  const questions = ids.map((qid) => byId[qid]).filter(Boolean);
  // 回看：已交卷带用户答案
  let userAnswers = {};
  if (paper.status === 'submitted') {
    const recs = db.prepare('SELECT question_id, user_answer, is_correct FROM answer_records WHERE paper_id=?').all(pid);
    userAnswers = Object.fromEntries(recs.map((r) => [r.question_id, { user_answer: r.user_answer, correct: !!r.is_correct }]));
  }
  return { ...paper, question_ids: ids, questions, user_answers: userAnswers };
}
function serveStatic(res, urlPath, accept) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(WWW_ROOT, rel));
  if (!filePath.startsWith(WWW_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback：非 API 且接受 HTML → index.html
      if (accept && accept.includes('text/html')) {
        const idx = path.join(WWW_ROOT, 'index.html');
        fs.stat(idx, (e2, s2) => {
          if (e2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          fs.createReadStream(idx).pipe(res);
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ==================== HTTP 服务 ====================
function start() {
  initDb(DATA_DIR);
  migrate();
  ai.setConfigFile(DATA_DIR);
  const router = createRouter();

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      let p = u.pathname;
      // 剥离网关前缀 /app/shuatixia
      if (p.startsWith('/app/shuatixia')) p = p.slice('/app/shuatixia'.length) || '/';
      const accept = req.headers.accept || '';

      const curUser = getUser(req);
      if (p.startsWith('/api/') && !curUser) {
        sendJson(res, 401, { error: '未登录，请先登录飞牛' });
        return;
      }

      if (p.startsWith('/api/')) {
        const method = req.method;
        let matched = null;
        for (const key of Object.keys(router)) {
          const [m, pattern] = key.split(' ');
          if (m !== method) continue;
          const params = paramMatch(pattern, p);
          if (params) { matched = { handler: router[key], params }; break; }
        }
        if (!matched) { sendJson(res, 404, { error: 'api not found' }); return; }
        const isJsonBody = ['POST', 'PUT', 'DELETE'].includes(method) &&
          (req.headers['content-type'] || '').includes('application/json');
        let body = null;
        if (isJsonBody) {
          try { body = await readBody(req); } catch (e) {
            sendJson(res, e.message === 'invalid json' ? 400 : 413, { error: e.message }); return;
          }
        }
        const data = await matched.handler(body, matched.params, req);
        sendJson(res, 200, { ok: true, data });
      } else {
        serveStatic(res, p, accept);
      }
    } catch (e) {
      const code = e.status || 500;
      sendJson(res, code, { ok: false, error: e.message || 'internal error' });
    }
  });

  if (SOCKET_PATH) {
    try { fs.unlinkSync(SOCKET_PATH); } catch (e) { /* 陈旧 socket */ }
    server.listen(SOCKET_PATH, () => {
      console.log(`[shuatixia] listening on unix socket ${SOCKET_PATH}`);
    });
  } else {
    const port = PORT || 18099;
    server.listen(port, '0.0.0.0', () => {
      console.log(`[shuatixia] listening on http://0.0.0.0:${port}`);
      console.log(`[shuatixia] data dir: ${DATA_DIR || '(memory)'}`);
    });
  }
}

start();
