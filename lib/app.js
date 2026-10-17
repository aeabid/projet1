// منطق التطبيق (واجهة REST) — يعمل محليًا وعلى Netlify Functions
// createHandler(pool) يرجع دالة: (Request) => Promise<Response>
import crypto from 'node:crypto';

export const LEVELS = [
  { code: '5', label: 'الخامسة أساسي' },
  { code: '6', label: 'السادسة أساسي' },
  { code: '6-distance', label: 'السادسة أساسي (عن بعد)' },
  { code: '7', label: 'السابعة أساسي' },
  { code: '8', label: 'الثامنة أساسي' },
  { code: '9', label: 'التاسعة أساسي' },
];
const LEVEL_CODES = LEVELS.map((l) => l.code);
const ROLES = ['admin', 'teacher', 'parent'];
const NOTE_CATEGORIES = ['behavior', 'level', 'general'];
const NOTE_RATINGS = ['excellent', 'good', 'average', 'weak'];

const SESSION_COOKIE = 'sid';
const SESSION_TTL_S = 30 * 24 * 60 * 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

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

function password(value) {
  if (typeof value !== 'string' || value.length < 6) {
    throw new HttpError(400, 'كلمة السر يجب أن تحتوي على 6 أحرف على الأقل');
  }
  return value;
}

function levelsList(value) {
  if (!Array.isArray(value) || value.length === 0) return null; // كل المستويات
  const levels = [...new Set(value.filter((v) => LEVEL_CODES.includes(v)))];
  return levels.length && levels.length < LEVEL_CODES.length ? levels : null;
}

const subjectFitsLevel = (subject, level) => !subject.levels || subject.levels.includes(level);

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

