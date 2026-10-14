'use strict';
/**
 * tests/ai.test.js — AI 通道单测（mock fetch）
 * 覆盖：配置保存/脱敏、讲解缓存命中（第二次不调 AI）、解析 JSON 归一、usage 审计、分批
 */
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

let called = 0; // fetch 调用次数
let lastPayload = null;

async function run() {
  // 1) 内存库 + 临时配置目录
  const { initDb, genId, nowLocal } = require('../db');
  const db = initDb(null);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-test-'));
  const ai = require('../ai');
  ai.setConfigFile(tmp);
  const uid = 'u-test';

  // 造题库 + 题目
  const bankId = genId('bk');
  db.prepare('INSERT INTO question_banks (id, owner_id, name, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(bankId, uid, '测试库', nowLocal(), nowLocal());
  const qid = genId('q');
  db.prepare('INSERT INTO questions (id, bank_id, seq, type, stem, options, answer, explanation, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(qid, bankId, 1, 'single', '1+1=?', JSON.stringify([{ k: 'A', text: '2' }, { k: 'B', text: '3' }]), 'A', null, nowLocal());

  // 2) 配置保存 + 脱敏
  const cfg = ai.saveConfig({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-abcdef123456', model: 'deepseek-chat' });
  assert.strictEqual(cfg.model, 'deepseek-chat');
  assert.strictEqual(ai.maskKey('sk-abcdef123456'), 'sk-a****3456');
  assert.strictEqual(ai.getConfig().baseUrl, 'https://api.deepseek.com/v1');

  // 3) mock fetch：讲解
  global.fetch = async (url, opts) => {
    called++;
    lastPayload = { url, opts };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '考点：加法。思路：1+1=2。易错：看错符号。' } }],
        usage: { prompt_tokens: 30, completion_tokens: 20 },
      }),
    };
  };

  // 第一次讲解 → 调 AI + 缓存
  const r1 = await ai.explainQuestion(db, qid, uid, cfg);
  assert.strictEqual(r1.cached, false);
  assert.ok(r1.text.includes('考点'));
  assert.strictEqual(called, 1);

  // 第二次 → 缓存命中，不再调 AI
  const r2 = await ai.explainQuestion(db, qid, uid, cfg);
  assert.strictEqual(r2.cached, true);
  assert.strictEqual(r2.text, r1.text);
  assert.strictEqual(called, 1);

  // 权限：他人访问 403
  await assert.rejects(() => ai.explainQuestion(db, qid, 'u-other', cfg), (e) => e.status === 403);

  // 4) usage 审计
  const usage = db.prepare('SELECT kind, model, questions, chars FROM ai_usage WHERE user_id=?').all(uid);
  assert.strictEqual(usage.length, 1);
  assert.strictEqual(usage[0].kind, 'explain');
  assert.strictEqual(usage[0].questions, 1);
  assert.ok(usage[0].chars > 0);

  // 5) 解析：mock 返回 JSON 数组（含判断/单选）
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ questions: [
        { stem: '判断1', type: 'judge', options: [{ k: 'A', text: '对' }, { k: 'B', text: '错' }], answer: 'A', explanation: '', chapter: '' },
        { stem: '单选一', type: 'single', options: [{ k: 'A', text: '甲' }, { k: 'B', text: '乙' }], answer: 'A', explanation: '', chapter: '' },
      ] }) } }],
      usage: {},
    }),
  });
  const parseCfg = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };
  const parsed = await ai.parseBlocks(
    ['[Q]判断1 [T]对', '1. 单选一 A.甲 B.乙 答案：A'],
    parseCfg,
    { usage: { db, userId: uid } }
  );
  assert.ok(Array.isArray(parsed));
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].type, 'judge');   // 判断题归一
  assert.strictEqual(parsed[0].answer, 'true');  // 答案 A→true
  assert.strictEqual(parsed[1].type, 'single');
  assert.strictEqual(parsed[1].answer, 'A');
  // 批内 usage 审计
  const usage2 = db.prepare('SELECT kind, questions, chars FROM ai_usage WHERE user_id=? AND kind=?').all(uid, 'parse');
  assert.strictEqual(usage2.length, 1);
  assert.strictEqual(usage2[0].questions, 2);
  assert.ok(usage2[0].chars > 0);

  // 6) 分批逻辑：60 块 × 长文本 → 多批，但每批 ≤ 20 块 / ≤ 6000 字符
  const big = Array.from({ length: 60 }, (_, i) => `块${i}：` + '甲'.repeat(200));
  const batches = ai.splitBlocks(big);
  assert.ok(batches.length >= 3, `batches=${batches.length}`);
  for (const b of batches) {
    assert.ok(b.length <= 20);
    assert.ok(b.join('').length <= 6000);
  }

  // 7) 无配置
  ai.setConfigFile(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-empty-')));
  assert.strictEqual(ai.getConfig(), null);

  // 8) looseParse 宽松解析
  assert.deepStrictEqual(ai.looseParse('前言 ```json\n{"questions":[]}\n``` 后'), { questions: [] });
  assert.deepStrictEqual(ai.looseParse('```json\n{"questions":[{"stem":"x"}]}\n```'), { questions: [{ stem: 'x' }] });
  assert.strictEqual(ai.looseParse('完全不是 JSON'), null);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('AI 通道单测全部通过：讲解缓存/权限/审计/解析归一/分批/脱敏/宽松JSON');
}

run().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
