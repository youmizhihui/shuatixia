'use strict';
// tests/commit-real.js — 真实 PDF 预览结果入库（临时验证脚本）
fetch('http://127.0.0.1:18098/api/imports/imp_muc7jiww_0xhpgb/commit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
}).then((r) => r.json()).then((j) => {
  console.log('commit:', JSON.stringify(j).slice(0, 300));
  return fetch('http://127.0.0.1:18098/api/banks/bk_muc6z1bz_zgyf5d/questions?page=1&size=3').then((r) => r.json()).then((p) => {
    console.log('bank total:', p.data?.total, 'first3:', p.data?.items?.map((q) => `${q.seq}:${q.type}:${q.answer}`).join(' | '));
  });
}).catch((e) => console.log('ERR', e.message));
