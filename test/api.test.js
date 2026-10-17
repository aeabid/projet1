const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../db');
const { createApp } = require('../server');

let server, base;

test.before(async () => {
  server = createApp(openDb(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function login(username, password) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.strictEqual(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
}

test('full flow: admin, teacher, parent permissions', async () => {
  const admin = await login('admin', 'admin123');
  const { body: meta } = await admin('GET', '/api/meta');
  const math = meta.subjects.find((s) => s.name === 'الرياضيات').id;
  const fr = meta.subjects.find((s) => s.name === 'الفرنسية').id;

  const t = await admin('POST', '/api/users', { role: 'teacher', username: 't1', full_name: 'T', password: 'secret1', subject_ids: [math] });
  assert.strictEqual(t.status, 201);
  const p1 = (await admin('POST', '/api/users', { role: 'parent', username: 'p1', full_name: 'P1', password: 'secret1' })).body.user;
  await admin('POST', '/api/users', { role: 'parent', username: 'p2', full_name: 'P2', password: 'secret1' });

  const s1 = (await admin('POST', '/api/students', { full_name: 'S1', level: '6-distance', parent_id: p1.id })).body.student;
  const s2 = (await admin('POST', '/api/students', { full_name: 'S2', level: '9' })).body.student;
  assert.strictEqual((await admin('POST', '/api/students', { full_name: 'X', level: '4' })).status, 400);

  const teacher = await login('t1', 'secret1');
  assert.strictEqual((await teacher('POST', `/api/students/${s1.id}/notes`, { subject_id: math, category: 'level', rating: 'good', content: 'bien' })).status, 201);
  assert.strictEqual((await teacher('POST', `/api/students/${s1.id}/notes`, { subject_id: fr, category: 'level', content: 'x' })).status, 403);
  assert.strictEqual((await teacher('POST', `/api/students/${s1.id}/absences`, { subject_id: math, date: '2026-10-01' })).status, 201);
  assert.strictEqual((await teacher('POST', '/api/students', { full_name: 'Y', level: '5' })).status, 403);
  assert.strictEqual((await teacher('GET', '/api/users')).status, 403);

  await admin('POST', `/api/students/${s1.id}/notes`, { category: 'general', content: 'admin note' });

  const parent = await login('p1', 'secret1');
  const list = await parent('GET', '/api/students');
  assert.deepStrictEqual(list.body.students.map((s) => s.id), [s1.id]);
  const detail = await parent('GET', `/api/students/${s1.id}`);
  assert.strictEqual(detail.body.notes.length, 2);
  assert.strictEqual(detail.body.absences.length, 1);
  assert.strictEqual((await parent('GET', `/api/students/${s2.id}`)).status, 404);
  assert.strictEqual((await parent('POST', `/api/students/${s1.id}/notes`, { category: 'general', content: 'x' })).status, 403);

  const other = await login('p2', 'secret1');
  assert.strictEqual((await other('GET', `/api/students/${s1.id}`)).status, 404);
  assert.strictEqual((await other('GET', '/api/students')).body.students.length, 0);
});

test('rejects bad credentials and anonymous access', async () => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'nope' }),
  });
  assert.strictEqual(res.status, 401);
  assert.strictEqual((await fetch(`${base}/api/students`)).status, 401);
});
