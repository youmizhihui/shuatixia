'use strict';
// tests/ai-parse-e2e.js — 导入 AI 解析端到端（临时验证）
const fs = require('node:fs');
const path = require('node:path');

const B = '----b';
const f = path.join(__dirname, '..', '..', '..', '.devfixtures', 'unrecognized.txt');
const buf = fs.readFileSync(f);
const head = Buffer.from(`${B}\r\nContent-Disposition: form-data; name="file"; filename="unrecognized.txt"\r\nContent-Type: text/plain\r\n\r\n`, 'utf8');
const tail = Buffer.from(`\r\n${B}--\r\n`, 'utf8');

(async () => {
  const imp = await fetch('http://127.0.0.1:18098/api/banks/bk_muc6z1bz_zgyf5d/import', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${B}` },
    body: Buffer.concat([head, buf, tail]),
  }).then((r) => r.json());
  console.log('import summary:', JSON.stringify(imp.data.summary));

  const token = imp.data.token;
  const parsed = await fetch('http://127.0.0.1:18098/api/ai/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then((r) => r.json());
  console.log('ai-parse:', JSON.stringify(parsed).slice(0, 500));
})();
