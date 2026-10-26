// منطق التطبيق (واجهة REST) — يعمل محليًا وعلى Netlify Functions
// createHandler(pool) يرجع دالة: (Request) => Promise<Response>
import crypto from 'node:crypto';
import { copyDatabase, countRows } from './db.js';

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

// الأنشطة وأصناف المداخيل والمصاريف
const ACTIVITIES = {
  support: 'دروس الدعم',
  program: 'البرنامج التربوي',
  courses: 'الدورات والأنشطة',
  general: 'مصاريف عامة',
};
const LEDGER_CATEGORIES = {
  expense: {
    salary: 'أجور',
    rent: 'كراء',
    utilities: 'ماء وكهرباء وإنترنت',
    supplies: 'لوازم ومعدات',
    food: 'أكل وتنقل',
    marketing: 'إشهار',
    tax: 'ضرائب ومعاليم',
    other: 'مصاريف أخرى',
  },
  income: {
    registration: 'معاليم التسجيل',
    sales: 'مبيعات',
    grant: 'منح ومساعدات',
    other: 'مداخيل أخرى',
  },
};
// البرنامج التربوي: من سبتمبر إلى ماي
const PROGRAM_SKIP = ['06', '07', '08'];
const COURSE_KINDS = ['holiday', 'summer', 'other', 'activity', 'trip', 'camp'];
const COURSE_STATUSES = ['planned', 'done', 'cancelled'];

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
function billableMonths(start, end, skip = ['07', '08']) {
  const months = [];
  for (let m = start; m <= end && months.length < 120; m = nextMonth(m)) {
    if (!skip.includes(m.slice(5))) months.push(m);
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
function computeFinance(student, payments, { skip } = {}) {
  // المبلغ الشهري بعد التخفيض
  const fee = student.free ? 0 : Math.max((student.monthly_fee ?? 0) - (student.discount ?? 0), 0);
  const startDate = student.start_date || `${student.billing_start || student.created_month}-01`;
  const ended = ['left', 'stopped'].includes(student.status) && student.end_date;
  const endDate = ended ? student.end_date : today();
  const byMonth = new Map();
  if (fee > 0 && student.status !== 'waiting' && startDate <= endDate) {
    for (const m of billableMonths(startDate.slice(0, 7), endDate.slice(0, 7), skip)) {
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
    discount: student.discount ?? null,
    discount_reason: student.discount_reason ?? null,
    net_fee: fee,
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

export function createHandler(pool, { adminPassword = process.env.ADMIN_PASSWORD, engine = 'netlify', migrationSource = null } = {}) {
  const all = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;

  // أول حساب للإدارة يُنشأ من المتغير ADMIN_PASSWORD
  let bootstrapped = null;
  const bootstrap = () =>
    (bootstrapped ??= (async () => {
      // أول تشغيل على Supabase: نقل كل المعطيات تلقائيًا من قاعدة Netlify إن كانت Supabase فارغة
      if (migrationSource) {
        const empty = (await one('SELECT COUNT(*)::int AS n FROM users')).n === 0;
        const hasData = empty && (await migrationSource.query('SELECT COUNT(*)::int AS n FROM users').catch(() => null))?.rows[0].n > 0;
        if (hasData) {
          const copied = await copyDatabase(migrationSource, pool, { onlyIfEmpty: true });
          if (copied) console.log('auto-migrated to Supabase:', JSON.stringify(copied));
        }
      }
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
    one(
      `SELECT id, username, full_name, role, phone, cin, email, address, hourly_rate::float8 AS hourly_rate
       FROM users WHERE id = $1`,
      [id]
    );
  const teacherSubjects = (id) =>
    all(
      `SELECT s.id, s.name, s.levels FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.teacher_id = $1 ORDER BY s.id`,
      [id]
    );
  const STUDENT_COLUMNS = `st.id, st.full_name, st.level, st.group_name, st.birth_date::text, st.parent_id, st.city,
    st.school, st.remarks, st.address, st.pack, st.monthly_fee::float8 AS monthly_fee, st.billing_start,
    (st.photo IS NOT NULL) AS has_photo, st.photo_version, to_char(st.created_at, 'YYYY-MM') AS created_month,
    st.status, st.start_date::text, st.end_date::text, st.free, st.discount::float8 AS discount, st.discount_reason`;
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
      `SELECT p.id, p.student_id, p.month, p.amount::float8 AS amount, p.paid_on::text, p.method, p.note, p.receipt_no,
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
      status, startDate, endDate, !!body.free, money(body.discount, 'التخفيض'),
      text(body.discount_reason, { max: 200, name: 'سبب التخفيض' })];
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
    const rate = body.role === 'teacher' ? money(body.hourly_rate, 'معلوم الساعة') : null;
    const { id } = await one(
      `INSERT INTO users (username, password_hash, full_name, role, phone, cin, email, address, hourly_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [username, hash, fullName, body.role, phone, cin, email, address, rate]
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
    const rate = existing.role === 'teacher' ? money(body.hourly_rate, 'معلوم الساعة') : null;
    await pool.query(
      `UPDATE users SET full_name = $1, phone = $2, username = $3, cin = $4, email = $5, address = $6, hourly_rate = $7
       WHERE id = $8`,
      [fullName, phone, username, cin, email, address, rate, params.id]
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
      for (const st of students) {
        delete st.monthly_fee;
        delete st.discount;
        delete st.discount_reason;
      }
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
         address, pack, monthly_fee, status, start_date, end_date, free, discount, discount_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
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
         start_date = $13, end_date = $14, free = $15, discount = $16, discount_reason = $17
       WHERE id = $18`,
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
      tt.teacher_id, tt.room, tt.valid_from::text, tt.valid_to::text, s.name AS subject_name, u.full_name AS teacher_name
    FROM timetable tt LEFT JOIN subjects s ON s.id = tt.subject_id LEFT JOIN users u ON u.id = tt.teacher_id`;
  // الحصص الحالية فقط (الحصص المنتهية تبقى لحساب ساعات الأشهر الماضية)
  const ACTIVE = 'tt.valid_to IS NULL';
  const SLOT_ORDER = 'ORDER BY tt.day, tt.start_time, tt.level';
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  // حصص تلميذ: مستواه، فوجه (إن حُدّد في الحصة)، وموادّه (أو كل المواد إذا لم تُحدَّد)
  async function studentSlots(student, subjects) {
    return all(
      `${SLOT_SELECT} WHERE ${ACTIVE} AND tt.level = $1 AND (tt.group_name IS NULL OR $2::text IS NULL OR lower(tt.group_name) = lower($2))
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
        `${SLOT_SELECT} WHERE ${ACTIVE} AND tt.teacher_id = $1 AND tt.day = $2 AND tt.start_time < $4 AND $3 < tt.end_time
           AND tt.id <> $5`,
        [teacherId, day, start, end, slotId]
      );
      if (clash) {
        throw new HttpError(
          409,
          `${teacher.full_name} عنده حصة في نفس الوقت: ${clash.subject_name ?? ''} ${clash.start_time}–${clash.end_time}`
        );
      }
    }
    const validFrom = body.valid_from ? date(body.valid_from, 'تاريخ بداية الحصة') : today();
    return [body.level, text(body.group_name, { max: 50, name: 'الفوج' }), day, start, end, subject.id, teacherId,
      text(body.room, { max: 100, name: 'القاعة' }), validFrom];
  }

  route('GET', '/api/timetable', ['admin', 'teacher'], async ({ user, query }) => {
    const level = query.get('level');
    if (level && !LEVEL_CODES.includes(level)) throw new HttpError(400, 'المستوى غير صالح');
    // المعلم: جدوله الخاص، الإدارة: جدول مستوى أو الكل
    if (user.role === 'teacher') {
      return { slots: await all(`${SLOT_SELECT} WHERE ${ACTIVE} AND tt.teacher_id = $1 ${SLOT_ORDER}`, [user.id]) };
    }
    return {
      slots: await all(`${SLOT_SELECT} WHERE ${ACTIVE} ${level ? 'AND tt.level = $1' : ''} ${SLOT_ORDER}`, level ? [level] : []),
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
      `INSERT INTO timetable (level, group_name, day, start_time, end_time, subject_id, teacher_id, room, valid_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      await readSlot(body)
    );
    return [201, { slot }];
  });

  // تعديل حصة بدأت قبل اليوم: تُغلق القديمة (تبقى للأشهر الماضية) وتُنشأ نسخة جديدة من اليوم
  route('PUT', '/api/timetable/:id', ['admin'], async ({ params, body }) => {
    const old = await one(`SELECT valid_from::text FROM timetable tt WHERE id = $1 AND ${ACTIVE}`, [params.id]);
    if (!old) throw new HttpError(404, 'الحصة غير موجودة');
    const values = await readSlot(body, params.id);
    if (old.valid_from < today()) {
      values[8] = values[8] > old.valid_from ? values[8] : today();
      await pool.query('UPDATE timetable SET valid_to = $1 WHERE id = $2', [values[8], params.id]);
      const slot = await one(
        `INSERT INTO timetable (level, group_name, day, start_time, end_time, subject_id, teacher_id, room, valid_from)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        values
      );
      return { slot };
    }
    await pool.query(
      `UPDATE timetable SET level = $1, group_name = $2, day = $3, start_time = $4, end_time = $5, subject_id = $6,
         teacher_id = $7, room = $8, valid_from = $9 WHERE id = $10`,
      [...values, params.id]
    );
    return { slot: { id: params.id } };
  });

  // حذف حصة: تتوقف من اليوم، وتبقى في حساب الساعات الماضية
  route('DELETE', '/api/timetable/:id', ['admin'], async ({ params }) => {
    const old = await one(`SELECT valid_from::text FROM timetable tt WHERE id = $1 AND ${ACTIVE}`, [params.id]);
    if (!old) throw new HttpError(404, 'الحصة غير موجودة');
    if (old.valid_from < today()) await pool.query('UPDATE timetable SET valid_to = $1 WHERE id = $2', [today(), params.id]);
    else await pool.query('DELETE FROM timetable WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // ---------- ساعات المعلمين وخلاصهم ----------
  const hoursBetween = (start, end) => {
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    return round3((h2 * 60 + m2 - (h1 * 60 + m1)) / 60);
  };
  const isoDay = (d) => new Date(d + 'T00:00:00Z').getUTCDay() || 7;

  // الحصص يومًا بيوم من 1 إلى آخر الشهر حسب الجدول، مع تعديلات الإدارة
  async function teacherMonth(teacher, month) {
    const first = `${month}-01`;
    const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    const slots = await all(
      `${SLOT_SELECT} WHERE tt.teacher_id = $1 AND tt.valid_from <= $3 AND (tt.valid_to IS NULL OR tt.valid_to > $2)
       ORDER BY tt.start_time`,
      [teacher.id, first, last]
    );
    const adjustments = await all(
      `SELECT id, date::text, timetable_id, hours::float8 AS hours, note FROM teacher_hour_adjustments
       WHERE teacher_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date, id`,
      [teacher.id, first, last]
    );
    const payments = await all(
      `SELECT id, month, amount::float8 AS amount, kind, paid_on::text, method, note FROM teacher_payments
       WHERE teacher_id = $1 AND month = $2 ORDER BY paid_on, id`,
      [teacher.id, month]
    );
    const now = today();
    const sessions = [];
    for (let d = 1; d <= daysInMonth(month); d++) {
      const day = `${month}-${String(d).padStart(2, '0')}`;
      for (const slot of slots) {
        if (slot.day !== isoDay(day) || slot.valid_from > day || (slot.valid_to && slot.valid_to <= day)) continue;
        const scheduled = hoursBetween(slot.start_time, slot.end_time);
        const adj = adjustments.find((a) => a.timetable_id === slot.id && a.date === day);
        sessions.push({
          date: day,
          timetable_id: slot.id,
          start_time: slot.start_time,
          end_time: slot.end_time,
          level: slot.level,
          group_name: slot.group_name,
          subject_name: slot.subject_name,
          scheduled_hours: scheduled,
          hours: adj ? adj.hours : scheduled,
          status: adj ? (adj.hours === 0 ? 'absent' : 'adjusted') : day > now ? 'planned' : 'done',
          adjustment_id: adj?.id ?? null,
          note: adj?.note ?? null,
        });
      }
      for (const extra of adjustments.filter((a) => !a.timetable_id && a.date === day)) {
        sessions.push({
          date: day,
          timetable_id: null,
          hours: extra.hours,
          scheduled_hours: 0,
          status: 'extra',
          adjustment_id: extra.id,
          note: extra.note,
        });
      }
    }
    const rate = teacher.hourly_rate ?? 0;
    const worked = sessions.filter((x) => x.status !== 'planned');
    const hoursDone = round3(worked.reduce((t, x) => t + x.hours, 0));
    const hoursPlanned = round3(sessions.filter((x) => x.status === 'planned').reduce((t, x) => t + x.hours, 0));
    const due = round3(hoursDone * rate);
    const paid = round3(payments.reduce((t, p) => t + p.amount, 0));
    return {
      month,
      hourly_rate: teacher.hourly_rate,
      sessions,
      hours_done: hoursDone,
      hours_planned: hoursPlanned,
      due,
      expected: round3((hoursDone + hoursPlanned) * rate),
      payments,
      paid,
      remaining: round3(due - paid),
    };
  }

  // السنة الدراسية: من سبتمبر إلى أوت
  function schoolYearMonths(ref = currentMonth()) {
    const [y, m] = ref.split('-').map(Number);
    const startYear = m >= 9 ? y : y - 1;
    const months = [];
    for (let mm = `${startYear}-09`; mm <= ref; mm = nextMonth(mm)) months.push(mm);
    return months;
  }

  async function loadTeacher(user, id) {
    if (user.role === 'teacher' && user.id !== id) throw new HttpError(403, 'ليس لديك صلاحية');
    const teacher = await one(
      `SELECT id, full_name, phone, hourly_rate::float8 AS hourly_rate FROM users WHERE id = $1 AND role = 'teacher'`,
      [id]
    );
    if (!teacher) throw new HttpError(404, 'المعلم غير موجود');
    return teacher;
  }

  const monthParam = (value) => {
    const month = value || currentMonth();
    if (!MONTH_RE.test(month)) throw new HttpError(400, 'الشهر غير صالح');
    return month;
  };

  // كل المعلمين لشهر معيّن (الإدارة)
  route('GET', '/api/payroll', ['admin'], async ({ query }) => {
    const month = monthParam(query.get('month'));
    const teachers = await all(
      `SELECT id, full_name, phone, hourly_rate::float8 AS hourly_rate FROM users WHERE role = 'teacher' ORDER BY full_name`
    );
    const rows = [];
    for (const t of teachers) {
      const m = await teacherMonth(t, month);
      rows.push({
        id: t.id,
        full_name: t.full_name,
        phone: t.phone,
        hourly_rate: t.hourly_rate,
        sessions: m.sessions.filter((x) => x.status !== 'planned' && x.hours > 0).length,
        absences: m.sessions.filter((x) => x.status === 'absent').length,
        hours_done: m.hours_done,
        hours_planned: m.hours_planned,
        due: m.due,
        paid: m.paid,
        remaining: m.remaining,
      });
    }
    const sum = (k) => round3(rows.reduce((t, r) => t + r[k], 0));
    return { month, teachers: rows, totals: { hours_done: sum('hours_done'), due: sum('due'), paid: sum('paid'), remaining: sum('remaining') } };
  });

  // تفاصيل شهر لمعلم (الإدارة، أو المعلم نفسه)
  route('GET', '/api/payroll/:id', ['admin', 'teacher'], async ({ user, params, query }) => {
    const teacher = await loadTeacher(user, params.id);
    return { teacher, ...(await teacherMonth(teacher, monthParam(query.get('month')))) };
  });

  // ملخّص السنة الدراسية كاملة
  route('GET', '/api/payroll/:id/year', ['admin', 'teacher'], async ({ user, params }) => {
    const teacher = await loadTeacher(user, params.id);
    const months = [];
    for (const month of schoolYearMonths()) {
      const m = await teacherMonth(teacher, month);
      months.push({ month, hours_done: m.hours_done, hours_planned: m.hours_planned, due: m.due, paid: m.paid, remaining: m.remaining, payments: m.payments });
    }
    const sum = (k) => round3(months.reduce((t, r) => t + r[k], 0));
    return { teacher, months, totals: { hours_done: sum('hours_done'), due: sum('due'), paid: sum('paid'), remaining: sum('remaining') } };
  });

  // تعديل الساعات: غياب المعلم (0)، تعديل مدة حصة، أو حصة إضافية
  route('POST', '/api/payroll/:id/adjustments', ['admin'], async ({ user, params, body }) => {
    const teacher = await loadTeacher(user, params.id);
    const day = date(body.date, 'التاريخ');
    const hours = Number(String(body.hours ?? '').replace(',', '.'));
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw new HttpError(400, 'عدد الساعات غير صالح');
    const note = text(body.note, { max: 300, name: 'الملاحظة' });
    if (body.timetable_id) {
      const slot = await one('SELECT id FROM timetable WHERE id = $1 AND teacher_id = $2', [Number(body.timetable_id) || 0, teacher.id]);
      if (!slot) throw new HttpError(400, 'الحصة غير موجودة');
      const adj = await one(
        `INSERT INTO teacher_hour_adjustments (teacher_id, date, timetable_id, hours, note) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (teacher_id, date, timetable_id) WHERE timetable_id IS NOT NULL
         DO UPDATE SET hours = EXCLUDED.hours, note = EXCLUDED.note RETURNING id`,
        [teacher.id, day, slot.id, hours, note]
      );
      return [201, { adjustment: adj }];
    }
    if (!hours) throw new HttpError(400, 'عدد ساعات الحصة الإضافية إجباري');
    const adj = await one(
      'INSERT INTO teacher_hour_adjustments (teacher_id, date, hours, note) VALUES ($1, $2, $3, $4) RETURNING id',
      [teacher.id, day, hours, note]
    );
    return [201, { adjustment: adj }];
  });

  route('DELETE', '/api/payroll/adjustments/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM teacher_hour_adjustments WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'التعديل غير موجود');
    return { ok: true };
  });

  route('POST', '/api/payroll/:id/payments', ['admin'], async ({ user, params, body }) => {
    const teacher = await loadTeacher(user, params.id);
    const month = monthParam(body.month);
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const kind = body.kind === 'advance' ? 'advance' : 'full';
    const method = body.method || null;
    if (method && !PAYMENT_METHODS.includes(method)) throw new HttpError(400, 'طريقة الدفع غير صالحة');
    const payment = await one(
      `INSERT INTO teacher_payments (teacher_id, month, amount, kind, paid_on, method, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [teacher.id, month, amount, kind, date(body.paid_on || today()), method, text(body.note, { max: 300, name: 'الملاحظة' }), user.id]
    );
    return [201, { payment }];
  });

  route('DELETE', '/api/payroll/payments/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM teacher_payments WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الدفعة غير موجودة');
    return { ok: true };
  });

  // ---------- مجموعات واتساب ----------
  const WA_LINK_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}\/?(\?.*)?$/;

  // مجموعات تلميذ: مستواه، وفوجه إن حُدّد في المجموعة
  const studentWhatsappGroups = (student) =>
    all(
      `SELECT id, name, level, group_name, invite_link FROM whatsapp_groups
       WHERE level = $1 AND (group_name IS NULL OR $2::text IS NULL OR lower(group_name) = lower($2)) ORDER BY id`,
      [student.level, student.group_name]
    );

  function readWhatsappGroup(body) {
    const name = text(body.name, { required: true, max: 120, name: 'اسم المجموعة' });
    const level = body.level || null;
    if (level && !LEVEL_CODES.includes(level)) throw new HttpError(400, 'المستوى غير صالح');
    const link = text(body.invite_link, { required: true, max: 200, name: 'رابط المجموعة' });
    if (!WA_LINK_RE.test(link)) throw new HttpError(400, 'رابط المجموعة يجب أن يبدأ بـ https://chat.whatsapp.com/');
    return [name, level, level ? text(body.group_name, { max: 50, name: 'الفوج' }) : null, link];
  }

  route('GET', '/api/whatsapp-groups', ['admin'], async () => ({
    groups: await all('SELECT id, name, level, group_name, invite_link FROM whatsapp_groups ORDER BY level NULLS FIRST, group_name, id'),
  }));

  route('POST', '/api/whatsapp-groups', ['admin'], async ({ body }) => {
    const group = await one(
      'INSERT INTO whatsapp_groups (name, level, group_name, invite_link) VALUES ($1, $2, $3, $4) RETURNING id',
      readWhatsappGroup(body)
    );
    return [201, { group }];
  });

  route('PUT', '/api/whatsapp-groups/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      'UPDATE whatsapp_groups SET name = $1, level = $2, group_name = $3, invite_link = $4 WHERE id = $5',
      [...readWhatsappGroup(body), params.id]
    );
    if (!rowCount) throw new HttpError(404, 'المجموعة غير موجودة');
    return { ok: true };
  });

  route('DELETE', '/api/whatsapp-groups/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM whatsapp_groups WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'المجموعة غير موجودة');
    return { ok: true };
  });

  // ======================================================================
  // البرنامج التربوي
  // ======================================================================
  const CHILD_SELECT = `SELECT c.id, c.full_name, c.birth_date::text, c.class_id, c.guardian_name, c.guardian_phone,
      c.monthly_fee::float8 AS monthly_fee, c.start_date::text, c.status, c.end_date::text, c.free, c.notes,
      c.discount::float8 AS discount, c.discount_reason,
      to_char(c.created_at, 'YYYY-MM') AS created_month, k.name AS class_name
    FROM program_children c LEFT JOIN program_classes k ON k.id = c.class_id`;
  const programPayments = (ids) =>
    all(
      `SELECT id, child_id, month, amount::float8 AS amount, paid_on::text, method, note, receipt_no FROM program_payments
       WHERE child_id = ANY($1::int[]) ORDER BY paid_on DESC, id DESC`,
      [ids]
    );
  // الطفل كتلميذ للحساب: active = يدرس، left = خرج
  const childFinance = (c, payments) =>
    computeFinance({ ...c, status: c.status === 'left' ? 'left' : 'studying' }, payments, { skip: PROGRAM_SKIP });

  function readChild(body) {
    const fullName = text(body.full_name, { required: true, max: 120, name: 'اسم الطفل' });
    const status = body.status === 'left' ? 'left' : 'active';
    const startDate = body.start_date ? date(body.start_date, 'تاريخ البداية') : null;
    const endDate = status === 'left' ? (body.end_date ? date(body.end_date, 'تاريخ الخروج') : today()) : null;
    return [
      fullName,
      body.birth_date ? date(body.birth_date, 'تاريخ الولادة') : null,
      Number(body.class_id) || null,
      text(body.guardian_name, { max: 120, name: 'اسم الولي' }),
      text(body.guardian_phone, { max: 40, name: 'الهاتف' }),
      money(body.monthly_fee, 'المبلغ الشهري'),
      startDate,
      status,
      endDate,
      !!body.free,
      text(body.notes, { max: 500, name: 'ملاحظات' }),
      money(body.discount, 'التخفيض'),
      text(body.discount_reason, { max: 200, name: 'سبب التخفيض' }),
    ];
  }

  route('GET', '/api/program', ['admin'], async () => {
    const classes = await all(
      `SELECT k.id, k.name, k.age_range, k.notes, k.default_fee::float8 AS default_fee,
         (SELECT COUNT(*)::int FROM program_children c WHERE c.class_id = k.id AND c.status = 'active') AS children
       FROM program_classes k ORDER BY k.name`
    );
    const children = await all(`${CHILD_SELECT} ORDER BY c.status, k.name NULLS LAST, c.full_name`);
    const payments = children.length ? await programPayments(children.map((c) => c.id)) : [];
    for (const c of children) {
      const f = childFinance(c, payments.filter((p) => p.child_id === c.id));
      c.balance = f.balance;
    }
    return { classes, children };
  });

  route('POST', '/api/program/classes', ['admin'], async ({ body }) => {
    const row = await one(
      'INSERT INTO program_classes (name, age_range, notes, default_fee) VALUES ($1, $2, $3, $4) RETURNING id',
      [
        text(body.name, { required: true, max: 120, name: 'اسم القسم' }),
        text(body.age_range, { max: 60, name: 'الأعمار' }),
        text(body.notes, { max: 500, name: 'ملاحظات' }),
        money(body.default_fee, 'المعلوم الشهري'),
      ]
    );
    return [201, { class: row }];
  });

  route('PUT', '/api/program/classes/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      'UPDATE program_classes SET name = $1, age_range = $2, notes = $3, default_fee = $4 WHERE id = $5',
      [
        text(body.name, { required: true, max: 120, name: 'اسم القسم' }),
        text(body.age_range, { max: 60, name: 'الأعمار' }),
        text(body.notes, { max: 500, name: 'ملاحظات' }),
        money(body.default_fee, 'المعلوم الشهري'),
        params.id,
      ]
    );
    if (!rowCount) throw new HttpError(404, 'القسم غير موجود');
    return { ok: true };
  });

  route('DELETE', '/api/program/classes/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM program_classes WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'القسم غير موجود');
    return { ok: true };
  });

  route('POST', '/api/program/children', ['admin'], async ({ body }) => {
    const row = await one(
      `INSERT INTO program_children (full_name, birth_date, class_id, guardian_name, guardian_phone, monthly_fee,
         start_date, status, end_date, free, notes, discount, discount_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      readChild(body)
    );
    return [201, { child: row }];
  });

  route('PUT', '/api/program/children/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      `UPDATE program_children SET full_name = $1, birth_date = $2, class_id = $3, guardian_name = $4, guardian_phone = $5,
         monthly_fee = $6, start_date = $7, status = $8, end_date = $9, free = $10, notes = $11, discount = $12,
         discount_reason = $13 WHERE id = $14`,
      [...readChild(body), params.id]
    );
    if (!rowCount) throw new HttpError(404, 'الطفل غير موجود');
    return { ok: true };
  });

  route('DELETE', '/api/program/children/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM program_children WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الطفل غير موجود');
    return { ok: true };
  });

  route('GET', '/api/program/children/:id', ['admin'], async ({ params }) => {
    const child = await one(`${CHILD_SELECT} WHERE c.id = $1`, [params.id]);
    if (!child) throw new HttpError(404, 'الطفل غير موجود');
    return { child, finance: childFinance(child, await programPayments([child.id])) };
  });

  route('POST', '/api/program/children/:id/payments', ['admin'], async ({ user, params, body }) => {
    if (!(await one('SELECT 1 FROM program_children WHERE id = $1', [params.id]))) throw new HttpError(404, 'الطفل غير موجود');
    const month = String(body.month || currentMonth());
    if (!MONTH_RE.test(month)) throw new HttpError(400, 'الشهر غير صالح');
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const method = body.method || null;
    if (method && !PAYMENT_METHODS.includes(method)) throw new HttpError(400, 'طريقة الدفع غير صالحة');
    const payment = await one(
      `INSERT INTO program_payments (child_id, month, amount, paid_on, method, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, receipt_no`,
      [params.id, month, amount, date(body.paid_on || today()), method, text(body.note, { max: 300, name: 'الملاحظة' }), user.id]
    );
    return [201, { payment }];
  });

  route('DELETE', '/api/program/payments/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM program_payments WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الدفعة غير موجودة');
    return { ok: true };
  });

  // ======================================================================
  // الدورات
  // ======================================================================
  function readCourse(body) {
    const kind = COURSE_KINDS.includes(body.kind) ? body.kind : 'holiday';
    const start = body.start_date ? date(body.start_date, 'تاريخ البداية') : null;
    const end = body.end_date ? date(body.end_date, 'تاريخ النهاية') : null;
    if (start && end && end < start) throw new HttpError(400, 'تاريخ النهاية قبل البداية');
    return [
      text(body.name, { required: true, max: 150, name: 'الاسم' }),
      kind,
      start,
      end,
      money(body.price, 'معلوم المشاركة'),
      text(body.notes, { max: 1000, name: 'ملاحظات' }),
      text(body.place, { max: 200, name: 'المكان' }),
      Number(body.capacity) > 0 ? Math.floor(Number(body.capacity)) : null,
      COURSE_STATUSES.includes(body.status) ? body.status : 'planned',
    ];
  }

  const COURSE_STATS = `
    (SELECT COUNT(*)::int FROM course_participants p WHERE p.course_id = c.id) AS participants,
    (SELECT COALESCE(SUM(GREATEST(COALESCE(p.fee, c.price, 0) - COALESCE(p.discount, 0), 0)), 0)::float8
      FROM course_participants p WHERE p.course_id = c.id) AS expected,
    (SELECT COALESCE(SUM(cp.amount), 0)::float8 FROM course_payments cp JOIN course_participants p ON p.id = cp.participant_id
      WHERE p.course_id = c.id) AS received,
    (SELECT COALESCE(SUM(l.amount), 0)::float8 FROM ledger_entries l WHERE l.course_id = c.id AND l.direction = 'expense') AS expenses,
    (SELECT COALESCE(SUM(l.amount), 0)::float8 FROM ledger_entries l WHERE l.course_id = c.id AND l.direction = 'income') AS other_income`;
  const COURSE_SELECT = `SELECT c.id, c.name, c.kind, c.start_date::text, c.end_date::text, c.price::float8 AS price, c.notes,
      c.place, c.capacity, c.status,
      ${COURSE_STATS} FROM courses c`;
  const withNet = (c) => ({ ...c, net: round3(c.received + c.other_income - c.expenses) });

  route('GET', '/api/courses', ['admin'], async () => ({
    courses: (await all(`${COURSE_SELECT} ORDER BY c.start_date DESC NULLS LAST, c.id DESC`)).map(withNet),
  }));

  route('POST', '/api/courses', ['admin'], async ({ body }) => {
    const row = await one(
      `INSERT INTO courses (name, kind, start_date, end_date, price, notes, place, capacity, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      readCourse(body)
    );
    return [201, { course: row }];
  });

  route('PUT', '/api/courses/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      `UPDATE courses SET name = $1, kind = $2, start_date = $3, end_date = $4, price = $5, notes = $6, place = $7,
         capacity = $8, status = $9 WHERE id = $10`,
      [...readCourse(body), params.id]
    );
    if (!rowCount) throw new HttpError(404, 'الدورة غير موجودة');
    return { ok: true };
  });

  route('DELETE', '/api/courses/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM courses WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الدورة غير موجودة');
    return { ok: true };
  });

  route('GET', '/api/courses/:id', ['admin'], async ({ params }) => {
    const course = await one(`${COURSE_SELECT} WHERE c.id = $1`, [params.id]);
    if (!course) throw new HttpError(404, 'الدورة غير موجودة');
    const participants = await all(
      `SELECT p.id, p.full_name, p.phone, p.student_id, p.fee::float8 AS fee, p.notes, p.discount::float8 AS discount,
         GREATEST(COALESCE(p.fee, $2::numeric, 0) - COALESCE(p.discount, 0), 0)::float8 AS due,
         (SELECT COALESCE(SUM(amount), 0)::float8 FROM course_payments WHERE participant_id = p.id) AS paid
       FROM course_participants p WHERE p.course_id = $1 ORDER BY p.full_name`,
      [course.id, course.price]
    );
    const payments = await all(
      `SELECT cp.id, cp.participant_id, cp.amount::float8 AS amount, cp.paid_on::text, cp.method, cp.note, cp.receipt_no
       FROM course_payments cp JOIN course_participants p ON p.id = cp.participant_id WHERE p.course_id = $1
       ORDER BY cp.paid_on, cp.id`,
      [course.id]
    );
    for (const p of participants) {
      p.remaining = round3(Math.max(p.due - p.paid, 0));
      p.payments = payments.filter((x) => x.participant_id === p.id);
    }
    const entries = await all(
      `SELECT id, direction, category, amount::float8 AS amount, date::text, description FROM ledger_entries
       WHERE course_id = $1 ORDER BY date, id`,
      [course.id]
    );
    return { course: withNet(course), participants, entries };
  });

  function readParticipant(body) {
    return [
      text(body.full_name, { required: true, max: 120, name: 'الاسم' }),
      text(body.phone, { max: 40, name: 'الهاتف' }),
      Number(body.student_id) || null,
      money(body.fee, 'المعلوم'),
      text(body.notes, { max: 500, name: 'ملاحظات' }),
      money(body.discount, 'التخفيض'),
    ];
  }

  route('POST', '/api/courses/:id/participants', ['admin'], async ({ params, body }) => {
    if (!(await one('SELECT 1 FROM courses WHERE id = $1', [params.id]))) throw new HttpError(404, 'الدورة غير موجودة');
    const row = await one(
      `INSERT INTO course_participants (course_id, full_name, phone, student_id, fee, notes, discount)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [params.id, ...readParticipant(body)]
    );
    // دفعة عند التسجيل (اختياري)
    const paid = money(body.paid_now, 'المبلغ المدفوع');
    if (paid) {
      await pool.query('INSERT INTO course_payments (participant_id, amount, paid_on, method) VALUES ($1, $2, $3, $4)', [
        row.id,
        paid,
        today(),
        PAYMENT_METHODS.includes(body.method) ? body.method : 'cash',
      ]);
    }
    return [201, { participant: row }];
  });

  route('PUT', '/api/courses/participants/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      'UPDATE course_participants SET full_name = $1, phone = $2, student_id = $3, fee = $4, notes = $5, discount = $6 WHERE id = $7',
      [...readParticipant(body), params.id]
    );
    if (!rowCount) throw new HttpError(404, 'المشارك غير موجود');
    return { ok: true };
  });

  route('DELETE', '/api/courses/participants/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM course_participants WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'المشارك غير موجود');
    return { ok: true };
  });

  route('POST', '/api/courses/participants/:id/payments', ['admin'], async ({ user, params, body }) => {
    if (!(await one('SELECT 1 FROM course_participants WHERE id = $1', [params.id]))) throw new HttpError(404, 'المشارك غير موجود');
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const method = body.method || null;
    if (method && !PAYMENT_METHODS.includes(method)) throw new HttpError(400, 'طريقة الدفع غير صالحة');
    const payment = await one(
      `INSERT INTO course_payments (participant_id, amount, paid_on, method, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, receipt_no`,
      [params.id, amount, date(body.paid_on || today()), method, text(body.note, { max: 300, name: 'الملاحظة' }), user.id]
    );
    return [201, { payment }];
  });

  route('DELETE', '/api/courses/payments/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM course_payments WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الدفعة غير موجودة');
    return { ok: true };
  });

  // ======================================================================
  // الإطار والأجور
  // ======================================================================
  function readStaff(body) {
    if (!ACTIVITIES[body.activity]) throw new HttpError(400, 'النشاط غير صالح');
    return [
      text(body.full_name, { required: true, max: 120, name: 'الاسم' }),
      body.activity,
      text(body.role, { max: 120, name: 'الخطة' }),
      money(body.monthly_salary, 'الأجرة الشهرية'),
      text(body.phone, { max: 40, name: 'الهاتف' }),
      body.active === undefined ? true : !!body.active,
    ];
  }

  route('GET', '/api/staff', ['admin'], async () => ({
    staff: await all(
      `SELECT id, full_name, activity, role, monthly_salary::float8 AS monthly_salary, phone, active FROM staff
       ORDER BY active DESC, activity, full_name`
    ),
  }));

  route('POST', '/api/staff', ['admin'], async ({ body }) => {
    const row = await one(
      'INSERT INTO staff (full_name, activity, role, monthly_salary, phone, active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      readStaff(body)
    );
    return [201, { staff: row }];
  });

  route('PUT', '/api/staff/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      'UPDATE staff SET full_name = $1, activity = $2, role = $3, monthly_salary = $4, phone = $5, active = $6 WHERE id = $7',
      [...readStaff(body), params.id]
    );
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });

  route('DELETE', '/api/staff/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM staff WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });

  // تسجيل أجور شهر لكل الإطار النشط دفعة واحدة (لا تُسجّل أجرة مرتين لنفس الشهر)
  route('POST', '/api/staff/salaries', ['admin'], async ({ user, body }) => {
    const month = String(body.month || currentMonth());
    if (!MONTH_RE.test(month)) throw new HttpError(400, 'الشهر غير صالح');
    const paidOn = date(body.date || today());
    const { rowCount } = await pool.query(
      `INSERT INTO ledger_entries (direction, activity, category, amount, date, description, staff_id, salary_month, created_by)
       SELECT 'expense', s.activity, 'salary', s.monthly_salary, $2, 'أجرة ' || $1 || ' — ' || s.full_name, s.id, $1, $3
       FROM staff s WHERE s.active AND s.monthly_salary > 0
       ON CONFLICT (staff_id, salary_month) WHERE staff_id IS NOT NULL AND salary_month IS NOT NULL DO NOTHING`,
      [month, paidOn, user.id]
    );
    return [201, { created: rowCount }];
  });

  // ======================================================================
  // دفتر المداخيل والمصاريف
  // ======================================================================
  function readEntry(body) {
    const direction = body.direction === 'income' ? 'income' : 'expense';
    if (!ACTIVITIES[body.activity]) throw new HttpError(400, 'النشاط غير صالح');
    if (!LEDGER_CATEGORIES[direction][body.category]) throw new HttpError(400, 'الصنف غير صالح');
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    return [
      direction,
      body.activity,
      body.category,
      amount,
      date(body.date || today()),
      text(body.description, { max: 300, name: 'البيان' }),
      body.activity === 'courses' ? Number(body.course_id) || null : null,
    ];
  }

  route('GET', '/api/ledger', ['admin'], async ({ query }) => {
    const month = query.get('month') || currentMonth();
    if (!MONTH_RE.test(month)) throw new HttpError(400, 'الشهر غير صالح');
    const activity = ACTIVITIES[query.get('activity')] ? query.get('activity') : null;
    return {
      entries: await all(
        `SELECT l.id, l.direction, l.activity, l.category, l.amount::float8 AS amount, l.date::text, l.description,
           l.course_id, c.name AS course_name, l.staff_id
         FROM ledger_entries l LEFT JOIN courses c ON c.id = l.course_id
         WHERE to_char(l.date, 'YYYY-MM') = $1 AND ($2::text IS NULL OR l.activity = $2)
         ORDER BY l.date DESC, l.id DESC`,
        [month, activity]
      ),
    };
  });

  route('POST', '/api/ledger', ['admin'], async ({ user, body }) => {
    const row = await one(
      `INSERT INTO ledger_entries (direction, activity, category, amount, date, description, course_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [...readEntry(body), user.id]
    );
    return [201, { entry: row }];
  });

  route('PUT', '/api/ledger/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      `UPDATE ledger_entries SET direction = $1, activity = $2, category = $3, amount = $4, date = $5, description = $6,
         course_id = $7 WHERE id = $8`,
      [...readEntry(body), params.id]
    );
    if (!rowCount) throw new HttpError(404, 'العملية غير موجودة');
    return { ok: true };
  });

  route('DELETE', '/api/ledger/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM ledger_entries WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'العملية غير موجودة');
    return { ok: true };
  });

  // ======================================================================
  // المردودية المالية
  // ======================================================================
  const monthRange = (month) => [`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`];
  const sumSql = async (sql, params) => (await one(sql, params)).total;

  // المقبوض والمدفوع فعليًا خلال الشهر لكل نشاط
  async function cashForMonth(month) {
    const [first, last] = monthRange(month);
    const range = [first, last];
    const fixed = {
      support: {
        income: [['خلاص التلاميذ', await sumSql('SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM payments WHERE paid_on BETWEEN $1 AND $2', range)]],
        expense: [['خلاص المعلمين (بالساعة)', await sumSql('SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM teacher_payments WHERE paid_on BETWEEN $1 AND $2', range)]],
      },
      program: {
        income: [['خلاص الأطفال', await sumSql('SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM program_payments WHERE paid_on BETWEEN $1 AND $2', range)]],
        expense: [],
      },
      courses: {
        income: [['معاليم المشاركين', await sumSql('SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM course_payments WHERE paid_on BETWEEN $1 AND $2', range)]],
        expense: [],
      },
      general: { income: [], expense: [] },
    };
    const ledger = await all(
      `SELECT activity, direction, category, SUM(amount)::float8 AS total FROM ledger_entries
       WHERE date BETWEEN $1 AND $2 GROUP BY activity, direction, category`,
      range
    );
    for (const l of ledger) fixed[l.activity][l.direction].push([LEDGER_CATEGORIES[l.direction][l.category] || l.category, l.total]);

    const activities = Object.entries(ACTIVITIES).map(([key, label]) => {
      const lines = (arr) => arr.filter(([, a]) => a > 0).map(([l, a]) => ({ label: l, amount: round3(a) }));
      const income = round3(fixed[key].income.reduce((t, [, a]) => t + a, 0));
      const expense = round3(fixed[key].expense.reduce((t, [, a]) => t + a, 0));
      return { key, label, income, expense, net: round3(income - expense), income_lines: lines(fixed[key].income), expense_lines: lines(fixed[key].expense) };
    });
    const total = (k) => round3(activities.reduce((t, a) => t + a[k], 0));
    return { month, activities, totals: { income: total('income'), expense: total('expense'), net: total('net') } };
  }

  // حسب الاستحقاق: ما يجب قبضه ودفعه عن الشهر (حتى لو لم يُدفع بعد)
  async function accrualForMonth(month) {
    const students = await all(`SELECT ${STUDENT_COLUMNS} FROM students st`);
    const sp = students.length ? await studentPayments(students.map((x) => x.id)) : [];
    let supportBilled = 0;
    let supportCollected = 0;
    for (const st of students) {
      const row = computeFinance(st, sp.filter((p) => p.student_id === st.id)).months.find((m) => m.month === month);
      if (row) {
        supportBilled += row.due;
        supportCollected += row.paid;
      }
    }
    const teachers = await all(`SELECT id, full_name, hourly_rate::float8 AS hourly_rate FROM users WHERE role = 'teacher'`);
    let teachersDue = 0;
    let teachersPaid = 0;
    for (const t of teachers) {
      const m = await teacherMonth(t, month);
      teachersDue += m.due;
      teachersPaid += m.paid;
    }
    const children = await all(`${CHILD_SELECT}`);
    const pp = children.length ? await programPayments(children.map((c) => c.id)) : [];
    let programBilled = 0;
    let programCollected = 0;
    for (const c of children) {
      const row = childFinance(c, pp.filter((p) => p.child_id === c.id)).months.find((m) => m.month === month);
      if (row) {
        programBilled += row.due;
        programCollected += row.paid;
      }
    }
    const [first, last] = monthRange(month);
    const salaries = await sumSql(
      `SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM ledger_entries
       WHERE direction = 'expense' AND activity = 'program' AND (salary_month = $3 OR (salary_month IS NULL AND date BETWEEN $1 AND $2))`,
      [first, last, month]
    );
    return {
      support: {
        billed: round3(supportBilled),
        collected: round3(supportCollected),
        unpaid: round3(supportBilled - supportCollected),
        teachers_due: round3(teachersDue),
        teachers_paid: round3(teachersPaid),
        teachers_unpaid: round3(teachersDue - teachersPaid),
        margin: round3(supportBilled - teachersDue),
      },
      program: {
        billed: round3(programBilled),
        collected: round3(programCollected),
        unpaid: round3(programBilled - programCollected),
        expenses: round3(salaries),
        margin: round3(programBilled - salaries),
      },
    };
  }

  route('GET', '/api/finance/summary', ['admin'], async ({ query }) => {
    const month = monthParam(query.get('month'));
    return { ...(await cashForMonth(month)), accrual: await accrualForMonth(month) };
  });

  // السنة الدراسية شهرًا بشهر (نقدًا)
  route('GET', '/api/finance/year', ['admin'], async () => {
    const months = [];
    for (const month of schoolYearMonths()) {
      const c = await cashForMonth(month);
      months.push({
        month,
        totals: c.totals,
        activities: Object.fromEntries(c.activities.map((a) => [a.key, { income: a.income, expense: a.expense, net: a.net }])),
      });
    }
    const sum = (k) => round3(months.reduce((t, m) => t + m.totals[k], 0));
    return { months, totals: { income: sum('income'), expense: sum('expense'), net: sum('net') } };
  });

  route('GET', '/api/finance/meta', ['admin'], async () => ({ activities: ACTIVITIES, categories: LEDGER_CATEGORIES }));

  // ======================================================================
  // التعريفات: المعلوم الشهري الافتراضي لكل مستوى في دروس الدعم
  // ======================================================================
  const getSetting = async (key, fallback) => (await one('SELECT value FROM settings WHERE key = $1', [key]))?.value ?? fallback;

  route('GET', '/api/settings/fees', ['admin'], async () => ({
    support: await getSetting('support_fees', {}),
    classes: await all('SELECT id, name, age_range, default_fee::float8 AS default_fee FROM program_classes ORDER BY name'),
  }));

  route('PUT', '/api/settings/fees', ['admin'], async ({ body }) => {
    const fees = {};
    for (const code of LEVEL_CODES) {
      const v = money(body.support?.[code], 'المعلوم');
      if (v) fees[code] = v;
    }
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('support_fees', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(fees)]
    );
    for (const c of Array.isArray(body.classes) ? body.classes : []) {
      await pool.query('UPDATE program_classes SET default_fee = $1 WHERE id = $2', [money(c.default_fee, 'المعلوم'), Number(c.id) || 0]);
    }
    return { support: fees };
  });

  // ======================================================================
  // الوصولات
  // ======================================================================
  const RECEIPT_SQL = {
    support: `SELECT p.receipt_no, p.amount::float8 AS amount, p.paid_on::text, p.method, p.note, p.month,
        st.full_name AS beneficiary, st.level, u.full_name AS payer, u.phone, st.parent_id,
        'دروس الدعم' AS program
      FROM payments p JOIN students st ON st.id = p.student_id LEFT JOIN users u ON u.id = st.parent_id WHERE p.id = $1`,
    program: `SELECT p.receipt_no, p.amount::float8 AS amount, p.paid_on::text, p.method, p.note, p.month,
        c.full_name AS beneficiary, NULL AS level, c.guardian_name AS payer, c.guardian_phone AS phone, NULL::int AS parent_id,
        'البرنامج التربوي' || COALESCE(' — ' || k.name, '') AS program
      FROM program_payments p JOIN program_children c ON c.id = p.child_id LEFT JOIN program_classes k ON k.id = c.class_id
      WHERE p.id = $1`,
    course: `SELECT p.receipt_no, p.amount::float8 AS amount, p.paid_on::text, p.method, p.note, NULL AS month,
        cp.full_name AS beneficiary, NULL AS level, COALESCE(u.full_name, cp.full_name) AS payer,
        COALESCE(cp.phone, u.phone) AS phone, NULL::int AS parent_id, c.name AS program
      FROM course_payments p JOIN course_participants cp ON cp.id = p.participant_id JOIN courses c ON c.id = cp.course_id
      LEFT JOIN students st ON st.id = cp.student_id LEFT JOIN users u ON u.id = st.parent_id
      WHERE p.id = $1`,
  };

  for (const kind of Object.keys(RECEIPT_SQL)) {
    // الولي يرى وصولات أبنائه في دروس الدعم
    route('GET', `/api/receipts/${kind}/:id`, kind === 'support' ? ['admin', 'parent'] : ['admin'], async ({ user, params }) => {
      const r = await one(RECEIPT_SQL[kind], [params.id]);
      if (!r || (user.role === 'parent' && r.parent_id !== user.id)) throw new HttpError(404, 'الوصل غير موجود');
      delete r.parent_id;
      return { receipt: { ...r, kind } };
    });
  }

  // سجل الوصولات لشهر (حسب تاريخ الدفع)
  route('GET', '/api/receipts', ['admin'], async ({ query }) => {
    const month = monthParam(query.get('month'));
    const [first, last] = monthRange(month);
    return {
      receipts: await all(
        `SELECT 'support' AS kind, p.id, p.receipt_no, p.amount::float8 AS amount, p.paid_on::text, p.method,
            st.full_name AS beneficiary, 'دروس الدعم' AS program
           FROM payments p JOIN students st ON st.id = p.student_id WHERE p.paid_on BETWEEN $1 AND $2
         UNION ALL
         SELECT 'program', p.id, p.receipt_no, p.amount::float8, p.paid_on::text, p.method, c.full_name, 'البرنامج التربوي'
           FROM program_payments p JOIN program_children c ON c.id = p.child_id WHERE p.paid_on BETWEEN $1 AND $2
         UNION ALL
         SELECT 'course', p.id, p.receipt_no, p.amount::float8, p.paid_on::text, p.method, cp.full_name, c.name
           FROM course_payments p JOIN course_participants cp ON cp.id = p.participant_id JOIN courses c ON c.id = cp.course_id
           WHERE p.paid_on BETWEEN $1 AND $2
         ORDER BY receipt_no DESC`,
        [first, last]
      ),
    };
  });

  // ======================================================================
  // كل تلاميذ المركز والبرامج المسجّلين فيها
  // ======================================================================
  const personKey = (name, phone) => `${normName(name || '')}|${phoneKey(phone) || ''}`;

  route('GET', '/api/center/people', ['admin'], async () => {
    const people = new Map();
    const add = (key, base) => {
      if (!people.has(key)) people.set(key, { ...base, programs: [] });
      return people.get(key);
    };
    const students = await all(
      `SELECT st.id, st.full_name, st.level, st.status, (st.photo IS NOT NULL) AS has_photo, st.photo_version,
         u.full_name AS parent_name, u.phone
       FROM students st LEFT JOIN users u ON u.id = st.parent_id`
    );
    for (const st of students) {
      const p = add(`s${st.id}`, { full_name: st.full_name, parent_name: st.parent_name, phone: st.phone, student_id: st.id,
        has_photo: st.has_photo, photo_version: st.photo_version, id: st.id });
      p.programs.push({ type: 'support', label: LEVELS.find((l) => l.code === st.level)?.label, status: st.status, link: `#/students/${st.id}` });
      people.set(personKey(st.full_name, st.phone), p);
    }
    const children = await all(`${CHILD_SELECT} ORDER BY c.full_name`);
    for (const c of children) {
      const key = personKey(c.full_name, c.guardian_phone);
      const p = people.get(key) || add(`c${c.id}`, { full_name: c.full_name, parent_name: c.guardian_name, phone: c.guardian_phone });
      people.set(key, p);
      p.programs.push({ type: 'program', label: c.class_name || 'البرنامج التربوي', status: c.status, link: `#/program/child/${c.id}` });
    }
    const parts = await all(
      `SELECT p.id, p.full_name, p.phone, p.student_id, c.id AS course_id, c.name, c.kind, c.status
       FROM course_participants p JOIN courses c ON c.id = p.course_id ORDER BY c.start_date DESC NULLS LAST`
    );
    for (const x of parts) {
      const key = personKey(x.full_name, x.phone);
      const p = (x.student_id && people.get(`s${x.student_id}`)) || people.get(key) || add(`p${x.id}`, { full_name: x.full_name, phone: x.phone });
      people.set(key, p);
      p.programs.push({ type: x.kind, label: x.name, status: x.status, link: `#/courses/${x.course_id}` });
    }
    const unique = [...new Set(people.values())].sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
    return { people: unique };
  });

  // ======================================================================
  // الأولياء المتخلّد بذمتهم
  // ======================================================================
  async function familyDebts() {
    const families = new Map();
    // العائلة: نفس الهاتف، أو نفس اسم الولي؛ دون هاتف ولا اسم: كل تلميذ وحده
    const fam = (phone, name, fallback) => {
      const key = phoneKey(phone) || (name ? `n:${normName(name)}` : `x:${fallback}`);
      if (!families.has(key)) families.set(key, { key, name: name || null, phone: phone || null, total: 0, oldest: null, items: [] });
      const f = families.get(key);
      f.name ||= name;
      f.phone ||= phone;
      return f;
    };
    const push = (f, item) => {
      f.items.push(item);
      f.total = round3(f.total + item.amount);
      if (item.oldest && (!f.oldest || item.oldest < f.oldest)) f.oldest = item.oldest;
    };
    const students = await all(
      `SELECT ${STUDENT_COLUMNS}, u.full_name AS parent_name, u.phone AS parent_phone
       FROM students st LEFT JOIN users u ON u.id = st.parent_id WHERE st.status <> 'waiting'`
    );
    const sp = students.length ? await studentPayments(students.map((x) => x.id)) : [];
    for (const st of students) {
      const f0 = computeFinance(st, sp.filter((p) => p.student_id === st.id));
      if (f0.balance <= 0) continue;
      const oldest = f0.months.filter((m) => m.remaining > 0).map((m) => m.month).sort()[0] || null;
      push(fam(st.parent_phone, st.parent_name, `s${st.id}`), { type: 'support', label: `دروس الدعم — ${st.full_name}`, student: st.full_name,
        amount: f0.balance, oldest, link: `#/students/${st.id}` });
    }
    const children = await all(`${CHILD_SELECT}`);
    const pp = children.length ? await programPayments(children.map((c) => c.id)) : [];
    for (const c of children) {
      const f0 = childFinance(c, pp.filter((p) => p.child_id === c.id));
      if (f0.balance <= 0) continue;
      const oldest = f0.months.filter((m) => m.remaining > 0).map((m) => m.month).sort()[0] || null;
      push(fam(c.guardian_phone, c.guardian_name, `c${c.id}`), { type: 'program', label: `البرنامج التربوي — ${c.full_name}`, student: c.full_name,
        amount: f0.balance, oldest, link: `#/program/child/${c.id}` });
    }
    const parts = await all(
      `SELECT p.id, p.full_name, COALESCE(p.phone, u.phone) AS phone, u.full_name AS parent_name, c.id AS course_id, c.name,
         c.start_date::text, GREATEST(COALESCE(p.fee, c.price, 0) - COALESCE(p.discount, 0), 0)::float8 AS due,
         (SELECT COALESCE(SUM(amount), 0)::float8 FROM course_payments WHERE participant_id = p.id) AS paid
       FROM course_participants p JOIN courses c ON c.id = p.course_id
       LEFT JOIN students st ON st.id = p.student_id LEFT JOIN users u ON u.id = st.parent_id
       WHERE c.status <> 'cancelled'`
    );
    for (const x of parts) {
      const amount = round3(x.due - x.paid);
      if (amount <= 0) continue;
      push(fam(x.phone, x.parent_name || x.full_name, `p${x.id}`), { type: 'course', label: `${x.name} — ${x.full_name}`, student: x.full_name,
        amount, oldest: x.start_date ? x.start_date.slice(0, 7) : null, link: `#/courses/${x.course_id}` });
    }
    const cm = currentMonth();
    const list = [...families.values()].map((f) => {
      // عدد الأشهر منذ أقدم مبلغ غير مدفوع
      let late = 0;
      if (f.oldest) for (let m = f.oldest; m < cm; m = nextMonth(m)) late++;
      return { ...f, months_late: late, severity: late >= 2 ? 'high' : late >= 1 ? 'medium' : 'low' };
    });
    return list.sort((a, b) => b.months_late - a.months_late || b.total - a.total);
  }

  route('GET', '/api/debts', ['admin'], async () => {
    const families = await familyDebts();
    return { families, total: round3(families.reduce((t, f) => t + f.total, 0)) };
  });

  // ======================================================================
  // مهام الإدارة والمشاكل
  // ======================================================================
  const TASK_PRIORITIES = ['normal', 'high', 'urgent'];
  const TASK_STATUSES = ['todo', 'doing', 'done'];
  const CTASK_SELECT = `SELECT t.id, t.title, t.description, t.kind, t.priority, t.status, t.assignee_user_id,
      COALESCE(u.full_name, t.assignee_name) AS assignee, t.assignee_name, t.due_date::text, t.decision_id,
      t.created_at, t.done_at
    FROM center_tasks t LEFT JOIN users u ON u.id = t.assignee_user_id`;

  async function readCenterTask(body) {
    let assigneeId = Number(body.assignee_user_id) || null;
    if (assigneeId) {
      const u = await userById(assigneeId);
      if (!u || u.role === 'parent') throw new HttpError(400, 'المسؤول غير موجود');
    }
    return [
      text(body.title, { required: true, max: 200, name: 'المهمة' }),
      text(body.description, { max: 2000, name: 'التفاصيل' }),
      body.kind === 'problem' ? 'problem' : 'task',
      TASK_PRIORITIES.includes(body.priority) ? body.priority : 'normal',
      TASK_STATUSES.includes(body.status) ? body.status : 'todo',
      assigneeId,
      assigneeId ? null : text(body.assignee_name, { max: 120, name: 'المسؤول' }),
      body.due_date ? date(body.due_date, 'الأجل') : null,
    ];
  }

  route('GET', '/api/todo', ['admin', 'teacher'], async ({ user, query }) => {
    const showDone = query.get('done') === '1';
    const where = [];
    const params = [];
    if (user.role === 'teacher') {
      params.push(user.id);
      where.push(`t.assignee_user_id = $${params.length}`);
    }
    if (!showDone) where.push(`t.status <> 'done'`);
    return {
      tasks: await all(
        `${CTASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY (t.status = 'done'), CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
           t.due_date NULLS LAST, t.id DESC LIMIT 300`,
        params
      ),
    };
  });

  route('POST', '/api/todo', ['admin'], async ({ user, body }) => {
    const row = await one(
      `INSERT INTO center_tasks (title, description, kind, priority, status, assignee_user_id, assignee_name, due_date,
         decision_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [...(await readCenterTask(body)), Number(body.decision_id) || null, user.id]
    );
    return [201, { task: row }];
  });

  route('PUT', '/api/todo/:id', ['admin'], async ({ params, body }) => {
    const v = await readCenterTask(body);
    const { rowCount } = await pool.query(
      `UPDATE center_tasks SET title = $1, description = $2, kind = $3, priority = $4, status = $5, assignee_user_id = $6,
         assignee_name = $7, due_date = $8, done_at = CASE WHEN $5 = 'done' THEN COALESCE(done_at, now()) ELSE NULL END
       WHERE id = $9`,
      [...v, params.id]
    );
    if (!rowCount) throw new HttpError(404, 'المهمة غير موجودة');
    return { ok: true };
  });

  // تغيير الحالة: الإدارة، أو المعلم المسؤول عن المهمة
  route('PATCH', '/api/todo/:id', ['admin', 'teacher'], async ({ user, params, body }) => {
    if (!TASK_STATUSES.includes(body.status)) throw new HttpError(400, 'الحالة غير صالحة');
    const t = await one('SELECT assignee_user_id, decision_id FROM center_tasks WHERE id = $1', [params.id]);
    if (!t || (user.role === 'teacher' && t.assignee_user_id !== user.id)) throw new HttpError(404, 'المهمة غير موجودة');
    await pool.query(
      `UPDATE center_tasks SET status = $1, done_at = CASE WHEN $1 = 'done' THEN now() ELSE NULL END WHERE id = $2`,
      [body.status, params.id]
    );
    // إنجاز مهمة مرتبطة بقرار يُنجز القرار
    if (t.decision_id && body.status === 'done') await pool.query(`UPDATE decisions SET status = 'done' WHERE id = $1`, [t.decision_id]);
    return { ok: true };
  });

  route('DELETE', '/api/todo/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM center_tasks WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'المهمة غير موجودة');
    return { ok: true };
  });

  // ======================================================================
  // الاجتماعات والقرارات
  // ======================================================================
  const readMeeting = (body) => [
    text(body.title, { required: true, max: 200, name: 'العنوان' }),
    date(body.date || today()),
    text(body.attendees, { max: 1000, name: 'الحاضرون' }),
    text(body.agenda, { max: 5000, name: 'جدول الأعمال' }),
    text(body.minutes, { max: 20000, name: 'المحضر' }),
  ];
  const DECISION_SELECT = `SELECT d.id, d.meeting_id, d.text, d.owner, d.due_date::text, d.status,
      (SELECT id FROM center_tasks t WHERE t.decision_id = d.id LIMIT 1) AS task_id FROM decisions d`;

  route('GET', '/api/meetings', ['admin'], async () => {
    const meetings = await all(
      `SELECT id, title, date::text, attendees, agenda, minutes FROM meetings ORDER BY date DESC, id DESC LIMIT 200`
    );
    const decisions = await all(`${DECISION_SELECT} ORDER BY d.id`);
    for (const m of meetings) m.decisions = decisions.filter((d) => d.meeting_id === m.id);
    return { meetings, open_decisions: decisions.filter((d) => d.status === 'open') };
  });

  route('POST', '/api/meetings', ['admin'], async ({ user, body }) => {
    const row = await one(
      'INSERT INTO meetings (title, date, attendees, agenda, minutes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [...readMeeting(body), user.id]
    );
    return [201, { meeting: row }];
  });

  route('PUT', '/api/meetings/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      'UPDATE meetings SET title = $1, date = $2, attendees = $3, agenda = $4, minutes = $5 WHERE id = $6',
      [...readMeeting(body), params.id]
    );
    if (!rowCount) throw new HttpError(404, 'الاجتماع غير موجود');
    return { ok: true };
  });

  route('DELETE', '/api/meetings/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM meetings WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الاجتماع غير موجود');
    return { ok: true };
  });

  route('POST', '/api/meetings/:id/decisions', ['admin'], async ({ params, body }) => {
    if (!(await one('SELECT 1 FROM meetings WHERE id = $1', [params.id]))) throw new HttpError(404, 'الاجتماع غير موجود');
    const row = await one(
      'INSERT INTO decisions (meeting_id, text, owner, due_date) VALUES ($1, $2, $3, $4) RETURNING id',
      [
        params.id,
        text(body.text, { required: true, max: 1000, name: 'القرار' }),
        text(body.owner, { max: 120, name: 'المسؤول' }),
        body.due_date ? date(body.due_date, 'الأجل') : null,
      ]
    );
    return [201, { decision: row }];
  });

  route('PATCH', '/api/decisions/:id', ['admin'], async ({ params, body }) => {
    if (!['open', 'done', 'cancelled'].includes(body.status)) throw new HttpError(400, 'الحالة غير صالحة');
    const { rowCount } = await pool.query('UPDATE decisions SET status = $1 WHERE id = $2', [body.status, params.id]);
    if (!rowCount) throw new HttpError(404, 'القرار غير موجود');
    return { ok: true };
  });

  route('DELETE', '/api/decisions/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM decisions WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'القرار غير موجود');
    return { ok: true };
  });

  // تحويل قرار إلى مهمة متابعة
  route('POST', '/api/decisions/:id/task', ['admin'], async ({ user, params }) => {
    const d = await one('SELECT d.*, d.due_date::text AS due FROM decisions d WHERE id = $1', [params.id]);
    if (!d) throw new HttpError(404, 'القرار غير موجود');
    const existing = await one('SELECT id FROM center_tasks WHERE decision_id = $1', [d.id]);
    if (existing) return { task: existing };
    const row = await one(
      `INSERT INTO center_tasks (title, assignee_name, due_date, decision_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [d.text.slice(0, 200), d.owner, d.due, d.id, user.id]
    );
    return [201, { task: row }];
  });

  // ======================================================================
  // التنبيهات ومؤشرات المركز
  // ======================================================================
  async function computeAlerts() {
    const alerts = [];
    const now = today();
    const add = (level, text, link, items = []) => alerts.push({ level, text, link, items });
    const tasks = await all(`${CTASK_SELECT} WHERE t.status <> 'done'`);
    const overdue = tasks.filter((t) => t.due_date && t.due_date < now);
    const urgent = tasks.filter((t) => t.priority === 'urgent' || t.kind === 'problem');
    const dueToday = tasks.filter((t) => t.due_date === now);
    if (urgent.length) add('urgent', `${urgent.length} مشكلة / مهمة عاجلة مفتوحة`, '#/todo', urgent.map((t) => t.title));
    if (overdue.length) add('urgent', `${overdue.length} مهمة متأخرة عن أجلها`, '#/todo', overdue.map((t) => `${t.title} (${t.assignee || '—'})`));
    if (dueToday.length) add('warning', `${dueToday.length} مهمة أجلها اليوم`, '#/todo', dueToday.map((t) => t.title));
    const decisions = await all(`${DECISION_SELECT} WHERE d.status = 'open' AND d.due_date < $1`, [now]);
    if (decisions.length) add('warning', `${decisions.length} قرار لم يُنفَّذ في أجله`, '#/meetings', decisions.map((d) => d.text));

    const debts = await familyDebts();
    const late = debts.filter((f) => f.severity === 'high');
    if (late.length) {
      add('urgent', `${late.length} عائلة متخلّدة بذمتها منذ شهرين أو أكثر (${round3(late.reduce((t, f) => t + f.total, 0))} د.ت)`,
        '#/debts', late.map((f) => `${f.name || '—'}: ${f.total} د.ت`));
    }
    const medium = debts.filter((f) => f.severity === 'medium');
    if (medium.length) add('warning', `${medium.length} عائلة لم تخلّص الشهر الماضي`, '#/debts');

    const waiting = (await one(`SELECT COUNT(*)::int AS n FROM students WHERE status = 'waiting'`)).n;
    if (waiting) add('warning', `${waiting} تسجيل جديد في الانتظار`, '#/registrations');

    const absentees = await all(
      `SELECT st.id, st.full_name, COUNT(*)::int AS n FROM absences a JOIN students st ON st.id = a.student_id
       WHERE NOT a.justified AND a.date >= current_date - 30 AND st.status = 'studying'
       GROUP BY st.id HAVING COUNT(*) >= 3 ORDER BY n DESC`
    );
    if (absentees.length) add('warning', `${absentees.length} تلميذ بـ 3 غيابات غير مبررة أو أكثر هذا الشهر`, '#/students',
      absentees.map((a) => `${a.full_name} (${a.n})`));

    const prev = (() => {
      const [y, m] = currentMonth().split('-').map(Number);
      return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    })();
    const teachers = await all(`SELECT id, full_name, hourly_rate::float8 AS hourly_rate FROM users WHERE role = 'teacher'`);
    const unpaid = [];
    for (const t of teachers) {
      const m = await teacherMonth(t, prev);
      if (m.remaining > 0) unpaid.push(`${t.full_name}: ${m.remaining} د.ت`);
    }
    if (unpaid.length) add('warning', `${unpaid.length} معلم لم يُخلَّص بالكامل عن ${prev}`, '#/payroll', unpaid);

    const soon = await all(
      `SELECT id, name, start_date::text FROM courses WHERE status = 'planned' AND start_date BETWEEN current_date AND current_date + 7 ORDER BY start_date`
    );
    if (soon.length) add('info', `${soon.length} نشاط / دورة تبدأ خلال 7 أيام`, '#/courses', soon.map((c) => `${c.name} (${c.start_date})`));
    return alerts;
  }

  route('GET', '/api/alerts', ['admin'], async () => {
    const alerts = await computeAlerts();
    return { alerts, count: alerts.filter((a) => a.level !== 'info').length };
  });

  route('GET', '/api/kpis', ['admin'], async () => {
    const month = currentMonth();
    const counts = await one(`SELECT
      (SELECT COUNT(*)::int FROM students WHERE status = 'studying') AS support_active,
      (SELECT COUNT(*)::int FROM program_children WHERE status = 'active') AS program_active,
      (SELECT COUNT(*)::int FROM courses WHERE status = 'planned' AND (end_date IS NULL OR end_date >= current_date)) AS events_open,
      (SELECT COUNT(*)::int FROM users WHERE role = 'teacher') AS teachers,
      (SELECT COUNT(*)::int FROM center_tasks WHERE status <> 'done') AS tasks_open,
      (SELECT COUNT(*)::int FROM center_tasks WHERE status <> 'done' AND due_date < current_date) AS tasks_overdue,
      (SELECT COUNT(*)::int FROM absences WHERE date >= date_trunc('month', current_date)) AS absences_month`);
    const cash = await cashForMonth(month);
    const acc = await accrualForMonth(month);
    const billed = acc.support.billed + acc.program.billed;
    const collected = acc.support.collected + acc.program.collected;
    const debts = await familyDebts();
    return {
      month,
      ...counts,
      income: cash.totals.income,
      expense: cash.totals.expense,
      net: cash.totals.net,
      collection_rate: billed ? Math.round((collected / billed) * 100) : null,
      debts_total: round3(debts.reduce((t, f) => t + f.total, 0)),
      debtors: debts.length,
      teacher_hours: round3(
        (await Promise.all(
          (await all(`SELECT id, hourly_rate::float8 AS hourly_rate FROM users WHERE role = 'teacher'`)).map((t) => teacherMonth(t, month))
        )).reduce((t, m) => t + m.hours_done, 0)
      ),
    };
  });

  // ======================================================================
  // قاعدة البيانات: نقل المعطيات من قاعدة Netlify إلى Supabase (مرة واحدة)
  // ======================================================================
  route('GET', '/api/admin/db-status', ['admin'], async () => {
    const status = { engine, migration_available: !!migrationSource };
    if (migrationSource) {
      status.target_rows = await countRows(pool);
      status.source_rows = await countRows(migrationSource).catch(() => null);
    }
    return status;
  });

  route('POST', '/api/admin/migrate-db', ['admin'], async ({ body }) => {
    if (!migrationSource) throw new HttpError(400, 'لا توجد قاعدة قديمة لنقل المعطيات منها');
    // حماية: لا نمسح قاعدة فيها معطيات إلا بتأكيد صريح
    if ((await countRows(pool)) > 0 && body.confirm !== 'REPLACE') {
      throw new HttpError(409, 'قاعدة Supabase فيها معطيات. النقل سيعوّضها كلها.');
    }
    const copied = await copyDatabase(migrationSource, pool);
    bootstrapped = null;
    return { copied };
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
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, receipt_no`,
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
    if (user.role === 'teacher') {
      delete student.monthly_fee;
      delete student.discount;
      delete student.discount_reason;
    }
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
      // روابط مجموعات واتساب: للإدارة والولي فقط
      whatsapp_groups: user.role === 'teacher' ? [] : await studentWhatsappGroups(student),
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
