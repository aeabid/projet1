import test from 'node:test';
import assert from 'node:assert';
import pg from 'pg';
import { NetlifyDB } from '@netlify/database-dev';
import { createHandler } from '../lib/app.js';
import { TABLES } from '../lib/db.js';

const migrations = new URL('../netlify/database/migrations', import.meta.url).pathname;
let dbs = [];
const pools = [];

async function freshPool() {
  const db = new NetlifyDB();
  const url = await db.start();
  await db.applyMigrations(migrations);
  dbs.push(db);
  const pool = new pg.Pool({ connectionString: url });
  pools.push(pool);
  return pool;
}

test.after(async () => {
  for (const p of pools) await p.end();
  for (const d of dbs) await d.stop();
});

test('copy every table from the Netlify database to Supabase, then keep working', async () => {
  const source = await freshPool();
  const target = await freshPool();
  const call = (handle) => async (method, url, body, cookie) => {
    const res = await handle(new Request('http://x' + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }));
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };

  // القاعدة القديمة: كلمة سر الإدارة تبدّلت، وفيها معطيات
  const oldApi = call(createHandler(source, { adminPassword: 'old-pass' }));
  const { cookie } = await oldApi('POST', '/api/login', { username: 'admin', password: 'old-pass' });
  const parent = (await oldApi('POST', '/api/users', { role: 'parent', username: 'pp', full_name: 'P', password: 'secret1' }, cookie)).body.user;
  const st = (await oldApi('POST', '/api/students', { full_name: 'Copied Kid', level: '9', parent_id: parent.id, monthly_fee: 150, start_date: '2026-09-01', pack: true }, cookie)).body.student;
  const pay = (await oldApi('POST', `/api/students/${st.id}/payments`, { month: '2026-09', amount: 150 }, cookie)).body.payment;
  await oldApi('POST', '/api/timetable', { level: '9', day: 3, start_time: '14:00', end_time: '15:00', subject_id: 1, valid_from: '2026-09-01' }, cookie);
  await oldApi('PUT', '/api/settings/fees', { support: { 9: 160 } }, cookie);
  await oldApi('POST', '/api/program/classes', { name: 'الصغار' }, cookie);

  // التطبيق على Supabase: أول طلب ينقل المعطيات تلقائيًا
  const newApi = call(createHandler(target, { adminPassword: 'env-pass', engine: 'supabase', migrationSource: source }));
  const login = await newApi('POST', '/api/login', { username: 'admin', password: 'old-pass' });
  assert.strictEqual(login.status, 200);
  const status = (await newApi('GET', '/api/admin/db-status', null, login.cookie)).body;
  assert.deepStrictEqual([status.engine, status.migration_available], ['supabase', true]);
  assert.strictEqual(status.target_rows, status.source_rows);
  // إعادة النقل يدويًا ممكنة بتأكيد صريح فقط
  assert.strictEqual((await newApi('POST', '/api/admin/migrate-db', {}, login.cookie)).status, 409);
  const res = await newApi('POST', '/api/admin/migrate-db', { confirm: 'REPLACE' }, login.cookie);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.copied.students, 1);

  // كل الجداول متطابقة
  for (const t of TABLES) {
    const a = (await source.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n;
    const b = (await target.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n;
    assert.strictEqual(b, a, t);
  }
  // الدخول بكلمة السر القديمة، والمعطيات كما هي
  const relog = await newApi('POST', '/api/login', { username: 'admin', password: 'old-pass' });
  assert.strictEqual(relog.status, 200);
  const detail = (await newApi('GET', `/api/students/${st.id}`, null, relog.cookie)).body;
  assert.strictEqual(detail.student.full_name, 'Copied Kid');
  assert.strictEqual(detail.finance.months.find((m) => m.month === '2026-09').paid, 150);
  assert.strictEqual(detail.timetable[0].start_time, '14:00');
  assert.deepStrictEqual((await newApi('GET', '/api/settings/fees', null, relog.cookie)).body.support, { 9: 160 });
  // الأرقام التسلسلية تواصل بعد آخر رقم
  const st2 = (await newApi('POST', '/api/students', { full_name: 'After', level: '5' }, relog.cookie)).body.student;
  assert.ok(st2.id > st.id);
  const pay2 = (await newApi('POST', `/api/students/${st.id}/payments`, { amount: 10 }, relog.cookie)).body.payment;
  assert.strictEqual(pay2.receipt_no, pay.receipt_no + 1);
});

test('first request on an empty Supabase copies the Netlify data automatically', async () => {
  const source = await freshPool();
  const target = await freshPool();
  const req = (handle, method, url, body, cookie) =>
    handle(new Request('http://x' + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }));
  const old = createHandler(source, { adminPassword: 'old' });
  const c = (await req(old, 'POST', '/api/login', { username: 'admin', password: 'old' })).headers.get('set-cookie').split(';')[0];
  await req(old, 'POST', '/api/students', { full_name: 'Auto Kid', level: '7' }, c);

  const fresh = createHandler(target, { adminPassword: 'env', migrationSource: source });
  // نفس الكوكي القديم يعمل: الجلسات منقولة
  const res = await req(fresh, 'GET', '/api/students', null, c);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual((await res.json()).students.map((s) => s.full_name), ['Auto Kid']);
  // كلمة سر ADMIN_PASSWORD لا تعوّض كلمة السر القديمة
  assert.strictEqual((await req(fresh, 'POST', '/api/login', { username: 'admin', password: 'env' })).status, 401);
  assert.strictEqual((await req(fresh, 'POST', '/api/login', { username: 'admin', password: 'old' })).status, 200);
});
