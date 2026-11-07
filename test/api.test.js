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
  // الشهر الماضي: كل أيامه مرّت مهما كان تاريخ اليوم (الاختبار لا يفشل يوم 1 من الشهر)
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const ym = prev.toISOString().slice(0, 7);
  const dim = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).getUTCDate();
  const create = async (extra) =>
    (await admin('POST', '/api/students', { full_name: 'Pr ' + Math.random(), level: '7', monthly_fee: 100, ...extra })).body.student;
  const fin = async (st) => (await admin('GET', `/api/students/${st.id}`)).body.finance;

  // دخل يوم 11 من الشهر: الشهر الأول بالـ prorata
  const p = await create({ start_date: `${ym}-11` });
  const f = (await fin(p)).months.find((m) => m.month === ym);
  assert.strictEqual(f.due, Math.round((100 * (dim - 10)) / dim));
  assert.strictEqual(f.prorata, `${dim - 10}/${dim}`);

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
  // المعلم يرى فقط أقسام البرنامج التي ينشّطها، دون معطيات مالية
  const tp = await teacher('GET', '/api/program');
  assert.strictEqual(tp.status, 200);
  assert.deepStrictEqual(tp.body.classes, []);
});

test('center management: discounts, receipts, debts, people, tasks, meetings, alerts, kpis', async () => {
  const admin = await login('admin', 'admin123');
  const pa = (await admin('POST', '/api/users', { role: 'parent', username: 'pcm', full_name: 'Famille CM', password: 'secret1', phone: '20 999 888' })).body.user;
  // تخفيض: 150 - 30 = 120 في الشهر، دين منذ 3 أشهر
  const start = '2026-03-01'; // جويلية وأوت لا يُحتسبان: تاريخ ثابت خارج الصيف
  const st = (await admin('POST', '/api/students', { full_name: 'CM Kid', level: '6', parent_id: pa.id, monthly_fee: 150, discount: 30, discount_reason: 'إخوة', start_date: start })).body.student;
  let f = (await admin('GET', `/api/students/${st.id}`)).body.finance;
  assert.strictEqual(f.net_fee, 120);
  assert.strictEqual(f.months.length >= 2, true);
  assert.strictEqual(f.months[0].due, 120);

  // نفس العائلة في البرنامج التربوي (نفس الهاتف) ودورة
  const child = (await admin('POST', '/api/program/children', { full_name: 'CM Small', guardian_name: 'Famille CM', guardian_phone: '+216 20999888', monthly_fee: 100, start_date: start })).body.child;
  const course = (await admin('POST', '/api/courses', { name: 'رحلة إلى عين دراهم', kind: 'trip', price: 50, place: 'عين دراهم', capacity: 30 })).body.course;
  await admin('POST', `/api/courses/${course.id}/participants`, { full_name: 'CM Kid', student_id: st.id, discount: 10 });

  const debts = (await admin('GET', '/api/debts')).body;
  const fam = debts.families.find((x) => x.key === '20999888');
  assert.ok(fam, 'family grouped by phone');
  assert.deepStrictEqual(fam.items.map((i) => i.type).sort(), ['course', 'program', 'support']);
  assert.ok(fam.months_late >= 2 && fam.severity === 'high');
  assert.strictEqual(fam.items.find((i) => i.type === 'course').amount, 40);

  // وصل
  const pay = (await admin('POST', `/api/students/${st.id}/payments`, { month: start.slice(0, 7), amount: 120 })).body.payment;
  assert.ok(pay.receipt_no > 0);
  const r = (await admin('GET', `/api/receipts/support/${pay.id}`)).body.receipt;
  assert.strictEqual(r.receipt_no, pay.receipt_no);
  assert.strictEqual(r.beneficiary, 'CM Kid');
  assert.strictEqual(r.payer, 'Famille CM');
  const parent = await login('pcm', 'secret1');
  assert.strictEqual((await parent('GET', `/api/receipts/support/${pay.id}`)).status, 200);
  // وصل طفل ليس من أبنائه
  assert.strictEqual((await parent('GET', `/api/receipts/program/1`)).status, 404);
  const p2 = (await admin('POST', `/api/program/children/${child.id}/payments`, { amount: 100 })).body.payment;
  assert.strictEqual(p2.receipt_no, pay.receipt_no + 1);
  const list = (await admin('GET', '/api/receipts')).body.receipts;
  assert.ok(list.some((x) => x.receipt_no === p2.receipt_no && x.kind === 'program'));

  // كل تلاميذ المركز: نفس الطفل في الدعم والرحلة
  const people = (await admin('GET', '/api/center/people')).body.people;
  const kid = people.find((x) => x.full_name === 'CM Kid');
  assert.deepStrictEqual(kid.programs.map((p) => p.type).sort(), ['support', 'trip']);

  // مهام ومشاكل
  const t = (await admin('POST', '/api/users', { role: 'teacher', username: 'tcm', full_name: 'T CM', password: 'secret1' })).body.user;
  await admin('POST', '/api/todo', { title: 'إصلاح المكيّف', kind: 'problem', priority: 'urgent' });
  const late = (await admin('POST', '/api/todo', { title: 'تحضير امتحان', assignee_user_id: t.id, due_date: '2026-01-01' })).body.task;
  const teacher = await login('tcm', 'secret1');
  assert.deepStrictEqual((await teacher('GET', '/api/todo')).body.tasks.map((x) => x.title), ['تحضير امتحان']);
  let alerts = (await admin('GET', '/api/alerts')).body;
  assert.ok(alerts.alerts.some((a) => a.link === '#/todo' && a.level === 'urgent'));
  assert.ok(alerts.alerts.some((a) => a.link === '#/debts'));
  assert.strictEqual((await teacher('PATCH', `/api/todo/${late.id}`, { status: 'done' })).status, 200);

  // اجتماع وقرار ← مهمة
  const m = (await admin('POST', '/api/meetings', { title: 'اجتماع الإطار', date: '2026-10-01', minutes: 'نقاش حول الرحلات' })).body.meeting;
  const d = (await admin('POST', `/api/meetings/${m.id}/decisions`, { text: 'تنظيم رحلة في العطلة', owner: 'المدير', due_date: '2026-11-01' })).body.decision;
  const task = (await admin('POST', `/api/decisions/${d.id}/task`)).body.task;
  await admin('PATCH', `/api/todo/${task.id}`, { status: 'done' });
  const meetings = (await admin('GET', '/api/meetings')).body.meetings;
  assert.strictEqual(meetings.find((x) => x.id === m.id).decisions[0].status, 'done');

  // التعريفات والمؤشرات
  await admin('PUT', '/api/settings/fees', { support: { 9: 160, 5: '120' } });
  assert.deepStrictEqual((await admin('GET', '/api/settings/fees')).body.support, { 5: 120, 9: 160 });
  const k = (await admin('GET', '/api/kpis')).body;
  assert.ok(k.support_active >= 1 && k.debtors >= 1 && k.tasks_open >= 1);
  assert.strictEqual((await teacher('GET', '/api/kpis')).status, 403);
});

