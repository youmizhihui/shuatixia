'use strict';
// tests/m4.test.js — M4 权限校验/练习重置/收藏/统计 集成测试（后端 18098）
const BASE = 'http://127.0.0.1:18098/api';
const BID = 'bk_muc6z1bz_zgyf5d';
const j = (r) => r.json();
const post = (p, body, headers) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body || {}) }).then(j);

(async () => {
  // 1) 权限：模拟他人身份访问私有题库（x-trim-userid=other → local-user 的库应 403/404）
  const r1 = await fetch(BASE + `/banks/${BID}`, { headers: { 'x-trim-userid': 'other-user', 'x-trim-username': 'other' } }).then(j);
  console.log('1 other-user bankDetail:', JSON.stringify({ ok: r1.ok, status: r1.status, error: r1.error }));

  // 2) 权限：模拟他人身份练习
  const r2 = await fetch(BASE + `/banks/${BID}/practice`, { headers: { 'x-trim-userid': 'other-user', 'x-trim-username': 'other' } }).then(j);
  console.log('2 other-user practice:', JSON.stringify({ ok: r2.ok, status: r2.status }));

  // 3) 权限：模拟他人身份导入
  const r3 = await post(`/banks/${BID}/import`, {}, { 'x-trim-userid': 'other-user', 'x-trim-username': 'other' });
  console.log('3 other-user import:', JSON.stringify({ ok: r3.ok, status: r3.status }));

  // 4) 权限：模拟他人身份 AI 讲解
  const r4 = await post('/ai/explain', { question_id: 'q_muc6zj07_8pdcd5' }, { 'x-trim-userid': 'other-user', 'x-trim-username': 'other' });
  console.log('4 other-user ai/explain:', JSON.stringify({ ok: r4.ok, status: r4.status }));

  // 5) 正常用户访问仍通
  const r5 = await fetch(BASE + `/banks/${BID}`).then(j);
  console.log('5 owner bankDetail:', JSON.stringify({ ok: r5.ok, name: r5.data && r5.data.name }));

  // 6) 练习重置：POST reset 后 practice 回到第 1 题
  await post(`/banks/${BID}/practice/reset`);
  const r6 = await fetch(BASE + `/banks/${BID}/practice`).then(j);
  console.log('6 after reset:', JSON.stringify({ last_seq: r6.data.last_seq, q_seq: r6.data.question && r6.data.question.seq }));

  // 7) 收藏 + 列表
  const q1 = r6.data.question.id;
  const r7 = await post(`/questions/${q1}/favorite`, { favorite: true });
  const r7b = await fetch(BASE + `/favorites?bank_id=${BID}`).then(j);
  console.log('7 favorite:', JSON.stringify({ ok: r7.ok, fav_count: r7b.data.favorites.length, first: r7b.data.favorites[0] && r7b.data.favorites[0].id === q1 }));
  // 取消收藏
  await post(`/questions/${q1}/favorite`, { favorite: false });
  const r7c = await fetch(BASE + `/favorites?bank_id=${BID}`).then(j);
  console.log('7b unfavorite:', r7c.data.favorites.length === 0);

  // 8) 统计
  const r8 = await fetch(BASE + '/stats').then(j);
  console.log('8 stats:', JSON.stringify({ answered: r8.data.answered, correct: r8.data.correct, wrong_total: r8.data.wrong_total, wrong_mastered: r8.data.wrong_mastered, by_type: r8.data.by_type.length, by_chapter: r8.data.by_chapter.length, trend: r8.data.trend.length, papers: r8.data.papers, active_days: r8.data.active_days }));
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
