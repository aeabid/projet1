const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const {
  openDb,
  hashPassword,
  verifyPassword,
  LEVELS,
  LEVEL_CODES,
  ROLES,
  NOTE_CATEGORIES,
  NOTE_RATINGS,
} = require('./db');

const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value, { required = false, max = 2000, name = 'الحقل' } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (required && !v) throw new HttpError(400, `${name} إجباري`);
  if (v.length > max) throw new HttpError(400, `${name} طويل جدًا`);
  return v || null;
}

function date(value, name = 'التاريخ') {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${name} غير صالح`);
  }
  return value;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  const q = {
    userById: db.prepare('SELECT id, username, full_name, role, phone FROM users WHERE id = ?'),
    session: db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?'),
    student: db.prepare('SELECT * FROM students WHERE id = ?'),
    subject: db.prepare('SELECT * FROM subjects WHERE id = ?'),
    teacherSubjects: db.prepare(
      `SELECT s.id, s.name FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.teacher_id = ? ORDER BY s.name`
    ),
  };

  // ---------- المصادقة ----------
  app.use((req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const row = q.session.get(token, Date.now());
      if (row) {
        req.user = q.userById.get(row.user_id);
        req.sessionToken = token;
      }
    }
    next();
  });

  const auth = (...roles) => (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'يجب تسجيل الدخول'));
    if (roles.length && !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'ليس لديك صلاحية'));
    }
    next();
  };

  function setSessionCookie(res, token, maxAgeMs) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`
    );
  }

  function loadStudentFor(user, id) {
    const student = q.student.get(Number(id));
    if (!student) throw new HttpError(404, 'التلميذ غير موجود');
    if (user.role === 'parent' && student.parent_id !== user.id) {
      throw new HttpError(404, 'التلميذ غير موجود');
    }
    return student;
  }

  // يتحقق أن المادة موجودة وأن المعلم يدرّسها
  function checkSubjectFor(user, subjectId, { required }) {
    if (subjectId === undefined || subjectId === null || subjectId === '') {
      if (required) throw new HttpError(400, 'المادة إجبارية');
      return null;
    }
    const subject = q.subject.get(Number(subjectId));
    if (!subject) throw new HttpError(400, 'المادة غير موجودة');
    if (user.role === 'teacher' && !q.teacherSubjects.all(user.id).some((s) => s.id === subject.id)) {
      throw new HttpError(403, 'هذه المادة ليست من موادك');
    }
    return subject.id;
  }

  app.post('/api/login', (req, res) => {
    const username = text(req.body.username, { required: true, name: 'اسم المستخدم' });
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const row = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new HttpError(401, 'اسم المستخدم أو كلمة السر غير صحيحة');
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
      token,
      row.id,
      Date.now() + SESSION_TTL_MS
    );
    setSessionCookie(res, token, SESSION_TTL_MS);
    res.json({ user: q.userById.get(row.id) });
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    setSessionCookie(res, '', 0);
    res.json({ ok: true });
  });

  app.get('/api/me', auth(), (req, res) => {
    const user = { ...req.user };
    if (user.role === 'teacher') user.subjects = q.teacherSubjects.all(user.id);
    res.json({ user });
  });

  app.post('/api/me/password', auth(), (req, res) => {
    const { current, next: newPassword } = req.body;
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(current || ''), row.password_hash)) {
      throw new HttpError(400, 'كلمة السر الحالية غير صحيحة');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      throw new HttpError(400, 'كلمة السر الجديدة يجب أن تحتوي على 6 أحرف على الأقل');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.sessionToken);
    res.json({ ok: true });
  });

  app.get('/api/meta', auth(), (_req, res) => {
    res.json({
      levels: LEVELS,
      subjects: db.prepare('SELECT id, name FROM subjects ORDER BY name').all(),
    });
  });

  // ---------- المواد ----------
  app.post('/api/subjects', auth('admin'), (req, res) => {
    const name = text(req.body.name, { required: true, max: 100, name: 'اسم المادة' });
    if (db.prepare('SELECT 1 FROM subjects WHERE name = ?').get(name)) {
      throw new HttpError(409, 'المادة موجودة');
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO subjects (name) VALUES (?)').run(name);
    res.status(201).json({ subject: q.subject.get(lastInsertRowid) });
  });

  app.delete('/api/subjects/:id', auth('admin'), (req, res) => {
    const { changes } = db.prepare('DELETE FROM subjects WHERE id = ?').run(Number(req.params.id));
    if (!changes) throw new HttpError(404, 'المادة غير موجودة');
    res.json({ ok: true });
  });

  // ---------- المستخدمون (معلمون، أولياء، إدارة) ----------
  function userWithExtras(id) {
    const user = q.userById.get(id);
    if (!user) return null;
    if (user.role === 'teacher') user.subjects = q.teacherSubjects.all(id);
    if (user.role === 'parent') {
      user.children = db.prepare('SELECT id, full_name, level FROM students WHERE parent_id = ? ORDER BY full_name').all(id);
    }
    return user;
  }

  function setTeacherSubjects(userId, subjectIds) {
    if (!Array.isArray(subjectIds)) return;
    db.prepare('DELETE FROM teacher_subjects WHERE teacher_id = ?').run(userId);
    const insert = db.prepare('INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)');
    for (const sid of subjectIds) {
      if (q.subject.get(Number(sid))) insert.run(userId, Number(sid));
    }
  }

  app.get('/api/users', auth('admin'), (req, res) => {
    const role = ROLES.includes(req.query.role) ? req.query.role : null;
    const rows = role
      ? db.prepare('SELECT id FROM users WHERE role = ? ORDER BY full_name').all(role)
      : db.prepare('SELECT id FROM users ORDER BY role, full_name').all();
    res.json({ users: rows.map((r) => userWithExtras(r.id)) });
  });

  app.post('/api/users', auth('admin'), (req, res) => {
    const role = req.body.role;
    if (!ROLES.includes(role)) throw new HttpError(400, 'الدور غير صالح');
    const username = text(req.body.username, { required: true, max: 50, name: 'اسم المستخدم' });
    const fullName = text(req.body.full_name, { required: true, max: 120, name: 'الاسم' });
    const phone = text(req.body.phone, { max: 30, name: 'الهاتف' });
    const password = req.body.password;
    if (typeof password !== 'string' || password.length < 6) {
      throw new HttpError(400, 'كلمة السر يجب أن تحتوي على 6 أحرف على الأقل');
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw new HttpError(409, 'اسم المستخدم مستعمل');
    }
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (username, password_hash, full_name, role, phone) VALUES (?, ?, ?, ?, ?)')
      .run(username, hashPassword(password), fullName, role, phone);
    if (role === 'teacher') setTeacherSubjects(lastInsertRowid, req.body.subject_ids);
    res.status(201).json({ user: userWithExtras(lastInsertRowid) });
  });

  app.put('/api/users/:id', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    const user = q.userById.get(id);
    if (!user) throw new HttpError(404, 'المستخدم غير موجود');
    const fullName = text(req.body.full_name, { required: true, max: 120, name: 'الاسم' });
    const phone = text(req.body.phone, { max: 30, name: 'الهاتف' });
    const username = text(req.body.username, { required: true, max: 50, name: 'اسم المستخدم' });
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
    if (clash) throw new HttpError(409, 'اسم المستخدم مستعمل');
    db.prepare('UPDATE users SET full_name = ?, phone = ?, username = ? WHERE id = ?').run(fullName, phone, username, id);
    if (req.body.password) {
      if (typeof req.body.password !== 'string' || req.body.password.length < 6) {
        throw new HttpError(400, 'كلمة السر يجب أن تحتوي على 6 أحرف على الأقل');
      }
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (user.role === 'teacher') setTeacherSubjects(id, req.body.subject_ids);
    res.json({ user: userWithExtras(id) });
  });

  app.delete('/api/users/:id', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'لا يمكنك حذف حسابك');
    const { changes } = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (!changes) throw new HttpError(404, 'المستخدم غير موجود');
    res.json({ ok: true });
  });

  // ---------- التلاميذ ----------
  const STUDENT_LIST_SQL = `
    SELECT st.*, p.full_name AS parent_name, p.phone AS parent_phone,
      (SELECT COUNT(*) FROM absences a WHERE a.student_id = st.id) AS absence_count,
      (SELECT COUNT(*) FROM absences a WHERE a.student_id = st.id AND a.justified = 0) AS unjustified_count,
      (SELECT COUNT(*) FROM notes n WHERE n.student_id = st.id) AS note_count
    FROM students st LEFT JOIN users p ON p.id = st.parent_id`;

  app.get('/api/students', auth(), (req, res) => {
    const where = [];
    const params = [];
    if (req.user.role === 'parent') {
      where.push('st.parent_id = ?');
      params.push(req.user.id);
    }
    if (LEVEL_CODES.includes(req.query.level)) {
      where.push('st.level = ?');
      params.push(req.query.level);
    }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      where.push('st.full_name LIKE ?');
      params.push(`%${req.query.q.trim()}%`);
    }
    const sql = `${STUDENT_LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY st.level, st.full_name`;
    let students = db.prepare(sql).all(...params);
    if (req.user.role === 'parent') students = students.map(({ parent_phone, ...s }) => s);
    res.json({ students });
  });

  function readStudentBody(body) {
    const fullName = text(body.full_name, { required: true, max: 120, name: 'اسم التلميذ' });
    if (!LEVEL_CODES.includes(body.level)) throw new HttpError(400, 'المستوى غير صالح');
    const groupName = text(body.group_name, { max: 50, name: 'الفوج' });
    const birthDate = body.birth_date ? date(body.birth_date, 'تاريخ الولادة') : null;
    let parentId = null;
    if (body.parent_id) {
      const parent = q.userById.get(Number(body.parent_id));
      if (!parent || parent.role !== 'parent') throw new HttpError(400, 'الولي غير موجود');
      parentId = parent.id;
    }
    return [fullName, body.level, groupName, birthDate, parentId];
  }

  app.post('/api/students', auth('admin'), (req, res) => {
    const values = readStudentBody(req.body);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO students (full_name, level, group_name, birth_date, parent_id) VALUES (?, ?, ?, ?, ?)')
      .run(...values);
    res.status(201).json({ student: q.student.get(lastInsertRowid) });
  });

  app.put('/api/students/:id', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (!q.student.get(id)) throw new HttpError(404, 'التلميذ غير موجود');
    const values = readStudentBody(req.body);
    db.prepare(
      'UPDATE students SET full_name = ?, level = ?, group_name = ?, birth_date = ?, parent_id = ? WHERE id = ?'
    ).run(...values, id);
    res.json({ student: q.student.get(id) });
  });

  app.delete('/api/students/:id', auth('admin'), (req, res) => {
    const { changes } = db.prepare('DELETE FROM students WHERE id = ?').run(Number(req.params.id));
    if (!changes) throw new HttpError(404, 'التلميذ غير موجود');
    res.json({ ok: true });
  });

  // ملف التلميذ الكامل: الغيابات + ملاحظات المعلمين + ملاحظات الإدارة
  app.get('/api/students/:id', auth(), (req, res) => {
    const student = loadStudentFor(req.user, req.params.id);
    const parent = student.parent_id ? q.userById.get(student.parent_id) : null;
    const absences = db
      .prepare(
        `SELECT a.*, s.name AS subject_name, u.full_name AS recorded_by_name
         FROM absences a LEFT JOIN subjects s ON s.id = a.subject_id LEFT JOIN users u ON u.id = a.recorded_by
         WHERE a.student_id = ? ORDER BY a.date DESC, a.id DESC`
      )
      .all(student.id);
    const notes = db
      .prepare(
        `SELECT n.*, s.name AS subject_name, u.full_name AS author_name, u.role AS author_role
         FROM notes n LEFT JOIN subjects s ON s.id = n.subject_id LEFT JOIN users u ON u.id = n.author_id
         WHERE n.student_id = ? ORDER BY n.date DESC, n.id DESC`
      )
      .all(student.id);
    res.json({
      student: {
        ...student,
        parent_name: parent ? parent.full_name : null,
        parent_phone: parent && req.user.role !== 'parent' ? parent.phone : null,
      },
      absences,
      notes,
    });
  });

  // ---------- الغيابات ----------
  app.post('/api/students/:id/absences', auth('admin', 'teacher'), (req, res) => {
    const student = loadStudentFor(req.user, req.params.id);
    const subjectId = checkSubjectFor(req.user, req.body.subject_id, { required: req.user.role === 'teacher' });
    const absenceDate = date(req.body.date || today());
    const reason = text(req.body.reason, { max: 500, name: 'السبب' });
    const justified = req.user.role === 'admin' && req.body.justified ? 1 : 0;
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO absences (student_id, date, subject_id, justified, reason, recorded_by) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(student.id, absenceDate, subjectId, justified, reason, req.user.id);
    res.status(201).json({ absence: db.prepare('SELECT * FROM absences WHERE id = ?').get(lastInsertRowid) });
  });

  // تبرير الغياب من طرف الإدارة
  app.patch('/api/absences/:id', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    const absence = db.prepare('SELECT * FROM absences WHERE id = ?').get(id);
    if (!absence) throw new HttpError(404, 'الغياب غير موجود');
    const reason = req.body.reason !== undefined ? text(req.body.reason, { max: 500, name: 'السبب' }) : absence.reason;
    db.prepare('UPDATE absences SET justified = ?, reason = ? WHERE id = ?').run(req.body.justified ? 1 : 0, reason, id);
    res.json({ absence: db.prepare('SELECT * FROM absences WHERE id = ?').get(id) });
  });

  app.delete('/api/absences/:id', auth('admin', 'teacher'), (req, res) => {
    const absence = db.prepare('SELECT * FROM absences WHERE id = ?').get(Number(req.params.id));
    if (!absence) throw new HttpError(404, 'الغياب غير موجود');
    if (req.user.role !== 'admin' && absence.recorded_by !== req.user.id) {
      throw new HttpError(403, 'لا يمكنك حذف غياب سجّله شخص آخر');
    }
    db.prepare('DELETE FROM absences WHERE id = ?').run(absence.id);
    res.json({ ok: true });
  });

  // ---------- الملاحظات ----------
  app.post('/api/students/:id/notes', auth('admin', 'teacher'), (req, res) => {
    const student = loadStudentFor(req.user, req.params.id);
    // ملاحظات الإدارة دون مادة، ملاحظات المعلم مرتبطة بإحدى مواده
    const subjectId =
      req.user.role === 'teacher' ? checkSubjectFor(req.user, req.body.subject_id, { required: true }) : null;
    if (!NOTE_CATEGORIES.includes(req.body.category)) throw new HttpError(400, 'نوع الملاحظة غير صالح');
    const rating = req.body.rating ? req.body.rating : null;
    if (rating && !NOTE_RATINGS.includes(rating)) throw new HttpError(400, 'التقييم غير صالح');
    const content = text(req.body.content, { required: true, max: 2000, name: 'نص الملاحظة' });
    const noteDate = date(req.body.date || today());
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO notes (student_id, author_id, subject_id, category, rating, content, date) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(student.id, req.user.id, subjectId, req.body.category, rating, content, noteDate);
    res.status(201).json({ note: db.prepare('SELECT * FROM notes WHERE id = ?').get(lastInsertRowid) });
  });

  app.delete('/api/notes/:id', auth('admin', 'teacher'), (req, res) => {
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(req.params.id));
    if (!note) throw new HttpError(404, 'الملاحظة غير موجودة');
    if (req.user.role !== 'admin' && note.author_id !== req.user.id) {
      throw new HttpError(403, 'لا يمكنك حذف ملاحظة كتبها شخص آخر');
    }
    db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
    res.json({ ok: true });
  });

  // ---------- لوحة الإدارة ----------
  app.get('/api/stats', auth('admin'), (_req, res) => {
    const count = (sql) => db.prepare(sql).get().n;
    res.json({
      students: count('SELECT COUNT(*) AS n FROM students'),
      teachers: count("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'"),
      parents: count("SELECT COUNT(*) AS n FROM users WHERE role = 'parent'"),
      absences_month: count("SELECT COUNT(*) AS n FROM absences WHERE date >= date('now', '-30 days')"),
      by_level: db.prepare('SELECT level, COUNT(*) AS n FROM students GROUP BY level').all(),
      recent_notes: db
        .prepare(
          `SELECT n.id, n.date, n.category, n.content, st.id AS student_id, st.full_name AS student_name,
             s.name AS subject_name, u.full_name AS author_name
           FROM notes n JOIN students st ON st.id = n.student_id
           LEFT JOIN subjects s ON s.id = n.subject_id LEFT JOIN users u ON u.id = n.author_id
           ORDER BY n.created_at DESC, n.id DESC LIMIT 8`
        )
        .all(),
    });
  });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'غير موجود')));

  app.use(express.static(path.join(__dirname, 'public')));

  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'خطأ في الخادم' : err.message });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp(openDb()).listen(port, () => {
    console.log(`التطبيق يعمل على http://localhost:${port}`);
  });
}

module.exports = { createApp };