test('program parents, one child in both programs, sibling discounts, yearly registration, shared expenses split', async () => {
  const admin = await login('admin', 'admin123');
  const year = (await admin('GET', '/api/settings/fees')).body.school_year;
  assert.strictEqual((await admin('PUT', '/api/settings/fees', { support: {}, family: { two: 10, three: 20 } })).status, 200);
  const fees = (await admin('GET', '/api/settings/fees')).body;
  assert.deepStrictEqual(fees.family, { two: 10, three: 20 });
  assert.strictEqual((await admin('PUT', '/api/settings/fees', { family: { two: 120 } })).status, 400);

  const parent = (await admin('POST', '/api/users', { role: 'parent', username: 'pfam', full_name: 'Famille', phone: '22 555 111', password: 'secret1' })).body.user;
  const anim = (await admin('POST', '/api/users', { role: 'teacher', username: 'anim', full_name: 'Animatrice', password: 'secret1' })).body.user;
  const A = (await admin('POST', '/api/students', { full_name: 'Fam A', level: '7', parent_id: parent.id, monthly_fee: 100, start_date: '2026-09-01' })).body.student;
  const k = (await admin('POST', '/api/program/classes', { name: 'Fam class', teacher_id: anim.id })).body.class;
  const B = (await admin('POST', '/api/program/children', { full_name: 'Fam B', class_id: k.id, parent_id: parent.id, monthly_fee: 80, start_date: '2026-09-01' })).body.child;
  // نفس التلميذ A في البرنامج التربوي: الاسم والولي من ملف الدعم
  const A2 = (await admin('POST', '/api/program/children', { student_id: A.id, class_id: k.id, monthly_fee: 50, start_date: '2026-10-01' })).body.child;
  assert.strictEqual((await admin('POST', '/api/program/children', { student_id: A.id })).status, 409);

  // شهر سبتمبر وأكتوبر: طفلان (A و B) => تخفيض 10%، و A في البرنامجين يُحسب مرة واحدة
  let a = (await admin('GET', `/api/students/${A.id}`)).body;
  assert.strictEqual(a.finance.months.find((m) => m.month === '2026-09').due, 90);
  assert.strictEqual(a.finance.months.find((m) => m.month === '2026-10').due, 90);
  assert.deepStrictEqual(a.finance.registration, []);
  assert.strictEqual(a.program.child.id, A2.id);
  assert.strictEqual(a.program.finance.months.find((m) => m.month === '2026-10').due, 45);
  assert.deepStrictEqual(a.program.finance.registration, []);
  let b = (await admin('GET', `/api/program/children/${B.id}`)).body;
  assert.strictEqual(b.finance.months.find((m) => m.month === '2026-09').due, 72);

  // ثالث ابن من أكتوبر: 20% في أكتوبر فقط
  await admin('POST', '/api/students', { full_name: 'Fam C', level: '5', parent_id: parent.id, monthly_fee: 100, start_date: '2026-10-01' });
  a = (await admin('GET', `/api/students/${A.id}`)).body;
  assert.strictEqual(a.finance.months.find((m) => m.month === '2026-09').due, 90);
  assert.strictEqual(a.finance.months.find((m) => m.month === '2026-10').due, 80);
  b = (await admin('GET', `/api/program/children/${B.id}`)).body;
  assert.strictEqual(b.finance.months.find((m) => m.month === '2026-10').due, 64);

  // معلوم التسجيل لم يعد منفصلًا: يُضاف إلى أول شهر، ويجتمع مع أي تعديل على نفس الشهر
  assert.strictEqual((await admin('POST', '/api/registration-payments', { child_id: A2.id, amount: 30, school_year: year })).status, 410);
  await admin('PUT', '/api/fee-adjustments', { child_id: B.id, month: '2026-09', kind: 'amount', value: 20 });
  const ex = (await admin('POST', '/api/fee-extras', { child_id: B.id, month: '2026-09', amount: 40, reason: 'معلوم التسجيل' })).body;
  b = (await admin('GET', `/api/program/children/${B.id}`)).body;
  let sep = b.finance.months.find((m) => m.month === '2026-09');
  // معلوم التسجيل اختياري: غير مدفوع ← لا يُستحق ولا يصبح دينًا
  assert.deepStrictEqual([sep.due, sep.extras[0].amount, sep.extras[0].paid], [20, 40, 0]);
  // يُدفع جزء منه (30 زيادة على المعلوم) ← يُحتسب 30 فقط، ولا رصيد مسبق
  const pB = (await admin('POST', '/api/pay-months', { kind: 'program', id: B.id, lines: [{ month: '2026-09', amount: 50 }] })).body.payment;
  b = (await admin('GET', `/api/program/children/${B.id}`)).body;
  sep = b.finance.months.find((m) => m.month === '2026-09');
  assert.deepStrictEqual([sep.due, sep.paid, sep.remaining, sep.extras[0].paid], [50, 50, 0, 30]);
  // مبلغ إضافي آخر (غير التسجيل) يُستحق كاملًا
  const ex2 = (await admin('POST', '/api/fee-extras', { child_id: B.id, month: '2026-09', amount: 15, reason: 'رحلة' })).body;
  b = (await admin('GET', `/api/program/children/${B.id}`)).body;
  sep = b.finance.months.find((m) => m.month === '2026-09');
  assert.deepStrictEqual([sep.due, sep.remaining], [50, 0]);
  await admin('DELETE', `/api/program/payments/${pB.id}`);
  await admin('DELETE', `/api/fee-extras/${ex2.id}`);
  assert.strictEqual((await admin('DELETE', `/api/fee-extras/${ex.id}`)).status, 200);

  // المنشط: حضور قسمه وملاحظات، دون معطيات مالية
  const t = await login('anim', 'secret1');
  assert.strictEqual((await t('POST', '/api/program/attendance', { class_id: k.id, date: '2026-10-20', absent_ids: [B.id] })).status, 200);
  const att = (await t('GET', `/api/program/attendance?class_id=${k.id}&date=2026-10-20`)).body;
  assert.deepStrictEqual(att.children.filter((c) => c.absent).map((c) => c.id), [B.id]);
  assert.strictEqual((await t('POST', `/api/program/children/${B.id}/notes`, { category: 'content', rating: 'good', content: 'يتابع المحتوى جيدًا' })).status, 201);
  const tb = (await t('GET', `/api/program/children/${B.id}`)).body;
  assert.strictEqual(tb.finance, undefined);
  assert.strictEqual(tb.child.monthly_fee, undefined);
  assert.strictEqual(tb.absences.length, 1);
  const tlist = (await t('GET', '/api/program')).body;
  assert.deepStrictEqual(tlist.classes.map((x) => x.id), [k.id]);

  // الولي: كل أبنائه مرة واحدة، ويرى ملف طفل التربوي ووصولاته
  const p = await login('pfam', 'secret1');
  const fam = (await p('GET', '/api/family')).body.kids;
  assert.deepStrictEqual(fam.map((x) => x.full_name).sort(), ['Fam A', 'Fam B', 'Fam C']);
  assert.strictEqual(fam.find((x) => x.full_name === 'Fam A').program.id, A2.id);
  const pb = (await p('GET', `/api/program/children/${B.id}`)).body;
  assert.strictEqual(pb.notes[0].category, 'content');
  assert.ok(pb.finance.balance > 0);
  const other = (await admin('POST', '/api/program/children', { full_name: 'Other kid' })).body.child;
  assert.strictEqual((await p('GET', `/api/program/children/${other.id}`)).status, 404);
  assert.strictEqual((await p('POST', `/api/program/children/${B.id}/notes`, { category: 'level', content: 'x' })).status, 403);

  // المصاريف المشتركة: وحدها، وتُوزَّع بالنسب التي تحدّدها الإدارة
  const month = new Date().toISOString().slice(0, 7);
  await admin('POST', '/api/ledger', { direction: 'expense', activity: 'general', category: 'rent', amount: 1000, date: `${month}-02` });
  assert.strictEqual((await admin('PUT', '/api/settings/shared-split', { support: 70, program: 40 })).status, 400);
  assert.strictEqual((await admin('PUT', '/api/settings/shared-split', { support: 60, program: 40 })).status, 200);
  const sum = (await admin('GET', `/api/finance/summary?month=${month}`)).body;
  const support = sum.activities.find((x) => x.key === 'support');
  const general = sum.activities.find((x) => x.key === 'general');
  assert.strictEqual(general.label, 'المصاريف العامة للمركز');
  await admin('POST', '/api/ledger', { direction: 'expense', activity: 'general', category: 'cleaning', amount: 50, date: `${month}-03` });
  const gen = (await admin('GET', `/api/finance/general?month=${month}`)).body;
  assert.ok(gen.categories.some((c) => c.label === 'نظافة' && c.total === 50));
  assert.ok(gen.expense >= 1050);
  assert.ok(sum.shared.cost >= 1000);
  assert.strictEqual(support.shared, Math.round(sum.shared.cost * 0.6 * 1000) / 1000);
  assert.strictEqual(support.net_after, Math.round((support.net - support.shared) * 1000) / 1000);
  assert.strictEqual(sum.shared.allocated, 100);
});

