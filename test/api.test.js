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

test('enrollment, photo and monthly payments', async () => {
  const admin = await login('admin', 'admin123');
  const { body: meta } = await admin('GET', '/api/meta');
  const id = (name) => meta.subjects.find((s) => s.name === name).id;
  const [math, fr, ar] = [id('الرياضيات'), id('الفرنسية'), id('العربية')];

  const parent = (await admin('POST', '/api/users', { role: 'parent', username: 'pf', full_name: 'PF', password: 'secret1' })).body.user;
  await admin('POST', '/api/users', { role: 'teacher', username: 'tf', full_name: 'TF', password: 'secret1', subject_ids: [math, fr] });
  const month = new Date().toISOString().slice(0, 7);
  const st = (
    await admin('POST', '/api/students', {
      full_name: 'Fin S', level: '8', parent_id: parent.id, school: 'Collège X', address: '12 rue Y',
      subject_ids: [math, ar], monthly_fee: '120,5', billing_start: month,
    })
  ).body.student;
  assert.strictEqual(st.monthly_fee, 120.5);

  // التسجيل في المواد: المعلم لا يكتب في مادة غير مسجّل فيها التلميذ
  const teacher = await login('tf', 'secret1');
  assert.strictEqual((await teacher('POST', `/api/students/${st.id}/notes`, { subject_id: fr, category: 'level', content: 'x' })).status, 400);
  assert.strictEqual((await teacher('POST', `/api/students/${st.id}/notes`, { subject_id: math, category: 'level', content: 'ok' })).status, 201);

  // pack = كل مواد المستوى
  await admin('PUT', `/api/students/${st.id}`, { ...st, pack: true, subject_ids: [] });
  let detail = (await admin('GET', `/api/students/${st.id}`)).body;
  assert.ok(detail.student.subjects.some((s) => s.id === fr));
  assert.ok(!detail.student.subjects.some((s) => s.name === 'علوم الحياة والأرض')); // التاسعة فقط

  // الخلاص
  assert.strictEqual(detail.finance.balance, 120.5);
  assert.strictEqual((await admin('POST', `/api/students/${st.id}/payments`, { month, amount: 100, method: 'cash' })).status, 201);
  assert.strictEqual((await admin('POST', `/api/students/${st.id}/payments`, { month, amount: 0 })).status, 400);
  const p = await login('pf', 'secret1');
  detail = (await p('GET', `/api/students/${st.id}`)).body;
  assert.strictEqual(detail.finance.total_paid, 100);
  assert.strictEqual(detail.finance.balance, 20.5);
  assert.strictEqual(detail.finance.months[0].payments[0].method, 'cash');
  assert.strictEqual((await p('POST', `/api/students/${st.id}/payments`, { month, amount: 5 })).status, 403);
  assert.strictEqual((await p('GET', '/api/students')).body.students[0].balance, 20.5);

  // المعلم لا يرى المعطيات المالية
  const tdetail = (await teacher('GET', `/api/students/${st.id}`)).body;
  assert.strictEqual(tdetail.finance, null);
  assert.strictEqual(tdetail.student.monthly_fee, undefined);
  assert.strictEqual((await teacher('GET', '/api/students')).body.students.find((s) => s.id === st.id).balance, undefined);

  // الصورة
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.strictEqual((await admin('PUT', `/api/students/${st.id}/photo`, { photo: 'javascript:alert(1)' })).status, 400);
  assert.strictEqual((await admin('PUT', `/api/students/${st.id}/photo`, { photo: png })).status, 200);
  const cookie = (await call('POST', '/api/login', { username: 'pf', password: 'secret1' })).headers.get('set-cookie').split(';')[0];
  const img = await handle(new Request(`http://localhost/api/students/${st.id}/photo`, { headers: { cookie } }));
  assert.strictEqual(img.status, 200);
  assert.strictEqual(img.headers.get('content-type'), 'image/png');
  const stats = (await admin('GET', '/api/stats')).body;
  assert.ok(stats.finance.unpaid.some((u) => u.id === st.id && u.balance === 20.5));
});

