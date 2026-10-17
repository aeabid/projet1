// يضيف بيانات تجريبية عبر الـ API: node scripts/seed-demo.js <الرابط> <كلمة سر الإدارة>
const [base = 'http://localhost:3000', adminPassword = 'admin123'] = process.argv.slice(2);

let cookie = '';
async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${url}: ${data.error}`);
  return data;
}

await api('POST', '/api/login', { username: 'admin', password: adminPassword });
if ((await api('GET', '/api/students')).students.length) {
  console.log('يوجد تلاميذ مسبقًا، لم تتم إضافة بيانات تجريبية.');
  process.exit(0);
}
const { subjects } = await api('GET', '/api/meta');
const sub = (name) => subjects.find((s) => s.name === name).id;
const user = async (role, username, full_name, phone, subject_ids) =>
  (await api('POST', '/api/users', { role, username, full_name, phone, password: '123456', subject_ids })).user.id;

await user('teacher', 'prof.math', 'أ. سامي الرياحي', '20 111 222', [sub('الرياضيات'), sub('علوم الحياة والأرض')]);
await user('teacher', 'prof.fr', 'أ. ليلى بن صالح', '22 333 444', [sub('الفرنسية'), sub('الإنجليزية')]);
await user('teacher', 'prof.ar', 'أ. منير الحامدي', '23 555 666', [sub('العربية')]);
const p1 = await user('parent', 'wali.trabelsi', 'محمد الطرابلسي', '98 765 432');
const p2 = await user('parent', 'wali.gharbi', 'فاطمة الغربي', '55 123 456');

const student = async (full_name, level, group_name, parent_id) =>
  (await api('POST', '/api/students', { full_name, level, group_name, parent_id })).student.id;
const s1 = await student('يوسف الطرابلسي', '9', 'أ', p1);
const s2 = await student('مريم الطرابلسي', '6-distance', '', p1);
const s3 = await student('آدم الغربي', '7', 'ب', p2);
await student('سلمى بن علي', '5', 'أ', null);
await student('أيوب الشريف', '8', 'أ', null);

await api('POST', `/api/students/${s1}/notes`, { category: 'general', content: 'نذكّر بضرورة إحضار كراس التمارين في كل حصة.', date: '2026-10-12' });
await api('POST', '/api/logout');

await api('POST', '/api/login', { username: 'prof.math', password: '123456' });
await api('POST', `/api/students/${s1}/notes`, { subject_id: sub('الرياضيات'), category: 'level', rating: 'good', content: 'تحسن واضح في الهندسة، يحتاج مزيدًا من التمارين في المعادلات.', date: '2026-10-10' });
await api('POST', `/api/students/${s1}/notes`, { subject_id: sub('علوم الحياة والأرض'), category: 'behavior', rating: 'excellent', content: 'منضبط ومشارك في القسم.', date: '2026-10-03' });
await api('POST', `/api/students/${s3}/notes`, { subject_id: sub('الرياضيات'), category: 'behavior', rating: 'weak', content: 'كثير التشويش أثناء الحصة.', date: '2026-10-11' });
await api('POST', `/api/students/${s3}/absences`, { subject_id: sub('الرياضيات'), date: '2026-10-07' });
await api('POST', `/api/students/${s3}/absences`, { subject_id: sub('الرياضيات'), date: '2026-10-14' });
await api('POST', '/api/logout');

await api('POST', '/api/login', { username: 'prof.fr', password: '123456' });
await api('POST', `/api/students/${s1}/notes`, { subject_id: sub('الفرنسية'), category: 'level', rating: 'average', content: 'Doit lire davantage pour enrichir son vocabulaire.', date: '2026-10-08' });
await api('POST', `/api/students/${s2}/notes`, { subject_id: sub('الفرنسية'), category: 'level', rating: 'excellent', content: "Très bon travail à distance, toujours connectée à l'heure.", date: '2026-10-09' });
await api('POST', `/api/students/${s1}/absences`, { subject_id: sub('الإنجليزية'), date: '2026-10-06', reason: 'شهادة طبية' });

console.log('تمت إضافة البيانات التجريبية (كلمة السر 123456): prof.math, prof.fr, prof.ar, wali.trabelsi, wali.gharbi');