test('legacy app import (students, teachers, notes), teacher levels and the monthly evaluation card', async () => {
  const admin = await login('admin', 'admin123');
  // تلميذ موجود مسبقًا بنفس الاسم (مع ملاحظة بين قوسين)
  const old = (await admin('POST', '/api/students', { full_name: 'Ali Legacy (SAUF ENG)', level: '5' })).body.student;
  const payload = {
    teachers: [
      { _id: 't-safa', label: 'Safa Leg', subjects: ['fr'], grades: ['5', '6', '6o'] },
      { _id: 't-sami', label: 'Sami Leg', subjects: ['en'], grades: [] },
    ],
    students: {
      l01: { name: 'Ali Legacy', grade: 5, mode: '', subjects: ['ar', 'fr', 'sci'], parentPhone: '55 111 222', createdAt: '2026-09-15T10:00:00Z' },
      l02: { name: 'Mariem Distance', grade: 6, mode: 'عن بعد', subjects: ['fr', 'en'], parentPhone: '55 111 222', parentName: 'Leg Parent' },
      l03: { name: 'Omar Nine', grade: 9, mode: '', subjects: ['math', 'svt'], parentPhone: '' },
    },
    notes: [
      { _id: 'l01-ar', sid: 'l01', subject: 'ar', level: 'جيد', behavior: 'حسن', text: 'قراءة جيدة', at: '2026-10-31T10:00:00Z', share: true, byLabel: 'بطاقة تقييم أكتوبر' },
      { _id: 'l01-sci', sid: 'l01', subject: 'sci', level: 'ممتاز', behavior: '', text: '', at: '2026-10-31T10:00:00Z', share: true },
      { _id: 'l01-hidden', sid: 'l01', subject: 'fr', level: 'ضعيف', behavior: 'يحتاج متابعة', text: 'داخلي', at: '2026-10-20T10:00:00Z', share: false },
      { _id: 'bad', sid: 'zz', subject: 'ar', level: 'جيد', at: '2026-10-31T10:00:00Z' },
    ],
  };
  const r = (await admin('POST', '/api/import/legacy', payload)).body;
  assert.strictEqual(r.students_matched, 1);
  assert.strictEqual(r.students_created, 2);
  assert.strictEqual(r.notes_added, 3);
  assert.strictEqual(r.notes_skipped, 1);
  assert.strictEqual(r.photo_targets.l01, old.id);
  assert.strictEqual(r.parents.length, 1); // الأختان تحت نفس الولي
  const safa = r.teachers.find((t) => t.full_name === 'Safa Leg');
  assert.ok(safa.username && safa.password);
  // إعادة الاستيراد: لا تكرار
  const again = (await admin('POST', '/api/import/legacy', payload)).body;
  assert.deepStrictEqual([again.students_matched, again.students_created, again.notes_added], [3, 0, 0]);
  assert.ok(again.teachers.every((t) => t.existing));

  const { body: meta } = await admin('GET', '/api/meta');
  assert.ok(meta.subjects.some((x) => x.name === 'العلوم'));
  const mariem = (await admin('GET', '/api/students?q=Mariem')).body.students[0];
  assert.strictEqual(mariem.level, '6-distance');

  // المعلمة: الفرنسية في 5 و6 و6 عن بعد فقط
  const t = await login(safa.username, safa.password);
  const mine = (await t('GET', '/api/students')).body.students.map((x) => x.full_name);
  assert.ok(mine.includes('Mariem Distance') && mine.includes('Ali Legacy (SAUF ENG)') && !mine.includes('Omar Nine'));
  const fr = meta.subjects.find((x) => x.name === 'الفرنسية').id;
  const omar = (await admin('GET', '/api/students?q=Omar')).body.students[0];
  assert.strictEqual((await t('POST', `/api/students/${omar.id}/notes`, { subject_id: fr, category: 'level', content: 'x' })).status, 403);
  // ملاحظة بالمستوى والسلوك معًا، دون نص
  assert.strictEqual((await t('POST', `/api/students/${old.id}/notes`, { subject_id: fr, category: 'level', rating: 'good', behavior: 'excellent', date: '2026-10-25' })).status, 201);

  // بطاقة أكتوبر: الترتيب كالبطاقة الورقية، والملاحظة الداخلية لا تظهر
  const card = (await admin('GET', `/api/students/${old.id}/report?month=2026-10`)).body;
  assert.deepStrictEqual(card.subjects.map((x) => x.subject), ['العلوم', 'العربية', 'الفرنسية']);
  const ar = card.subjects.find((x) => x.subject === 'العربية');
  assert.deepStrictEqual([ar.level, ar.behavior, ar.notes], ['good', 'good', ['قراءة جيدة']]);
  const frRow = card.subjects.find((x) => x.subject === 'الفرنسية');
  assert.deepStrictEqual([frRow.level, frRow.behavior], ['good', 'excellent']);
  assert.ok(card.months.includes('2026-10'));
  assert.strictEqual((await admin('GET', `/api/students/${old.id}/report?month=2026-09`)).body.subjects.every((x) => !x.level), true);
  // الولي يرى البطاقة، دون الملاحظة الداخلية في ملف ابنه
  const parentUser = (await admin('GET', `/api/students/${mariem.id}`)).body.student;
  assert.ok(parentUser.parent_name);
  const cls = (await admin('GET', '/api/reports/class?level=5&month=2026-10')).body;
  assert.ok(cls.reports.some((x) => x.student.id === old.id));
  assert.strictEqual((await t('GET', '/api/reports/class?level=5')).status, 403);
});