export function createHandler(pool, { adminPassword = process.env.ADMIN_PASSWORD } = {}) {
  const all = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;

  // أول حساب للإدارة يُنشأ من المتغير ADMIN_PASSWORD
  let bootstrapped = null;
  const bootstrap = () =>
    (bootstrapped ??= (async () => {
      if (!adminPassword) return;
      await pool.query(
        `INSERT INTO users (username, password_hash, full_name, role)
         SELECT 'admin', $1, 'الإدارة', 'admin'
         WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`,
        [hashPassword(adminPassword)]
      );
    })().catch((err) => {
      bootstrapped = null;
      throw err;
    }));

  const userById = (id) => one('SELECT id, username, full_name, role, phone FROM users WHERE id = $1', [id]);
  const teacherSubjects = (id) =>
    all(
      `SELECT s.id, s.name, s.levels FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.teacher_id = $1 ORDER BY s.id`,
      [id]
    );
  const getStudent = (id) =>
    one('SELECT id, full_name, level, group_name, birth_date::text, parent_id FROM students WHERE id = $1', [id]);

  async function loadStudentFor(user, id) {
    const student = Number.isInteger(Number(id)) ? await getStudent(Number(id)) : null;
    if (!student || (user.role === 'parent' && student.parent_id !== user.id)) {
      throw new HttpError(404, 'التلميذ غير موجود');
    }
    return student;
  }

  // المادة موجودة، تُدرّس في مستوى التلميذ، والمعلم يدرّسها
  async function checkSubjectFor(user, subjectId, student, { required }) {
    if (subjectId === undefined || subjectId === null || subjectId === '') {
      if (required) throw new HttpError(400, 'المادة إجبارية');
      return null;
    }
    const subject = await one('SELECT * FROM subjects WHERE id = $1', [Number(subjectId) || 0]);
    if (!subject) throw new HttpError(400, 'المادة غير موجودة');
    if (!subjectFitsLevel(subject, student.level)) throw new HttpError(400, 'هذه المادة لا تُدرّس في مستوى التلميذ');
    if (user.role === 'teacher' && !(await teacherSubjects(user.id)).some((s) => s.id === subject.id)) {
      throw new HttpError(403, 'هذه المادة ليست من موادك');
    }
    return subject.id;
  }

  async function userWithExtras(id) {
    const user = await userById(id);
    if (!user) return null;
    if (user.role === 'teacher') user.subjects = await teacherSubjects(id);
    if (user.role === 'parent') {
      user.children = await all('SELECT id, full_name, level FROM students WHERE parent_id = $1 ORDER BY full_name', [id]);
    }
    return user;
  }

  async function setTeacherSubjects(userId, subjectIds) {
    if (!Array.isArray(subjectIds)) return;
    await pool.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [userId]);
    const ids = subjectIds.map(Number).filter(Number.isInteger);
    await pool.query(
      `INSERT INTO teacher_subjects (teacher_id, subject_id)
       SELECT $1, id FROM subjects WHERE id = ANY($2::int[]) ON CONFLICT DO NOTHING`,
      [userId, ids]
    );
  }

  async function readStudentBody(body) {
    const fullName = text(body.full_name, { required: true, max: 120, name: 'اسم التلميذ' });
    if (!LEVEL_CODES.includes(body.level)) throw new HttpError(400, 'المستوى غير صالح');
    const groupName = text(body.group_name, { max: 50, name: 'الفوج' });
    const birthDate = body.birth_date ? date(body.birth_date, 'تاريخ الولادة') : null;
    let parentId = null;
    if (body.parent_id) {
      const parent = await userById(Number(body.parent_id) || 0);
      if (!parent || parent.role !== 'parent') throw new HttpError(400, 'الولي غير موجود');
      parentId = parent.id;
    }
    return [fullName, body.level, groupName, birthDate, parentId];
  }

  const routes = [];
  const route = (method, path, roles, handler) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '(\\d{1,9})')) + '$');
    routes.push({ method, re, keys, roles, handler });
  };
  const ANY = []; // أي مستخدم مسجّل

  // ---------- المصادقة ----------
  route('POST', '/api/login', null, async ({ body, setSession }) => {
    const username = text(body.username, { required: true, name: 'اسم المستخدم' });
    const row = await one('SELECT id, password_hash FROM users WHERE lower(username) = lower($1)', [username]);
    if (!row || !verifyPassword(String(body.password ?? ''), row.password_hash)) {
      throw new HttpError(401, 'اسم المستخدم أو كلمة السر غير صحيحة');
    }
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
    await pool.query(
      `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
      [token, row.id, SESSION_TTL_S]
    );
    setSession(token, SESSION_TTL_S);
    return { user: await userWithExtras(row.id) };
  });

  route('POST', '/api/logout', null, async ({ token, setSession }) => {
    if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    setSession('', 0);
    return { ok: true };
  });

  route('GET', '/api/me', ANY, async ({ user }) => ({ user: await userWithExtras(user.id) }));

  route('POST', '/api/me/password', ANY, async ({ user, body, token }) => {
    const row = await one('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!verifyPassword(String(body.current ?? ''), row.password_hash)) {
      throw new HttpError(400, 'كلمة السر الحالية غير صحيحة');
    }
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password(body.next)), user.id]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [user.id, token]);
    return { ok: true };
  });

  route('GET', '/api/meta', ANY, async () => ({
    levels: LEVELS,
    subjects: await all('SELECT id, name, levels FROM subjects ORDER BY id'),
  }));

  // ---------- المواد ----------
  route('POST', '/api/subjects', ['admin'], async ({ body }) => {
    const name = text(body.name, { required: true, max: 100, name: 'اسم المادة' });
    if (await one('SELECT 1 FROM subjects WHERE name = $1', [name])) throw new HttpError(409, 'المادة موجودة');
    const subject = await one('INSERT INTO subjects (name, levels) VALUES ($1, $2) RETURNING *', [name, levelsList(body.levels)]);
    return [201, { subject }];
  });

  route('PUT', '/api/subjects/:id', ['admin'], async ({ params, body }) => {
    const name = text(body.name, { required: true, max: 100, name: 'اسم المادة' });
    if (await one('SELECT 1 FROM subjects WHERE name = $1 AND id <> $2', [name, params.id])) {
      throw new HttpError(409, 'المادة موجودة');
    }
    const subject = await one('UPDATE subjects SET name = $1, levels = $2 WHERE id = $3 RETURNING *', [
      name,
      levelsList(body.levels),
      params.id,
    ]);
    if (!subject) throw new HttpError(404, 'المادة غير موجودة');
    return { subject };
  });

  route('DELETE', '/api/subjects/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM subjects WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'المادة غير موجودة');
    return { ok: true };
  });

  // ---------- المستخدمون ----------
  route('GET', '/api/users', ['admin'], async ({ query }) => {
    const role = ROLES.includes(query.get('role')) ? query.get('role') : null;
    const rows = await all(
      `SELECT id FROM users ${role ? 'WHERE role = $1' : ''} ORDER BY role, full_name`,
      role ? [role] : []
    );
    return { users: await Promise.all(rows.map((r) => userWithExtras(r.id))) };
  });

  route('POST', '/api/users', ['admin'], async ({ body }) => {
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'الدور غير صالح');
    const username = text(body.username, { required: true, max: 50, name: 'اسم المستخدم' });
    const fullName = text(body.full_name, { required: true, max: 120, name: 'الاسم' });
    const phone = text(body.phone, { max: 30, name: 'الهاتف' });
    const hash = hashPassword(password(body.password));
    if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) {
      throw new HttpError(409, 'اسم المستخدم مستعمل');
    }
    const { id } = await one(
      'INSERT INTO users (username, password_hash, full_name, role, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [username, hash, fullName, body.role, phone]
    );
    if (body.role === 'teacher') await setTeacherSubjects(id, body.subject_ids);
    return [201, { user: await userWithExtras(id) }];
  });

  route('PUT', '/api/users/:id', ['admin'], async ({ params, body }) => {
    const existing = await userById(params.id);
    if (!existing) throw new HttpError(404, 'المستخدم غير موجود');
    const fullName = text(body.full_name, { required: true, max: 120, name: 'الاسم' });
    const phone = text(body.phone, { max: 30, name: 'الهاتف' });
    const username = text(body.username, { required: true, max: 50, name: 'اسم المستخدم' });
    if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2', [username, params.id])) {
      throw new HttpError(409, 'اسم المستخدم مستعمل');
    }
    const newHash = body.password ? hashPassword(password(body.password)) : null;
    await pool.query('UPDATE users SET full_name = $1, phone = $2, username = $3 WHERE id = $4', [
      fullName,
      phone,
      username,
      params.id,
    ]);
    if (newHash) {
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, params.id]);
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [params.id]);
    }
    if (existing.role === 'teacher') await setTeacherSubjects(params.id, body.subject_ids);
    return { user: await userWithExtras(params.id) };
  });

  route('DELETE', '/api/users/:id', ['admin'], async ({ params, user }) => {
    if (params.id === user.id) throw new HttpError(400, 'لا يمكنك حذف حسابك');
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'المستخدم غير موجود');
    return { ok: true };
  });

  // ---------- التلاميذ ----------
  route('GET', '/api/students', ANY, async ({ user, query }) => {
    const where = [];
    const params = [];
    const add = (cond, value) => {
      params.push(value);
      where.push(cond.replace('?', `$${params.length}`));
    };
    if (user.role === 'parent') add('st.parent_id = ?', user.id);
    if (LEVEL_CODES.includes(query.get('level'))) add('st.level = ?', query.get('level'));
    if (query.get('q')?.trim()) add('st.full_name ILIKE ?', `%${query.get('q').trim()}%`);
    const students = await all(
      `SELECT st.id, st.full_name, st.level, st.group_name, st.birth_date::text, st.parent_id,
         p.full_name AS parent_name, ${user.role === 'parent' ? 'NULL' : 'p.phone'} AS parent_phone,
         (SELECT COUNT(*)::int FROM absences a WHERE a.student_id = st.id) AS absence_count,
         (SELECT COUNT(*)::int FROM absences a WHERE a.student_id = st.id AND NOT a.justified) AS unjustified_count,
         (SELECT COUNT(*)::int FROM notes n WHERE n.student_id = st.id) AS note_count
       FROM students st LEFT JOIN users p ON p.id = st.parent_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY st.level, st.full_name`,
      params
    );
    return { students };
  });

  route('POST', '/api/students', ['admin'], async ({ body }) => {
    const values = await readStudentBody(body);
    const { id } = await one(
      'INSERT INTO students (full_name, level, group_name, birth_date, parent_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      values
    );
    return [201, { student: await getStudent(id) }];
  });

  route('PUT', '/api/students/:id', ['admin'], async ({ params, body }) => {
    if (!(await getStudent(params.id))) throw new HttpError(404, 'التلميذ غير موجود');
    const values = await readStudentBody(body);
    await pool.query(
      'UPDATE students SET full_name = $1, level = $2, group_name = $3, birth_date = $4, parent_id = $5 WHERE id = $6',
      [...values, params.id]
    );
    return { student: await getStudent(params.id) };
  });

  route('DELETE', '/api/students/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM students WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'التلميذ غير موجود');
    return { ok: true };
  });

  // ملف التلميذ: الغيابات + ملاحظات المعلمين + ملاحظات الإدارة
  route('GET', '/api/students/:id', ANY, async ({ user, params }) => {
    const student = await loadStudentFor(user, params.id);
    const parent = student.parent_id ? await userById(student.parent_id) : null;
    const absences = await all(
      `SELECT a.id, a.date::text, a.subject_id, a.justified, a.reason, a.recorded_by,
         s.name AS subject_name, u.full_name AS recorded_by_name
       FROM absences a LEFT JOIN subjects s ON s.id = a.subject_id LEFT JOIN users u ON u.id = a.recorded_by
       WHERE a.student_id = $1 ORDER BY a.date DESC, a.id DESC`,
      [student.id]
    );
    const notes = await all(
      `SELECT n.id, n.date::text, n.subject_id, n.category, n.rating, n.content, n.author_id,
         s.name AS subject_name, u.full_name AS author_name, u.role AS author_role
       FROM notes n LEFT JOIN subjects s ON s.id = n.subject_id LEFT JOIN users u ON u.id = n.author_id
       WHERE n.student_id = $1 ORDER BY n.date DESC, n.id DESC`,
      [student.id]
    );
    return {
      student: {
        ...student,
        parent_name: parent?.full_name ?? null,
        parent_phone: parent && user.role !== 'parent' ? parent.phone : null,
      },
      absences,
      notes,
    };
  });

  // ---------- الغيابات ----------
  route('POST', '/api/students/:id/absences', ['admin', 'teacher'], async ({ user, params, body }) => {
    const student = await loadStudentFor(user, params.id);
    const subjectId = await checkSubjectFor(user, body.subject_id, student, { required: user.role === 'teacher' });
    const absence = await one(
      `INSERT INTO absences (student_id, date, subject_id, justified, reason, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        student.id,
        date(body.date || today()),
        subjectId,
        user.role === 'admin' && !!body.justified,
        text(body.reason, { max: 500, name: 'السبب' }),
        user.id,
      ]
    );
    return [201, { absence }];
  });

  route('PATCH', '/api/absences/:id', ['admin'], async ({ params, body }) => {
    const absence = await one(
      'UPDATE absences SET justified = $1, reason = COALESCE($2, reason) WHERE id = $3 RETURNING id, justified, reason',
      [!!body.justified, body.reason !== undefined ? text(body.reason, { max: 500, name: 'السبب' }) : null, params.id]
    );
    if (!absence) throw new HttpError(404, 'الغياب غير موجود');
    return { absence };
  });

  route('DELETE', '/api/absences/:id', ['admin', 'teacher'], async ({ user, params }) => {
    const absence = await one('SELECT recorded_by FROM absences WHERE id = $1', [params.id]);
    if (!absence) throw new HttpError(404, 'الغياب غير موجود');
    if (user.role !== 'admin' && absence.recorded_by !== user.id) {
      throw new HttpError(403, 'لا يمكنك حذف غياب سجّله شخص آخر');
    }
    await pool.query('DELETE FROM absences WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // ---------- الملاحظات ----------
  route('POST', '/api/students/:id/notes', ['admin', 'teacher'], async ({ user, params, body }) => {
    const student = await loadStudentFor(user, params.id);
    // ملاحظات الإدارة دون مادة، ملاحظات المعلم مرتبطة بإحدى مواده
    const subjectId =
      user.role === 'teacher' ? await checkSubjectFor(user, body.subject_id, student, { required: true }) : null;
    if (!NOTE_CATEGORIES.includes(body.category)) throw new HttpError(400, 'نوع الملاحظة غير صالح');
    const rating = body.rating || null;
    if (rating && !NOTE_RATINGS.includes(rating)) throw new HttpError(400, 'التقييم غير صالح');
    const note = await one(
      `INSERT INTO notes (student_id, author_id, subject_id, category, rating, content, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        student.id,
        user.id,
        subjectId,
        body.category,
        rating,
        text(body.content, { required: true, max: 2000, name: 'نص الملاحظة' }),
        date(body.date || today()),
      ]
    );
    return [201, { note }];
  });

  route('DELETE', '/api/notes/:id', ['admin', 'teacher'], async ({ user, params }) => {
    const note = await one('SELECT author_id FROM notes WHERE id = $1', [params.id]);
    if (!note) throw new HttpError(404, 'الملاحظة غير موجودة');
    if (user.role !== 'admin' && note.author_id !== user.id) {
      throw new HttpError(403, 'لا يمكنك حذف ملاحظة كتبها شخص آخر');
    }
    await pool.query('DELETE FROM notes WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // ---------- لوحة الإدارة ----------
  route('GET', '/api/stats', ['admin'], async () => {
    const counts = await one(`SELECT
      (SELECT COUNT(*)::int FROM students) AS students,
      (SELECT COUNT(*)::int FROM users WHERE role = 'teacher') AS teachers,
      (SELECT COUNT(*)::int FROM users WHERE role = 'parent') AS parents,
      (SELECT COUNT(*)::int FROM absences WHERE date >= current_date - 30) AS absences_month`);
    return {
      ...counts,
      by_level: await all('SELECT level, COUNT(*)::int AS n FROM students GROUP BY level'),
      recent_notes: await all(
        `SELECT n.id, n.date::text, n.category, n.content, st.id AS student_id, st.full_name AS student_name,
           s.name AS subject_name, u.full_name AS author_name
         FROM notes n JOIN students st ON st.id = n.student_id
         LEFT JOIN subjects s ON s.id = n.subject_id LEFT JOIN users u ON u.id = n.author_id
         ORDER BY n.created_at DESC, n.id DESC LIMIT 8`
      ),
    };
  });

  // ---------- التوجيه ----------
  return async function handle(request) {
    const url = new URL(request.url);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    const cookies = [];
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    const setSession = (token, maxAge) =>
      cookies.push(`${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);

    const respond = (status, data) => {
      const res = new Response(JSON.stringify(data), { status, headers });
      for (const c of cookies) res.headers.append('Set-Cookie', c);
      return res;
    };

    try {
      await bootstrap();
      const match = routes
        .filter((r) => r.re.test(url.pathname))
        .find((r) => r.method === request.method);
      if (!match) throw new HttpError(404, 'غير موجود');

      const token = parseCookies(request.headers.get('cookie') || '')[SESSION_COOKIE] || null;
      let user = null;
      if (token) {
        const row = await one('SELECT user_id FROM sessions WHERE token = $1 AND expires_at > now()', [token]);
        if (row) user = await userById(row.user_id);
      }
      if (match.roles) {
        if (!user) throw new HttpError(401, 'يجب تسجيل الدخول');
        if (match.roles.length && !match.roles.includes(user.role)) throw new HttpError(403, 'ليس لديك صلاحية');
      }

      let body = {};
      if (!['GET', 'HEAD'].includes(request.method)) {
        const raw = await request.text();
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            throw new HttpError(400, 'طلب غير صالح');
          }
          if (!body || typeof body !== 'object') body = {};
        }
      }

      const m = url.pathname.match(match.re);
      const params = Object.fromEntries(match.keys.map((k, i) => [k, Number(m[i + 1])]));
      const result = await match.handler({ user, params, query: url.searchParams, body, token, setSession });
      return Array.isArray(result) ? respond(result[0], result[1]) : respond(200, result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return respond(status, { error: status === 500 ? 'خطأ في الخادم' : err.message });
    }
  };
}