test('prorata, free students and status', async () => {
  const admin = await login('admin', 'admin123');
  const now = new Date();
  const ym = now.toISOString().slice(0, 7);
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const create = async (extra) =>
    (await admin('POST', '/api/students', { full_name: 'Pr ' + Math.random(), level: '7', monthly_fee: 100, ...extra })).body.student;
  const fin = async (st) => (await admin('GET', `/api/students/${st.id}`)).body.finance;

  // دخل يوم 11 من الشهر: الشهر الأول بالـ prorata
  const p = await create({ start_date: `${ym}-11` });
  const f = await fin(p);
  assert.strictEqual(f.months[0].due, Math.round((100 * (dim - 10)) / dim));
  assert.strictEqual(f.months[0].prorata, `${dim - 10}/${dim}`);

  // مجاني: لا مستحقات
  assert.strictEqual((await fin(await create({ start_date: `${ym}-01`, free: true }))).balance, 0);
  // في الانتظار: لا مستحقات
  assert.strictEqual((await fin(await create({ start_date: `${ym}-01`, status: 'waiting' }))).balance, 0);
  // توقف يوم 10: prorata لآخر شهر
  const st = await create({ start_date: `${ym}-01`, status: 'stopped', end_date: `${ym}-10` });
  assert.strictEqual((await fin(st)).months[0].due, Math.round((100 * 10) / dim));
  assert.strictEqual((await admin('POST', '/api/students', { full_name: 'x', level: '7', status: 'bad' })).status, 400);
  const waiting = (await admin('GET', '/api/students?status=waiting')).body.students;
  assert.ok(waiting.every((s) => s.status === 'waiting') && waiting.length >= 1);
});

test('parent self-registration with ID card, then login by CIN', async () => {
  const meta = await call('GET', '/api/public/meta');
  assert.strictEqual(meta.status, 200);
  const math = meta.body.subjects.find((s) => s.name === 'الرياضيات').id;
  const reg = {
    parent: { full_name: 'Reg Parent', cin: '09876543', phone: '+216 22 333 444', password: 'secret1', address: 'Ariana' },
    children: [
      { full_name: 'Reg Kid 1', level: '9', pack: true, school: 'Collège Z' },
      { full_name: 'Reg Kid 2', level: '5', subject_ids: [math] },
    ],
  };
  const res = await call('POST', '/api/register', reg);
  assert.strictEqual(res.status, 201);
  assert.ok(res.headers.get('set-cookie').startsWith('sid='));
  assert.strictEqual(res.body.user.username, '22333444');
  assert.strictEqual(res.body.user.children.length, 2);
  // مرة ثانية بنفس الهاتف أو بطاقة التعريف: مرفوض
  assert.strictEqual((await call('POST', '/api/register', reg)).status, 409);
  assert.strictEqual((await call('POST', '/api/register', { ...reg, website: 'spam' })).status, 400);

  const parent = await login('09876543', 'secret1'); // الدخول برقم بطاقة التعريف
  const kids = (await parent('GET', '/api/students')).body.students;
  assert.deepStrictEqual(kids.map((k) => k.status), ['waiting', 'waiting']);
  const kid2 = kids.find((k) => k.full_name === 'Reg Kid 2');
  assert.deepStrictEqual((await parent('GET', `/api/students/${kid2.id}`)).body.student.subjects.map((s) => s.id), [math]);
});