test('parent messages, bulk monthly cards, class overview, teacher self-signup', async () => {
  const admin = await login('admin', 'admin123');
  const { body: meta } = await admin('GET', '/api/meta');
  const math = meta.subjects.find((x) => x.name === 'الرياضيات').id;
  const ar = meta.subjects.find((x) => x.name === 'العربية').id;

  // ----- تسجيل المعلم بنفسه: لا دخول قبل الموافقة -----
  const reg = await call('POST', '/api/register', { role: 'teacher', teacher: { full_name: 'Prof Signup', phone: '50 600 700', password: 'secret1', subject_ids: [math] } });
  assert.strictEqual(reg.status, 201);
  assert.strictEqual((await call('POST', '/api/login', { username: '50600700', password: 'secret1' })).status, 403);
  const alerts = (await admin('GET', '/api/alerts')).body.alerts;
  assert.ok(alerts.some((a) => a.link === '#/teachers'));
  const pending = (await admin('GET', '/api/users?role=teacher')).body.users.find((u) => u.full_name === 'Prof Signup');
  assert.strictEqual(pending.approved, false);
  await admin('PUT', `/api/users/${pending.id}`, { ...pending, subject_ids: [math], subject_levels: { [math]: ['8'] } });
  await admin('POST', `/api/users/${pending.id}/approve`);
  const prof = await login('50600700', 'secret1');

  // ----- تلميذ في الثامنة مع ولي -----
  const parentUser = (await admin('POST', '/api/users', { role: 'parent', username: 'pmsg', full_name: 'Parent Msg', password: 'secret1' })).body.user;
  const st = (await admin('POST', '/api/students', { full_name: 'Msg Kid', level: '8', parent_id: parentUser.id, pack: true })).body.student;
  const other = (await admin('POST', '/api/students', { full_name: 'Other Kid', level: '8' })).body.student;
  const parent = await login('pmsg', 'secret1');

  // ----- المراسلة -----
  const t1 = (await parent('POST', '/api/threads', { student_id: st.id, target: 'subject', subject_id: math, body: 'سؤال عن الرياضيات' })).body.thread;
  const t2 = (await parent('POST', '/api/threads', { student_id: st.id, target: 'admin', body: 'سؤال للإدارة' })).body.thread;
  assert.strictEqual((await parent('POST', '/api/threads', { student_id: other.id, target: 'admin', body: 'x' })).status, 404);
  // المعلم يرى محادثة مادته فقط، والإدارة ترى الكل
  assert.deepStrictEqual((await prof('GET', '/api/threads')).body.threads.map((t) => t.id), [t1.id]);
  assert.strictEqual((await prof('GET', '/api/threads/unread')).body.count, 1);
  assert.strictEqual((await prof('GET', `/api/threads/${t2.id}`)).status, 404);
  const seen = (await prof('GET', `/api/threads/${t1.id}`)).body;
  assert.strictEqual(seen.messages[0].from, 'Parent Msg');
  assert.strictEqual((await prof('GET', '/api/threads/unread')).body.count, 0);
  await prof('POST', `/api/threads/${t1.id}/messages`, { body: 'مرحبا، يحتاج تمارين إضافية' });
  await prof('PATCH', `/api/threads/${t1.id}`, { status: 'closed' });
  const pv = (await parent('GET', `/api/threads/${t1.id}`)).body;
  assert.strictEqual(pv.messages[1].from, 'أستاذ(ة) الرياضيات'); // دون اسم المدرّس
  assert.strictEqual(pv.thread.status, 'closed');
  await parent('POST', `/api/threads/${t1.id}/messages`, { body: 'شكرًا' });
  assert.strictEqual((await parent('GET', `/api/threads/${t1.id}`)).body.thread.status, 'open');
  const adminList = (await admin('GET', '/api/threads')).body;
  assert.strictEqual(adminList.threads.length >= 2, true);
  assert.strictEqual((await parent('GET', `/api/threads/${t2.id}`)).body.messages.length, 1);

  // ----- إدخال بطاقات القسم: المعلم في مادته ومستواه فقط -----
  assert.strictEqual((await prof('GET', `/api/evaluations?level=9&subject_id=${math}&month=2026-10`)).status, 403);
  assert.strictEqual((await prof('GET', `/api/evaluations?level=8&subject_id=${ar}&month=2026-10`)).status, 403);
  const ev = (await prof('GET', `/api/evaluations?level=8&subject_id=${math}&month=2026-10`)).body;
  assert.ok(ev.students.some((x) => x.id === st.id));
  await prof('POST', '/api/evaluations', { level: '8', subject_id: math, month: '2026-10', entries: [
    { student_id: st.id, rating: 'average', behavior: 'good', content: 'يحتاج تركيزًا' },
    { student_id: other.id, rating: 'excellent' },
  ] });
  // إعادة الحفظ تعدّل نفس الملاحظة
  await prof('POST', '/api/evaluations', { level: '8', subject_id: math, month: '2026-10', entries: [{ student_id: st.id, rating: 'good', behavior: 'good', content: 'تحسّن' }] });
  const again = (await prof('GET', `/api/evaluations?level=8&subject_id=${math}&month=2026-10`)).body.students.find((x) => x.id === st.id);
  assert.deepStrictEqual([again.card.rating, again.card.content], ['good', 'تحسّن']);
  const card = (await parent('GET', `/api/students/${st.id}/report?month=2026-10`)).body;
  const row = card.subjects.find((x) => x.subject === 'الرياضيات');
  assert.deepStrictEqual([row.level, row.behavior, row.notes], ['good', 'good', ['تحسّن']]);
  assert.strictEqual((await admin('GET', `/api/students/${st.id}`)).body.notes.filter((n) => n.subject_id === math).length, 1);

  // ----- نظرة حسب القسم -----
  const ov = (await admin('GET', '/api/overview?level=8')).body;
  const mi = ov.subjects.findIndex((x) => x.id === math);
  assert.strictEqual(ov.students.find((x) => x.id === st.id).cells[mi].level, 'good');
  assert.ok(ov.counts.good >= 1 && ov.counts.excellent >= 1);
  const tov = (await prof('GET', '/api/overview?level=8')).body;
  assert.deepStrictEqual(tov.subjects.map((x) => x.id), [math]);
  assert.strictEqual((await parent('GET', '/api/overview?level=8')).status, 403);
});

