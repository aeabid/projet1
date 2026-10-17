import test from 'node:test';
import assert from 'node:assert';
import pg from 'pg';
import { NetlifyDB } from '@netlify/database-dev';
import { createHandler } from '../lib/app.js';

let db, pool, handle;

test.before(async () => {
  db = new NetlifyDB();
  const connectionString = await db.start();
  await db.applyMigrations(new URL('../netlify/database/migrations', import.meta.url).pathname);
  pool = new pg.Pool({ connectionString });
  handle = createHandler(pool, { adminPassword: 'admin123' });
});
test.after(async () => {
  await pool.end();
  await db.stop();
});

async function call(method, url, body, cookie) {
  const res = await handle(
    new Request('http://localhost' + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function login(username, password) {
  const res = await call('POST', '/api/login', { username, password });
  assert.strictEqual(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (method, url, body) => call(method, url, body, cookie);
}

test('full flow: admin, teacher, parent permissions', async () => {
  const admin = await login('admin', 'admin123');
  const { body: meta } = await admin('GET', '/api/meta');
  const id = (name) => meta.subjects.find((s) => s.name === name).id;
  const [math, fr, svt] = [id('الرياضيات'), id('الفرنسية'), id('علوم الحياة والأرض')];
  assert.deepStrictEqual(meta.subjects.find((s) => s.id === svt).levels, ['9']);

  const t = await admin('POST', '/api/users', { role: 'teacher', username: 't1', full_name: 'T', password: 'secret1', subject_ids: [math, svt] });
  assert.strictEqual(t.status, 201);
  assert.strictEqual(t.body.user.subjects.length, 2);
  const p1 = (await admin('POST', '/api/users', { role: 'parent', username: 'p1', full_name: 'P1', password: 'secret1' })).body.user;
  await admin('POST', '/api/users', { role: 'parent', username: 'p2', full_name: 'P2', password: 'secret1' });
  assert.strictEqual((await admin('POST', '/api/users', { role: 'parent', username: 'P1', full_name: 'X', password: 'secret1' })).status, 409);

  const s1 = (await admin('POST', '/api/students', { full_name: 'S1', level: '6-distance', parent_id: p1.id })).body.student;
  const s2 = (await admin('POST', '/api/students', { full_name: 'S2', level: '9' })).body.student;
  assert.strictEqual((await admin('POST', '/api/students', { full_name: 'X', level: '4' })).status, 400);

  const teacher = await login('t1', 'secret1');
  assert.strictEqual((await teacher('POST', `/api/students/${s1.id}/notes`, { subject_id: math, category: 'level', rating: 'good', content: 'bien' })).status, 201);
  assert.strictEqual((await teacher('POST', `/api/students/${s1.id}/notes`, { subject_id: fr, category: 'level', content: 'x' })).status, 403);
  // علوم الحياة والأرض للتاسعة فقط
  assert.strictEqual((await teacher('POST', `/api/students/${s1.id}/notes`, { subject_id: svt, category: 'level', content: 'x' })).status, 400);
  assert.strictEqual((await teacher('POST', `/api/students/${s2.id}/notes`, { subject_id: svt, category: 'level', content: 'ok' })).status, 201);
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
  assert.strictEqual(detail.body.absences[0].date, '2026-10-01');
  assert.strictEqual((await parent('GET', `/api/students/${s2.id}`)).status, 404);
  assert.strictEqual((await parent('POST', `/api/students/${s1.id}/notes`, { category: 'general', content: 'x' })).status, 403);

  const other = await login('p2', 'secret1');
  assert.strictEqual((await other('GET', `/api/students/${s1.id}`)).status, 404);
  assert.strictEqual((await other('GET', '/api/students')).body.students.length, 0);

  const stats = await admin('GET', '/api/stats');
  assert.strictEqual(stats.body.students, 2);
});

test('rejects bad credentials and anonymous access', async () => {
  assert.strictEqual((await call('POST', '/api/login', { username: 'admin', password: 'nope' })).status, 401);
  assert.strictEqual((await call('GET', '/api/students')).status, 401);
  assert.strictEqual((await call('GET', '/api/students/99999999999')).status, 404);
});

test('imports a student list and groups siblings under one parent account', async () => {
  const admin = await login('admin', 'admin123');
  const rows = [
    { full_name: 'Imp A', level: '5', parent_name: 'Parent X', phone: '99 111 222/94000000', city: 'Ariana', remarks: 'SAUF FR' },
    { full_name: 'Imp B', level: '6-distance', parent_name: 'parent  x', phone: '' }, // نفس الولي بالاسم
    { full_name: 'Imp C', level: '9', parent_name: 'Other', phone: '+21699111222' }, // نفس الولي بالهاتف
    { full_name: 'Imp D', level: '7', parent_name: 'Validé', phone: '' }, // دون ولي
    { full_name: 'Imp E', level: '8', parent_name: '', phone: '55 000 111' }, // هاتف فقط
  ];
  const res = await admin('POST', '/api/import/students', { rows });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.created_students, 5);
  assert.strictEqual(res.body.parents.length, 2);
  const [px, pe] = res.body.parents;
  assert.strictEqual(px.username, '99111222');
  assert.deepStrictEqual(px.children, ['Imp A', 'Imp B', 'Imp C']);
  assert.strictEqual(pe.full_name, 'ولي Imp E');

  const parent = await login(px.username, px.password);
  const { body } = await parent('GET', '/api/students');
  assert.deepStrictEqual(body.students.map((s) => s.full_name).sort(), ['Imp A', 'Imp B', 'Imp C']);
  assert.strictEqual(body.students.find((s) => s.full_name === 'Imp A').remarks, 'SAUF FR');

  // إعادة الاستيراد: لا تكرار للتلاميذ ولا للأولياء
  const again = await admin('POST', '/api/import/students', { rows });
  assert.strictEqual(again.body.created_students, 0);
  assert.strictEqual(again.body.skipped.length, 5);
  assert.strictEqual(again.body.parents.length, 0);

  assert.strictEqual((await admin('POST', '/api/import/students', { rows: [{ full_name: 'X', level: '4' }] })).status, 400);
  assert.strictEqual((await parent('POST', '/api/import/students', { rows })).status, 403);
});