test('teacher class list, bulk attendance and class tasks', async () => {
  const admin = await login('admin', 'admin123');
  const { body: meta } = await admin('GET', '/api/meta');
  const math = meta.subjects.find((s) => s.name === 'الرياضيات').id;
  const fr = meta.subjects.find((s) => s.name === 'الفرنسية').id;
  await admin('POST', '/api/users', { role: 'teacher', username: 'tatt', full_name: 'Tatt', password: 'secret1', subject_ids: [math] });
  const pa = (await admin('POST', '/api/users', { role: 'parent', username: 'patt', full_name: 'Patt', password: 'secret1' })).body.user;
  const mk = async (name, extra) =>
    (await admin('POST', '/api/students', { full_name: name, level: '8', parent_id: pa.id, ...extra })).body.student;
  const a = await mk('Att A', { subject_ids: [math] });
  const b = await mk('Att B', { pack: true });
  const c = await mk('Att C', { subject_ids: [fr] }); // ليس في الرياضيات
  const d = await mk('Att D', { subject_ids: [math], status: 'left' }); // خرج

  const teacher = await login('tatt', 'secret1');
  const list = (await teacher('GET', '/api/students?level=8')).body.students.map((s) => s.full_name);
  assert.ok(list.includes('Att A') && list.includes('Att B'));
  assert.ok(!list.includes('Att C') && !list.includes('Att D'));

  const day = '2026-10-15';
  const att = (await teacher('GET', `/api/attendance?level=8&subject_id=${math}&date=${day}`)).body;
  assert.deepStrictEqual(att.students.map((s) => s.full_name).filter((n) => n.startsWith('Att')), ['Att A', 'Att B']);
  assert.strictEqual((await teacher('POST', '/api/attendance', { level: '8', subject_id: math, date: day, absent_ids: [a.id] })).status, 200);
  assert.strictEqual((await teacher('GET', `/api/attendance?level=8&subject_id=${math}&date=${day}`)).body.students.find((s) => s.id === a.id).absent, true);
  // تعديل: A حاضر، B غائب
  await teacher('POST', '/api/attendance', { level: '8', subject_id: math, date: day, absent_ids: [b.id] });
  const after = (await teacher('GET', `/api/attendance?level=8&subject_id=${math}&date=${day}`)).body.students;
  assert.deepStrictEqual(after.filter((s) => s.absent).map((s) => s.id), [b.id]);
  assert.strictEqual((await teacher('GET', `/api/attendance?level=8&subject_id=${fr}&date=${day}`)).status, 403);

  // مهمة لكل القسم
  assert.strictEqual((await teacher('POST', '/api/tasks', { level: '8', subject_id: math, title: 'Série 3', due_date: '2026-10-20' })).status, 201);
  assert.strictEqual((await teacher('POST', '/api/tasks', { level: '8', subject_id: fr, title: 'x' })).status, 403);
  const parent = await login('patt', 'secret1');
  assert.deepStrictEqual((await parent('GET', `/api/students/${a.id}`)).body.tasks.map((t) => t.title), ['Série 3']);
  assert.deepStrictEqual((await parent('GET', `/api/students/${c.id}`)).body.tasks, []); // C غير مسجّل في الرياضيات
  assert.strictEqual((await parent('GET', '/api/tasks')).status, 403);
  void d;
});