test('home pages: teacher sees students, notes, absences and pay; parent sees notes, payments, absences', async () => {
  const admin = await login('admin', 'admin123');
  const { body: meta } = await admin('GET', '/api/meta');
  const math = meta.subjects.find((x) => x.name === 'الرياضيات').id;
  const t = (await admin('POST', '/api/users', { role: 'teacher', username: 'thome', full_name: 'T Home', password: 'secret1', hourly_rate: 10, subject_ids: [math] })).body.user;
  const p = (await admin('POST', '/api/users', { role: 'parent', username: 'phome', full_name: 'P Home', password: 'secret1' })).body.user;
  const st = (await admin('POST', '/api/students', { full_name: 'Home Kid', level: '7', parent_id: p.id, monthly_fee: 100, start_date: '2026-09-01' })).body.student;
  await admin('POST', `/api/students/${st.id}/payments`, { month: '2026-09', amount: 100, paid_on: '2026-09-03' });
  const teacher = await login('thome', 'secret1');
  await teacher('POST', `/api/students/${st.id}/notes`, { subject_id: math, category: 'level', rating: 'good', content: 'يتقدّم' });
  await teacher('POST', `/api/students/${st.id}/notes`, { subject_id: math, category: 'behavior', rating: 'weak', content: 'داخلية', visible_to_parent: false });
  await teacher('POST', `/api/students/${st.id}/absences`, { subject_id: math, date: new Date().toISOString().slice(0, 10) });

  const th = (await teacher('GET', '/api/home/teacher')).body;
  assert.ok(th.students >= 1);
  assert.strictEqual(th.notes_month, 2);
  assert.strictEqual(th.absences_month, 1);
  assert.strictEqual(th.notes[0].student_name, 'Home Kid');
  assert.ok('remaining' in th.pay && th.pay.hourly_rate === 10);

  const parent = await login('phome', 'secret1');
  const ph = (await parent('GET', '/api/home/parent')).body;
  assert.deepStrictEqual(ph.kids.map((k) => k.full_name), ['Home Kid']);
  assert.deepStrictEqual(ph.notes.map((n) => n.content), ['يتقدّم']); // الملاحظة الداخلية لا تظهر
  assert.strictEqual(ph.notes[0].from, 'أستاذ(ة) الرياضيات');
  assert.deepStrictEqual(ph.payments.map((x) => [x.kind, x.amount, x.paid_on]), [['support', 100, '2026-09-03']]);
  assert.strictEqual(ph.absences.length, 1);
  assert.strictEqual((await parent('GET', '/api/home/teacher')).status, 403);
  assert.strictEqual((await teacher('GET', '/api/home/parent')).status, 403);
});

test('google login for parents: link request, admin approval, then direct login; quick status and subjects list', async () => {
  const gHandle = createHandler(pool, {
    adminPassword: 'admin123',
    googleClientId: 'cid',
    verifyGoogle: async (cred) => {
      if (!cred.startsWith('ok-')) throw Object.assign(new Error('bad'), { status: 401 });
      return { sub: cred.slice(3), email: `${cred.slice(3)}@gmail.com`, name: 'Mama ' + cred.slice(3) };
    },
  });
  const gcall = async (method, url, body, cookie) => {
    const res = await gHandle(new Request('http://localhost' + url, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }));
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const admin = await login('admin', 'admin123');
  assert.strictEqual((await gcall('GET', '/api/auth/config')).body.google_client_id, 'cid');
  assert.strictEqual((await call('GET', '/api/auth/config')).body.google_client_id, null);

  const kid = (await admin('POST', '/api/students', { full_name: 'Googlekid Zarrouk', level: '7', subject_ids: [1, 4] })).body.student;
  const first = await gcall('POST', '/api/auth/google', { credential: 'ok-u1' });
  assert.strictEqual(first.body.link_required, true);
  const ticket = first.body.ticket;
  assert.strictEqual((await gcall('GET', `/api/auth/google/children?ticket=bad&q=googlekid`)).status, 401);
  assert.strictEqual((await gcall('GET', `/api/auth/google/children?ticket=${ticket}&q=go`)).body.children.length, 0);
  const found = (await gcall('GET', `/api/auth/google/children?ticket=${ticket}&q=googlekid`)).body.children;
  assert.deepStrictEqual(found.map((c) => [c.type, c.id]), [['student', kid.id]]);
  assert.strictEqual(Object.keys(found[0]).includes('parent_id'), false);
  const sent = await gcall('POST', '/api/auth/google/request', {
    ticket, full_name: 'Mama Zarrouk', phone: '22 333 444',
    children: [{ type: 'student', id: kid.id }, { type: 'new', full_name: 'Petit Zarrouk', level: '5' }],
  });
  assert.strictEqual(sent.status, 200);
  // ما زال في الانتظار
  assert.strictEqual((await gcall('POST', '/api/auth/google', { credential: 'ok-u1' })).body.status, 'pending');
  const { body: list } = await admin('GET', '/api/parent-requests');
  const req = list.requests.find((r) => r.google_email === 'u1@gmail.com');
  assert.strictEqual(req.children.length, 2);
  assert.strictEqual((await admin('POST', `/api/parent-requests/${req.id}/approve`, {})).status, 200);
  const logged = await gcall('POST', '/api/auth/google', { credential: 'ok-u1' });
  assert.strictEqual(logged.body.user.role, 'parent');
  const cookie = logged.headers.get('set-cookie').split(';')[0];
  const mine = (await gcall('GET', '/api/students', null, cookie)).body.students.map((s) => s.full_name).sort();
  assert.deepStrictEqual(mine, ['Googlekid Zarrouk', 'Petit Zarrouk']);
  assert.strictEqual((await gcall('POST', '/api/auth/google', { credential: 'bad' })).status, 401);

  // الإدارة: نفس البريد في حساب الإدارة = دخول مباشر كإدارة
  const adminUser = (await admin('GET', '/api/me')).body.user;
  await pool.query(`UPDATE users SET email = 'Boss@gmail.com' WHERE id = $1`, [adminUser.id]);
  const boss = await gcall('POST', '/api/auth/google', { credential: 'ok-boss' });
  assert.strictEqual(boss.body.user.role, 'admin');
  assert.strictEqual((await gcall('POST', '/api/auth/google', { credential: 'ok-boss' })).body.user.id, adminUser.id);

  // الحالة السريعة وقائمة المواد
  assert.strictEqual((await admin('PATCH', `/api/students/${kid.id}/status`, { status: 'nope' })).status, 400);
  const left = (await admin('PATCH', `/api/students/${kid.id}/status`, { status: 'left', end_date: '2026-10-31' })).body.student;
  assert.deepStrictEqual([left.status, left.end_date], ['left', '2026-10-31']);
  const back = (await admin('PATCH', `/api/students/${kid.id}/status`, { status: 'waiting' })).body.student;
  assert.deepStrictEqual([back.status, back.end_date], ['waiting', null]);
  const row = (await admin('GET', '/api/students?q=Googlekid')).body.students[0];
  assert.deepStrictEqual(row.subject_names, ['العربية', 'الرياضيات']);
});

