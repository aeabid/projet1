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
const STATUSES = ['studying', 'waiting', 'left', 'stopped'];

const SESSION_COOKIE = 'sid';
const SESSION_TTL_S = 30 * 24 * 60 * 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

// نسخة غير متزامنة للاستيراد: تُحسب عدة كلمات سر بالتوازي
function hashPasswordAsync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(`${salt}:${key.toString('hex')}`)))
  );
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

// أول رقم هاتف، أرقام فقط، دون مفتاح تونس
function phoneKey(phone) {
  const first = String(phone ?? '').split(/[\/,;]|\s-\s|-(?=\d{6})/)[0];
  let digits = first.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('216')) digits = digits.slice(3);
  return digits.length >= 6 ? digits : null;
}

const normName = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim();

const subjectFitsLevel =(subject, level) => !subject.levels || subject.levels.includes(level);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PAYMENT_METHODS = ['cash', 'transfer', 'cheque', 'd17', 'other'];

const currentMonth = () => new Date().toISOString().slice(0, 7);

function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

// الأشهر المستحقة من أول شهر إلى الشهر الحالي (دون جويلية وأوت)
function billableMonths(start, end) {
  const months = [];
  for (let m = start; m <= end && months.length < 120; m = nextMonth(m)) {
    if (!m.endsWith('-07') && !m.endsWith('-08')) months.push(m);
  }
  return months;
}

const round3 = (n) => Math.round(n * 1000) / 1000;

function money(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(400, `${name} غير صالح`);
  return round3(n);
}

const daysInMonth = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

