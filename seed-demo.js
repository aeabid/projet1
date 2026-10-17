// يضيف بيانات تجريبية: معلمون، أولياء، تلاميذ، غيابات وملاحظات
const { openDb, hashPassword } = require('./db');

const db = openDb();
if (db.prepare('SELECT COUNT(*) AS n FROM students').get().n > 0) {
  console.log('قاعدة البيانات تحتوي على تلاميذ مسبقًا، لم تتم إضافة بيانات تجريبية.');
  process.exit(0);
}

const subjectId = (name) => db.prepare('SELECT id FROM subjects WHERE name = ?').get(name).id;
const addUser = (username, fullName, role, phone) =>
  db
    .prepare('INSERT INTO users (username, password_hash, full_name, role, phone) VALUES (?, ?, ?, ?, ?)')
    .run(username, hashPassword('123456'), fullName, role, phone).lastInsertRowid;

const math = addUser('prof.math', 'أ. سامي الرياحي', 'teacher', '20 111 222');
const fr = addUser('prof.fr', 'أ. ليلى بن صالح', 'teacher', '22 333 444');
db.prepare('INSERT INTO teacher_subjects VALUES (?, ?)').run(math, subjectId('الرياضيات'));
db.prepare('INSERT INTO teacher_subjects VALUES (?, ?)').run(math, subjectId('العلوم الفيزيائية'));
db.prepare('INSERT INTO teacher_subjects VALUES (?, ?)').run(fr, subjectId('الفرنسية'));

const p1 = addUser('wali.trabelsi', 'محمد الطرابلسي', 'parent', '98 765 432');
const p2 = addUser('wali.gharbi', 'فاطمة الغربي', 'parent', '55 123 456');

const addStudent = (name, level, group, parent) =>
  db
    .prepare('INSERT INTO students (full_name, level, group_name, parent_id) VALUES (?, ?, ?, ?)')
    .run(name, level, group, parent).lastInsertRowid;

const s1 = addStudent('يوسف الطرابلسي', '9', 'أ', p1);
const s2 = addStudent('مريم الطرابلسي', '6-distance', null, p1);
const s3 = addStudent('آدم الغربي', '7', 'ب', p2);

const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get().id;
const note = db.prepare(
  'INSERT INTO notes (student_id, author_id, subject_id, category, rating, content, date) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
note.run(s1, math, subjectId('الرياضيات'), 'level', 'good', 'تحسن واضح في الهندسة، يحتاج مزيدًا من التمارين في المعادلات.', '2026-10-10');
note.run(s1, math, subjectId('الرياضيات'), 'behavior', 'excellent', 'منضبط ومشارك في القسم.', '2026-10-03');
note.run(s1, fr, subjectId('الفرنسية'), 'level', 'average', 'Doit lire davantage pour enrichir son vocabulaire.', '2026-10-08');
note.run(s1, admin, null, 'general', null, 'نذكّر بضرورة إحضار كراس التمارين في كل حصة.', '2026-10-12');
note.run(s2, fr, subjectId('الفرنسية'), 'level', 'excellent', 'Très bon travail à distance, toujours connectée à l\'heure.', '2026-10-09');
note.run(s3, math, subjectId('الرياضيات'), 'behavior', 'weak', 'كثير التشويش أثناء الحصة.', '2026-10-11');

const absence = db.prepare(
  'INSERT INTO absences (student_id, date, subject_id, justified, reason, recorded_by) VALUES (?, ?, ?, ?, ?, ?)'
);
absence.run(s1, '2026-10-06', subjectId('الفرنسية'), 1, 'شهادة طبية', fr);
absence.run(s3, '2026-10-07', subjectId('الرياضيات'), 0, null, math);
absence.run(s3, '2026-10-14', subjectId('الرياضيات'), 0, null, math);

console.log('تمت إضافة البيانات التجريبية. كلمة السر لكل الحسابات التجريبية: 123456');
console.log('معلمون: prof.math, prof.fr — أولياء: wali.trabelsi, wali.gharbi');