test('fee adjustments: whole month absent, some days absent, custom amount', async () => {
  const admin = await login('admin', 'admin123');
  const st = (await admin('POST', '/api/students', { full_name: 'Adj Kid', level: '7', monthly_fee: 100, start_date: '2026-09-01' })).body.student;
  const fin = async () => (await admin('GET', `/api/students/${st.id}`)).body.finance;
  const due = async (m) => (await fin()).months.find((x) => x.month === m).due;
  assert.strictEqual(await due('2026-10'), 100);
  assert.strictEqual((await admin('PUT', '/api/fee-adjustments', { student_id: st.id, month: '2026-10', kind: 'bad' })).status, 400);
  assert.strictEqual((await admin('PUT', '/api/fee-adjustments', { student_id: st.id, month: '2026-10', kind: 'absent_days' })).status, 400);
  await admin('PUT', '/api/fee-adjustments', { student_id: st.id, month: '2026-10', kind: 'exempt', reason: 'مرض' });
  assert.strictEqual(await due('2026-10'), 0);
  await admin('PUT', '/api/fee-adjustments', { student_id: st.id, month: '2026-10', kind: 'absent_days', value: 10 });
  assert.strictEqual(await due('2026-10'), Math.round((100 * 21) / 31));
  await admin('PUT', '/api/fee-adjustments', { student_id: st.id, month: '2026-09', kind: 'amount', value: 30 });
  const f = await fin();
  const sep = f.months.find((x) => x.month === '2026-09');
  assert.deepStrictEqual([sep.due, sep.adjustment.kind, sep.adjustment.original], [30, 'amount', 100]);
  assert.strictEqual((await admin('DELETE', `/api/fee-adjustments/${sep.adjustment.id}`)).status, 200);
  assert.strictEqual(await due('2026-09'), 100);
});

test('program timetable and notes list', async () => {
  const admin = await login('admin', 'admin123');
  const k = (await admin('POST', '/api/program/classes', { name: 'TT class' })).body;
  const classId = k.class?.id ?? k.id;
  assert.ok(classId);
  assert.strictEqual((await admin('POST', '/api/program/slots', { class_id: classId, day: 3, start_time: '10:00', end_time: '09:00' })).status, 400);
  const s = await admin('POST', '/api/program/slots', { class_id: classId, day: 3, start_time: '09:00', end_time: '10:30', title: 'Coran' });
  assert.strictEqual(s.status, 201);
  const { slots } = (await admin('GET', '/api/program/slots')).body;
  assert.ok(slots.some((x) => x.id === s.body.id && x.class_name === 'TT class' && x.title === 'Coran'));
  assert.strictEqual((await admin('DELETE', `/api/program/slots/${s.body.id}`)).status, 200);
  assert.strictEqual((await admin('GET', '/api/program/notes')).status, 200);
});

test('group message to a whole class and program class posts', async () => {
  const admin = await login('admin', 'admin123');
  const { body: meta } = await admin('GET', '/api/meta');
  const math = meta.subjects.find((s) => s.name === 'الرياضيات').id;
  const par = (await admin('POST', '/api/users', { role: 'parent', username: 'gm-p', full_name: 'GM P', password: 'secret1' })).body.user;
  await admin('POST', '/api/students', { full_name: 'GM A', level: '8', parent_id: par.id, pack: true, status: 'studying' });
  await admin('POST', '/api/students', { full_name: 'GM B', level: '8', parent_id: par.id, subject_ids: [1], status: 'studying' });
  const t = (await admin('POST', '/api/users', { role: 'teacher', username: 'gm-t', full_name: 'GM T', password: 'secret1', subject_ids: [math] })).body.user;
  const teacher = await login('gm-t', 'secret1');
  assert.strictEqual((await teacher('POST', '/api/threads/group', { level: '8', subject_id: 1, body: 'x' })).status, 403);
  const sent = await teacher('POST', '/api/threads/group', { level: '8', subject_id: math, title: 'Exam', body: 'Révisez' });
  assert.strictEqual(sent.status, 201);
  const parent = await login('gm-p', 'secret1');
  const threads = (await parent('GET', '/api/threads')).body.threads.filter((x) => x.title === 'Exam');
  assert.strictEqual(threads.length, 1); // GM B لا يدرس الرياضيات

  const k = (await admin('POST', '/api/program/classes', { name: 'Posts class', teacher_id: t.id })).body.class;
  const child = (await admin('POST', '/api/program/children', { full_name: 'Post kid', class_id: k.id, parent_id: par.id })).body.child;
  const other = (await admin('POST', '/api/program/classes', { name: 'Other class' })).body.class;
  assert.strictEqual((await teacher('POST', '/api/program/posts', { class_id: other.id, title: 'x' })).status, 403);
  const post = await teacher('POST', '/api/program/posts', { class_id: k.id, kind: 'activity', title: 'Hifdh', body: 'Sourate' });
  assert.strictEqual(post.status, 201);
  assert.strictEqual(post.body.parents, 1);
  const file = (await parent('GET', `/api/program/children/${child.id}`)).body;
  assert.ok(file.posts.some((p) => p.title === 'Hifdh'));
  assert.strictEqual((await teacher('GET', '/api/program/posts')).body.posts.length, 1);
});

test('program facilitators paid monthly, class formulas, partners share (super admin only)', async () => {
  const admin = await login('admin', 'admin123');
  const f = (await admin('POST', '/api/users', { role: 'teacher', username: 'fac1', full_name: 'Fac One', password: 'secret1', program_staff: true, monthly_salary: 600, subject_ids: [1] })).body.user;
  assert.deepStrictEqual([f.program_staff, f.monthly_salary, f.subjects.length], [true, 600, 0]);
  const k = (await admin('POST', '/api/program/classes', { name: 'Athar T', teacher_id: f.id, formulas: [{ name: 'A', fee: 80 }, { name: 'A+L', fee: 120 }] })).body.class;
  const child = (await admin('POST', '/api/program/children', { full_name: 'Form kid', class_id: k.id, formula: 'A+L', start_date: '2026-09-01' })).body.child;
  const file = (await admin('GET', `/api/program/children/${child.id}`)).body;
  assert.deepStrictEqual([file.child.formula, file.child.monthly_fee], ['A+L', 120]);
  const month = new Date().toISOString().slice(0, 7);
  const pay = await admin('POST', `/api/program/staff/${f.id}/pay`, { month });
  assert.strictEqual(pay.status, 201);
  assert.strictEqual((await admin('POST', `/api/program/staff/${f.id}/pay`, { month })).status, 409);
  const sp = (await admin('GET', `/api/program/staff-pay?month=${month}`)).body;
  assert.strictEqual(sp.staff.find((s) => s.id === f.id).payment.amount, 600);
  const fac = await login('fac1', 'secret1');
  assert.strictEqual((await fac('GET', '/api/program/staff-pay')).body.staff.length, 1);

  // الشركاء: للمشرف العام فقط
  await pool.query(`UPDATE users SET super_admin = false WHERE username = 'admin'`);
  assert.strictEqual((await admin('GET', '/api/partners')).status, 403);
  await pool.query(`UPDATE users SET super_admin = true WHERE username = 'admin'`);
  const p = (await admin('GET', '/api/partners')).body;
  const m = p.months.find((x) => x.month === month);
  assert.strictEqual(m.shares.Aymen, Math.round(m.net * 0.25 * 1000) / 1000);
  assert.strictEqual((await admin('POST', '/api/partners/payments', { partner: 'Aymen', amount: 100, paid_on: '2026-06-10', note: 'avant' })).status, 201);
  const s = (await admin('GET', '/api/partners')).body.summary.find((x) => x.name === 'Aymen');
  assert.strictEqual(s.paid_before, 100);
  await pool.query(`UPDATE users SET super_admin = true WHERE username = 'admin'`);
});

