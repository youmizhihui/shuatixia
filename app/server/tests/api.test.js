'use strict';
/**
 * tests/api.test.js — 后端 API 集成测试（需先启动 server：node server.js --port 18099 --data-dir .devdb）
 * 链路：创建题库 → 上传识别 → 预览 → 确认入库 → 题目列表可见
 */
const assert = require('node:assert');
const XLSX = require('xlsx');

const BASE = 'http://127.0.0.1:18098';
const BOUNDARY = '----shuatixia-test-' + Date.now();

const SAMPLE_TEXT = `第一章 有理数
1. 计算：3 + 5 = ?
A. 6
B. 7
C. 8
D. 9
【答案】C
【解析】3 + 5 = 8。
2. 下列哪个数是质数？
A. 4
B. 6
C. 7
D. 9
答案：C
解析：7 只能被 1 和自身整除。
3. 判断：0 是最小的自然数。
A. 对
B. 错
【答案】对
4. 多选：以下哪些是偶数？
A. 2
B. 3
C. 4
D. 5
答案：AC
`;

async function json(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(j)}`);
  return j.data;
}

function multipart(fields, fileField, filename, fileBuf, fileType) {
  const chunks = [];
  const push = (s) => chunks.push(Buffer.from(s, 'utf8'));
  for (const [k, v] of Object.entries(fields)) {
    push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  }
  push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${fileType}\r\n\r\n`);
  chunks.push(fileBuf);
  push(`\r\n--${BOUNDARY}--\r\n`);
  return Buffer.concat(chunks);
}

async function upload(bankId, filename, buf, type) {
  const body = multipart({}, 'file', filename, buf, type);
  const res = await fetch(`${BASE}/api/banks/${bankId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
    body,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`import → ${res.status}: ${JSON.stringify(j)}`);
  return j.data;
}

(async () => {
  let pass = 0;

  // 1) health
  {
    const h = await json('GET', '/api/health');
    assert.strictEqual(h.name, '爱刷题');
    pass++;
    console.log('[1] health OK');
  }

  // 2) 创建题库
  const bank = await json('POST', '/api/banks', { name: '初中数学·测试', category: '数学' });
  assert.ok(bank.id && bank.name === '初中数学·测试');
  pass++;
  console.log('[2] 创建题库 OK —', bank.id);

  // 3) 上传 txt → 预览
  const txtRes = await upload(bank.id, 'sample.txt', Buffer.from(SAMPLE_TEXT, 'utf8'), 'text/plain');
  assert.ok(txtRes.token && txtRes.summary.total === 4, `txt summary=${JSON.stringify(txtRes.summary)}`);
  const prev = await json('GET', `/api/imports/${txtRes.token}`);
  assert.strictEqual(prev.questions.length, 4);
  assert.strictEqual(prev.questions[2].type, 'judge');
  pass++;
  console.log('[3] txt 上传识别+预览 OK —', txtRes.summary.total, '题');

  // 4) 确认入库
  const committed = await json('POST', `/api/imports/${txtRes.token}/commit`, {});
  assert.strictEqual(committed.imported, 4);
  pass++;
  console.log('[4] 确认入库 OK —', committed.imported, '题');

  // 5) 题目列表可见
  const qs = await json('GET', `/api/banks/${bank.id}/questions?page=1&size=20`);
  assert.strictEqual(qs.total, 4);
  assert.strictEqual(qs.questions[0].stem.includes('3 + 5'), true);
  pass++;
  console.log('[5] 题目列表可见 OK — total', qs.total);

  // 6) 上传 xlsx（表格式）→ 预览 → 入库
  {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析', '章节'],
      ['1+1=?', '1', '2', '3', '4', 'B', '1+1=2', '加法'],
      ['2*3=?', '5', '6', '7', '8', 'B', '2*3=6', '乘法'],
      ['10-3=?', '6', '7', '8', '9', 'B', '10-3=7', '减法'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const r = await upload(bank.id, 'basic.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(r.summary.total === 3, `xlsx summary=${JSON.stringify(r.summary)}`);
    const prev2 = await json('GET', `/api/imports/${r.token}`);
    assert.strictEqual(prev2.questions[0].answer, 'B');
    const c2 = await json('POST', `/api/imports/${r.token}/commit`, {});
    assert.strictEqual(c2.imported, 3);
    pass++;
    console.log('[6] xlsx 表格式导入 OK —', c2.imported, '题');
  }

  // 7) 题库列表 + 题目总数
  const banks = await json('GET', '/api/banks');
  const b = banks.banks.find((x) => x.id === bank.id);
  assert.strictEqual(b.question_count, 7);
  pass++;
  console.log('[7] 题库列表统计 OK —', b.name, b.question_count, '题');

  // 8) 重复导入：追加模式（同一题库再导入 2 题覆盖）
  {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['题干', '答案'],
      ['判断题：1+1=2', '对'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const r = await upload(bank.id, 'judge.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const prev3 = await json('GET', `/api/imports/${r.token}`);
    assert.strictEqual(prev3.questions[0].type, 'judge'); // 表格式无选项列判断题 → 归一化为 judge
    assert.strictEqual(prev3.questions[0].answer, 'true');
    pass++;
    console.log('[8] 追加导入预览 OK（判断题归一化 judge:true）');
  }

  console.log(`\nAPI 集成测试全部通过：${pass}/8`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