// الوضعية المالية: المستحق والمدفوع في كل شهر
// - الشهر الأول بالـ prorata حسب تاريخ بداية الدراسة، وكذلك شهر الخروج أو التوقف
// - لا مستحقات للتلميذ المجاني أو في الانتظار
// - المبالغ المحسوبة بالـ prorata تُدوَّر إلى أقرب دينار
function computeFinance(student, payments) {
  const fee = student.free ? 0 : student.monthly_fee ?? 0;
  const startDate = student.start_date || `${student.billing_start || student.created_month}-01`;
  const ended = ['left', 'stopped'].includes(student.status) && student.end_date;
  const endDate = ended ? student.end_date : today();
  const byMonth = new Map();
  if (fee > 0 && student.status !== 'waiting' && startDate <= endDate) {
    for (const m of billableMonths(startDate.slice(0, 7), endDate.slice(0, 7))) {
      const days = daysInMonth(m);
      const from = m === startDate.slice(0, 7) ? Number(startDate.slice(8, 10)) : 1;
      const to = ended && m === endDate.slice(0, 7) ? Number(endDate.slice(8, 10)) : days;
      const covered = to - from + 1;
      const due = covered >= days ? fee : Math.round((fee * covered) / days);
      byMonth.set(m, { month: m, due, prorata: covered < days ? `${covered}/${days}` : null, paid: 0, payments: [] });
    }
  }
  for (const p of payments) {
    if (!byMonth.has(p.month)) byMonth.set(p.month, { month: p.month, due: 0, prorata: null, paid: 0, payments: [] });
    const row = byMonth.get(p.month);
    row.paid = round3(row.paid + p.amount);
    row.payments.push(p);
  }
  const months = [...byMonth.values()]
    .map((r) => ({ ...r, remaining: round3(Math.max(r.due - r.paid, 0)) }))
    .sort((a, b) => b.month.localeCompare(a.month));
  const totalDue = round3(months.reduce((t, r) => t + r.due, 0));
  const totalPaid = round3(months.reduce((t, r) => t + r.paid, 0));
  return {
    monthly_fee: student.monthly_fee,
    free: !!student.free,
    start_date: student.start_date,
    months,
    total_due: totalDue,
    total_paid: totalPaid,
    balance: round3(totalDue - totalPaid),
  };
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

  const userById = (id) =>
    one('SELECT id, username, full_name, role, phone, cin, email, address FROM users WHERE id = $1', [id]);
  const teacherSubjects = (id) =>
    all(
      `SELECT s.id, s.name, s.levels FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.teacher_id = $1 ORDER BY s.id`,
      [id]
    );
  const STUDENT_COLUMNS = `st.id, st.full_name, st.level, st.group_name, st.birth_date::text, st.parent_id, st.city,
    st.school, st.remarks, st.address, st.pack, st.monthly_fee::float8 AS monthly_fee, st.billing_start,
    (st.photo IS NOT NULL) AS has_photo, st.photo_version, to_char(st.created_at, 'YYYY-MM') AS created_month,
    st.status, st.start_date::text, st.end_date::text, st.free`;
  const getStudent = (id) => one(`SELECT ${STUDENT_COLUMNS} FROM students st WHERE st.id = $1`, [id]);

  // مواد التلميذ: كل مواد مستواه إذا كان pack، وإلا المواد المسجّل فيها
  const studentSubjects = (student) =>
    student.pack
      ? all('SELECT id, name, levels FROM subjects WHERE levels IS NULL OR $1 = ANY(levels) ORDER BY id', [student.level])
      : all(
          `SELECT s.id, s.name, s.levels FROM student_subjects ss JOIN subjects s ON s.id = ss.subject_id
           WHERE ss.student_id = $1 ORDER BY s.id`,
          [student.id]
        );

  async function setStudentSubjects(studentId, subjectIds) {
    if (!Array.isArray(subjectIds)) return;
    await pool.query('DELETE FROM student_subjects WHERE student_id = $1', [studentId]);
    await pool.query(
      `INSERT INTO student_subjects (student_id, subject_id)
       SELECT $1, id FROM subjects WHERE id = ANY($2::int[]) ON CONFLICT DO NOTHING`,
      [studentId, subjectIds.map(Number).filter(Number.isInteger)]
    );
  }

  const studentPayments = (ids) =>
    all(
      `SELECT p.id, p.student_id, p.month, p.amount::float8 AS amount, p.paid_on::text, p.method, p.note,
         u.full_name AS recorded_by_name
       FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
       WHERE p.student_id = ANY($1::int[]) ORDER BY p.paid_on DESC, p.id DESC`,
      [ids]
    );

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
    const enrolled = await studentSubjects(student);
    if (enrolled.length && !enrolled.some((s) => s.id === subject.id)) {
      throw new HttpError(400, 'التلميذ غير مسجّل في هذه المادة');
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

  async function readContact(body, userId = 0) {
    const cin = body.cin ? String(body.cin).replace(/\s/g, '') : null;
    if (cin && !/^[0-9A-Za-z]{6,12}$/.test(cin)) throw new HttpError(400, 'رقم بطاقة التعريف غير صالح');
    if (cin && (await one('SELECT 1 FROM users WHERE cin = $1 AND id <> $2', [cin, userId]))) {
      throw new HttpError(409, 'رقم بطاقة التعريف مسجّل مسبقًا');
    }
    const email = text(body.email, { max: 120, name: 'البريد الإلكتروني' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'البريد الإلكتروني غير صالح');
    return { cin, email, address: text(body.address, { max: 300, name: 'العنوان' }) };
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
    const city = text(body.city, { max: 120, name: 'المدينة' });
    const school = text(body.school, { max: 200, name: 'المؤسسة' });
    const remarks = text(body.remarks, { max: 500, name: 'الملاحظات' });
    const address = text(body.address, { max: 300, name: 'العنوان' });
    const fee = money(body.monthly_fee, 'المبلغ الشهري');
    const status = body.status || 'studying';
    if (!STATUSES.includes(status)) throw new HttpError(400, 'الحالة غير صالحة');
    const startDate = body.start_date ? date(body.start_date, 'تاريخ بداية الدراسة') : null;
    let endDate = null;
    if (status === 'left' || status === 'stopped') endDate = body.end_date ? date(body.end_date, 'تاريخ الخروج') : today();
    if (startDate && endDate && endDate < startDate) throw new HttpError(400, 'تاريخ الخروج قبل تاريخ البداية');
    return [fullName, body.level, groupName, birthDate, parentId, city, school, remarks, address, !!body.pack, fee,
      status, startDate, endDate, !!body.free];
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
    const row = await one(
      'SELECT id, password_hash FROM users WHERE lower(username) = lower($1) OR cin = $1 ORDER BY id LIMIT 1',
      [username]
    );
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
    const { cin, email, address } = await readContact(body);
    const hash = hashPassword(password(body.password));
    if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) {
      throw new HttpError(409, 'اسم المستخدم مستعمل');
    }
    const { id } = await one(
      `INSERT INTO users (username, password_hash, full_name, role, phone, cin, email, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [username, hash, fullName, body.role, phone, cin, email, address]
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
    const { cin, email, address } = await readContact(body, params.id);
    const newHash = body.password ? hashPassword(password(body.password)) : null;
    await pool.query(
      'UPDATE users SET full_name = $1, phone = $2, username = $3, cin = $4, email = $5, address = $6 WHERE id = $7',
      [fullName, phone, username, cin, email, address, params.id]
    );
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
    if (user.role === 'teacher') {
      // قائمة المعلم: التلاميذ الذين يدرسون في إحدى مواده (أو لم تُحدَّد موادهم بعد)
      params.push(user.id);
      const t = `$${params.length}`;
      where.push(`st.status = 'studying' AND (
        ((st.pack OR NOT EXISTS (SELECT 1 FROM student_subjects x WHERE x.student_id = st.id))
          AND EXISTS (SELECT 1 FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
                      WHERE ts.teacher_id = ${t} AND (s.levels IS NULL OR st.level = ANY(s.levels))))
        OR EXISTS (SELECT 1 FROM student_subjects x JOIN teacher_subjects ts ON ts.subject_id = x.subject_id
                   WHERE x.student_id = st.id AND ts.teacher_id = ${t}))`);
    }
    if (STATUSES.includes(query.get('status'))) add('st.status = ?', query.get('status'));
    if (LEVEL_CODES.includes(query.get('level'))) add('st.level = ?', query.get('level'));
    if (query.get('q')?.trim()) add('st.full_name ILIKE ?', `%${query.get('q').trim()}%`);
    const students = await all(
      `SELECT ${STUDENT_COLUMNS},
         p.full_name AS parent_name, ${user.role === 'parent' ? 'NULL' : 'p.phone'} AS parent_phone,
         (SELECT COUNT(*)::int FROM absences a WHERE a.student_id = st.id) AS absence_count,
         (SELECT COUNT(*)::int FROM absences a WHERE a.student_id = st.id AND NOT a.justified) AS unjustified_count,
         (SELECT COUNT(*)::int FROM notes n WHERE n.student_id = st.id) AS note_count
       FROM students st LEFT JOIN users p ON p.id = st.parent_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY st.level, st.full_name`,
      params
    );
    // المعلم لا يرى المعطيات المالية
    if (user.role === 'teacher') {
      for (const st of students) delete st.monthly_fee;
    } else if (students.length) {
      const payments = await studentPayments(students.map((st) => st.id));
      for (const st of students) {
        st.balance = computeFinance(st, payments.filter((p) => p.student_id === st.id)).balance;
      }
    }
    return { students };
  });

  route('POST', '/api/students', ['admin'], async ({ body }) => {
    const values = await readStudentBody(body);
    const { id } = await one(
      `INSERT INTO students (full_name, level, group_name, birth_date, parent_id, city, school, remarks,
         address, pack, monthly_fee, status, start_date, end_date, free)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      values
    );
    await setStudentSubjects(id, body.subject_ids);
    return [201, { student: await getStudent(id) }];
  });

  route('PUT', '/api/students/:id', ['admin'], async ({ params, body }) => {
    if (!(await getStudent(params.id))) throw new HttpError(404, 'التلميذ غير موجود');
    const values = await readStudentBody(body);
    await pool.query(
      `UPDATE students SET full_name = $1, level = $2, group_name = $3, birth_date = $4, parent_id = $5,
         city = $6, school = $7, remarks = $8, address = $9, pack = $10, monthly_fee = $11, status = $12,
         start_date = $13, end_date = $14, free = $15
       WHERE id = $16`,
      [...values, params.id]
    );
    await setStudentSubjects(params.id, body.subject_ids);
    return { student: await getStudent(params.id) };
  });

  route('DELETE', '/api/students/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM students WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'التلميذ غير موجود');
    return { ok: true };
  });

  // استيراد قائمة تلاميذ مع إنشاء حسابات الأولياء (اسم المستخدم = رقم الهاتف)
  route('POST', '/api/import/students', ['admin'], async ({ body }) => {
    if (!Array.isArray(body.rows) || !body.rows.length) throw new HttpError(400, 'القائمة فارغة');
    if (body.rows.length > 1000) throw new HttpError(400, 'القائمة طويلة جدًا');
    const rows = body.rows.map((r, i) => {
      const line = `السطر ${i + 1}: `;
      const fullName = text(r.full_name, { max: 120, name: line + 'اسم التلميذ' });
      if (!fullName) throw new HttpError(400, line + 'اسم التلميذ إجباري');
      if (!LEVEL_CODES.includes(r.level)) throw new HttpError(400, line + 'المستوى غير صالح');
      let parentName = text(r.parent_name, { max: 120, name: line + 'اسم الولي' });
      if (parentName && /^valid[ée]?$/i.test(parentName)) parentName = null;
      const phone = text(r.phone, { max: 60, name: line + 'الهاتف' });
      return {
        fullName,
        level: r.level,
        parentName,
        phone,
        phoneKey: phoneKey(phone),
        city: text(r.city, { max: 120, name: line + 'المدينة' }),
        school: text(r.school, { max: 200, name: line + 'المؤسسة' }),
        remarks: text(r.remarks, { max: 500, name: line + 'الملاحظات' }),
      };
    });

    // نفس الولي = نفس رقم الهاتف أو نفس الاسم
    const groupOf = new Map();
    const find = (k) => (groupOf.get(k) === k ? k : find(groupOf.get(k)));
    const union = (a, b) => groupOf.set(find(a), find(b));
    rows.forEach((r, i) => {
      groupOf.set(i, i);
      const keys = [r.phoneKey && 'p:' + r.phoneKey, r.parentName && 'n:' + normName(r.parentName)].filter(Boolean);
      for (const k of keys) {
        if (!groupOf.has(k)) groupOf.set(k, k);
        union(i, k);
      }
    });

    // الأولياء: إعادة استعمال حساب موجود (نفس الهاتف أو الاسم) أو إنشاء حساب جديد
    const groups = new Map();
    rows.forEach((r, i) => {
      if (!r.parentName && !r.phoneKey) return;
      const g = find(i);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const parents = (await client.query(`SELECT id, lower(username) AS u, lower(full_name) AS n FROM users WHERE role = 'parent'`)).rows;
      const taken = new Set((await client.query('SELECT lower(username) AS u FROM users')).rows.map((r) => r.u));
      const existingStudents = new Set(
        (await client.query('SELECT lower(full_name) AS n, level FROM students')).rows.map((r) => `${r.n}|${r.level}`)
      );

      const parentOf = new Map(); // row -> parent id أو كائن الولي الجديد
      const newParents = [];
      for (const members of groups.values()) {
        const name = members.find((m) => m.parentName)?.parentName ?? null;
        const phoneRow = members.find((m) => m.phoneKey);
        const existing = parents.find(
          (p) => (phoneRow && p.u === phoneRow.phoneKey) || (name && normName(p.n) === normName(name))
        );
        let parent = existing?.id;
        if (!parent) {
          let username = phoneRow?.phoneKey || `wali${crypto.randomInt(1000, 10000)}`;
          while (taken.has(username.toLowerCase())) username = `${phoneRow?.phoneKey || 'wali'}-${crypto.randomInt(10, 100)}`;
          taken.add(username.toLowerCase());
          parent = {
            full_name: name ?? `ولي ${members[0].fullName}`,
            username,
            password: String(crypto.randomInt(100000, 1000000)),
            phone: phoneRow?.phone ?? null,
            children: [],
          };
          newParents.push(parent);
        }
        for (const m of members) parentOf.set(m, parent);
      }

      const hashes = await Promise.all(newParents.map((p) => hashPasswordAsync(p.password)));
      if (newParents.length) {
        const inserted = await client.query(
          `INSERT INTO users (username, password_hash, full_name, role, phone)
           SELECT u, h, n, 'parent', ph FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS t(u, h, n, ph)
           RETURNING id, username`,
          [newParents.map((p) => p.username), hashes, newParents.map((p) => p.full_name), newParents.map((p) => p.phone)]
        );
        const idOf = new Map(inserted.rows.map((r) => [r.username, r.id]));
        for (const p of newParents) p.id = idOf.get(p.username);
      }

      const skipped = [];
      const toInsert = [];
      for (const r of rows) {
        const key = `${r.fullName.toLowerCase()}|${r.level}`;
        if (existingStudents.has(key)) {
          skipped.push(r.fullName);
          continue;
        }
        existingStudents.add(key);
        const parent = parentOf.get(r);
        if (parent && typeof parent === 'object') parent.children.push(r.fullName);
        toInsert.push({ ...r, parentId: typeof parent === 'object' ? parent.id : (parent ?? null) });
      }
      if (toInsert.length) {
        const col = (k) => toInsert.map((r) => r[k] ?? null);
        await client.query(
          `INSERT INTO students (full_name, level, parent_id, city, school, remarks)
           SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[])`,
          [col('fullName'), col('level'), col('parentId'), col('city'), col('school'), col('remarks')]
        );
      }
      await client.query('COMMIT');
      return [
        201,
        {
          created_students: toInsert.length,
          skipped,
          parents: newParents.map(({ id, ...p }) => p),
        },
      ];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ---------- التسجيل المباشر للأولياء (رابط عمومي) ----------
  route('GET', '/api/public/meta', null, async () => ({
    levels: LEVELS,
    subjects: await all('SELECT id, name, levels FROM subjects ORDER BY id'),
  }));

  route('POST', '/api/register', null, async ({ body, setSession }) => {
    if (body.website) throw new HttpError(400, 'طلب غير صالح'); // حقل مخفي ضد الروبوتات
    const parent = body.parent || {};
    const fullName = text(parent.full_name, { required: true, max: 120, name: 'اسم الولي' });
    const phone = text(parent.phone, { required: true, max: 30, name: 'الهاتف' });
    const username = phoneKey(phone);
    if (!username) throw new HttpError(400, 'رقم الهاتف غير صالح');
    const { cin, email, address } = await readContact(parent);
    if (!cin) throw new HttpError(400, 'رقم بطاقة التعريف إجباري');
    const hash = await hashPasswordAsync(password(parent.password));
    if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) {
      throw new HttpError(409, 'رقم الهاتف مسجّل مسبقًا، ادخل بحسابك أو اتصل بالإدارة');
    }
    const children = Array.isArray(body.children) ? body.children : [];
    if (!children.length) throw new HttpError(400, 'أضف ابنًا واحدًا على الأقل');
    if (children.length > 8) throw new HttpError(400, 'عدد الأبناء كبير جدًا');
    const kids = children.map((c, i) => {
      const line = `الابن ${i + 1}: `;
      const name = text(c.full_name, { required: true, max: 120, name: line + 'الاسم' });
      if (!LEVEL_CODES.includes(c.level)) throw new HttpError(400, line + 'المستوى غير صالح');
      return {
        name,
        level: c.level,
        birthDate: c.birth_date ? date(c.birth_date, line + 'تاريخ الولادة') : null,
        school: text(c.school, { max: 200, name: line + 'المؤسسة' }),
        pack: !!c.pack,
        subjectIds: c.pack || !Array.isArray(c.subject_ids) ? [] : c.subject_ids.map(Number).filter(Number.isInteger),
        remarks: text(c.remarks, { max: 500, name: line + 'ملاحظات' }),
      };
    });

    const client = await pool.connect();
    let parentId;
    try {
      await client.query('BEGIN');
      parentId = (
        await client.query(
          `INSERT INTO users (username, password_hash, full_name, role, phone, cin, email, address)
           VALUES ($1, $2, $3, 'parent', $4, $5, $6, $7) RETURNING id`,
          [username, hash, fullName, phone, cin, email, address]
        )
      ).rows[0].id;
      for (const k of kids) {
        const { id } = (
          await client.query(
            `INSERT INTO students (full_name, level, birth_date, school, address, pack, remarks, parent_id, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'waiting') RETURNING id`,
            [k.name, k.level, k.birthDate, k.school, address, k.pack, k.remarks, parentId]
          )
        ).rows[0];
        await client.query(
          `INSERT INTO student_subjects (student_id, subject_id) SELECT $1, id FROM subjects WHERE id = ANY($2::int[])`,
          [id, k.subjectIds]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
      [token, parentId, SESSION_TTL_S]
    );
    setSession(token, SESSION_TTL_S);
    return [201, { user: await userWithExtras(parentId) }];
  });

  // ---------- الحضور: المعلم يسجّل غيابات القسم دفعة واحدة ----------
  async function attendanceList(user, query) {
    const level = query.get('level');
    if (!LEVEL_CODES.includes(level)) throw new HttpError(400, 'المستوى غير صالح');
    const day = date(query.get('date') || today());
    const subjectId = Number(query.get('subject_id')) || 0;
    const subject = await one('SELECT * FROM subjects WHERE id = $1', [subjectId]);
    if (!subject) throw new HttpError(400, 'المادة غير موجودة');
    if (user.role === 'teacher' && !(await teacherSubjects(user.id)).some((s) => s.id === subject.id)) {
      throw new HttpError(403, 'هذه المادة ليست من موادك');
    }
    const students = await all(
      `SELECT ${STUDENT_COLUMNS},
         EXISTS (SELECT 1 FROM absences a WHERE a.student_id = st.id AND a.date = $3 AND a.subject_id = $2) AS absent
       FROM students st
       WHERE st.level = $1 AND st.status = 'studying'
         AND (EXISTS (SELECT 1 FROM student_subjects x WHERE x.student_id = st.id AND x.subject_id = $2)
              OR ((st.pack OR NOT EXISTS (SELECT 1 FROM student_subjects x WHERE x.student_id = st.id))
                  AND ($4::text[] IS NULL OR st.level = ANY($4::text[]))))
       ORDER BY st.full_name`,
      [level, subject.id, day, subject.levels]
    );
    for (const st of students) delete st.monthly_fee;
    return { day, subject, students };
  }

  route('GET', '/api/attendance', ['admin', 'teacher'], async ({ user, query }) => {
    const { day, subject, students } = await attendanceList(user, query);
    return { date: day, subject_id: subject.id, students };
  });

  route('POST', '/api/attendance', ['admin', 'teacher'], async ({ user, body }) => {
    const query = new URLSearchParams({ level: body.level ?? '', date: body.date ?? '', subject_id: body.subject_id ?? '' });
    const { day, subject, students } = await attendanceList(user, query);
    const absentIds = new Set((Array.isArray(body.absent_ids) ? body.absent_ids : []).map(Number));
    const ids = students.map((st) => st.id);
    await pool.query(
      `DELETE FROM absences WHERE date = $1 AND subject_id = $2 AND student_id = ANY($3::int[])
         AND NOT (student_id = ANY($4::int[]))`,
      [day, subject.id, ids, [...absentIds]]
    );
    const toAdd = students.filter((st) => absentIds.has(st.id) && !st.absent).map((st) => st.id);
    await pool.query(
      `INSERT INTO absences (student_id, date, subject_id, recorded_by)
       SELECT unnest($1::int[]), $2, $3, $4`,
      [toAdd, day, subject.id, user.id]
    );
    return { absent: absentIds.size, present: ids.length - [...absentIds].filter((id) => ids.includes(id)).length };
  });

  // ---------- المهام العامة للقسم ----------
  const TASK_SELECT = `SELECT t.id, t.level, t.subject_id, t.title, t.description, t.due_date::text, t.author_id,
      t.created_at, s.name AS subject_name, u.full_name AS author_name
    FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id LEFT JOIN users u ON u.id = t.author_id`;

  route('GET', '/api/tasks', ['admin', 'teacher'], async ({ user }) => ({
    tasks: await all(
      `${TASK_SELECT} ${user.role === 'teacher' ? 'WHERE t.author_id = $1' : ''}
       ORDER BY t.created_at DESC LIMIT 200`,
      user.role === 'teacher' ? [user.id] : []
    ),
  }));

  route('POST', '/api/tasks', ['admin', 'teacher'], async ({ user, body }) => {
    if (!LEVEL_CODES.includes(body.level)) throw new HttpError(400, 'المستوى غير صالح');
    const subject = await one('SELECT * FROM subjects WHERE id = $1', [Number(body.subject_id) || 0]);
    if (!subject) throw new HttpError(400, 'المادة غير موجودة');
    if (!subjectFitsLevel(subject, body.level)) throw new HttpError(400, 'هذه المادة لا تُدرّس في هذا المستوى');
    if (user.role === 'teacher' && !(await teacherSubjects(user.id)).some((s) => s.id === subject.id)) {
      throw new HttpError(403, 'هذه المادة ليست من موادك');
    }
    const task = await one(
      `INSERT INTO tasks (level, subject_id, title, description, due_date, author_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        body.level,
        subject.id,
        text(body.title, { required: true, max: 200, name: 'عنوان المهمة' }),
        text(body.description, { max: 3000, name: 'التفاصيل' }),
        body.due_date ? date(body.due_date, 'آخر أجل') : null,
        user.id,
      ]
    );
    return [201, { task }];
  });

  route('DELETE', '/api/tasks/:id', ['admin', 'teacher'], async ({ user, params }) => {
    const task = await one('SELECT author_id FROM tasks WHERE id = $1', [params.id]);
    if (!task) throw new HttpError(404, 'المهمة غير موجودة');
    if (user.role !== 'admin' && task.author_id !== user.id) throw new HttpError(403, 'لا يمكنك حذف مهمة شخص آخر');
    await pool.query('DELETE FROM tasks WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // ---------- جداول الأوقات ----------
  const SLOT_SELECT = `SELECT tt.id, tt.level, tt.group_name, tt.day, tt.start_time, tt.end_time, tt.subject_id,
      tt.teacher_id, tt.room, s.name AS subject_name, u.full_name AS teacher_name
    FROM timetable tt LEFT JOIN subjects s ON s.id = tt.subject_id LEFT JOIN users u ON u.id = tt.teacher_id`;
  const SLOT_ORDER = 'ORDER BY tt.day, tt.start_time, tt.level';
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  // حصص تلميذ: مستواه، فوجه (إن حُدّد في الحصة)، وموادّه (أو كل المواد إذا لم تُحدَّد)
  async function studentSlots(student, subjects) {
    return all(
      `${SLOT_SELECT} WHERE tt.level = $1 AND (tt.group_name IS NULL OR $2::text IS NULL OR lower(tt.group_name) = lower($2))
         AND ($3::int[] IS NULL OR tt.subject_id = ANY($3::int[])) ${SLOT_ORDER}`,
      [student.level, student.group_name, subjects.length ? subjects.map((x) => x.id) : null]
    );
  }

  async function readSlot(body, slotId = 0) {
    if (!LEVEL_CODES.includes(body.level)) throw new HttpError(400, 'المستوى غير صالح');
    const day = Number(body.day);
    if (!Number.isInteger(day) || day < 1 || day > 7) throw new HttpError(400, 'اليوم غير صالح');
    const start = String(body.start_time || '');
    const end = String(body.end_time || '');
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) throw new HttpError(400, 'التوقيت غير صالح');
    if (start >= end) throw new HttpError(400, 'وقت النهاية يجب أن يكون بعد وقت البداية');
    const subject = await one('SELECT * FROM subjects WHERE id = $1', [Number(body.subject_id) || 0]);
    if (!subject) throw new HttpError(400, 'المادة غير موجودة');
    if (!subjectFitsLevel(subject, body.level)) throw new HttpError(400, 'هذه المادة لا تُدرّس في هذا المستوى');
    let teacherId = null;
    if (body.teacher_id) {
      const teacher = await userById(Number(body.teacher_id) || 0);
      if (!teacher || teacher.role !== 'teacher') throw new HttpError(400, 'المعلم غير موجود');
      teacherId = teacher.id;
      // المعلم لا يمكن أن يكون في حصتين في نفس الوقت
      const clash = await one(
        `${SLOT_SELECT} WHERE tt.teacher_id = $1 AND tt.day = $2 AND tt.start_time < $4 AND $3 < tt.end_time AND tt.id <> $5`,
        [teacherId, day, start, end, slotId]
      );
      if (clash) {
        throw new HttpError(
          409,
          `${teacher.full_name} عنده حصة في نفس الوقت: ${clash.subject_name ?? ''} ${clash.start_time}–${clash.end_time}`
        );
      }
    }
    return [body.level, text(body.group_name, { max: 50, name: 'الفوج' }), day, start, end, subject.id, teacherId,
      text(body.room, { max: 100, name: 'القاعة' })];
  }

  route('GET', '/api/timetable', ['admin', 'teacher'], async ({ user, query }) => {
    const level = query.get('level');
    if (level && !LEVEL_CODES.includes(level)) throw new HttpError(400, 'المستوى غير صالح');
    // المعلم: جدوله الخاص، الإدارة: جدول مستوى أو الكل
    if (user.role === 'teacher') return { slots: await all(`${SLOT_SELECT} WHERE tt.teacher_id = $1 ${SLOT_ORDER}`, [user.id]) };
    return {
      slots: await all(`${SLOT_SELECT} ${level ? 'WHERE tt.level = $1' : ''} ${SLOT_ORDER}`, level ? [level] : []),
    };
  });

  // جدول أبناء الولي
  route('GET', '/api/timetable/children', ['parent'], async ({ user }) => {
    const kids = await all(`SELECT ${STUDENT_COLUMNS} FROM students st WHERE st.parent_id = $1 AND st.status <> 'left' ORDER BY st.full_name`, [user.id]);
    const children = [];
    for (const kid of kids) {
      children.push({ id: kid.id, full_name: kid.full_name, level: kid.level, slots: await studentSlots(kid, await studentSubjects(kid)) });
    }
    return { children };
  });

  route('POST', '/api/timetable', ['admin'], async ({ body }) => {
    const slot = await one(
      `INSERT INTO timetable (level, group_name, day, start_time, end_time, subject_id, teacher_id, room)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      await readSlot(body)
    );
    return [201, { slot }];
  });

  route('PUT', '/api/timetable/:id', ['admin'], async ({ params, body }) => {
    if (!(await one('SELECT 1 FROM timetable WHERE id = $1', [params.id]))) throw new HttpError(404, 'الحصة غير موجودة');
    await pool.query(
      `UPDATE timetable SET level = $1, group_name = $2, day = $3, start_time = $4, end_time = $5, subject_id = $6,
         teacher_id = $7, room = $8 WHERE id = $9`,
      [...(await readSlot(body, params.id)), params.id]
    );
    return { ok: true };
  });

  route('DELETE', '/api/timetable/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM timetable WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الحصة غير موجودة');
    return { ok: true };
  });

  // ---------- صورة التلميذ ----------
  route('PUT', '/api/students/:id/photo', ['admin'], async ({ params, body }) => {
    const photo = body.photo;
    if (photo !== null && !(typeof photo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo))) {
      throw new HttpError(400, 'الصورة غير صالحة');
    }
    if (photo && photo.length > 400_000) throw new HttpError(400, 'الصورة كبيرة جدًا');
    const row = await one(
      'UPDATE students SET photo = $1, photo_version = photo_version + 1 WHERE id = $2 RETURNING photo_version',
      [photo, params.id]
    );
    if (!row) throw new HttpError(404, 'التلميذ غير موجود');
    return { photo_version: row.photo_version };
  });

  route('GET', '/api/students/:id/photo', ANY, async ({ user, params }) => {
    await loadStudentFor(user, params.id);
    const row = await one('SELECT photo FROM students WHERE id = $1', [params.id]);
    const m = row?.photo?.match(/^data:(image\/\w+);base64,(.*)$/);
    if (!m) throw new HttpError(404, 'لا توجد صورة');
    return new Response(Buffer.from(m[2], 'base64'), {
      headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=31536000' },
    });
  });

  // ---------- الخلاص ----------
  route('POST', '/api/students/:id/payments', ['admin'], async ({ user, params, body }) => {
    const student = await loadStudentFor(user, params.id);
    const month = String(body.month || currentMonth());
    if (!MONTH_RE.test(month)) throw new HttpError(400, 'الشهر غير صالح');
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const method = body.method || null;
    if (method && !PAYMENT_METHODS.includes(method)) throw new HttpError(400, 'طريقة الدفع غير صالحة');
    const payment = await one(
      `INSERT INTO payments (student_id, month, amount, paid_on, method, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [student.id, month, amount, date(body.paid_on || today()), method, text(body.note, { max: 300, name: 'الملاحظة' }), user.id]
    );
    return [201, { payment }];
  });

  route('DELETE', '/api/payments/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM payments WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الدفعة غير موجودة');
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
    const finance = user.role === 'teacher' ? null : computeFinance(student, await studentPayments([student.id]));
    const subjects = await studentSubjects(student);
    // مهام القسم: مستوى التلميذ وموادّه (أو كل المواد إذا لم تُحدَّد)
    const tasks = await all(
      `${TASK_SELECT} WHERE t.level = $1 AND ($2::int[] IS NULL OR t.subject_id = ANY($2::int[]))
       ORDER BY COALESCE(t.due_date, t.created_at::date) DESC LIMIT 50`,
      [student.level, subjects.length ? subjects.map((x) => x.id) : null]
    );
    if (user.role === 'teacher') delete student.monthly_fee;
    return {
      student: {
        ...student,
        subjects,
        parent_name: parent?.full_name ?? null,
        parent_phone: parent && user.role !== 'parent' ? parent.phone : null,
      },
      absences,
      notes,
      finance,
      tasks,
      timetable: await studentSlots(student, subjects),
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
      (SELECT COUNT(*)::int FROM absences WHERE date >= current_date - 30) AS absences_month,
      (SELECT COUNT(*)::int FROM students WHERE status = 'waiting') AS waiting`);
    const students = await all(`SELECT ${STUDENT_COLUMNS} FROM students st`);
    const payments = students.length ? await studentPayments(students.map((st) => st.id)) : [];
    const month = currentMonth();
    const unpaid = students
      .map((st) => ({
        id: st.id,
        full_name: st.full_name,
        level: st.level,
        balance: computeFinance(st, payments.filter((p) => p.student_id === st.id)).balance,
      }))
      .filter((st) => st.balance > 0)
      .sort((a, b) => b.balance - a.balance);
    return {
      ...counts,
      finance: {
        month,
        expected: round3(
          students.reduce(
            (t, st) =>
              t + (computeFinance(st, []).months.find((m) => m.month === month)?.due ?? 0),
            0
          )
        ),
        collected: round3(payments.filter((p) => p.month === month).reduce((t, p) => t + p.amount, 0)),
        outstanding: round3(unpaid.reduce((t, st) => t + st.balance, 0)),
        unpaid: unpaid.slice(0, 15),
        unpaid_count: unpaid.length,
      },
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
      if (result instanceof Response) return result;
      return Array.isArray(result) ? respond(result[0], result[1]) : respond(200, result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return respond(status, { error: status === 500 ? 'خطأ في الخادم' : err.message });
    }
  };
}