test('center debts: a simple record, payments reduce the remaining and never touch income or expenses', async () => {
  const admin = await login('admin', 'admin123');
  const d = (await admin('POST', '/api/center-debts', { creditor: 'facebook', description: 'Sponsorisation', amount: 4000 })).body;
  assert.strictEqual((await admin('POST', `/api/center-debts/${d.id}/payments`, { amount: 5000 })).status, 400);
  const p = (await admin('POST', `/api/center-debts/${d.id}/payments`, { amount: 1000, paid_on: '2026-10-05' })).body;
  let list = (await admin('GET', '/api/center-debts')).body;
  assert.strictEqual(list.debts.find((x) => x.id === d.id).remaining, 3000);
  const ledger = (await admin('GET', '/api/ledger?month=2026-10&activity=general')).body.entries;
  assert.strictEqual(ledger.filter((e) => e.description?.includes('facebook')).length, 0);
  await admin('DELETE', `/api/center-debts/payments/${p.id}`);
  list = (await admin('GET', '/api/center-debts')).body;
  assert.strictEqual(list.debts.find((x) => x.id === d.id).remaining, 4000);
  assert.strictEqual((await admin('DELETE', `/api/center-debts/${d.id}`)).status, 200);
});

test('facilitator paid per child: 40 for each paying child in her classes', async () => {
  const admin = await login('admin', 'admin123');
  const amel = (await admin('POST', '/api/users', { role: 'teacher', username: 'amel-pc', full_name: 'Amel PC', password: 'secret1', program_staff: true, pay_per_child: 40 })).body.user;
  assert.strictEqual(amel.pay_per_child, 40);
  const k = (await admin('POST', '/api/program/classes', { name: 'Athar PC', teacher_id: amel.id })).body.class;
  await admin('POST', '/api/program/children', { full_name: 'PC1', class_id: k.id, monthly_fee: 80, start_date: '2026-09-01' });
  await admin('POST', '/api/program/children', { full_name: 'PC2', class_id: k.id, monthly_fee: 120, start_date: '2026-09-01' });
  await admin('POST', '/api/program/children', { full_name: 'PC free', class_id: k.id, free: true, start_date: '2026-09-01' });
  const sp = (await admin('GET', '/api/program/staff-pay?month=2026-10')).body;
  const me = sp.staff.find((s) => s.id === amel.id);
  assert.deepStrictEqual([me.children_count, me.expected], [2, 80]);
});

test('salaries overview: support teachers, program staff, admin and cleaning staff', async () => {
  const admin = await login('admin', 'admin123');
  const cleaner = (await admin('POST', '/api/staff', { full_name: 'Samira M', activity: 'general', role: 'عاملة نظافة', monthly_salary: 300 })).body.staff;
  const month = '2026-10';
  let r = (await admin('GET', `/api/salaries?month=${month}`)).body;
  const adminGroup = r.groups.find((g) => g.key === 'admin');
  assert.ok(adminGroup.people.some((p) => p.id === cleaner.id && p.due === 300 && p.paid === 0));
  assert.strictEqual((await admin('POST', `/api/staff/${cleaner.id}/pay`, { month })).status, 201);
  assert.strictEqual((await admin('POST', `/api/staff/${cleaner.id}/pay`, { month })).status, 409);
  r = (await admin('GET', `/api/salaries?month=${month}`)).body;
  assert.strictEqual(r.groups.find((g) => g.key === 'admin').people.find((p) => p.id === cleaner.id).paid, 300);
  assert.deepStrictEqual(r.groups.map((g) => g.key), ['support', 'program', 'admin']);
  const users = (await admin('GET', '/api/users?role=teacher')).body.users;
  assert.ok(users.every((u) => Array.isArray(u.subjects) && typeof u.program_classes === 'number'));
});

test('each amount counts in the month it belongs to: a January fee paid in March updates January and the partner share', async () => {
  const admin = await login('admin', 'admin123');
  await pool.query(`UPDATE users SET super_admin = false WHERE username = 'admin'`);
  assert.strictEqual((await admin('GET', '/api/dashboard/year')).status, 403);
  await pool.query(`UPDATE users SET super_admin = true WHERE username = 'admin'`);
  try {
    const st = (await admin('POST', '/api/students', { full_name: 'Late Kid', level: '7', monthly_fee: 100, start_date: '2026-01-01' })).body.student;
    const before = (await admin('GET', '/api/dashboard/year?mode=calendar&year=2026')).body.months.find((m) => m.month === '2026-01');
    await admin('POST', `/api/students/${st.id}/payments`, { month: '2026-01', amount: 100, paid_on: '2026-03-12' });
    const y = (await admin('GET', '/api/dashboard/year?mode=calendar&year=2026')).body;
    const jan = y.months.find((m) => m.month === '2026-01');
    assert.strictEqual(jan.income.support, round(before.income.support + 100));
    assert.strictEqual(jan.late_collected, round(before.late_collected + 100));
    assert.strictEqual(y.months.length, 12);
    // نصيب الشريك يتحدّث، والتسبقة تنقص من الباقي
    const p0 = (await admin('GET', '/api/partners')).body.summary[0];
    assert.strictEqual((await admin('POST', '/api/partners/payments', { partner: p0.name, amount: 50, paid_on: new Date().toISOString().slice(0, 10) })).status, 201);
    const p1 = (await admin('GET', '/api/partners')).body.summary[0];
    assert.strictEqual(p1.balance, round(p0.balance - 50));
    // لا تسكير: يمكن دائمًا تسجيل دفعة عن شهر قديم
    assert.strictEqual((await admin('POST', `/api/students/${st.id}/payments`, { month: '2026-02', amount: 50, paid_on: '2026-03-20' })).status, 201);
  } finally {
    await pool.query(`UPDATE users SET super_admin = true WHERE username = 'admin'`);
  }
});
const round = (n) => Math.round(n * 1000) / 1000;
function currentMonthForTest() {
  return new Date().toISOString().slice(0, 7);
}