test('timetables: admin builds per level, teacher and parents see theirs', async () => {
  const admin = await login('admin', 'admin123');
  const { body: meta } = await admin('GET', '/api/meta');
  const math = meta.subjects.find((s) => s.name === 'الرياضيات').id;
  const fr = meta.subjects.find((s) => s.name === 'الفرنسية').id;
  const svt = meta.subjects.find((s) => s.name === 'علوم الحياة والأرض').id;
  const t = (await admin('POST', '/api/users', { role: 'teacher', username: 'ttt', full_name: 'TT', password: 'secret1', subject_ids: [math] })).body.user;
  const pa = (await admin('POST', '/api/users', { role: 'parent', username: 'ptt', full_name: 'PT', password: 'secret1' })).body.user;
  const kid = (await admin('POST', '/api/students', { full_name: 'TT Kid', level: '7', group_name: 'A', parent_id: pa.id, subject_ids: [math] })).body.student;

  const slot = (extra) => admin('POST', '/api/timetable', { level: '7', day: 3, start_time: '14:00', end_time: '15:30', subject_id: math, teacher_id: t.id, ...extra });
  assert.strictEqual((await slot({})).status, 201);
  // نفس المعلم في نفس الوقت (حتى في مستوى آخر): مرفوض
  assert.strictEqual((await slot({ level: '8', start_time: '15:00', end_time: '16:00' })).status, 409);
  assert.strictEqual((await slot({ start_time: '16:00', end_time: '15:00' })).status, 400);
  assert.strictEqual((await slot({ subject_id: svt, teacher_id: null })).status, 400); // علوم للتاسعة فقط
  await slot({ day: 5, start_time: '09:00', end_time: '10:00', subject_id: fr, teacher_id: null }); // مادة غير مسجّل فيها
  await slot({ day: 6, start_time: '09:00', end_time: '10:00', group_name: 'B' }); // فوج آخر

  const teacher = await login('ttt', 'secret1');
  const mine = (await teacher('GET', '/api/timetable')).body.slots;
  assert.deepStrictEqual(mine.map((s) => [s.day, s.start_time]), [[3, '14:00'], [6, '09:00']]);
  assert.strictEqual((await teacher('POST', '/api/timetable', { level: '7', day: 1, start_time: '08:00', end_time: '09:00', subject_id: math })).status, 403);

  const parent = await login('ptt', 'secret1');
  const { children } = (await parent('GET', '/api/timetable/children')).body;
  assert.deepStrictEqual(children[0].slots.map((s) => s.day), [3]); // لا الفرنسية ولا الفوج B
  assert.deepStrictEqual((await parent('GET', `/api/students/${kid.id}`)).body.timetable.map((s) => s.subject_name), ['الرياضيات']);
  assert.strictEqual((await parent('GET', '/api/timetable')).status, 403);
});

test('whatsapp groups: admin manages links, parent sees their child group', async () => {
  const admin = await login('admin', 'admin123');
  const link = 'https://chat.whatsapp.com/AbCdEf1234567890';
  assert.strictEqual((await admin('POST', '/api/whatsapp-groups', { name: 'x', level: '9', invite_link: 'https://evil.example/x' })).status, 400);
  assert.strictEqual((await admin('POST', '/api/whatsapp-groups', { name: 'التاسعة أ', level: '9', group_name: 'A', invite_link: link })).status, 201);
  await admin('POST', '/api/whatsapp-groups', { name: 'التاسعة ب', level: '9', group_name: 'B', invite_link: link + 'B' });
  await admin('POST', '/api/whatsapp-groups', { name: 'كل الأولياء', invite_link: link + 'ALL' }); // دون مستوى
  const pa = (await admin('POST', '/api/users', { role: 'parent', username: 'pwa', full_name: 'PWA', password: 'secret1', phone: '22 123 456' })).body.user;
  const kid = (await admin('POST', '/api/students', { full_name: 'WA Kid', level: '9', group_name: 'a', parent_id: pa.id })).body.student;
  const parent = await login('pwa', 'secret1');
  assert.deepStrictEqual((await parent('GET', `/api/students/${kid.id}`)).body.whatsapp_groups.map((g) => g.name), ['التاسعة أ']);
  assert.strictEqual((await parent('GET', '/api/whatsapp-groups')).status, 403);
  assert.strictEqual((await admin('GET', '/api/whatsapp-groups')).body.groups.length, 3);
});

