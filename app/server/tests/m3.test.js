'use strict';
// tests/m3.test.js — M3 练习闭环 API 集成测试（需后端运行在 18098）
const BASE = 'http://127.0.0.1:18098/api';
const BID = 'bk_muc6z1bz_zgyf5d';
const j = (r) => r.json();
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(j);

(async () => {
  // 1) 练习：取当前进度题
  let r = await fetch(BASE + `/banks/${BID}/practice`).then(j);
  console.log('1 practice:', JSON.stringify({ total: r.data.total, last_seq: r.data.last_seq, q: r.data.question && { id: r.data.question.id, seq: r.data.question.seq, type: r.data.question.type } }));

  // 2) 提交第一题（故意答错 → 错题归集）
  const q1 = r.data.question;
  const wrongAns = q1.type === 'judge' ? (q1.answer === 'true' ? 'false' : 'true') : (q1.answer === 'A' ? 'B' : 'A');
  r = await post(`/banks/${BID}/practice/answer`, { question_id: q1.id, answer: wrongAns });
  console.log('2 answer-wrong:', JSON.stringify({ correct: r.data.correct, answer: r.data.answer, next: r.data.next_seq, finished: r.data.finished }));

  // 3) 错题集应包含该题
  r = await fetch(BASE + `/wrong?bank_id=${BID}`).then(j);
  console.log('3 wrong:', r.data.wrong.length, 'items, first wrong_count =', r.data.wrong[0] && r.data.wrong[0].wrong_count);

  // 4) 答对同一题 → status=0（已掌握，但记录仍在列表）
  r = await post(`/banks/${BID}/practice/answer`, { question_id: q1.id, answer: 'C' });
  console.log('4 answer-right:', JSON.stringify(r.data.correct));

  // 5) 组卷 5 题
  r = await post(`/banks/${BID}/papers`, { count: 5, title: '集成测试卷' });
  const pid = r.data.paper.id;
  console.log('5 paper:', JSON.stringify({ id: pid, total: r.data.paper.total, status: r.data.paper.status, qs: r.data.paper.questions.length }));

  // 6) 交卷：全答正确的前 2 题 + 其余空 → 计分
  const answers = {};
  r.data.paper.questions.forEach((q, i) => { if (i < 2) answers[q.id] = q.answer; });
  r = await post(`/papers/${pid}/submit`, { answers });
  console.log('6 submit:', JSON.stringify({ score: r.data.score, total: r.data.total, corrects: r.data.results.filter((x) => x.correct === true).length }));

  // 7) 回看：带用户答案
  r = await fetch(BASE + `/papers/${pid}`).then(j);
  console.log('7 review:', JSON.stringify({ status: r.data.paper.status, has_user_answers: Object.keys(r.data.paper.user_answers).length > 0 }));

  // 8) 试卷列表
  r = await fetch(BASE + '/papers').then(j);
  console.log('8 papers list:', r.data.papers.length);

  // 9) 移除错题
  r = await fetch(BASE + `/wrong/${q1.id}`, { method: 'DELETE' }).then(j);
  r = await fetch(BASE + `/wrong?bank_id=${BID}`).then(j);
  console.log('9 removed, wrong left:', r.data.wrong.length);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