test('multi-month payment: one receipt number for all months, visible to the parent', async () => {
  const admin = await login('admin', 'admin123');
  const par = (await admin('POST', '/api/users', { role: 'parent', username: 'mm-parent', full_name: 'ولي', password: 'secret1' })).body.user;
  const st = (await admin('POST', '/api/students', { full_name: 'تلميذ أشهر', level: '7', parent_id: par.id, monthly_fee: 100, start_date: '2026-09-01' })).body.student;
  const r = await admin('POST', '/api/pay-months', { kind: 'support', id: st.id, lines: [{ month: '2026-09', amount: 100 }, { month: '2026-10', amount: 100 }], method: 'cash' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.payment.total, 200);
  const rc = await admin('GET', `/api/receipts/support/${r.body.payment.id}`);
  assert.strictEqual(rc.body.receipt.lines.length, 2);
  assert.strictEqual(rc.body.receipt.total, 200);
  assert.ok(rc.body.receipt.lines.every((l) => l.amount === 100));
  const bad = await admin('POST', '/api/pay-months', { kind: 'support', id: st.id, lines: [] });
  assert.strictEqual(bad.status, 400);
  const parent = await login('mm-parent', 'secret1');
  const mine = await parent('GET', '/api/my-receipts');
  assert.strictEqual(mine.body.receipts.length, 1);
  assert.deepStrictEqual(mine.body.receipts[0].months, ['2026-09', '2026-10']);
  assert.strictEqual(mine.body.receipts[0].total, 200);
  assert.strictEqual((await parent('GET', `/api/receipts/support/${r.body.payment.id}`)).status, 200);
});

test('a payment can be edited after its receipt: same receipt number, new amount and month', async () => {
  const admin = await login('admin', 'admin123');
  const st = (await admin('POST', '/api/students', { full_name: 'تلميذ تعديل', level: '8', monthly_fee: 100, start_date: '2026-09-01' })).body.student;
  const pay = (await admin('POST', '/api/pay-months', { kind: 'support', id: st.id, lines: [{ month: '2026-09', amount: 80 }] })).body.payment;
  const r = await admin('PUT', `/api/payments/${pay.id}`, { month: '2026-10', amount: 100, paid_on: '2026-10-02', method: 'cash' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.payment.receipt_no, pay.receipt_no);
  const rc = (await admin('GET', `/api/receipts/support/${pay.id}`)).body.receipt;
  assert.deepStrictEqual([rc.amount, rc.month, rc.receipt_no, !!rc.edited_at], [100, '2026-10', pay.receipt_no, true]);
  assert.strictEqual((await admin('PUT', `/api/payments/${pay.id}`, { month: 'x', amount: 1 })).status, 400);
});

test('changing the monthly fee from a month keeps earlier months at the old fee', async () => {
  const admin = await login('admin', 'admin123');
  const st = (await admin('POST', '/api/students', { full_name: 'تلميذ باقة', level: '7', monthly_fee: 140, start_date: '2026-09-01' })).body.student;
  const put = (fee, from) => admin('PUT', `/api/students/${st.id}`, { full_name: 'تلميذ باقة', level: '7', monthly_fee: fee, start_date: '2026-09-01', status: 'studying', fee_from: from });
  const dues = async () => Object.fromEntries((await admin('GET', `/api/students/${st.id}`)).body.finance.months.map((m) => [m.month, m.due]));
  // باقة من أكتوبر: سبتمبر يبقى 140
  assert.strictEqual((await put(240, '2026-10')).status, 200);
  let d = await dues();
  assert.deepStrictEqual([d['2026-09'], d['2026-10']], [140, 240]);
  // تغيير ثانٍ من نوفمبر: سبتمبر 140، أكتوبر 240، نوفمبر 200
  await put(200, '2026-11');
  d = await dues();
  assert.deepStrictEqual([d['2026-09'], d['2026-10'], d['2026-11']], [140, 240, 200]);
  // تصحيح خطأ: المعلوم على كل الأشهر
  await put(180, 'all');
  d = await dues();
  assert.deepStrictEqual([d['2026-09'], d['2026-10'], d['2026-11']], [180, 180, 180]);
});

test('admin permissions: restricted admin, account guards, accounting and documents', async () => {
  const sup = await login('admin', 'admin123');
  const a = (await sup('POST', '/api/users', { role: 'admin', username: 'acc1', full_name: 'المحاسبة', password: 'secret1' })).body.user;
  assert.deepStrictEqual(a.perms.stats, false);
  const acc = await login('acc1', 'secret1');
  // افتراضيًا: لا إحصائيات، لا تعديل دفعات، لا محاسبة
  assert.strictEqual((await acc('GET', '/api/dashboard/year')).status, 403);
  assert.strictEqual((await acc('GET', '/api/accounting?month=2026-11')).status, 403);
  assert.strictEqual((await acc('PUT', '/api/payments/1', { month: '2026-11', amount: 1 })).status, 403);
  // لا يستطيع تعديل حساب المشرف العام ولا إنشاء إداري
  assert.strictEqual((await acc('PUT', '/api/users/1', { full_name: 'x', username: 'admin', password: 'hacked1' })).status, 403);
  assert.strictEqual((await acc('POST', '/api/users', { role: 'admin', username: 'x2', full_name: 'x', password: 'secret1' })).status, 403);
  assert.strictEqual((await acc('PUT', `/api/users/${a.id}/permissions`, { perms: { stats: true } })).status, 403);
  // المشرف العام يمنحه المحاسبة والإحصائيات
  assert.strictEqual((await sup('PUT', `/api/users/${a.id}/permissions`, { perms: { accounting: true, stats: true } })).status, 200);
  const me = (await acc('GET', '/api/me')).body.user;
  assert.deepStrictEqual([me.perms.accounting, me.perms.stats, me.perms.school], [true, true, false]);
  const board = await acc('GET', '/api/dashboard/year');
  assert.strictEqual(board.status, 200);
  assert.deepStrictEqual(board.body.totals.shares, {});
  // دفعة عبر بنك الشركة تظهر في المحاسبة، والنقدية لا
  const st = (await sup('POST', '/api/students', { full_name: 'بنك', level: '7', monthly_fee: 100, start_date: '2026-11-01' })).body.student;
  await sup('POST', '/api/pay-months', { kind: 'support', id: st.id, lines: [{ month: '2026-11', amount: 100 }], method: 'bank', paid_on: '2026-11-05' });
  await sup('POST', '/api/pay-months', { kind: 'support', id: st.id, lines: [{ month: '2026-12', amount: 50 }], method: 'cash', paid_on: '2026-11-06' });
  const book = (await acc('GET', '/api/accounting?month=2026-11')).body;
  assert.strictEqual(book.bank_total, 100);
  assert.strictEqual(book.bank.length, 1);
  assert.strictEqual(book.by_method.cash >= 50, true);
  const exp = await acc('POST', '/api/accounting/expenses', { category: 'tax_office', amount: 120, date: '2026-11-10' });
  assert.strictEqual(exp.status, 201);
  assert.strictEqual((await acc('POST', '/api/accounting/expenses', { category: 'acc_other', amount: 5 })).status, 400);
  const doc = await acc('POST', '/api/documents', { folder: 'month', month: '2026-11', ledger_id: exp.body.id, filename: 'وصل.pdf', data: 'data:application/pdf;base64,JVBERi0xLjQ=' });
  assert.strictEqual(doc.status, 201);
  const book2 = (await acc('GET', '/api/accounting?month=2026-11')).body;
  assert.strictEqual(book2.expenses.find((x) => x.id === exp.body.id).files, 1);
  const f = await handle(new Request(`http://localhost/api/documents/${doc.body.id}/file`, { headers: { cookie: (await call('POST', '/api/login', { username: 'acc1', password: 'secret1' })).headers.get('set-cookie').split(';')[0] } }));
  assert.strictEqual(f.headers.get('content-type'), 'application/pdf');
  // المعفى هذا الشهر
  assert.ok([200, 201].includes((await sup('PUT', '/api/fee-adjustments', { student_id: st.id, month: '2026-11', kind: 'exempt', reason: 'معفى' })).status));
});