test('teacher payroll: hours from timetable, adjustments, payments, history kept', async () => {
  const admin = await login('admin', 'admin123');
  const { body: meta } = await admin('GET', '/api/meta');
  const math = meta.subjects.find((s) => s.name === 'الرياضيات').id;
  const t = (await admin('POST', '/api/users', { role: 'teacher', username: 'tpay', full_name: 'T Pay', password: 'secret1', subject_ids: [math], hourly_rate: '20' })).body.user;
  assert.strictEqual(t.hourly_rate, 20);
  await admin('POST', '/api/users', { role: 'teacher', username: 'tother', full_name: 'Other', password: 'secret1' });

  // الأربعاء 14:00–15:30 منذ 1 سبتمبر 2025: أيام الأربعاء في سبتمبر 2025 = 3، 10، 17، 24
  const slot = (await admin('POST', '/api/timetable', { level: '5', day: 3, start_time: '14:00', end_time: '15:30', subject_id: math, teacher_id: t.id, valid_from: '2025-09-01' })).body.slot;
  let m = (await admin('GET', `/api/payroll/${t.id}?month=2025-09`)).body;
  assert.deepStrictEqual(m.sessions.map((x) => x.date), ['2025-09-03', '2025-09-10', '2025-09-17', '2025-09-24']);
  assert.strictEqual(m.hours_done, 6);
  assert.strictEqual(m.due, 120);

  // غياب يوم 10، حصة إضافية ساعتان يوم 13
  await admin('POST', `/api/payroll/${t.id}/adjustments`, { date: '2025-09-10', timetable_id: slot.id, hours: 0, note: 'غياب' });
  await admin('POST', `/api/payroll/${t.id}/adjustments`, { date: '2025-09-13', hours: 2, note: 'حصة تدارك' });
  m = (await admin('GET', `/api/payroll/${t.id}?month=2025-09`)).body;
  assert.strictEqual(m.hours_done, 6.5);
  assert.strictEqual(m.due, 130);
  assert.strictEqual(m.sessions.find((x) => x.date === '2025-09-10').status, 'absent');

  // تسبقة ثم الباقي
  await admin('POST', `/api/payroll/${t.id}/payments`, { month: '2025-09', amount: 100, kind: 'advance' });
  m = (await admin('GET', `/api/payroll/${t.id}?month=2025-09`)).body;
  assert.strictEqual(m.remaining, 30);

  // تعديل ثم حذف الحصة اليوم لا يغيّر الأشهر الماضية
  assert.strictEqual((await admin('PUT', `/api/timetable/${slot.id}`, { level: '5', day: 4, start_time: '10:00', end_time: '11:00', subject_id: math, teacher_id: t.id })).status, 200);
  const current = (await admin('GET', '/api/timetable?level=5')).body.slots.filter((x) => x.teacher_id === t.id);
  assert.strictEqual(current.length, 1);
  assert.strictEqual(current[0].day, 4);
  await admin('DELETE', `/api/timetable/${current[0].id}`);
  assert.strictEqual((await admin('GET', `/api/payroll/${t.id}?month=2025-09`)).body.due, 130);

  // المعلم يرى حسابه طيلة السنة، ولا يرى حساب غيره
  const teacher = await login('tpay', 'secret1');
  assert.strictEqual((await teacher('GET', `/api/payroll/${t.id}?month=2025-09`)).body.paid, 100);
  const year = (await teacher('GET', `/api/payroll/${t.id}/year`)).body;
  assert.ok(year.months.length >= 1 && year.months[0].month.endsWith('-09'));
  const other = await login('tother', 'secret1');
  assert.strictEqual((await other('GET', `/api/payroll/${t.id}?month=2025-09`)).status, 403);
  assert.strictEqual((await teacher('POST', `/api/payroll/${t.id}/payments`, { month: '2025-09', amount: 5 })).status, 403);
  const list = (await admin('GET', '/api/payroll?month=2025-09')).body;
  assert.strictEqual(list.teachers.find((x) => x.id === t.id).remaining, 30);
});

