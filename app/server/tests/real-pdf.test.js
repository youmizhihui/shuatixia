'use strict';
// tests/real-pdf.test.js — 真实 PDF 识别验证（需后端运行在 18098）
const fs = require('node:fs');
const path = require('node:path');

const B = '----real';
const pdfPath = path.join(__dirname, '..', '..', '..', '.devfixtures', 'real-sample.pdf');
const buf = fs.readFileSync(pdfPath);
console.log('PDF bytes:', buf.length);

const head = Buffer.from(
  `${B}\r\nContent-Disposition: form-data; name="file"; filename="real-sample.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
  'utf8'
);
const tail = Buffer.from(`\r\n${B}--\r\n`, 'utf8');

fetch('http://127.0.0.1:18098/api/banks/bk_muc6z1bz_zgyf5d/import', {
  method: 'POST',
  headers: { 'Content-Type': `multipart/form-data; boundary=${B}` },
  body: Buffer.concat([head, buf, tail]),
}).then((r) => r.json()).then((j) => {
  console.log('import:', JSON.stringify(j).slice(0, 600));
  if (j.data && j.data.token) {
    return fetch(`http://127.0.0.1:18098/api/imports/${j.data.token}`).then((r) => r.json()).then((p) => {
      console.log('preview total:', p.data.summary?.total, 'failed:', p.data.summary?.failed, 'byType:', JSON.stringify(p.data.summary?.byType));
      console.log('first question:', JSON.stringify(p.data.questions?.[0])?.slice(0, 300));
    });
  }
}).catch((e) => console.log('ERR', e.message));
