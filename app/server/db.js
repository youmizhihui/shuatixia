'use strict';
/**
 * db.js — 爱刷题 SQLite 数据层
 * 使用 Node 内置 node:sqlite（DatabaseSync），零 npm 依赖。
 * 表结构对应方案设计 v2.0 第 6 章。
 */

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

let db = null;

/** 生成 id：前缀 + 时间戳 + 随机串（司农同款） */
function genId(prefix) {
  return prefix + '_' + crypto.randomBytes(9).toString('hex');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS question_banks (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT,
  visibility    TEXT NOT NULL DEFAULT 'private',
  source_format TEXT,
  total_count   INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id             TEXT PRIMARY KEY,
  bank_id        TEXT NOT NULL REFERENCES question_banks(id),
  seq            INTEGER NOT NULL,
  type           TEXT NOT NULL,
  stem           TEXT NOT NULL,
  options        TEXT,
  answer         TEXT NOT NULL,
  explanation    TEXT,
  explanation_ai TEXT,
  chapter        TEXT,
  confidence     REAL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank_id, seq);

CREATE TABLE IF NOT EXISTS practice_progress (
  user_id    TEXT NOT NULL,
  bank_id    TEXT NOT NULL,
  last_seq   INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, bank_id)
);

CREATE TABLE IF NOT EXISTS answer_records (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  bank_id     TEXT NOT NULL,
  question_id TEXT NOT NULL,
  source      TEXT NOT NULL,
  paper_id    TEXT,
  user_answer TEXT,
  is_correct  INTEGER NOT NULL,
  answered_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_user ON answer_records(user_id, bank_id, answered_at);

CREATE TABLE IF NOT EXISTS papers (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  bank_id      TEXT NOT NULL,
  title        TEXT,
  config       TEXT NOT NULL,
  question_ids TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'in_progress',
  score        INTEGER,
  total        INTEGER,
  started_at   TEXT NOT NULL,
  submitted_at TEXT
);

CREATE TABLE IF NOT EXISTS wrong_questions (
  user_id       TEXT NOT NULL,
  bank_id       TEXT NOT NULL,
  question_id   TEXT NOT NULL,
  wrong_count   INTEGER DEFAULT 1,
  last_wrong_at TEXT NOT NULL,
  status        INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id     TEXT NOT NULL,
  bank_id     TEXT NOT NULL,
  question_id TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE IF NOT EXISTS import_templates (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  format      TEXT NOT NULL,
  fingerprint TEXT,
  template    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_templates_fp ON import_templates(fingerprint, owner_id);

-- 格式规范模板（AI 识别格式后确认保存；按格式签名命中自动复用）
CREATE TABLE IF NOT EXISTS import_specs (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,   -- 'text' | 'excel'
  signature  TEXT NOT NULL,   -- 格式签名（文本=行首模式序列哈希；excel=表头哈希）
  spec       TEXT NOT NULL,   -- 规范 JSON
  hits       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_specs_sig ON import_specs(owner_id, kind, signature);

CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  model      TEXT,
  questions  INTEGER NOT NULL,
  chars      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, created_at);
`;

/**
 * 初始化数据库。dataDir 为空时用于内存测试。
 * @param {string} dataDir 数据目录（TRIM_DATA_SHARE_PATHS / TRIM_PKGVAR/data / --data-dir）
 */
function initDb(dataDir) {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = dataDir ? path.join(dataDir, 'shuatixia.db') : ':memory:';
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec(SCHEMA);
  return db;
}

function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

/** 轻量迁移：老库补新增列（预留） */
function migrate() {
  const qCols = db.prepare('PRAGMA table_info(questions)').all();
  if (!qCols.some((c) => c.name === 'explanation_ai')) {
    db.exec('ALTER TABLE questions ADD COLUMN explanation_ai TEXT');
  }
}

/** 本地时间 YYYY-MM-DD HH:mm:ss */
function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

module.exports = { initDb, getDb, genId, nowLocal, migrate };