test('educational program, courses, staff, ledger and monthly finance summary', async () => {
  const admin = await login('admin', 'admin123');
  const month = new Date().toISOString().slice(0, 7);
  const day = new Date().toISOString().slice(0, 10);
  const before = (await admin('GET', `/api/finance/summary?month=${month}`)).body;
  const act = (sum, key) => sum.activities.find((a) => a.key === key);

  // البرنامج التربوي
  const cls = (await admin('POST', '/api/program/classes', { name: 'قسم 4-5 سنوات', age_range: '4-5' })).body.class;
  const child = (await admin('POST', '/api/program/children', { full_name: 'Prog Kid', class_id: cls.id, monthly_fee: 150, start_date: `${month}-01`, guardian_phone: '22000111' })).body.child;
  assert.strictEqual((await admin('POST', `/api/program/children/${child.id}/payments`, { month, amount: 150 })).status, 201);
  const prog = (await admin('GET', '/api/program')).body;
  assert.strictEqual(prog.classes.find((k) => k.id === cls.id).children, 1);
  assert.strictEqual(prog.children.find((c) => c.id === child.id).balance, 0);
  // جوان-أوت لا تُحتسب
  const summer = (await admin('POST', '/api/program/children', { full_name: 'Summer Kid', monthly_fee: 100, start_date: '2025-06-01', status: 'left', end_date: '2025-08-31' })).body.child;
  assert.strictEqual((await admin('GET', `/api/program/children/${summer.id}`)).body.finance.total_due, 0);

  // دورة
  const course = (await admin('POST', '/api/courses', { name: 'دورة عطلة الشتاء', kind: 'holiday', price: 80, start_date: day, end_date: day })).body.course;
  await admin('POST', `/api/courses/${course.id}/participants`, { full_name: 'P1', paid_now: 80 });
  const p2 = (await admin('POST', `/api/courses/${course.id}/participants`, { full_name: 'P2', fee: 60 })).body.participant;
  await admin('POST', `/api/courses/participants/${p2.id}/payments`, { amount: 30 });
  await admin('POST', '/api/ledger', { direction: 'expense', activity: 'courses', category: 'supplies', amount: 40, course_id: course.id, description: 'أدوات' });
  const cd = (await admin('GET', `/api/courses/${course.id}`)).body;
  assert.strictEqual(cd.course.expected, 140);
  assert.strictEqual(cd.course.received, 110);
  assert.strictEqual(cd.course.net, 70);
  assert.strictEqual(cd.participants.find((p) => p.full_name === 'P2').remaining, 30);

  // الإطار: أجور الشهر مرة واحدة فقط
  await admin('POST', '/api/staff', { full_name: 'مربية', activity: 'program', monthly_salary: 600 });
  await admin('POST', '/api/staff', { full_name: 'قديم', activity: 'program', monthly_salary: 500, active: false });
  assert.strictEqual((await admin('POST', '/api/staff/salaries', { month, date: day })).body.created, 1);
  assert.strictEqual((await admin('POST', '/api/staff/salaries', { month, date: day })).body.created, 0);
  await admin('POST', '/api/ledger', { direction: 'expense', activity: 'general', category: 'rent', amount: 1000, date: day });
  assert.strictEqual((await admin('POST', '/api/ledger', { direction: 'expense', activity: 'x', category: 'rent', amount: 1 })).status, 400);

  const after = (await admin('GET', `/api/finance/summary?month=${month}`)).body;
  const delta = (key, k) => Math.round((act(after, key)[k] - act(before, key)[k]) * 1000) / 1000;
  assert.strictEqual(delta('program', 'income'), 150);
  assert.strictEqual(delta('program', 'expense'), 600);
  assert.strictEqual(delta('courses', 'income'), 110);
  assert.strictEqual(delta('courses', 'expense'), 40);
  assert.strictEqual(delta('general', 'expense'), 1000);
  assert.ok(after.accrual.program.billed >= 150);
  const year = (await admin('GET', '/api/finance/year')).body;
  assert.ok(year.months.some((m) => m.month === month));

  const teacher = await login('tpay', 'secret1');
  assert.strictEqual((await teacher('GET', `/api/finance/summary?month=${month}`)).status, 403);
  assert.strictEqual((await teacher('GET', '/api/program')).status, 403);
});
