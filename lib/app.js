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
const DEFAULT_LEVELS = LEVELS.map((l) => ({ ...l }));
// الأقسام قابلة للتعديل من الإدارة: نفس المصفوفتين تُحدَّثان في مكانهما (كل الكود يقرأ منهما)
function setLevels(list) {
  LEVELS.splice(0, LEVELS.length, ...list.map((l) => ({ code: l.code, label: l.label })));
  LEVEL_CODES.splice(0, LEVEL_CODES.length, ...LEVELS.map((l) => l.code));
}
const ROLES = ['admin', 'teacher', 'parent'];
const NOTE_CATEGORIES = ['behavior', 'level', 'general'];
const NOTE_RATINGS = ['excellent', 'good', 'average', 'weak'];
const STATUSES = ['studying', 'waiting', 'left', 'stopped'];

// الأنشطة وأصناف المداخيل والمصاريف
const ACTIVITIES = {
  support: 'دروس الدعم',
  program: 'البرنامج التربوي',
  courses: 'الدورات والأنشطة',
  general: 'المصاريف العامة للمركز',
};
const LEDGER_CATEGORIES = {
  expense: {
    salary: 'أجور',
    rent: 'كراء',
    utilities: 'ماء وكهرباء وإنترنت',
    cleaning: 'نظافة',
    supplies: 'معدات ولوازم',
    maintenance: 'صيانة',
    printing: 'طباعة',
    food: 'أكل وتنقل',
    marketing: 'إشهار',
    tax: 'ضرائب ومعاليم',
    tax_monthly: 'القباضة · قسط شهري',
    tax_quarterly: 'القباضة · قسط ثلاثي',
    tax_office: 'القباضة · أخرى',
    accountant_fee: 'أجرة المحاسب الشهرية',
    bilan_annual: 'Bilan annuel',
    monthly_dues: 'الرسوم الشهرية',
    annual_declaration: 'التصريح السنوي',
    accounting: 'المحاسبة',
    acc_other: 'أخرى (محاسبة)',
    other: 'مصاريف أخرى',
  },
  income: {
    registration: 'معاليم التسجيل',
    sales: 'مبيعات',
    grant: 'منح ومساعدات',
    other: 'مداخيل أخرى',
  },
};
// مصاريف تظهر في فضاء المحاسبة
// مجموعات فضاء المحاسبة (المصاريف التي يتابعها المحاسب)
const ACCOUNTING_GROUPS = [
  ['recette', 'القباضة', ['tax_monthly', 'tax_quarterly', 'tax_office']],
  ['accountant', 'المحاسب', ['accountant_fee']],
  ['bilan', 'Bilan annuel', ['bilan_annual']],
  ['other', 'أخرى', ['acc_other', 'annual_declaration', 'monthly_dues', 'accounting', 'tax']],
];
const ACCOUNTING_CATEGORIES = ACCOUNTING_GROUPS.flatMap(([, , c]) => c);
// الأنواع المقترحة عند الإضافة (القديمة تبقى للعرض فقط)
const ACCOUNTING_NEW = ['tax_monthly', 'tax_quarterly', 'tax_office', 'accountant_fee', 'bilan_annual', 'acc_other'];
const DOC_FOLDERS = ['month', 'center', 'bank', 'pv'];
// البرنامج التربوي: من سبتمبر إلى ماي
const PROGRAM_SKIP = ['06', '07', '08'];
// الأنشطة التي تُوزَّع عليها المصاريف المشتركة
const SPLIT_KEYS = ['support', 'program', 'courses'];
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

// رابط فيديو (YouTube، Drive، …): http(s) فقط
function videoUrl(v) {
  const u = String(v ?? '').trim();
  if (!u) return null;
  if (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 500) throw new HttpError(400, 'رابط الفيديو غير صالح');
  return u;
}
// علامات الاتجاه الخفية والفراغات في الأطراف (تأتي مع النسخ واللصق)
const cleanCredential = (v) => String(v ?? '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff\u00a0]/g, '').trim();

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
  if (typeof value === 'string') value = cleanCredential(value);
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
// partner: الشريك وليّ أيضًا، معلوم أبنائه يُخصم من نصيبه (لا يدخل الصندوق ولا البنك)
const PAYMENT_METHODS = ['cash', 'bank', 'transfer', 'cheque', 'd17', 'other', 'partner'];
// ما يدخل الحساب البنكي للشركة (للمحاسبة): «بنك الشركة» فقط، لا أي تحويل أو صك
const BANK_METHODS = ['bank'];

// صلاحيات الإداري (المشرف العام له كلها دائمًا)
export const PERMISSIONS = {
  school: 'التلاميذ والبرامج (الدعم، التربوي، الدورات، الغيابات)',
  stats: 'رؤية الإحصائيات والمردودية',
  edit_payments: 'تعديل وحذف دفعات مسجّلة سابقًا',
  expenses: 'المداخيل والمصاريف',
  salaries: 'الأجور وخلاص المدرّسين',
  fees: 'التعريفات والتخفيضات',
  delete: 'حذف التلاميذ والأطفال',
  accounts: 'حسابات المدرّسين والإداريين',
  accounting: 'فضاء المحاسبة (البنك، الوصولات، الملفات)',
  cash: 'الصندوق اليومي (المداخيل والمصاريف نقدًا)',
  partners: 'نصيب الشركاء والمرابيح (اطّلاع فقط)',
  read_only: '🔒 اطّلاع فقط: لا يضيف ولا يعدّل ولا يحذف أي شيء',
};
const DEFAULT_PERMISSIONS = { school: true, stats: false, edit_payments: false, expenses: true, salaries: false, fees: false, delete: false, accounts: false, accounting: false, cash: true, partners: false, read_only: false };
// من أين دُفع المصروف: الصندوق، البنك، أو من مبلغ سحبه صاحب المشروع
const PAID_FROM = ['cash', 'bank', 'owner'];
// أدوار الإدارة الافتراضية (المدير يضيف ويعدّل ويحذف من صفحة الصلاحيات)
const DEFAULT_ROLES = [
  { key: 'admin', name: 'الإدارة', perms: { school: true, stats: false, edit_payments: false, expenses: false, salaries: false, fees: false, delete: false, accounts: false, accounting: false, cash: false, partners: false, read_only: false } },
  { key: 'partner', name: 'شريك', perms: { school: false, stats: true, edit_payments: false, expenses: false, salaries: false, fees: false, delete: false, accounts: false, accounting: false, cash: false, partners: true, read_only: true } },
  { key: 'accounting', name: 'محاسبة', perms: { school: false, stats: true, edit_payments: false, expenses: false, salaries: false, fees: false, delete: false, accounts: false, accounting: true, cash: false, partners: false, read_only: false } },
];
const permsOf = (user) => (user?.super_admin ? Object.fromEntries(Object.keys(PERMISSIONS).map((k) => [k, true])) : { ...DEFAULT_PERMISSIONS, ...(user?.permissions || {}) });
// قواعد الصلاحيات: [الطريقة، المسار، الصلاحية]
const PERMISSION_RULES = [
  [/^(PUT|DELETE)$/, /^\/api\/(payments|program\/payments|courses\/payments)\/\d+$/, 'edit_payments'],
  [/./, /^\/api\/(dashboard|board|kpis|finance\/(summary|year|general))(\/|$)/, 'stats'],
  [/^(POST|PUT|DELETE)$/, /^\/api\/ledger(\/|$)/, 'expenses'],
  [/./, /^\/api\/fixed-expenses(\/|$)/, 'expenses'],
  [/./, /^\/api\/(salaries|staff|payroll(?!\/\d+$)|payroll\/\d+\/(adjustments|payments))(\/|$)/, 'salaries'],
  [/^PUT$/, /^\/api\/settings\/fees$/, 'fees'],
  [/^DELETE$/, /^\/api\/(students|program\/children)\/\d+$/, 'delete'],
  [/./, /^\/api\/(accounting|documents)(\/|$)/, 'accounting'],
  [/./, /^\/api\/cash(\/|$)/, 'cash'],
  [/^GET$/, /^\/api\/partners$/, 'partners'],
  // الجانب البيداغوجي ومعطيات التلاميذ: لمن له صلاحية «التلاميذ والبرامج» فقط
  [/./, /^\/api\/(students|attendance|evaluations|overview|people|threads|tasks|group-message|timetable|course|courses|parents|family|center\/people|levels|receipts|debts|alerts|todo|meetings|decisions|board\/(notices|attendance|today)|program(?!\/(staff|pay|slots)))(\/|$)/, 'school'],
];

// صلاحيات المعلمين والمؤطّرين والأولياء (يتحكّم فيها المدير): [الوصف، مسارات الواجهة البرمجية المحجوبة عند الإيقاف]
export const ROLE_FEATURES = {
  teacher: {
    attendance: ['تسجيل الغيابات', /^\/api\/(attendance|students\/\d+\/absences|absences\/\d+)(\/|$)/],
    evaluations: ['إدخال الملاحظات والتقييم', /^\/api\/(evaluations|overview|students\/\d+\/notes|notes\/\d+)(\/|$)/],
    tasks: ['تمارين وأنشطة القسم (فيديو وملفات)', /^\/api\/(tasks|task-files)(\/|$)/],
    group_message: ['رسالة لكامل القسم', /^\/api\/threads\/group$/],
    messages: ['مراسلة الأولياء', /^\/api\/threads(?!\/(unread|badge-seen)$)(\/|$)/],
    my_pay: ['رؤية ساعاته وخلاصه', /^\/api\/payroll\/\d+(\/|$)/],
    todo: ['المهام الموكلة إليه', /^\/api\/todo(\/|$)/],
  },
  program_staff: {
    attendance: ['تسجيل الغيابات', /^\/api\/program\/(attendance|children\/\d+\/absences|absences\/\d+)(\/|$)/],
    notes: ['ملاحظات التقييم للأطفال', /^\/api\/program\/(children\/\d+\/notes|notes\/\d+)(\/|$)/],
    posts: ['أنشطة ورسائل القسم (فيديو وملفات)', /^\/api\/(program\/posts|program-post-files)(\/|$)/],
    my_pay: ['رؤية أجرته', /^\/api\/program\/staff-pay(\/|$)/],
  },
  parent: {
    timetable: ['جدول الأوقات', /^\/api\/timetable(\/|$)/],
    evaluation: ['التقييم: الملاحظات والمهام', /^\/api\/task-files(\/|$)/],
    absences: ['الغيابات', null],
    pay: ['الوضعية المالية والخلاص', null],
    receipts: ['الوصولات', /^\/api\/my-receipts(\/|$)/],
    messages: ['مراسلة المعلمين والإدارة', /^\/api\/threads(?!\/(unread|badge-seen)$)(\/|$)/],
  },
};
// أي مجموعات صلاحيات تنطبق على الحساب (معلم دعم ومؤطّر في نفس الوقت: الاثنان)
const featureGroups = (u) =>
  u?.role === 'parent' ? ['parent'] : u?.role === 'teacher' ? (u.program_staff ? ['program_staff'] : u.also_program ? ['teacher', 'program_staff'] : ['teacher']) : [];

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
const fmtNum = (n) => String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ',');
function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// السنة الدراسية لشهر: من سبتمبر إلى أوت (مثال: 2026-2027)
function schoolYearOf(month) {
  const y = Number(month.slice(0, 4));
  return Number(month.slice(5, 7)) >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// الوضعية المالية: المستحق والمدفوع في كل شهر
// - الشهر الأول بالـ prorata حسب تاريخ بداية الدراسة، وكذلك شهر الخروج أو التوقف
// - لا مستحقات للتلميذ المجاني أو في الانتظار
// - المبالغ المحسوبة بالـ prorata تُدوَّر إلى أقرب دينار
// - siblingPct(month): نسبة تخفيض الإخوة في ذلك الشهر (حسب عدد الأبناء المسجّلين يومها)
// - registration: معلوم التسجيل السنوي (يُضاف إلى المجموع والباقي)
function computeFinance(student, payments, { skip, siblingPct, registration = [], adjustments = [], extras = [], history = [] } = {}) {
  // المبلغ الشهري بعد التخفيض
  const fee = student.free ? 0 : Math.max((student.monthly_fee ?? 0) - (student.discount ?? 0), 0);
  // معلوم شهر معيّن: من تاريخ المعلوم إن تغيّر بعده، وإلا المعلوم الحالي
  const hist = [...history].sort((a, b) => a.upto_month.localeCompare(b.upto_month));
  const feeOf = (m) => {
    const h = hist.find((x) => x.upto_month >= m);
    return !h || student.free ? fee : Math.max((h.monthly_fee ?? 0) - (h.discount ?? 0), 0);
  };
  const anyFee = fee > 0 || hist.some((h) => (h.monthly_fee ?? 0) - (h.discount ?? 0) > 0);
  const startDate = student.start_date || `${student.billing_start || student.created_month}-01`;
  const ended = ['left', 'stopped'].includes(student.status) && student.end_date;
  const endDate = ended ? student.end_date : today();
  const byMonth = new Map();
  if (anyFee && !student.free && student.status !== 'waiting' && startDate <= endDate) {
    for (const m of billableMonths(startDate.slice(0, 7), endDate.slice(0, 7), skip)) {
      const days = daysInMonth(m);
      const from = m === startDate.slice(0, 7) ? Number(startDate.slice(8, 10)) : 1;
      const to = ended && m === endDate.slice(0, 7) ? Number(endDate.slice(8, 10)) : days;
      const covered = to - from + 1;
      const pct = siblingPct?.(m) || 0;
      const base = feeOf(m);
      if (base <= 0 && !adjustments.some((a) => a.month === m)) continue;
      const monthFee = pct ? round3((base * (100 - pct)) / 100) : base;
      let due = covered >= days ? monthFee : Math.round((monthFee * covered) / days);
      // تعديل الإدارة لهذا الشهر: غياب الشهر كاملًا، غياب عدد من الأيام، أو مبلغ آخر
      const adj = adjustments.find((a) => a.month === m);
      let adjustment = null;
      if (adj) {
        const original = due;
        if (adj.kind === 'exempt') due = 0;
        else if (adj.kind === 'absent_days') due = Math.max(Math.round((due * (covered - Math.min(adj.value, covered))) / covered), 0);
        else if (adj.kind === 'amount') due = round3(Math.max(adj.value, 0));
        adjustment = { id: adj.id, kind: adj.kind, value: adj.value, reason: adj.reason, original };
      }
      byMonth.set(m, { month: m, due, prorata: covered < days ? `${covered}/${days}` : null, sibling_pct: pct || null, adjustment, extras: [], paid: 0, payments: [] });
    }
  }
  for (const p of payments) {
    if (!byMonth.has(p.month)) byMonth.set(p.month, { month: p.month, due: 0, prorata: null, sibling_pct: null, extras: [], paid: 0, payments: [] });
    const row = byMonth.get(p.month);
    row.paid = round3(row.paid + p.amount);
    row.payments.push(p);
  }
  // زيادات الشهر (منها معلوم التسجيل مع أول شهر): تُستحق كاملة إلى أن تُدفع أو تعدّلها الإدارة (معفى، مبلغ آخر)
  const isReg = (x) => /تسجيل/.test(x.reason || '');
  for (const x of extras) {
    if (!byMonth.has(x.month)) byMonth.set(x.month, { month: x.month, due: 0, prorata: null, sibling_pct: null, extras: [], paid: 0, payments: [] });
    byMonth.get(x.month).extras.push({ ...x });
  }
  for (const row of byMonth.values()) {
    const base = row.due;
    row.due = round3(row.due + row.extras.reduce((t, x) => t + x.amount, 0));
    // ما دُفع من معلوم التسجيل: ما زاد على معلوم الشهر (للعرض)
    let surplus = round3(Math.max(row.paid - base, 0));
    for (const x of row.extras.filter(isReg)) {
      x.registration = true;
      x.paid = round3(Math.min(x.amount, surplus));
      surplus = round3(surplus - x.paid);
    }
  }
  const months = [...byMonth.values()]
    .map((r) => ({ ...r, remaining: round3(Math.max(r.due - r.paid, 0)) }))
    .sort((a, b) => b.month.localeCompare(a.month));
  const totalDue = round3(months.reduce((t, r) => t + r.due, 0) + registration.reduce((t, r) => t + r.due, 0));
  const totalPaid = round3(months.reduce((t, r) => t + r.paid, 0) + registration.reduce((t, r) => t + r.paid, 0));
  return {
    monthly_fee: student.monthly_fee,
    discount: student.discount ?? null,
    discount_reason: student.discount_reason ?? null,
    net_fee: fee,
    sibling_pct: siblingPct?.(currentMonth()) || null,
    free: !!student.free,
    start_date: student.start_date,
    months,
    registration,
    total_due: totalDue,
    total_paid: totalPaid,
    balance: round3(totalDue - totalPaid),
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// التحقق من رمز Google (ID token) عبر خدمة Google الرسمية
async function verifyGoogleToken(credential, clientId) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) throw new HttpError(401, 'تعذّر التحقق من حساب Google');
  const info = await res.json();
  if (info.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) {
    throw new HttpError(401, 'حساب Google غير صالح لهذا التطبيق');
  }
  if (String(info.email_verified) !== 'true') throw new HttpError(401, 'البريد الإلكتروني غير مؤكَّد في Google');
  return { sub: info.sub, email: info.email, name: info.name || info.email };
}

export function createHandler(pool, {
  adminPassword = process.env.ADMIN_PASSWORD,
  engine = 'netlify',
  migrationSource = null,
  googleClientId = process.env.GOOGLE_CLIENT_ID || '',
  verifyGoogle = (credential) => verifyGoogleToken(credential, googleClientId),
} = {}) {
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
        `INSERT INTO users (username, password_hash, full_name, role, super_admin)
         SELECT 'admin', $1, 'الإدارة', 'admin', true
         WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`,
        [hashPassword(adminPassword)]
      );
      // لا بد من مشرف عام واحد على الأقل
      await pool.query(
        `UPDATE users SET super_admin = true WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)
         AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND super_admin)`
      );
    })().catch((err) => {
      bootstrapped = null;
      throw err;
    }));

  const userById = (id) =>
    one(
      `SELECT id, username, full_name, role, phone, cin, email, address, hourly_rate::float8 AS hourly_rate, approved,
         program_staff, also_program, volunteer, last_seen, linked_parent_id, monthly_salary::float8 AS monthly_salary, pay_per_child::float8 AS pay_per_child, super_admin, permissions
       FROM users WHERE id = $1`,
      [id]
    );
  const teacherSubjects = (id) =>
    all(
      `SELECT s.id, s.name, s.levels, ts.levels AS teach_levels FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.teacher_id = $1 ORDER BY s.id`,
      [id]
    );
  // المعلم يدرّس المادة في هذا المستوى (teach_levels فارغ = كل مستويات المادة)
  const teaches = async (teacherId, subjectId, level) =>
    (await teacherSubjects(teacherId)).some(
      (s) => s.id === subjectId && (!level || !s.teach_levels || s.teach_levels.includes(level))
    );
  const STUDENT_COLUMNS = `st.id, st.full_name, st.level, st.group_name, st.birth_date::text, st.parent_id, st.city,
    st.school, st.remarks, st.address, st.pack, st.monthly_fee::float8 AS monthly_fee, st.billing_start,
    (st.photo IS NOT NULL) AS has_photo, st.photo_version, to_char(st.created_at, 'YYYY-MM') AS created_month,
    st.status, st.start_date::text, st.end_date::text, st.free, st.discount::float8 AS discount, st.discount_reason, st.no_sibling`;
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
      `SELECT p.id, p.student_id, p.month, p.amount::float8 AS amount, p.paid_on::text, p.method, p.note, p.receipt_no, p.edited_at IS NOT NULL AS edited,
         u.full_name AS recorded_by_name
       FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
       WHERE p.student_id = ANY($1::int[]) ORDER BY p.paid_on DESC, p.id DESC`,
      [ids]
    );

  // ---------- العائلة: تخفيض الإخوة ومعلوم التسجيل السنوي ----------
  // الشخص: s<id> لتلميذ الدعم (وطفل التربوي المرتبط به)، c<id> لطفل التربوي وحده
  // تُحمَّل مرة واحدة في كل طلب، ثم fees.student(...) و fees.child(...) تحسب الوضعية المالية
  async function feeTools() {
    const family = await getSetting('family_discounts', {});
    const regFees = await getSetting('registration_fees', {});
    const enrollments = await all(
      `SELECT 's' || st.id AS person, st.parent_id, st.status, st.free,
         COALESCE(st.start_date::text, COALESCE(st.billing_start, to_char(st.created_at, 'YYYY-MM')) || '-01') AS start,
         st.end_date::text AS end_date
       FROM students st
       UNION ALL
       SELECT CASE WHEN c.student_id IS NULL THEN 'c' || c.id ELSE 's' || c.student_id END, COALESCE(sl.parent_id, c.parent_id),
         CASE WHEN c.status = 'left' THEN 'left' ELSE 'studying' END, c.free,
         COALESCE(c.start_date::text, to_char(c.created_at, 'YYYY-MM') || '-01'), c.end_date::text
       FROM program_children c LEFT JOIN students sl ON sl.id = c.student_id`
    );
    const periods = enrollments
      .filter((e) => e.status !== 'waiting')
      .map((e) => ({
        ...e,
        from: e.start.slice(0, 7),
        to: ['left', 'stopped'].includes(e.status) && e.end_date ? e.end_date.slice(0, 7) : '9999-12',
      }));
    const byParent = new Map();
    for (const e of periods) {
      if (!e.parent_id || e.free) continue;
      if (!byParent.has(e.parent_id)) byParent.set(e.parent_id, []);
      byParent.get(e.parent_id).push(e);
    }
    const two = Number(family.two) || 0;
    const three = Number(family.three) || two;
    // عدد الأبناء (أشخاص مختلفون) المسجّلين في ذلك الشهر في أي برنامج
    const siblingPct = (parentId) => {
      const members = byParent.get(parentId);
      if (!members || !two) return undefined;
      return (m) => {
        const n = new Set(members.filter((e) => e.from <= m && m <= e.to).map((e) => e.person)).size;
        return n >= 3 ? three : n === 2 ? two : 0;
      };
    };
    const regPayments = await all(
      `SELECT r.id, r.school_year, r.amount::float8 AS amount, r.paid_on::text, r.method, r.note, r.receipt_no,
         CASE WHEN r.student_id IS NOT NULL THEN 's' || r.student_id
              WHEN c.student_id IS NOT NULL THEN 's' || c.student_id ELSE 'c' || r.child_id END AS person
       FROM registration_payments r LEFT JOIN program_children c ON c.id = r.child_id ORDER BY r.paid_on DESC, r.id DESC`
    );
    const currentYear = schoolYearOf(currentMonth());
    // المعلوم مرة واحدة في كل سنة دراسية سُجّل فيها الطفل (في برنامج أو أكثر)
    const registration = (person) => {
      const mine = periods.filter((e) => e.person === person && !e.free);
      const years = new Map();
      for (const [year, amount] of Object.entries(regFees)) {
        const due = Number(amount) || 0;
        if (!due || year > currentYear) continue;
        const [y1] = year.split('-');
        if (mine.some((e) => e.from <= `${Number(y1) + 1}-08` && `${y1}-09` <= e.to)) years.set(year, { school_year: year, due, paid: 0, payments: [] });
      }
      for (const p of regPayments.filter((x) => x.person === person)) {
        if (!years.has(p.school_year)) years.set(p.school_year, { school_year: p.school_year, due: 0, paid: 0, payments: [] });
        const y = years.get(p.school_year);
        y.paid = round3(y.paid + p.amount);
        y.payments.push(p);
      }
      return [...years.values()]
        .map((y) => ({ ...y, remaining: round3(Math.max(y.due - y.paid, 0)) }))
        .sort((a, b) => b.school_year.localeCompare(a.school_year));
    };
    const adjRows = await all(
      `SELECT id, student_id, child_id, month, kind, value::float8 AS value, reason FROM fee_adjustments`
    );
    const extraRows = await all(`SELECT id, student_id, child_id, month, amount::float8 AS amount, reason FROM fee_extras`);
    const histRows = await all(`SELECT student_id, child_id, upto_month, monthly_fee::float8 AS monthly_fee, discount::float8 AS discount FROM fee_history`);
    return {
      student: (st, payments) =>
        computeFinance(st, payments, {
          // «بدون تخفيض الإخوة»: يبقى محسوبًا ضمن الإخوة، لكن لا تخفيض عليه هو
          siblingPct: st.no_sibling ? undefined : siblingPct(st.parent_id),
          // معلوم التسجيل لم يعد منفصلًا: يُضاف يدويًا إلى أول شهر (زيادات الشهر)
          adjustments: adjRows.filter((a) => a.student_id === st.id),
          extras: extraRows.filter((a) => a.student_id === st.id),
          history: histRows.filter((h) => h.student_id === st.id),
        }),
      // طفل مرتبط بتلميذ دعم: معلوم التسجيل في ملف الدعم
      child: (c, payments) =>
        computeFinance({ ...c, status: c.status === 'left' ? 'left' : 'studying' }, payments, {
          skip: PROGRAM_SKIP,
          siblingPct: siblingPct(c.family_parent_id),
          adjustments: adjRows.filter((a) => a.child_id === c.id),
          extras: extraRows.filter((a) => a.child_id === c.id),
          history: histRows.filter((h) => h.child_id === c.id),
        }),
      currentYear,
      regFee: 0,
    };
  }

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
    if (user.role === 'teacher' && !(await teaches(user.id, subject.id, student.level))) {
      throw new HttpError(403, 'هذه المادة ليست من موادك في هذا المستوى');
    }
    const enrolled = await studentSubjects(student);
    if (enrolled.length && !enrolled.some((s) => s.id === subject.id)) {
      throw new HttpError(400, 'التلميذ غير مسجّل في هذه المادة');
    }
    return subject.id;
  }

  // تسمية نوع الحساب: المدير، الإدارة، شريك…، معلم، مؤطّر، ولي
  async function roleLabel(u) {
    if (u.role === 'admin') {
      if (u.super_admin) return 'المدير';
      const k = u.permissions?.role;
      if (k) return (await getSetting('admin_roles', DEFAULT_ROLES)).find((r) => r.key === k)?.name || 'الإدارة';
      return 'الإدارة';
    }
    if (u.role === 'teacher') return u.program_staff ? 'مؤطّر' : u.also_program ? 'معلم · مؤطّر' : 'معلم';
    return 'ولي';
  }
  async function userWithExtras(id) {
    const user = await userById(id);
    if (!user) return null;
    if (user.role === 'teacher') {
      user.subjects = await teacherSubjects(id);
      user.program_classes = (await one('SELECT COUNT(*)::int AS n FROM program_classes WHERE teacher_id = $1', [id])).n;
    }
    if (user.role === 'parent') {
      user.children = await all('SELECT id, full_name, level, status FROM students WHERE parent_id = $1 ORDER BY full_name', [id]);
      // كل أبنائه في انتظار تفعيل الإدارة (ولا طفل في البرنامج التربوي): المنصة تفتح لكن لا يرى شيئًا بعد
      const kids = (await one(`SELECT COUNT(*)::int AS n FROM program_children WHERE parent_id = $1 AND status = 'active'`, [id])).n;
      user.waiting = user.children.length > 0 && user.children.every((c) => c.status === 'waiting') && !kids;
    }
    if (user.role === 'admin') user.perms = permsOf(user);
    user.role_label = await roleLabel(user);
    if (featureGroups(user).length) {
      const rf = await roleFeatures();
      user.features = Object.assign({}, ...featureGroups(user).map((g) => Object.fromEntries(Object.entries(rf[g]).map(([k, v]) => [`${g}.${k}`, v]))));
    }
    return user;
  }

  // من يعدّل الحسابات: الإداريون للمشرف العام فقط، والمدرّسون لمن له صلاحية «الحسابات»، والأولياء للجميع
  const guardAccount = (actor, role) => {
    if (actor.super_admin) return;
    if (role === 'admin') throw new HttpError(403, 'حسابات الإدارة للمشرف العام فقط');
    if (role === 'teacher' && !permsOf(actor).accounts) throw new HttpError(403, `ليس لديك صلاحية: ${PERMISSIONS.accounts}`);
  };

  // مرافق البرنامج التربوي: أجرة شهرية، بلا مواد ولا مستويات ولا معلوم ساعة
  async function setProgramStaff(userId, body) {
    // متطوّع: بلا أجرة
    const vol = !!body.volunteer;
    await pool.query(`UPDATE users SET program_staff = true, hourly_rate = NULL, monthly_salary = $1, pay_per_child = $2, volunteer = $3 WHERE id = $4`, [
      vol ? null : money(body.monthly_salary, 'الأجرة الشهرية'),
      vol ? null : money(body.pay_per_child, 'المبلغ عن كل طفل'),
      vol,
      userId,
    ]);
    await pool.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [userId]);
  }

  // subjectLevels: { [subject_id]: ['5', '6'] } — مستويات المعلم في كل مادة (غائب أو فارغ = الكل)
  async function setTeacherSubjects(userId, subjectIds, subjectLevels = {}) {
    if (!Array.isArray(subjectIds)) return;
    await pool.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [userId]);
    for (const id of subjectIds.map(Number).filter(Number.isInteger)) {
      await pool.query(
        `INSERT INTO teacher_subjects (teacher_id, subject_id, levels)
         SELECT $1, id, $3 FROM subjects WHERE id = $2 ON CONFLICT DO NOTHING`,
        [userId, id, levelsList(subjectLevels?.[id])]
      );
    }
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
      text(body.discount_reason, { max: 200, name: 'سبب التخفيض' }), !!body.no_sibling];
  }

  const routes = [];
  const route = (method, path, roles, handler) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '(\\d{1,9})')) + '$');
    routes.push({ method, path, re, keys, roles, handler });
  };
  const ANY = []; // أي مستخدم مسجّل

  // ---------- المصادقة ----------
  route('POST', '/api/login', null, async ({ body, setSession }) => {
    // النسخ واللصق (من واتساب مثلًا) يجلب أحيانًا فراغات وعلامات اتجاه خفية: تُحذف
    const username = cleanCredential(text(body.username, { required: true, name: 'اسم المستخدم' }));
    const row = await one(
      'SELECT id, password_hash, approved FROM users WHERE lower(username) = lower($1) OR cin = $1 ORDER BY id LIMIT 1',
      [username]
    );
    const raw = String(body.password ?? '');
    if (!row || !(verifyPassword(raw, row.password_hash) || verifyPassword(cleanCredential(raw), row.password_hash))) {
      throw new HttpError(401, 'اسم المستخدم أو كلمة السر غير صحيحة');
    }
    if (!row.approved) throw new HttpError(403, 'حسابك في انتظار موافقة إدارة فيد');
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
    await pool.query(
      `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
      [token, row.id, SESSION_TTL_S]
    );
    setSession(token, SESSION_TTL_S);
    await pool.query('UPDATE users SET last_seen = now() WHERE id = $1', [row.id]);
    return { user: await userWithExtras(row.id) };
  });

  route('POST', '/api/logout', null, async ({ token, setSession }) => {
    if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    setSession('', 0);
    return { ok: true };
  });

  route('GET', '/api/me', ANY, async ({ user }) => ({ user: { ...(await userWithExtras(user.id)), impersonated_by: user.impersonated_by || null } }));

  // تجربة الواجهة: المدير يفتح التطبيقة بحساب آخر، للاطّلاع فقط (كل تعديل مرفوض)
  route('GET', '/api/impersonate/accounts', ['admin'], async ({ user }) => {
    if (!user.super_admin) throw new HttpError(403, 'للمدير فقط');
    const rows = await all(
      `SELECT u.id, u.full_name, u.role, u.program_staff, u.also_program, u.permissions,
         (SELECT COUNT(*)::int FROM students s WHERE s.parent_id = u.id) AS kids
       FROM users u WHERE u.approved AND NOT u.super_admin ORDER BY u.full_name`
    );
    const roles = await getSetting('admin_roles', DEFAULT_ROLES);
    return {
      accounts: rows.map((u) => ({
        id: u.id, full_name: u.full_name, kids: u.kids,
        type: u.role === 'admin' ? (u.permissions?.role || 'admin') : u.role === 'teacher' ? (u.program_staff ? 'program_staff' : 'teacher') : 'parent',
      })),
      types: [...roles.map((r) => ({ key: r.key, name: r.name })), { key: 'teacher', name: 'معلم' }, { key: 'program_staff', name: 'مؤطّر' }, { key: 'parent', name: 'ولي' }],
    };
  });
  route('POST', '/api/impersonate', ['admin'], async ({ user, body, setSession }) => {
    if (!user.super_admin || user.impersonated_by) throw new HttpError(403, 'للمدير فقط');
    const target = await userById(Number(body.user_id));
    if (!target || target.super_admin || !target.approved) throw new HttpError(404, 'الحساب غير موجود');
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (token, user_id, expires_at, impersonator_id) VALUES ($1, $2, now() + interval '3 hours', $3)`,
      [token, target.id, user.id]
    );
    setSession(token, 3 * 3600);
    return { ok: true };
  });
  route('POST', '/api/impersonate/stop', ANY, async ({ user, token, setSession }) => {
    if (!user.impersonated_by) throw new HttpError(400, 'لست في وضع التجربة');
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    const fresh = crypto.randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`, [fresh, user.impersonated_by, SESSION_TTL_S]);
    setSession(fresh, SESSION_TTL_S);
    return { ok: true };
  });

  route('POST', '/api/me/password', ANY, async ({ user, body, token }) => {
    const row = await one('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!verifyPassword(String(body.current ?? ''), row.password_hash) && !verifyPassword(cleanCredential(body.current), row.password_hash)) {
      throw new HttpError(400, 'كلمة السر الحالية غير صحيحة');
    }
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password(body.next)), user.id]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [user.id, token]);
    return { ok: true };
  });

  // الأقسام (المستويات): من الإعدادات، مع تحديث كل 15 ثانية حتى تتوافق كل نسخ الخادم
  let levelsAt = 0;
  async function loadLevels(force = false) {
    if (!force && Date.now() - levelsAt < 15000) return;
    levelsAt = Date.now();
    const saved = await getSetting('levels', null);
    setLevels(Array.isArray(saved) && saved.length ? saved : DEFAULT_LEVELS);
  }
  route('GET', '/api/levels', ['admin'], async () => {
    const counts = await all(`SELECT level, COUNT(*)::int AS n FROM students WHERE status <> 'left' GROUP BY level`);
    return { levels: LEVELS.map((l) => ({ ...l, students: counts.find((c) => c.level === l.code)?.n || 0 })) };
  });
  route('PUT', '/api/levels', ['admin'], async ({ body }) => {
    const seen = new Set();
    const list = (Array.isArray(body.levels) ? body.levels : []).slice(0, 40).map((l, i) => {
      const label = text(l.label, { required: true, max: 60, name: 'اسم القسم' });
      let code = String(l.code || '').trim().slice(0, 20);
      if (!code) code = `L${Date.now().toString(36)}${i}`;
      if (!/^[\w-]+$/.test(code)) throw new HttpError(400, `رمز القسم «${code}» غير صالح (حروف لاتينية وأرقام فقط)`);
      if (seen.has(code)) throw new HttpError(400, `الرمز «${code}» مكرّر`);
      seen.add(code);
      return { code, label };
    });
    if (!list.length) throw new HttpError(400, 'لازم قسم واحد على الأقل');
    // قسم فيه تلاميذ (أو حصص) لا يُحذف
    for (const old of LEVELS.filter((l) => !seen.has(l.code))) {
      const used = await one(
        `SELECT (SELECT COUNT(*)::int FROM students WHERE level = $1) AS st, (SELECT COUNT(*)::int FROM timetable WHERE level = $1 AND valid_to IS NULL) AS tt`,
        [old.code]
      );
      if (used.st || used.tt) throw new HttpError(409, `لا يمكن حذف «${old.label}»: فيه ${used.st} تلميذ و${used.tt} حصة. انقلهم لقسم آخر أولًا.`);
    }
    await saveSetting('levels', list);
    await loadLevels(true);
    return { levels: LEVELS };
  });

  route('GET', '/api/meta', ANY, async ({ user }) => ({
    ...(user.role === 'admin'
      ? { pricing: await getSetting('support_pricing', DEFAULT_PRICING), pack_fees: await getSetting('support_fees', {}) }
      : {}),
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
    // كل الحسابات مع تفاصيلها في 4 استعلامات فقط (بدل استعلامين لكل حساب)
    const users = await all(
      `SELECT id, username, full_name, role, phone, cin, email, address, hourly_rate::float8 AS hourly_rate, approved,
         program_staff, also_program, volunteer, last_seen, linked_parent_id, monthly_salary::float8 AS monthly_salary, pay_per_child::float8 AS pay_per_child, super_admin
       FROM users ${role ? 'WHERE role = $1' : ''} ORDER BY role, full_name`,
      role ? [role] : []
    );
    if (!role || role === 'teacher') {
      const subs = await all(
        `SELECT ts.teacher_id, s.id, s.name, s.levels, ts.levels AS teach_levels FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id ORDER BY s.id`
      );
      const classes = await all(`SELECT teacher_id, COUNT(*)::int AS n FROM program_classes WHERE teacher_id IS NOT NULL GROUP BY teacher_id`);
      for (const u of users.filter((x) => x.role === 'teacher')) {
        u.subjects = subs.filter((s) => s.teacher_id === u.id).map(({ teacher_id, ...s }) => s);
        u.program_classes = classes.find((c) => c.teacher_id === u.id)?.n || 0;
      }
    }
    if (!role || role === 'parent') {
      const kids = await all(`SELECT id, full_name, level, parent_id FROM students WHERE parent_id IS NOT NULL ORDER BY full_name`);
      const pkids = await all(
        `SELECT c.id, c.full_name, c.parent_id, k.name AS class_name FROM program_children c LEFT JOIN program_classes k ON k.id = c.class_id
         WHERE c.parent_id IS NOT NULL AND c.student_id IS NULL AND c.status = 'active' ORDER BY c.full_name`
      );
      for (const u of users.filter((x) => x.role === 'parent')) {
        u.children = kids.filter((k) => k.parent_id === u.id).map(({ parent_id, ...k }) => k);
        u.program_children = pkids.filter((k) => k.parent_id === u.id).map(({ parent_id, ...k }) => k);
      }
    }
    return { users };
  });

  // الصلاحيات: المشرف العام يحدّد ما يراه ويفعله كل إداري
  route('GET', '/api/permissions', ['admin'], async ({ user }) => {
    if (!user.super_admin) throw new HttpError(403, 'هذه الصفحة للمشرف العام فقط');
    const admins = await all(`SELECT id, username, full_name, email, google_email, super_admin, permissions, approved FROM users WHERE role = 'admin' ORDER BY super_admin DESC, id`);
    const roles = await getSetting('admin_roles', DEFAULT_ROLES);
    return { permissions: PERMISSIONS, defaults: DEFAULT_PERMISSIONS, roles, admins: admins.map((a) => ({ ...a, perms: permsOf(a), role_key: a.permissions?.role || null })) };
  });
  // الأدوار: قائمة كاملة (إضافة / تعديل / حذف). تعديل صلاحيات دور يُطبَّق على كل حساباته
  route('PUT', '/api/roles', ['admin'], async ({ user, body }) => {
    if (!user.super_admin) throw new HttpError(403, 'هذه الصفحة للمشرف العام فقط');
    const seen = new Set();
    const roles = (Array.isArray(body.roles) ? body.roles : []).slice(0, 20).map((r, i) => {
      const name = text(r.name, { required: true, max: 40, name: 'اسم الدور' });
      let key = String(r.key || '').replace(/[^a-z0-9_]/g, '').slice(0, 30) || `role${Date.now().toString(36)}${i}`;
      if (seen.has(key)) key += i;
      seen.add(key);
      return { key, name, perms: Object.fromEntries(Object.keys(PERMISSIONS).map((k) => [k, !!r.perms?.[k]])) };
    });
    if (!roles.length) throw new HttpError(400, 'لازم دور واحد على الأقل');
    await saveSetting('admin_roles', roles);
    // حسابات كل دور تأخذ صلاحياته الجديدة؛ حسابات دور محذوف تبقى بصلاحياتها (بلا دور)
    const admins = await all(`SELECT id, permissions FROM users WHERE role = 'admin' AND NOT super_admin`);
    for (const a of admins) {
      const k = a.permissions?.role;
      if (!k) continue;
      const r = roles.find((x) => x.key === k);
      const next = r ? { ...r.perms, role: k } : { ...a.permissions, role: null };
      await pool.query('UPDATE users SET permissions = $1 WHERE id = $2', [JSON.stringify(next), a.id]);
    }
    return { roles };
  });
  route('PUT', '/api/users/:id/permissions', ['admin'], async ({ user, params, body }) => {
    if (!user.super_admin) throw new HttpError(403, 'هذه الصفحة للمشرف العام فقط');
    const target = await userById(params.id);
    if (!target || target.role !== 'admin') throw new HttpError(404, 'الإداري غير موجود');
    if (target.super_admin) throw new HttpError(400, 'المشرف العام له كل الصلاحيات');
    // دور جاهز (صلاحياته من الدور) أو صلاحيات مخصّصة
    const roles = await getSetting('admin_roles', DEFAULT_ROLES);
    const role = body.role ? roles.find((r) => r.key === body.role) : null;
    if (body.role && !role) throw new HttpError(400, 'الدور غير موجود');
    const perms = role ? { ...role.perms, role: role.key } : { ...Object.fromEntries(Object.keys(PERMISSIONS).map((k) => [k, !!body.perms?.[k]])), role: null };
    await pool.query('UPDATE users SET permissions = $1 WHERE id = $2', [JSON.stringify(perms), target.id]);
    return { perms };
  });

  route('POST', '/api/users', ['admin'], async ({ body, user }) => {
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'الدور غير صالح');
    guardAccount(user, body.role);
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
    if (body.role === 'teacher') {
      if (body.program_staff) await setProgramStaff(id, body);
      else await setTeacherSubjects(id, body.subject_ids, body.subject_levels);
    }
    return [201, { user: await userWithExtras(id) }];
  });

  // كلمة سر أوّلية جديدة (تُرسَل للشخص عبر واتساب): سهلة القراءة، دون حروف متشابهة
  route('POST', '/api/users/:id/new-password', ['admin'], async ({ params, user }) => {
    const target = await userById(params.id);
    if (!target) throw new HttpError(404, 'المستخدم غير موجود');
    if (target.id !== user.id) guardAccount(user, target.role);
    if (target.super_admin && !user.super_admin) throw new HttpError(403, 'ليس لديك صلاحية');
    const letters = 'abcdefghjkmnpqrstuvwxyz';
    const pick = (set, n) => Array.from(crypto.randomBytes(n), (b) => set[b % set.length]).join('');
    const pw = `feed${pick(letters, 2)}${pick('23456789', 4)}`;
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(pw), target.id]);
    // الجلسات القديمة تنتهي: الدخول بكلمة السر الجديدة
    if (target.id !== user.id) await pool.query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    return { username: target.username, password: pw, full_name: target.full_name, phone: target.phone, role: target.role };
  });

  route('PUT', '/api/users/:id', ['admin'], async ({ params, body, user }) => {
    const existing = await userById(params.id);
    if (!existing) throw new HttpError(404, 'المستخدم غير موجود');
    if (existing.id !== user.id) guardAccount(user, existing.role);
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
    if (existing.role === 'teacher') {
      if (body.program_staff ?? existing.program_staff) await setProgramStaff(params.id, body);
      else await setTeacherSubjects(params.id, body.subject_ids, body.subject_levels);
    }
    return { user: await userWithExtras(params.id) };
  });

  route('DELETE', '/api/users/:id', ['admin'], async ({ params, user }) => {
    if (params.id === user.id) throw new HttpError(400, 'لا يمكنك حذف حسابك');
    const target = await userById(params.id);
    if (target) guardAccount(user, target.role);
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'المستخدم غير موجود');
    return { ok: true };
  });

  // ---------- التلاميذ ----------
  // قائمة المعلم: التلاميذ الذين يدرسون في إحدى مواده ومستوياته (أو لم تُحدَّد موادهم بعد)
  const teacherStudentsSql = (t) => `st.status = 'studying' AND (
        ((st.pack OR NOT EXISTS (SELECT 1 FROM student_subjects x WHERE x.student_id = st.id))
          AND EXISTS (SELECT 1 FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
                      WHERE ts.teacher_id = ${t} AND (s.levels IS NULL OR st.level = ANY(s.levels))
                        AND (ts.levels IS NULL OR st.level = ANY(ts.levels))))
        OR EXISTS (SELECT 1 FROM student_subjects x JOIN teacher_subjects ts ON ts.subject_id = x.subject_id
                   WHERE x.student_id = st.id AND ts.teacher_id = ${t} AND (ts.levels IS NULL OR st.level = ANY(ts.levels))))`;

  route('GET', '/api/students', ANY, async ({ user, query }) => {
    const where = [];
    const params = [];
    const add = (cond, value) => {
      params.push(value);
      where.push(cond.replace('?', `$${params.length}`));
    };
    if (user.role === 'parent') add('st.parent_id = ?', user.id);
    if (user.role === 'teacher') {
      params.push(user.id);
      where.push(teacherStudentsSql(`$${params.length}`));
    }
    if (STATUSES.includes(query.get('status'))) add('st.status = ?', query.get('status'));
    if (LEVEL_CODES.includes(query.get('level'))) add('st.level = ?', query.get('level'));
    if (query.get('q')?.trim()) add('st.full_name ILIKE ?', `%${query.get('q').trim()}%`);
    const students = await all(
      `SELECT ${STUDENT_COLUMNS},
         p.full_name AS parent_name, ${user.role === 'parent' ? 'NULL' : 'p.phone'} AS parent_phone,
         (SELECT array_agg(sb.name ORDER BY sb.id) FROM student_subjects ss JOIN subjects sb ON sb.id = ss.subject_id
           WHERE ss.student_id = st.id) AS subject_names,
         (SELECT array_agg(ss.subject_id) FROM student_subjects ss WHERE ss.student_id = st.id) AS subject_ids,
         (SELECT COUNT(*)::int FROM absences a WHERE a.student_id = st.id) AS absence_count,
         (SELECT COUNT(*)::int FROM absences a WHERE a.student_id = st.id AND NOT a.justified) AS unjustified_count,
         (SELECT COUNT(*)::int FROM notes n WHERE n.student_id = st.id
           ${user.role === 'parent' ? 'AND n.visible_to_parent' : ''}) AS note_count
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
      const fees = await feeTools();
      for (const st of students) {
        st.balance = fees.student(st, payments.filter((p) => p.student_id === st.id)).balance;
      }
    }
    return { students };
  });

  // معلوم التسجيل (40 افتراضيًا) مع أول شهر لكل تلميذ أو طفل جديد، والإدارة تعدّله (معفى، 10، 30…)
  async function addRegistration(col, id, startDate, free) {
    if (free) return;
    const amount = Number(await getSetting('registration_default', 40)) || 0;
    if (!amount) return;
    const month = (startDate || today()).slice(0, 7);
    await pool.query(
      `INSERT INTO fee_extras (${col}, month, amount, reason) SELECT $1, $2, $3, 'معلوم التسجيل'
       WHERE NOT EXISTS (SELECT 1 FROM fee_extras WHERE ${col} = $1 AND reason LIKE '%تسجيل%')`,
      [id, month, amount]
    );
  }

  route('POST', '/api/students', ['admin'], async ({ body }) => {
    const values = await readStudentBody(body);
    const { id } = await one(
      `INSERT INTO students (full_name, level, group_name, birth_date, parent_id, city, school, remarks,
         address, pack, monthly_fee, status, start_date, end_date, free, discount, discount_reason, no_sibling)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
      values
    );
    await setStudentSubjects(id, body.subject_ids);
    // تلميذ قادم من البرنامج التربوي: يُربط بالطفل، ومعلوم التسجيل دفعه هناك
    const fromChild = Number(body.from_child_id) || null;
    const linked = fromChild
      ? (await pool.query('UPDATE program_children SET student_id = $1 WHERE id = $2 AND student_id IS NULL', [id, fromChild])).rowCount
      : 0;
    if (!linked) await addRegistration('student_id', id, values[12], values[14]);
    return [201, { student: await getStudent(id) }];
  });

  // تغيير سريع لحالة التلميذ (يدرس / في الانتظار / خرج / متوقف)
  route('PATCH', '/api/students/:id/status', ['admin'], async ({ params, body }) => {
    if (!STATUSES.includes(body.status)) throw new HttpError(400, 'حالة غير صحيحة');
    const ending = ['left', 'stopped'].includes(body.status);
    const endDate = ending ? (/^\d{4}-\d{2}-\d{2}$/.test(body.end_date || '') ? body.end_date : today()) : null;
    const prev = await one('SELECT status FROM students WHERE id = $1', [params.id]);
    const row = await one(
      `UPDATE students SET status = $1, end_date = $2,
         start_date = CASE WHEN $1 = 'studying' AND start_date IS NULL THEN CURRENT_DATE ELSE start_date END
       WHERE id = $3 RETURNING id`,
      [body.status, endDate, params.id]
    );
    if (!row) throw new HttpError(404, 'التلميذ غير موجود');
    // تفعيل تسجيل كان في الانتظار: معلوم التسجيل يُطلب في الشهر الأول
    if (body.status === 'studying' && prev?.status === 'waiting') {
      const st = await one('SELECT start_date::text, free FROM students WHERE id = $1', [params.id]);
      await addRegistration('student_id', Number(params.id), st.start_date, st.free);
    }
    return { student: await getStudent(params.id) };
  });

  // تغيير المعلوم ابتداءً من شهر: الأشهر قبله تحتفظ بالمعلوم الذي كان يُطبَّق عليها.
  // from = 'all' ← تصحيح: المعلوم الجديد على كل الأشهر (يُمسح التاريخ)
  async function recordFeeChange(col, id, before, after, from) {
    const same = (a, b) => Number(a.monthly_fee || 0) === Number(b.monthly_fee || 0) && Number(a.discount || 0) === Number(b.discount || 0);
    const changed = !same(before, after);
    if (!changed) return;
    if (from === 'all') return void (await pool.query(`DELETE FROM fee_history WHERE ${col} = $1`, [id]));
    const start = MONTH_RE.test(from || '') ? from : currentMonth();
    const [y, mo] = start.split('-').map(Number);
    const upto = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
    const rows = await all(`SELECT upto_month, monthly_fee::float8 AS monthly_fee, discount::float8 AS discount FROM fee_history WHERE ${col} = $1 ORDER BY upto_month`, [id]);
    const cur = rows.find((r) => r.upto_month >= upto) || before;
    await pool.query(`DELETE FROM fee_history WHERE ${col} = $1 AND upto_month >= $2`, [id, upto]);
    if (same(cur, after)) return;
    await pool.query(`INSERT INTO fee_history (${col}, upto_month, monthly_fee, discount) VALUES ($1, $2, $3, $4)`, [id, upto, cur.monthly_fee ?? null, cur.discount ?? null]);
  }

  route('PUT', '/api/students/:id', ['admin'], async ({ params, body }) => {
    const before = await getStudent(params.id);
    if (!before) throw new HttpError(404, 'التلميذ غير موجود');
    const values = await readStudentBody(body);
    await recordFeeChange('student_id', Number(params.id), before, { monthly_fee: values[10], discount: values[15] }, body.fee_from);
    await pool.query(
      `UPDATE students SET full_name = $1, level = $2, group_name = $3, birth_date = $4, parent_id = $5,
         city = $6, school = $7, remarks = $8, address = $9, pack = $10, monthly_fee = $11, status = $12,
         start_date = $13, end_date = $14, free = $15, discount = $16, discount_reason = $17, no_sibling = $18
       WHERE id = $19`,
      [...values, params.id]
    );
    await setStudentSubjects(params.id, body.subject_ids);
    if (before.status === 'waiting' && values[11] === 'studying') await addRegistration('student_id', Number(params.id), values[12], values[14]);
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
    return [201, await importStudentRows(rows)];
  });

  // إضافة قائمة تلاميذ مع حسابات أوليائهم (الإخوة تحت نفس الحساب)؛ التلميذ الموجود (نفس الاسم والمستوى) لا يُكرَّر
  async function importStudentRows(rows) {
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
      return {
        created_students: toInsert.length,
        skipped,
        parents: newParents.map(({ id, ...p }) => p),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------- التسجيل المباشر للأولياء (رابط عمومي) ----------
  route('GET', '/api/public/meta', null, async () => ({
    levels: LEVELS,
    subjects: await all('SELECT id, name, levels FROM subjects ORDER BY id'),
    pricing: await getSetting('support_pricing', DEFAULT_PRICING),
    pack_fees: await getSetting('support_fees', {}),
  }));

  // السعر حسب التسعيرة (نفس حساب الواجهة): عدد الحصص الأسبوعية للمواد المختارة، أو الباقة
  async function priceFor(level, pack, subjectIds) {
    const pr = await getSetting('support_pricing', DEFAULT_PRICING);
    const packFee = Number((await getSetting('support_fees', {}))?.[level]) || null;
    if (!pr) return null;
    if (pack) return packFee;
    const subs = await all('SELECT id, levels FROM subjects WHERE id = ANY($1::int[])', [subjectIds]);
    const valid = subs.filter((x) => !x.levels || x.levels.includes(level));
    if (!valid.length) return null;
    const n = valid.reduce((t, x) => t + (Number(pr.units?.[x.id]) || 1), 0);
    const step = n >= 4 ? packFee : Number(pr.steps?.[String(n)]) || null;
    return packFee && step ? Math.min(step, packFee) : step || packFee;
  }

  route('POST', '/api/register', null, async ({ body, setSession }) => {
    if (body.website) throw new HttpError(400, 'طلب غير صالح'); // حقل مخفي ضد الروبوتات
    if (body.role === 'teacher') return registerTeacher(body.teacher || {});
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
        const fee = await priceFor(k.level, k.pack, k.subjectIds);
        const { id } = (
          await client.query(
            `INSERT INTO students (full_name, level, birth_date, school, address, pack, remarks, parent_id, status, monthly_fee)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'waiting', $9) RETURNING id`,
            [k.name, k.level, k.birthDate, k.school, address, k.pack, k.remarks, parentId, fee]
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

  // المعلم يسجّل نفسه: الحساب لا يعمل حتى توافق الإدارة وتحدّد موادّه
  async function registerTeacher(t) {
    const fullName = text(t.full_name, { required: true, max: 120, name: 'الاسم' });
    const phone = text(t.phone, { required: true, max: 30, name: 'الهاتف' });
    const username = phoneKey(phone);
    if (!username) throw new HttpError(400, 'رقم الهاتف غير صالح');
    const email = text(t.email, { max: 120, name: 'البريد الإلكتروني' });
    const hash = await hashPasswordAsync(password(t.password));
    if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) {
      throw new HttpError(409, 'رقم الهاتف مسجّل مسبقًا، ادخل بحسابك أو اتصل بالإدارة');
    }
    const { id } = await one(
      `INSERT INTO users (username, password_hash, full_name, role, phone, email, approved)
       VALUES ($1, $2, $3, 'teacher', $4, $5, false) RETURNING id`,
      [username, hash, fullName, phone, email]
    );
    await setTeacherSubjects(id, Array.isArray(t.subject_ids) ? t.subject_ids : []);
    return [201, { pending: true, username }];
  }

  // ---------- الدخول بحساب Google (الأولياء) ----------
  const newSession = async (userId, setSession) => {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
      [token, userId, SESSION_TTL_S]
    );
    setSession(token, SESSION_TTL_S);
  };

  route('GET', '/api/auth/config', null, async () => ({ google_client_id: googleClientId || null }));

  route('POST', '/api/auth/google', null, async ({ body, setSession }) => {
    if (!googleClientId) throw new HttpError(400, 'الدخول بـ Google غير مفعّل');
    const g = await verifyGoogle(String(body.credential || '')).catch((err) => {
      throw err instanceof HttpError ? err : new HttpError(401, 'تعذّر التحقق من حساب Google');
    });
    const known = await one('SELECT id, approved FROM users WHERE google_sub = $1', [g.sub]);
    if (known) {
      if (!known.approved) throw new HttpError(403, 'حسابك موقوف، اتصل بإدارة فيد');
      await pool.query('UPDATE users SET google_email = $1 WHERE id = $2', [g.email, known.id]);
      await newSession(known.id, setSession);
      return { user: await userWithExtras(known.id) };
    }
    // حساب الإدارة الذي بريده الإلكتروني هو نفس بريد Google يُربط مباشرة (أول دخول)
    const adminByEmail = await one(
      `SELECT id FROM users WHERE role = 'admin' AND approved AND google_sub IS NULL AND lower(email) = lower($1) ORDER BY id LIMIT 1`,
      [g.email]
    );
    if (adminByEmail) {
      await pool.query('UPDATE users SET google_sub = $1, google_email = $2 WHERE id = $3', [g.sub, g.email, adminByEmail.id]);
      await newSession(adminByEmail.id, setSession);
      return { user: await userWithExtras(adminByEmail.id) };
    }
    // حساب جديد: «تذكرة» تسمح فقط بالبحث عن الأبناء وإرسال الطلب للإدارة
    const ticket = crypto.randomBytes(24).toString('hex');
    const req = await one(
      `INSERT INTO parent_requests (ticket, google_sub, google_email, google_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_sub) DO UPDATE SET ticket = EXCLUDED.ticket, google_email = EXCLUDED.google_email,
         google_name = EXCLUDED.google_name
       RETURNING status, full_name, phone`,
      [ticket, g.sub, g.email, g.name]
    );
    return { link_required: true, ticket, name: req.full_name || g.name, email: g.email, phone: req.phone, status: req.status };
  });

  const ticketRequest = async (ticket) => {
    const req = ticket && (await one(`SELECT * FROM parent_requests WHERE ticket = $1`, [String(ticket)]));
    if (!req || req.status === 'approved') throw new HttpError(401, 'انتهت الجلسة، أعد الدخول بـ Google');
    return req;
  };

  // بحث محدود: الاسم الكامل والمستوى فقط، 3 حروف على الأقل، 6 نتائج
  route('GET', '/api/auth/google/children', null, async ({ query }) => {
    await ticketRequest(query.get('ticket'));
    const q = (query.get('q') || '').trim();
    if (q.length < 3) return { children: [] };
    const like = `%${q}%`;
    const children = await all(
      `(SELECT 'student' AS type, id, full_name, level, NULL AS class_name FROM students
         WHERE status <> 'left' AND full_name ILIKE $1)
       UNION ALL
       (SELECT 'child', c.id, c.full_name, NULL, pc.name FROM program_children c
         LEFT JOIN program_classes pc ON pc.id = c.class_id
         WHERE c.student_id IS NULL AND c.status <> 'left' AND c.full_name ILIKE $1)
       ORDER BY full_name LIMIT 6`,
      [like]
    );
    return { children };
  });

  route('POST', '/api/auth/google/request', null, async ({ body }) => {
    const req = await ticketRequest(body.ticket);
    const fullName = text(body.full_name, { required: true, max: 120, name: 'اسم الولي' });
    const phone = text(body.phone, { required: true, max: 30, name: 'الهاتف' });
    if (!phoneKey(phone)) throw new HttpError(400, 'رقم الهاتف غير صالح');
    const list = Array.isArray(body.children) ? body.children.slice(0, 8) : [];
    if (!list.length) throw new HttpError(400, 'اختر ابنًا واحدًا على الأقل أو أضفه');
    const children = [];
    for (const c of list) {
      if (c.type === 'student' || c.type === 'child') {
        const row = await one(
          c.type === 'student' ? 'SELECT id, full_name FROM students WHERE id = $1' : 'SELECT id, full_name FROM program_children WHERE id = $1',
          [Number(c.id)]
        );
        if (row) children.push({ type: c.type, id: row.id, full_name: row.full_name });
      } else {
        const name = text(c.full_name, { required: true, max: 120, name: 'اسم الابن' });
        if (!LEVEL_CODES.includes(c.level)) throw new HttpError(400, `المستوى غير صالح (${name})`);
        children.push({ type: 'new', full_name: name, level: c.level });
      }
    }
    if (!children.length) throw new HttpError(400, 'اختر ابنًا واحدًا على الأقل أو أضفه');
    await pool.query(
      `UPDATE parent_requests SET full_name = $1, phone = $2, children = $3, note = $4, status = 'pending', submitted_at = now()
       WHERE id = $5`,
      [fullName, phone, JSON.stringify(children), text(body.note, { max: 500, name: 'ملاحظة' }), req.id]
    );
    return { ok: true };
  });

  // الإدارة: مراجعة الطلبات
  route('GET', '/api/parent-requests', ['admin'], async () => {
    const requests = await all(
      `SELECT id, google_email, google_name, full_name, phone, children, note, status, submitted_at::text, user_id
       FROM parent_requests WHERE status IN ('pending', 'rejected') ORDER BY status, submitted_at DESC`
    );
    const parents = await all(`SELECT id, full_name, phone, username FROM users WHERE role = 'parent' AND google_sub IS NULL ORDER BY full_name`);
    for (const r of requests) {
      // اقتراح الحساب الموجود: نفس الهاتف أو ولي الابن المختار
      const key = phoneKey(r.phone);
      const byPhone = parents.find((p) => key && String(p.phone || '').split(/[\/,;]/).some((x) => phoneKey(x) === key));
      let byChild = null;
      for (const c of r.children) {
        const row =
          c.type === 'student'
            ? await one('SELECT parent_id FROM students WHERE id = $1', [c.id])
            : c.type === 'child'
              ? await one('SELECT parent_id FROM program_children WHERE id = $1', [c.id])
              : null;
        if (row?.parent_id) byChild ??= row.parent_id;
      }
      r.suggested_parent_id = byChild || byPhone?.id || null;
    }
    return { requests, parents };
  });

  route('POST', '/api/parent-requests/:id/approve', ['admin'], async ({ params, body }) => {
    const req = await one(`SELECT * FROM parent_requests WHERE id = $1 AND status = 'pending'`, [params.id]);
    if (!req) throw new HttpError(404, 'الطلب غير موجود');
    let parentId = body.parent_id ? Number(body.parent_id) : null;
    if (parentId) {
      const p = await one(`SELECT id, google_sub FROM users WHERE id = $1 AND role = 'parent'`, [parentId]);
      if (!p) throw new HttpError(400, 'حساب الولي غير موجود');
      if (p.google_sub && p.google_sub !== req.google_sub) throw new HttpError(409, 'هذا الحساب مربوط بحساب Google آخر');
      await pool.query(
        `UPDATE users SET google_sub = $1, google_email = $2, approved = true,
           phone = COALESCE(NULLIF(phone, ''), $3) WHERE id = $4`,
        [req.google_sub, req.google_email, req.phone, parentId]
      );
    } else {
      let username = phoneKey(req.phone) || `g${req.id}`;
      if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) username = `${username}-g${req.id}`;
      const hash = await hashPasswordAsync(crypto.randomBytes(12).toString('hex'));
      parentId = (
        await one(
          `INSERT INTO users (username, password_hash, full_name, role, phone, email, google_sub, google_email)
           VALUES ($1, $2, $3, 'parent', $4, $5, $6, $5) RETURNING id`,
          [username, hash, req.full_name || req.google_name, req.phone, req.google_email, req.google_sub]
        )
      ).id;
    }
    for (const c of req.children) {
      if (c.type === 'student') await pool.query('UPDATE students SET parent_id = $1 WHERE id = $2', [parentId, c.id]);
      else if (c.type === 'child') await pool.query('UPDATE program_children SET parent_id = $1 WHERE id = $2', [parentId, c.id]);
      else {
        await pool.query(
          `INSERT INTO students (full_name, level, parent_id, status) VALUES ($1, $2, $3, 'waiting')`,
          [c.full_name, c.level, parentId]
        );
      }
    }
    await pool.query(`UPDATE parent_requests SET status = 'approved', user_id = $1 WHERE id = $2`, [parentId, req.id]);
    return { ok: true, parent_id: parentId };
  });

  route('POST', '/api/parent-requests/:id/reject', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query(`UPDATE parent_requests SET status = 'rejected' WHERE id = $1 AND status = 'pending'`, [params.id]);
    if (!rowCount) throw new HttpError(404, 'الطلب غير موجود');
    return { ok: true };
  });

  // ---------- تعديل مبلغ شهر (غياب) ----------
  const ADJ_KINDS = ['exempt', 'absent_days', 'amount'];
  route('PUT', '/api/fee-adjustments', ['admin'], async ({ user, body }) => {
    const studentId = body.student_id ? Number(body.student_id) : null;
    const childId = body.child_id ? Number(body.child_id) : null;
    if (!studentId === !childId) throw new HttpError(400, 'حدّد التلميذ أو الطفل');
    if (!MONTH_RE.test(body.month || '')) throw new HttpError(400, 'الشهر غير صالح');
    if (!ADJ_KINDS.includes(body.kind)) throw new HttpError(400, 'نوع التعديل غير صالح');
    let value = null;
    if (body.kind !== 'exempt') {
      value = money(body.value, body.kind === 'amount' ? 'المبلغ' : 'عدد الأيام');
      if (value === null) throw new HttpError(400, body.kind === 'amount' ? 'اكتب المبلغ' : 'اكتب عدد أيام الغياب');
      if (body.kind === 'absent_days' && (value < 1 || value > 31)) throw new HttpError(400, 'عدد الأيام غير صالح');
    }
    const exists = studentId
      ? await one('SELECT 1 FROM students WHERE id = $1', [studentId])
      : await one('SELECT 1 FROM program_children WHERE id = $1', [childId]);
    if (!exists) throw new HttpError(404, 'غير موجود');
    const reason = text(body.reason, { max: 300, name: 'السبب' });
    const col = studentId ? 'student_id' : 'child_id';
    const existing = await one(`SELECT id FROM fee_adjustments WHERE ${col} = $1 AND month = $2`, [studentId || childId, body.month]);
    if (existing) {
      await pool.query(`UPDATE fee_adjustments SET kind = $1, value = $2, reason = $3, created_by = $4 WHERE id = $5`, [
        body.kind, value, reason, user.id, existing.id,
      ]);
      return { id: existing.id };
    }
    const row = await one(
      `INSERT INTO fee_adjustments (${col}, month, kind, value, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [studentId || childId, body.month, body.kind, value, reason, user.id]
    );
    return [201, { id: row.id }];
  });

  route('POST', '/api/fee-extras', ['admin'], async ({ user, body }) => {
    const studentId = body.student_id ? Number(body.student_id) : null;
    const childId = body.child_id ? Number(body.child_id) : null;
    if (!studentId === !childId) throw new HttpError(400, 'حدّد التلميذ أو الطفل');
    if (!MONTH_RE.test(body.month || '')) throw new HttpError(400, 'الشهر غير صالح');
    const amount = body.exempt ? 0 : money(body.amount, 'المبلغ');
    if (!amount && !body.exempt) throw new HttpError(400, 'اكتب المبلغ');
    const row = await one(
      `INSERT INTO fee_extras (student_id, child_id, month, amount, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [studentId, childId, body.month, amount, text(body.reason, { max: 200, name: 'السبب' }) || 'معلوم التسجيل', user.id]
    );
    return [201, { id: row.id }];
  });
  route('DELETE', '/api/fee-extras/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM fee_extras WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });

  route('DELETE', '/api/fee-adjustments/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM fee_adjustments WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });

  route('POST', '/api/users/:id/approve', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query(`UPDATE users SET approved = true WHERE id = $1`, [params.id]);
    if (!rowCount) throw new HttpError(404, 'الحساب غير موجود');
    return { ok: true };
  });

  // ---------- الحضور: المعلم يسجّل غيابات القسم دفعة واحدة ----------
  async function attendanceList(user, query) {
    const level = query.get('level');
    if (!LEVEL_CODES.includes(level)) throw new HttpError(400, 'المستوى غير صالح');
    const day = date(query.get('date') || today());
    const subjectId = Number(query.get('subject_id')) || 0;
    const subject = await one('SELECT * FROM subjects WHERE id = $1', [subjectId]);
    if (!subject) throw new HttpError(400, 'المادة غير موجودة');
    if (user.role === 'teacher' && !(await teaches(user.id, subject.id, level))) {
      throw new HttpError(403, 'هذه المادة ليست من موادك في هذا المستوى');
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
  const TASK_SELECT = `SELECT t.id, t.level, t.subject_id, t.title, t.description, t.due_date::text, t.author_id, t.video_url,
      t.created_at, s.name AS subject_name, u.full_name AS author_name,
      COALESCE((SELECT json_agg(json_build_object('id', f.id, 'filename', f.filename, 'mime', f.mime, 'size', f.size) ORDER BY f.id)
        FROM task_files f WHERE f.task_id = t.id), '[]') AS files
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
    if (user.role === 'teacher' && !(await teaches(user.id, subject.id, body.level))) {
      throw new HttpError(403, 'هذه المادة ليست من موادك في هذا المستوى');
    }
    const task = await one(
      `INSERT INTO tasks (level, subject_id, title, description, due_date, author_id, video_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        body.level,
        subject.id,
        text(body.title, { required: true, max: 200, name: 'عنوان المهمة' }),
        text(body.description, { max: 3000, name: 'التفاصيل' }),
        body.due_date ? date(body.due_date, 'آخر أجل') : null,
        user.id,
        videoUrl(body.video_url),
      ]
    );
    return [201, { task }];
  });

  // ملف مرفق بمهمة القسم (PDF، صور، Word…): 4 ميغا على الأكثر
  const TASK_FILE_MAX = 4 * 1024 * 1024;
  route('POST', '/api/tasks/:id/files', ['admin', 'teacher'], async ({ user, params, body }) => {
    const task = await one('SELECT author_id FROM tasks WHERE id = $1', [params.id]);
    if (!task) throw new HttpError(404, 'المهمة غير موجودة');
    if (user.role !== 'admin' && task.author_id !== user.id) throw new HttpError(403, 'ليس لديك صلاحية');
    const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
    if (!m) throw new HttpError(400, 'الملف غير صالح');
    const size = Math.floor((m[2].length * 3) / 4);
    if (size > TASK_FILE_MAX) throw new HttpError(400, 'الملف أكبر من 4 ميغا');
    const n = (await one('SELECT COUNT(*)::int AS n FROM task_files WHERE task_id = $1', [params.id])).n;
    if (n >= 10) throw new HttpError(400, '10 ملفات على الأكثر لكل مهمة');
    const row = await one(
      `INSERT INTO task_files (task_id, filename, mime, size, data) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [params.id, text(body.filename, { required: true, max: 200, name: 'اسم الملف' }), m[1], size, body.data]
    );
    return [201, { id: row.id }];
  });
  // تحميل الملف: الإدارة، المعلم، أو ولي تلميذ في نفس المستوى
  route('GET', '/api/task-files/:id', ANY, async ({ user, params }) => {
    const f = await one(`SELECT f.filename, f.mime, f.data, t.level, t.subject_id FROM task_files f JOIN tasks t ON t.id = f.task_id WHERE f.id = $1`, [params.id]);
    if (!f) throw new HttpError(404, 'الملف غير موجود');
    if (user.role === 'parent' && !(await one(`SELECT 1 FROM students WHERE parent_id = $1 AND level = $2 AND status <> 'left' LIMIT 1`, [user.id, f.level]))) {
      throw new HttpError(403, 'ليس لديك صلاحية');
    }
    const b64 = f.data.slice(f.data.indexOf(',') + 1);
    return new Response(Buffer.from(b64, 'base64'), {
      headers: { 'Content-Type': f.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`, 'Cache-Control': 'private, max-age=3600' },
    });
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
    // الحصة تُحتسب من أول الشهر الحالي (الأشهر الماضية تُدخل يدويًا)
    const validFrom = `${currentMonth()}-01`;
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
    // جدول معلّم معيّن (يُستخرج من جداول المستويات نفسها)
    const teacherId = Number(query.get('teacher')) || null;
    if (teacherId) return { slots: await all(`${SLOT_SELECT} WHERE ${ACTIVE} AND tt.teacher_id = $1 ${SLOT_ORDER}`, [teacherId]) };
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
    // التعديل يُطبَّق على كامل الشهر الحالي؛ الحصة التي بدأت قبله تُغلق في آخر الشهر الماضي وتبقى لحسابه
    if (old.valid_from < values[8]) {
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
    // الحذف يُطبَّق على كامل الشهر الحالي
    const monthStart = `${currentMonth()}-01`;
    if (old.valid_from < monthStart) await pool.query('UPDATE timetable SET valid_to = $1 WHERE id = $2', [monthStart, params.id]);
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
    // فترات إيقاف العدّ (عطلة، امتحانات): لكل المدرّسين أو لهذا المدرّس
    const pauses = await all(
      `SELECT id, date_from::text, date_to::text, reason FROM payroll_pauses
       WHERE (teacher_id IS NULL OR teacher_id = $1) AND date_from <= $3 AND date_to >= $2`,
      [teacher.id, first, last]
    );
    const pausedOn = (day) => pauses.find((p) => p.date_from <= day && day <= p.date_to);
    // حصة 1:45 (أو أكثر من ثلاثة أرباع ساعة إضافية) تُحتسب ساعة كاملة إذا فعّلت الإدارة ذلك للمدرّس
    const roundUp = !!(await one('SELECT round_hours FROM users WHERE id = $1', [teacher.id]))?.round_hours;
    const paidHours = (h) => (roundUp && h % 1 >= 0.74 ? Math.ceil(h) : h);
    const now = today();
    const sessions = [];
    for (let d = 1; d <= daysInMonth(month); d++) {
      const day = `${month}-${String(d).padStart(2, '0')}`;
      for (const slot of slots) {
        if (slot.day !== isoDay(day) || slot.valid_from > day || (slot.valid_to && slot.valid_to <= day)) continue;
        const scheduled = paidHours(hoursBetween(slot.start_time, slot.end_time));
        const adj = adjustments.find((a) => a.timetable_id === slot.id && a.date === day);
        const pause = !adj && pausedOn(day);
        if (pause) {
          sessions.push({
            date: day, timetable_id: slot.id, start_time: slot.start_time, end_time: slot.end_time, level: slot.level,
            group_name: slot.group_name, subject_name: slot.subject_name, scheduled_hours: scheduled, hours: 0,
            status: 'paused', adjustment_id: null, note: pause.reason || 'إيقاف العدّ',
          });
          continue;
        }
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
    const worked = sessions.filter((x) => x.status !== 'planned' && x.status !== 'paused');
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
      pauses,
      paused_sessions: sessions.filter((x) => x.status === 'paused').length,
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
      `SELECT id, full_name, phone, hourly_rate::float8 AS hourly_rate, round_hours FROM users WHERE role = 'teacher' AND NOT program_staff ORDER BY full_name`
    );
    const rows = [];
    for (const t of teachers) {
      const m = await teacherMonth(t, month);
      rows.push({
        id: t.id,
        full_name: t.full_name,
        phone: t.phone,
        hourly_rate: t.hourly_rate,
        round_hours: t.round_hours,
        sessions: m.sessions.filter((x) => x.status !== 'planned' && x.hours > 0).length,
        absences: m.sessions.filter((x) => x.status === 'absent').length,
        paused: m.paused_sessions,
        slots_per_week: (await one(`SELECT COUNT(*)::int AS n FROM timetable tt WHERE tt.teacher_id = $1 AND ${ACTIVE}`, [t.id])).n,
        hours_done: m.hours_done,
        hours_planned: m.hours_planned,
        due: m.due,
        paid: m.paid,
        remaining: m.remaining,
        // المتوقّع إلى آخر الشهر: كل الحصص المبرمجة تُنجز (دون غيابات) × معلوم الساعة
        expected: round3(m.due + (m.hours_planned || 0) * (t.hourly_rate || 0)),
      });
    }
    const sum = (k) => round3(rows.reduce((t, r) => t + r[k], 0));
    const [first, last] = monthRange(month);
    const pauses = await all(
      `SELECT p.id, p.date_from::text, p.date_to::text, p.reason, p.teacher_id, u.full_name AS teacher_name
       FROM payroll_pauses p LEFT JOIN users u ON u.id = p.teacher_id WHERE p.date_from <= $2 AND p.date_to >= $1 ORDER BY p.date_from`,
      [first, last]
    );
    return { month, teachers: rows, pauses, totals: { hours_done: sum('hours_done'), hours_planned: sum('hours_planned'), due: sum('due'), paid: sum('paid'), remaining: sum('remaining'), expected: sum('expected') } };
  });
  route('POST', '/api/payroll/pauses', ['admin'], async ({ user, body }) => {
    const from = date(body.date_from, 'من');
    const to = date(body.date_to || body.date_from, 'إلى');
    if (to < from) throw new HttpError(400, 'تاريخ النهاية قبل البداية');
    const row = await one(
      `INSERT INTO payroll_pauses (date_from, date_to, teacher_id, reason, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [from, to, Number(body.teacher_id) || null, text(body.reason, { max: 200, name: 'السبب' }), user.id]
    );
    return [201, { id: row.id }];
  });
  route('DELETE', '/api/payroll/pauses/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM payroll_pauses WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });

  // تفاصيل شهر لمعلم (الإدارة، أو المعلم نفسه)
  route('GET', '/api/payroll/:id', ['admin', 'teacher'], async ({ user, params, query }) => {
    const teacher = await loadTeacher(user, params.id);
    const flag = await one('SELECT round_hours FROM users WHERE id = $1', [teacher.id]);
    return { teacher: { ...teacher, round_hours: !!flag?.round_hours }, ...(await teacherMonth(teacher, monthParam(query.get('month')))) };
  });
  // تشغيل / إيقاف «حصة 1:45 = ساعتان» لمدرّس
  route('PUT', '/api/payroll/:id/round-hours', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(`UPDATE users SET round_hours = $1 WHERE id = $2 AND role = 'teacher'`, [!!body.on, params.id]);
    if (!rowCount) throw new HttpError(404, 'المدرّس غير موجود');
    return { ok: true };
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
  // غيابات المدرّسين ليوم: كل الحصص المبرمجة (الكل حاضر افتراضيًا)، والإدارة تسجّل الغياب فقط
  route('GET', '/api/teacher-attendance', ['admin'], async ({ query }) => {
    const day = date(query.get('date') || today(), 'التاريخ');
    const slots = await all(
      `${SLOT_SELECT} WHERE tt.teacher_id IS NOT NULL AND tt.day = $1 AND tt.valid_from <= $2 AND (tt.valid_to IS NULL OR tt.valid_to > $2)
       ORDER BY tt.start_time`,
      [isoDay(day), day]
    );
    const adj = await all(`SELECT id, timetable_id, hours::float8 AS hours, note FROM teacher_hour_adjustments WHERE date = $1 AND timetable_id IS NOT NULL`, [day]);
    const pause = await one(`SELECT reason FROM payroll_pauses WHERE teacher_id IS NULL AND date_from <= $1 AND date_to >= $1 LIMIT 1`, [day]);
    return {
      date: day,
      pause: pause?.reason ?? null,
      sessions: slots.map((x) => {
        const a = adj.find((y) => y.timetable_id === x.id);
        return { ...x, absent: !!a && a.hours === 0, adjustment_id: a?.id ?? null, note: a?.note ?? null };
      }),
    };
  });

  // تسجيل غياب مدرّس في حصة (أو إلغاؤه): الحصة تُحتسب 0 ساعة
  route('POST', '/api/teacher-attendance', ['admin'], async ({ body }) => {
    const day = date(body.date, 'التاريخ');
    const slot = await one('SELECT id, teacher_id FROM timetable WHERE id = $1 AND teacher_id IS NOT NULL', [Number(body.timetable_id) || 0]);
    if (!slot) throw new HttpError(400, 'الحصة غير موجودة');
    if (body.absent) {
      await pool.query(
        `INSERT INTO teacher_hour_adjustments (teacher_id, date, timetable_id, hours, note) VALUES ($1, $2, $3, 0, $4)
         ON CONFLICT (teacher_id, date, timetable_id) WHERE timetable_id IS NOT NULL DO UPDATE SET hours = 0, note = EXCLUDED.note`,
        [slot.teacher_id, day, slot.id, text(body.note, { max: 300, name: 'الملاحظة' }) || 'غياب']
      );
    } else {
      await pool.query('DELETE FROM teacher_hour_adjustments WHERE teacher_id = $1 AND date = $2 AND timetable_id = $3', [slot.teacher_id, day, slot.id]);
    }
    return { ok: true };
  });

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
       WHERE NOT program AND level = $1 AND (group_name IS NULL OR $2::text IS NULL OR lower(group_name) = lower($2)) ORDER BY id`,
      [student.level, student.group_name]
    );
  // مجموعات طفل في البرنامج التربوي: كل الأطفال، أو قسمه
  const childWhatsappGroups = (child) =>
    all(`SELECT id, name, invite_link FROM whatsapp_groups WHERE program AND (class_id IS NULL OR class_id = $1) ORDER BY class_id NULLS FIRST, id`, [child.class_id]);

  async function readWhatsappGroup(body) {
    const name = text(body.name, { required: true, max: 120, name: 'اسم المجموعة' });
    const link = text(body.invite_link, { required: true, max: 200, name: 'رابط المجموعة' });
    if (!WA_LINK_RE.test(link)) throw new HttpError(400, 'رابط المجموعة يجب أن يبدأ بـ https://chat.whatsapp.com/');
    if (body.program === true || body.program === 'true' || body.program === '1') {
      const classId = Number(body.class_id) || null;
      if (classId && !(await one('SELECT 1 FROM program_classes WHERE id = $1', [classId]))) throw new HttpError(400, 'القسم غير موجود');
      return [name, null, null, link, true, classId];
    }
    const level = body.level || null;
    if (level && !LEVEL_CODES.includes(level)) throw new HttpError(400, 'المستوى غير صالح');
    return [name, level, level ? text(body.group_name, { max: 50, name: 'الفوج' }) : null, link, false, null];
  }

  route('GET', '/api/whatsapp-groups', ['admin'], async () => ({
    groups: await all(
      `SELECT g.id, g.name, g.level, g.group_name, g.invite_link, g.program, g.class_id, k.name AS class_name
       FROM whatsapp_groups g LEFT JOIN program_classes k ON k.id = g.class_id ORDER BY g.program, g.level NULLS FIRST, g.group_name, k.name NULLS FIRST, g.id`
    ),
  }));

  route('POST', '/api/whatsapp-groups', ['admin'], async ({ body }) => {
    const group = await one(
      'INSERT INTO whatsapp_groups (name, level, group_name, invite_link, program, class_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      await readWhatsappGroup(body)
    );
    return [201, { group }];
  });

  route('PUT', '/api/whatsapp-groups/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      'UPDATE whatsapp_groups SET name = $1, level = $2, group_name = $3, invite_link = $4, program = $5, class_id = $6 WHERE id = $7',
      [...(await readWhatsappGroup(body)), params.id]
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
  // الولي: حساب الولي (أو ولي تلميذ الدعم المرتبط)؛ guardian_* للأطفال دون حساب
  const CHILD_SELECT = `SELECT c.id, c.full_name, c.birth_date::text, c.class_id, c.guardian_name, c.guardian_phone,
      c.monthly_fee::float8 AS monthly_fee, c.start_date::text, c.status, c.end_date::text, c.free, c.notes,
      c.discount::float8 AS discount, c.discount_reason, c.parent_id, c.student_id, c.formula,
      to_char(c.created_at, 'YYYY-MM') AS created_month, k.name AS class_name, k.teacher_id AS class_teacher_id,
      sl.full_name AS student_name, sl.level AS student_level,
      COALESCE(sl.parent_id, c.parent_id) AS family_parent_id,
      COALESCE(pu.full_name, c.guardian_name) AS contact_name, COALESCE(pu.phone, c.guardian_phone) AS contact_phone
    FROM program_children c LEFT JOIN program_classes k ON k.id = c.class_id
    LEFT JOIN students sl ON sl.id = c.student_id
    LEFT JOIN users pu ON pu.id = COALESCE(sl.parent_id, c.parent_id)`;
  const programPayments = (ids) =>
    all(
      `SELECT id, child_id, month, amount::float8 AS amount, paid_on::text, method, note, receipt_no, edited_at IS NOT NULL AS edited FROM program_payments
       WHERE child_id = ANY($1::int[]) ORDER BY paid_on DESC, id DESC`,
      [ids]
    );

  async function readChild(body, childId = 0) {
    let fullName = text(body.full_name, { max: 120, name: 'اسم الطفل' });
    const status = body.status === 'left' ? 'left' : 'active';
    const startDate = body.start_date ? date(body.start_date, 'تاريخ البداية') : null;
    const endDate = status === 'left' ? (body.end_date ? date(body.end_date, 'تاريخ الخروج') : today()) : null;
    // نفس الطفل مسجّل في دروس الدعم: الاسم والولي من ملف الدعم
    let studentId = Number(body.student_id) || null;
    let parentId = Number(body.parent_id) || null;
    if (studentId) {
      const st = await getStudent(studentId);
      if (!st) throw new HttpError(400, 'التلميذ غير موجود');
      if (await one('SELECT 1 FROM program_children WHERE student_id = $1 AND id <> $2', [studentId, childId])) {
        throw new HttpError(409, 'هذا التلميذ مسجّل مسبقًا في البرنامج التربوي');
      }
      fullName ||= st.full_name;
      parentId = null;
    } else if (parentId) {
      const parent = await userById(parentId);
      if (!parent || parent.role !== 'parent') throw new HttpError(400, 'الولي غير موجود');
    }
    if (!fullName) throw new HttpError(400, 'اسم الطفل إجباري');
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
      parentId,
      studentId,
    ];
  }

  // من يرى الطفل: الإدارة، الولي، ومنشط قسمه
  async function loadChildFor(user, id) {
    const child = Number.isInteger(Number(id)) ? await one(`${CHILD_SELECT} WHERE c.id = $1`, [Number(id)]) : null;
    const allowed =
      child &&
      (user.role === 'admin' ||
        (user.role === 'parent' && child.family_parent_id === user.id) ||
        (user.role === 'teacher' && child.class_teacher_id === user.id));
    if (!allowed) throw new HttpError(404, 'الطفل غير موجود');
    return child;
  }

  // متابعة الطفل: الغيابات والملاحظات (المستوى، متابعة المحتوى، السلوك)
  async function childFollowUp(childId) {
    return {
      absences: await all(
        `SELECT a.id, a.date::text, a.justified, a.reason, a.recorded_by, u.full_name AS recorded_by_name
         FROM program_absences a LEFT JOIN users u ON u.id = a.recorded_by WHERE a.child_id = $1 ORDER BY a.date DESC`,
        [childId]
      ),
      notes: await all(
        `SELECT n.id, n.date::text, n.category, n.rating, n.content, n.author_id, u.full_name AS author_name
         FROM program_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.child_id = $1 ORDER BY n.date DESC, n.id DESC`,
        [childId]
      ),
    };
  }

  // ملف الطفل كاملًا (للإدارة والولي: مع الوضعية المالية)
  async function childFile(user, child) {
    const file = { child, ...(await childFollowUp(child.id)) };
    file.posts = child.class_id
      ? await all(
          `SELECT p.id, p.kind, p.title, p.body, p.due_date::text, p.created_at, u.full_name AS author_name, p.video_url, COALESCE((SELECT json_agg(json_build_object('id', f.id, 'filename', f.filename, 'mime', f.mime, 'size', f.size) ORDER BY f.id) FROM program_post_files f WHERE f.post_id = p.id), '[]') AS files
           FROM program_posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.class_id = $1 ORDER BY p.created_at DESC LIMIT 20`,
          [child.class_id]
        )
      : [];
    file.whatsapp_groups = user.role === 'teacher' ? [] : await childWhatsappGroups(child);
    if (user.role !== 'teacher') {
      file.finance = (await feeTools()).child(child, await programPayments([child.id]));
    } else {
      for (const k of ['monthly_fee', 'discount', 'discount_reason', 'guardian_phone', 'contact_phone']) delete child[k];
    }
    // الولي: ما أوقفه المدير لا يُرسل
    if (user.role === 'parent') {
      if (!(await featureOn(user, 'pay'))) file.finance = null;
      if (!(await featureOn(user, 'absences'))) file.absences = [];
      if (!(await featureOn(user, 'evaluation'))) (file.notes = []), (file.posts = []);
    }
    return file;
  }

  // ---------- أنشطة وتمارين ورسائل لكامل قسم في البرنامج التربوي ----------
  const canPostToClass = async (user, classId) =>
    user.role === 'admin' || !!(await one('SELECT 1 FROM program_classes WHERE id = $1 AND teacher_id = $2', [classId, user.id]));
  route('GET', '/api/program/posts', ['admin', 'teacher'], async ({ user, query }) => {
    const classId = Number(query.get('class_id')) || null;
    return {
      posts: await all(
        `SELECT p.id, p.class_id, pc.name AS class_name, p.kind, p.title, p.body, p.due_date::text, p.created_at, p.author_id,
           u.full_name AS author_name, p.video_url, COALESCE((SELECT json_agg(json_build_object('id', f.id, 'filename', f.filename, 'mime', f.mime, 'size', f.size) ORDER BY f.id) FROM program_post_files f WHERE f.post_id = p.id), '[]') AS files
         FROM program_posts p JOIN program_classes pc ON pc.id = p.class_id LEFT JOIN users u ON u.id = p.author_id
         WHERE ($1::int IS NULL OR p.class_id = $1) AND ($2::int IS NULL OR pc.teacher_id = $2)
         ORDER BY p.created_at DESC LIMIT 200`,
        [classId, user.role === 'teacher' ? user.id : null]
      ),
    };
  });
  route('POST', '/api/program/posts', ['admin', 'teacher'], async ({ user, body }) => {
    const classId = Number(body.class_id) || 0;
    if (!(await one('SELECT 1 FROM program_classes WHERE id = $1', [classId]))) throw new HttpError(400, 'اختر القسم');
    if (!(await canPostToClass(user, classId))) throw new HttpError(403, 'هذا القسم ليس من أقسامك');
    const kind = body.kind === 'message' ? 'message' : 'activity';
    const row = await one(
      `INSERT INTO program_posts (class_id, kind, title, body, due_date, author_id, video_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        classId,
        kind,
        text(body.title, { required: true, max: 200, name: 'العنوان' }),
        text(body.body, { max: 4000, name: 'التفاصيل' }),
        body.due_date ? date(body.due_date, 'آخر أجل') : null,
        user.id,
        videoUrl(body.video_url),
      ]
    );
    const parents = (await one(
      `SELECT COUNT(DISTINCT COALESCE(st.parent_id, c.parent_id))::int AS n FROM program_children c LEFT JOIN students st ON st.id = c.student_id
       WHERE c.class_id = $1 AND c.status <> 'left' AND COALESCE(st.parent_id, c.parent_id) IS NOT NULL`,
      [classId]
    )).n;
    return [201, { id: row.id, parents }];
  });
  route('POST', '/api/program/posts/:id/files', ['admin', 'teacher'], async ({ user, params, body }) => {
    const post = await one('SELECT author_id FROM program_posts WHERE id = $1', [params.id]);
    if (!post) throw new HttpError(404, 'المنشور غير موجود');
    if (user.role !== 'admin' && post.author_id !== user.id) throw new HttpError(403, 'ليس لديك صلاحية');
    const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
    if (!m) throw new HttpError(400, 'الملف غير صالح');
    const size = Math.floor((m[2].length * 3) / 4);
    if (size > 4 * 1024 * 1024) throw new HttpError(400, 'الملف أكبر من 4 ميغا');
    if ((await one('SELECT COUNT(*)::int AS n FROM program_post_files WHERE post_id = $1', [params.id])).n >= 10) throw new HttpError(400, '10 ملفات على الأكثر');
    const row = await one(`INSERT INTO program_post_files (post_id, filename, mime, size, data) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
      params.id, text(body.filename, { required: true, max: 200, name: 'اسم الملف' }), m[1], size, body.data,
    ]);
    return [201, { id: row.id }];
  });
  // ملف منشور: الإدارة، مؤطّر القسم، أو ولي طفل في القسم
  route('GET', '/api/program-post-files/:id', ANY, async ({ user, params }) => {
    const f = await one(
      `SELECT f.filename, f.mime, f.data, p.class_id, pc.teacher_id FROM program_post_files f JOIN program_posts p ON p.id = f.post_id
       JOIN program_classes pc ON pc.id = p.class_id WHERE f.id = $1`,
      [params.id]
    );
    if (!f) throw new HttpError(404, 'الملف غير موجود');
    if (user.role === 'parent') {
      const ok = await one(
        `SELECT 1 FROM program_children c LEFT JOIN students st ON st.id = c.student_id
         WHERE c.class_id = $1 AND c.status <> 'left' AND COALESCE(st.parent_id, c.parent_id) = $2 LIMIT 1`,
        [f.class_id, user.id]
      );
      if (!ok) throw new HttpError(403, 'ليس لديك صلاحية');
    }
    const b64 = f.data.slice(f.data.indexOf(',') + 1);
    return new Response(Buffer.from(b64, 'base64'), {
      headers: { 'Content-Type': f.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`, 'Cache-Control': 'private, max-age=3600' },
    });
  });
  route('DELETE', '/api/program/posts/:id', ['admin', 'teacher'], async ({ user, params }) => {
    const p = await one('SELECT author_id FROM program_posts WHERE id = $1', [params.id]);
    if (!p) throw new HttpError(404, 'غير موجود');
    if (user.role !== 'admin' && p.author_id !== user.id) throw new HttpError(403, 'لا يمكنك حذف منشور شخص آخر');
    await pool.query('DELETE FROM program_posts WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // ---------- خلاص المرافقين (أجرة شهرية) ----------
  const programStaffSql = `SELECT u.id, u.full_name, u.phone, u.monthly_salary::float8 AS monthly_salary, u.pay_per_child::float8 AS pay_per_child, u.volunteer, u.also_program,
      (SELECT string_agg(k.name, '، ' ORDER BY k.name) FROM program_classes k WHERE k.teacher_id = u.id) AS classes
    FROM users u WHERE u.role = 'teacher' AND (u.program_staff OR u.also_program)`;
  route('GET', '/api/program/staff-pay', ['admin', 'teacher'], async ({ user, query }) => programStaffMonth(monthParam(query.get('month')), user));
  // معلم دعم يصبح مؤطّرًا أيضًا (أو يُفكّ): يبقى معلوم ساعته للدعم، وأجرته في التربوي شهرية أو عن كل طفل
  route('POST', '/api/program/staff/link', ['admin'], async ({ user, body }) => {
    const t = await userById(Number(body.teacher_id));
    if (!t || t.role !== 'teacher') throw new HttpError(404, 'المعلم غير موجود');
    guardAccount(user, 'teacher');
    if (t.program_staff) throw new HttpError(400, 'هذا الحساب مؤطّر أصلًا');
    const vol = !!body.volunteer;
    await pool.query(`UPDATE users SET also_program = true, monthly_salary = $1, pay_per_child = $2, volunteer = $3 WHERE id = $4`, [
      vol ? null : money(body.monthly_salary, 'الأجرة الشهرية'), vol ? null : money(body.pay_per_child, 'المبلغ عن كل طفل'), vol, t.id,
    ]);
    return { ok: true };
  });
  route('DELETE', '/api/program/staff/:id/link', ['admin'], async ({ user, params }) => {
    guardAccount(user, 'teacher');
    const { rowCount } = await pool.query(
      `UPDATE users SET also_program = false, monthly_salary = NULL, pay_per_child = NULL, volunteer = false WHERE id = $1 AND role = 'teacher' AND also_program`,
      [params.id]
    );
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    await pool.query('UPDATE program_classes SET teacher_id = NULL WHERE teacher_id = $1', [params.id]);
    return { ok: true };
  });
  async function programStaffMonth(month, user) {
    const staff = await all(`${programStaffSql} ${user.role === 'teacher' ? 'AND u.id = $1' : ''} ORDER BY u.full_name`, user.role === 'teacher' ? [user.id] : []);
    const paid = await all(
      `SELECT id, teacher_id, amount::float8 AS amount, date::text, salary_month FROM ledger_entries
       WHERE teacher_id = ANY($1) ${user.role === 'teacher' ? '' : 'AND salary_month = $2'} ORDER BY date DESC`,
      user.role === 'teacher' ? [staff.map((s) => s.id)] : [staff.map((s) => s.id), month]
    );
    // الأجرة المستحقة: الشهرية + مبلغ عن كل طفل يدفع في أقسامه (حسب ما يُحتسب عليه ذلك الشهر، مع الـ prorata)
    const perChild = staff.filter((s) => s.pay_per_child);
    let fees = null;
    let kids = [];
    let kidPays = [];
    if (perChild.length) {
      fees = await feeTools();
      kids = await all(`${CHILD_SELECT} WHERE k.teacher_id = ANY($1)`, [perChild.map((s) => s.id)]);
      kidPays = kids.length ? await programPayments(kids.map((c) => c.id)) : [];
    }
    for (const s of staff) {
      let units = 0;
      if (s.pay_per_child) {
        for (const c of kids.filter((x) => x.class_teacher_id === s.id && !x.free && x.monthly_fee > 0)) {
          const row = fees.child(c, kidPays.filter((p) => p.child_id === c.id)).months.find((m) => m.month === month);
          if (row?.due > 0) units += Math.min(row.due / c.monthly_fee, 1);
        }
      }
      s.children_count = round3(units);
      s.expected = round3((s.monthly_salary || 0) + (s.pay_per_child || 0) * units);
      s.payment = paid.find((p) => p.teacher_id === s.id && p.salary_month === month) || null;
      if (user.role === 'teacher') s.history = paid.filter((p) => p.teacher_id === s.id);
    }
    return { month, staff, total_due: round3(staff.reduce((t, s) => t + (s.expected || 0), 0)), total_paid: round3(staff.reduce((t, s) => t + (s.payment?.amount || 0), 0)) };
  }

  // ---------- الأجور: نظرة عامة على كل الأجور في الشهر (مدرّسو الدعم، المؤطّرون، الموارد البشرية الأخرى) ----------
  route('GET', '/api/salaries', ['admin'], async ({ user, query }) => salariesMonth(monthParam(query.get('month')), user));
  // أجور الإطار الإداري والعاملين (أجرة شهرية ثابتة)
  async function staffMonth(month) {
    const staffRows = await all(
      `SELECT s.id, s.full_name, s.role, s.activity, s.monthly_salary::float8 AS monthly_salary,
         (SELECT l.id FROM ledger_entries l WHERE l.staff_id = s.id AND l.salary_month = $1 LIMIT 1) AS payment_id,
         COALESCE((SELECT SUM(l.amount) FROM ledger_entries l WHERE l.staff_id = s.id AND l.salary_month = $1), 0)::float8 AS paid
       FROM staff s WHERE s.active ORDER BY s.full_name`,
      [month]
    );
    return staffRows.map((s) => ({
      id: s.id, name: s.full_name, basis: s.role || 'أجرة شهرية', activity: s.activity,
      due: s.monthly_salary || 0, paid: s.paid, payment_id: s.payment_id, pay: `/api/staff/${s.id}/pay`,
    }));
  }

  async function salariesMonth(month, user) {
    const teachers = await all(
      `SELECT id, full_name, hourly_rate::float8 AS hourly_rate FROM users WHERE role = 'teacher' AND NOT program_staff ORDER BY full_name`
    );
    const support = [];
    for (const tch of teachers) {
      const m = await teacherMonth(tch, month);
      if (!m.due && !m.paid && !m.hours_done) continue;
      support.push({ id: tch.id, name: tch.full_name, basis: `${fmtNum(m.hours_done)} س × ${fmtNum(tch.hourly_rate || 0)} د.ت`, due: m.due, paid: m.paid, link: `#/payroll/${tch.id}`,
        expected: round3(m.due + (m.hours_planned || 0) * (tch.hourly_rate || 0)) });
    }
    const prog = await programStaffMonth(month, user);
    const program = prog.staff.map((s) => ({
      id: s.id, name: s.full_name,
      basis: s.volunteer ? 'متطوّع' : s.pay_per_child ? `${fmtNum(s.pay_per_child)} د.ت × ${fmtNum(s.children_count)} طفل` : s.monthly_salary ? 'أجرة شهرية' : 'غير محدّدة',
      due: s.expected || 0, paid: s.payment?.amount || 0, payment_id: s.payment?.id || null, pay: `/api/program/staff/${s.id}/pay`,
    }));
    const admin = await staffMonth(month);
    const group = (key, label, people) => ({
      key, label, people,
      due: round3(people.reduce((t, x) => t + x.due, 0)), paid: round3(people.reduce((t, x) => t + x.paid, 0)),
    });
    const groups = [
      group('support', 'مدرّسو دروس الدعم (بالساعة)', support),
      group('program', 'مؤطّرو البرنامج التربوي', program),
      group('admin', 'الموارد البشرية الأخرى', admin),
    ];
    const sum = (k) => round3(groups.reduce((t, g) => t + g[k], 0));
    return { month, groups, due: sum('due'), paid: sum('paid') };
  }

  // الأجور طيلة السنة الدراسية: كل شخص × كل شهر (المستحق والمدفوع)
  route('GET', '/api/salaries/year', ['admin'], async ({ user, query }) => {
    const ref = monthParam(query.get('month'));
    const [y, m] = ref.split('-').map(Number);
    const start = m >= 9 ? y : y - 1;
    const cur = currentMonth();
    const months = [];
    for (let mm = `${start}-09`; mm <= `${start + 1}-08` && mm <= cur; mm = nextMonth(mm)) months.push(mm);
    const people = new Map();
    const perMonth = await Promise.all(months.map((mo) => salariesMonth(mo, user)));
    for (const [i, sm] of perMonth.entries()) {
      for (const g of sm.groups) {
        for (const p of g.people) {
          const key = `${g.key}:${p.id}`;
          if (!people.has(key)) people.set(key, { group: g.key, group_label: g.label, id: p.id, name: p.name, link: p.link || null, months: months.map(() => null), due: 0, paid: 0 });
          const row = people.get(key);
          row.months[i] = { due: round3(p.due), paid: round3(p.paid) };
          row.due = round3(row.due + p.due);
          row.paid = round3(row.paid + p.paid);
        }
      }
    }
    const rows = [...people.values()].map((r) => ({ ...r, remaining: round3(r.due - r.paid) }));
    const groups = ['support', 'program', 'admin'].map((k) => {
      const list = rows.filter((r) => r.group === k).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      return { key: k, label: list[0]?.group_label || k, people: list, due: round3(list.reduce((t, r) => t + r.due, 0)), paid: round3(list.reduce((t, r) => t + r.paid, 0)) };
    }).filter((g) => g.people.length);
    const monthTotals = months.map((_, i) => ({
      due: round3(rows.reduce((t, r) => t + (r.months[i]?.due || 0), 0)),
      paid: round3(rows.reduce((t, r) => t + (r.months[i]?.paid || 0), 0)),
    }));
    const sum = (k) => round3(rows.reduce((t, r) => t + r[k], 0));
    return { year: `${start}-${start + 1}`, months, groups, month_totals: monthTotals, totals: { due: sum('due'), paid: sum('paid'), remaining: round3(sum('due') - sum('paid')) } };
  });

  route('POST', '/api/staff/:id/pay', ['admin'], async ({ user, params, body }) => {
    const s = await one('SELECT id, full_name, activity, monthly_salary::float8 AS monthly_salary FROM staff WHERE id = $1', [params.id]);
    if (!s) throw new HttpError(404, 'غير موجود');
    const month = monthParam(body.month);
    const amount = money(body.amount, 'المبلغ') ?? s.monthly_salary;
    if (!amount) throw new HttpError(400, 'حدّد المبلغ');
    const row = await one(
      `INSERT INTO ledger_entries (direction, activity, category, amount, date, description, staff_id, salary_month, created_by)
       VALUES ('expense', $1, 'salary', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (staff_id, salary_month) WHERE staff_id IS NOT NULL AND salary_month IS NOT NULL DO NOTHING RETURNING id`,
      [s.activity, amount, body.date ? date(body.date) : today(), `أجرة ${month} — ${s.full_name}`, s.id, month, user.id]
    );
    if (!row) throw new HttpError(409, 'أجرة هذا الشهر مسجّلة مسبقًا');
    return [201, { id: row.id }];
  });
  route('POST', '/api/program/staff/:id/pay', ['admin'], async ({ user, params, body }) => {
    const s = await one(`${programStaffSql} AND u.id = $1`, [params.id]);
    if (!s) throw new HttpError(404, 'المرافق غير موجود');
    const month = monthParam(body.month);
    const amount = money(body.amount, 'المبلغ') ?? s.monthly_salary ?? null;
    if (!amount) throw new HttpError(400, 'حدّد الأجرة الشهرية أو المبلغ');
    const row = await one(
      `INSERT INTO ledger_entries (direction, activity, category, amount, date, description, teacher_id, salary_month, created_by)
       VALUES ('expense', 'program', 'salary', $1, $2, $3, $4, $5, $6)
       ON CONFLICT (teacher_id, salary_month) WHERE teacher_id IS NOT NULL AND salary_month IS NOT NULL DO NOTHING RETURNING id`,
      [amount, body.date ? date(body.date) : today(), `أجرة ${month} — ${s.full_name}`, s.id, month, user.id]
    );
    if (!row) throw new HttpError(409, 'أجرة هذا الشهر مسجّلة مسبقًا');
    return [201, { id: row.id }];
  });

  // ---------- ديون المركز (Crédits) ----------
  route('GET', '/api/center-debts', ['admin'], async () => {
    const debts = await all(
      `SELECT d.id, d.creditor, d.description, d.amount::float8 AS amount, d.since::text,
         COALESCE((SELECT SUM(p.amount) FROM center_debt_payments p WHERE p.debt_id = d.id), 0)::float8 AS paid
       FROM center_debts d ORDER BY d.id`
    );
    const payments = await all(
      `SELECT p.id, p.debt_id, p.amount::float8 AS amount, p.paid_on::text, p.note, p.ledger_id FROM center_debt_payments p ORDER BY p.paid_on DESC, p.id DESC`
    );
    for (const d of debts) {
      d.remaining = round3(d.amount - d.paid);
      d.payments = payments.filter((p) => p.debt_id === d.id);
    }
    const sum = (k) => round3(debts.reduce((t, d) => t + d[k], 0));
    return { debts, total: sum('amount'), paid: sum('paid'), remaining: sum('remaining') };
  });
  route('POST', '/api/center-debts', ['admin'], async ({ body }) => {
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const row = await one(
      `INSERT INTO center_debts (creditor, description, amount, since) VALUES ($1, $2, $3, $4) RETURNING id`,
      [text(body.creditor, { required: true, max: 120, name: 'الجهة الدائنة' }), text(body.description, { max: 300, name: 'البيان' }), amount,
        body.since ? date(body.since) : null]
    );
    return [201, { id: row.id }];
  });
  route('PUT', '/api/center-debts/:id', ['admin'], async ({ params, body }) => {
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const { rowCount } = await pool.query(
      `UPDATE center_debts SET creditor = $1, description = $2, amount = $3, since = $4 WHERE id = $5`,
      [text(body.creditor, { required: true, max: 120, name: 'الجهة الدائنة' }), text(body.description, { max: 300, name: 'البيان' }), amount,
        body.since ? date(body.since) : null, params.id]
    );
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });
  route('DELETE', '/api/center-debts/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM center_debts WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });
  // تسديد: ينقص الباقي، ويُسجَّل (اختياريًا) مصروفًا عامًا في شهر الدفع
  route('POST', '/api/center-debts/:id/payments', ['admin'], async ({ user, params, body }) => {
    const debt = await one(
      `SELECT d.id, d.creditor, d.amount::float8 AS amount,
         COALESCE((SELECT SUM(p.amount) FROM center_debt_payments p WHERE p.debt_id = d.id), 0)::float8 AS paid
       FROM center_debts d WHERE d.id = $1`,
      [params.id]
    );
    if (!debt) throw new HttpError(404, 'غير موجود');
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    if (amount > round3(debt.amount - debt.paid) + 0.0005) throw new HttpError(400, 'المبلغ أكبر من الباقي');
    const paidOn = date(body.paid_on || today());
    const note = text(body.note, { max: 300, name: 'ملاحظة' });
    // الديون مكان لحفظ المعلومة فقط: التسديد لا يُسجَّل في المصاريف ولا يؤثّر في الحسابات
    const ledgerId = null;
    const row = await one(
      `INSERT INTO center_debt_payments (debt_id, amount, paid_on, note, ledger_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [debt.id, amount, paidOn, note, ledgerId, user.id]
    );
    return [201, { id: row.id }];
  });
  route('DELETE', '/api/center-debts/payments/:id', ['admin'], async ({ params }) => {
    const p = await one('SELECT ledger_id FROM center_debt_payments WHERE id = $1', [params.id]);
    if (!p) throw new HttpError(404, 'غير موجود');
    await pool.query('DELETE FROM center_debt_payments WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // ---------- المنتجات: كل بيع مدخول في شهر تاريخه ----------
  const SALE_SELECT = `SELECT s.id, s.product_id, p.name AS product_name, s.student_id, s.child_id, s.qty, s.unit_price::float8 AS unit_price,
      s.amount::float8 AS amount, s.sold_on::text, s.note,
      COALESCE(st.full_name, c.full_name, s.buyer_name) AS buyer, CASE WHEN st.id IS NOT NULL THEN st.level END AS level
    FROM product_sales s JOIN products p ON p.id = s.product_id
    LEFT JOIN students st ON st.id = s.student_id LEFT JOIN program_children c ON c.id = s.child_id`;
  route('GET', '/api/products', ['admin'], async ({ query }) => {
    const month = /^\d{4}-\d{2}$/.test(query.get('month') || '') ? query.get('month') : null;
    const products = await all(
      `SELECT p.id, p.name, p.price::float8 AS price, p.active,
         COALESCE(SUM(s.qty), 0)::int AS sold, COALESCE(SUM(s.amount), 0)::float8 AS revenue
       FROM products p LEFT JOIN product_sales s ON s.product_id = p.id GROUP BY p.id ORDER BY p.active DESC, p.id`
    );
    const sales = await all(
      `${SALE_SELECT} ${month ? `WHERE to_char(s.sold_on, 'YYYY-MM') = $1` : ''} ORDER BY s.sold_on DESC, s.id DESC LIMIT 500`,
      month ? [month] : []
    );
    const students = await all(`SELECT id, full_name, level FROM students WHERE status IN ('studying', 'waiting') ORDER BY full_name`);
    const children = await all(`SELECT id, full_name FROM program_children WHERE status = 'active' ORDER BY full_name`);
    return { products, sales, month, total: round3(sales.reduce((t, s) => t + s.amount, 0)), students, children };
  });
  const productBody = (body) => ({
    name: text(body.name, { required: true, max: 120, name: 'اسم المنتج' }),
    price: body.price === '' || body.price == null ? null : money(body.price, 'السعر'),
  });
  route('POST', '/api/products', ['admin'], async ({ body }) => {
    const p = productBody(body);
    const row = await one(`INSERT INTO products (name, price) VALUES ($1, $2) RETURNING id`, [p.name, p.price]);
    return [201, { id: row.id }];
  });
  route('PUT', '/api/products/:id', ['admin'], async ({ params, body }) => {
    const p = productBody(body);
    const { rowCount } = await pool.query(`UPDATE products SET name = $1, price = $2, active = $3 WHERE id = $4`, [
      p.name, p.price, body.active === undefined ? true : Boolean(body.active) && body.active !== 'false', params.id,
    ]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });
  route('DELETE', '/api/products/:id', ['admin'], async ({ params }) => {
    const used = await one('SELECT COUNT(*)::int AS n FROM product_sales WHERE product_id = $1', [params.id]);
    if (used?.n) throw new HttpError(409, 'للمنتج مبيعات مسجّلة: أوقفه بدل حذفه');
    const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });
  route('POST', '/api/product-sales', ['admin'], async ({ user, body }) => {
    const p = await one('SELECT id, name, price::float8 AS price FROM products WHERE id = $1', [body.product_id]);
    if (!p) throw new HttpError(404, 'المنتج غير موجود');
    if (p.price == null) throw new HttpError(400, `حدّد سعر «${p.name}» أولًا`);
    const qty = Math.max(1, Math.floor(Number(body.qty) || 1));
    const studentId = body.student_id ? Number(body.student_id) : null;
    const childId = !studentId && body.child_id ? Number(body.child_id) : null;
    const buyer = text(body.buyer_name, { max: 120, name: 'اسم المشتري' });
    if (!studentId && !childId && !buyer) throw new HttpError(400, 'اختر التلميذ أو اكتب اسم المشتري');
    const unit = body.unit_price === '' || body.unit_price == null ? p.price : money(body.unit_price, 'السعر');
    const row = await one(
      `INSERT INTO product_sales (product_id, student_id, child_id, buyer_name, qty, unit_price, amount, sold_on, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [p.id, studentId, childId, studentId || childId ? null : buyer, qty, unit, round3(unit * qty), date(body.sold_on || today()),
        text(body.note, { max: 300, name: 'ملاحظة' }), user.id]
    );
    return [201, { id: row.id }];
  });
  route('DELETE', '/api/product-sales/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM product_sales WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });

  // ---------- الصندوق اليومي: الداخل نقدًا، الخارج من الصندوق، سحب صاحب المشروع، والرصيد المتوقع ----------
  const cashDays = async (from, to) => {
    const rows = await all(
      `SELECT d::text AS date, SUM(cin)::float8 AS cash_in, SUM(cout)::float8 AS cash_out, SUM(wd)::float8 AS withdraw, SUM(dep)::float8 AS deposit FROM (
         SELECT paid_on AS d, amount AS cin, 0 AS cout, 0 AS wd, 0 AS dep FROM payments WHERE COALESCE(method, 'cash') = 'cash' AND paid_on BETWEEN $1 AND $2
         UNION ALL SELECT paid_on, amount, 0, 0, 0 FROM program_payments WHERE COALESCE(method, 'cash') = 'cash' AND paid_on BETWEEN $1 AND $2
         UNION ALL SELECT paid_on, amount, 0, 0, 0 FROM course_payments WHERE COALESCE(method, 'cash') = 'cash' AND paid_on BETWEEN $1 AND $2
         UNION ALL SELECT sold_on, amount, 0, 0, 0 FROM product_sales WHERE sold_on BETWEEN $1 AND $2
         UNION ALL SELECT date, CASE WHEN direction = 'income' THEN amount ELSE 0 END, CASE WHEN direction = 'expense' THEN amount ELSE 0 END, 0, 0
           FROM ledger_entries WHERE paid_from = 'cash' AND date BETWEEN $1 AND $2
         UNION ALL SELECT paid_on, 0, amount, 0, 0 FROM teacher_payments WHERE COALESCE(method, 'cash') = 'cash' AND paid_on BETWEEN $1 AND $2
         UNION ALL SELECT date, 0, 0, CASE WHEN kind = 'withdraw' THEN amount ELSE 0 END, CASE WHEN kind = 'deposit' THEN amount ELSE 0 END
           FROM cash_moves WHERE kind <> 'count' AND date BETWEEN $1 AND $2
       ) x GROUP BY d ORDER BY d`,
      [from, to]
    );
    return rows.map((r) => ({ ...r, net: round3(r.cash_in - r.cash_out) }));
  };
  route('GET', '/api/cash', ['admin'], async ({ query }) => {
    const month = monthParam(query.get('month'));
    const opening = await getSetting('cash_opening', null);
    const [first, last] = monthRange(month);
    const start = opening?.date || first;
    // الرصيد من تاريخ الافتتاح إلى آخر الشهر المعروض
    const all_ = opening ? await cashDays(start, last) : [];
    let bal = Number(opening?.amount) || 0;
    const balAt = new Map();
    for (const d of all_) {
      bal = round3(bal + d.cash_in - d.cash_out - d.withdraw + d.deposit);
      balAt.set(d.date, bal);
    }
    const days = (await cashDays(first, last)).map((d) => ({ ...d, balance: balAt.get(d.date) ?? null }));
    const t = today();
    const todayRow = (await cashDays(t, t))[0] || { date: t, cash_in: 0, cash_out: 0, withdraw: 0, deposit: 0, net: 0 };
    const moves = await all(
      `SELECT m.id, m.date::text, m.kind, m.person, m.amount::float8 AS amount, m.note, u.full_name AS by_name
       FROM cash_moves m LEFT JOIN users u ON u.id = m.created_by WHERE m.date BETWEEN $1 AND $2 ORDER BY m.date DESC, m.id DESC`,
      [first, last]
    );
    const lastCount = await one(`SELECT date::text, amount::float8 AS amount FROM cash_moves WHERE kind = 'count' ORDER BY date DESC, id DESC LIMIT 1`);
    let expectedAtCount = null;
    if (lastCount && opening && lastCount.date >= start) {
      expectedAtCount = Number(opening.amount) || 0;
      for (const d of await cashDays(start, lastCount.date)) expectedAtCount = round3(expectedAtCount + d.cash_in - d.cash_out - d.withdraw + d.deposit);
    }
    // صاحب المشروع: ما سحبه، وما صرفه منه على المركز
    const owner = await getSetting('partners_owner', 'Alaa');
    const draws = await one(
      `SELECT COALESCE((SELECT SUM(amount) FROM cash_moves WHERE kind = 'withdraw' AND date BETWEEN $1 AND $2), 0)::float8 AS withdrawn,
         COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE direction = 'expense' AND paid_from = 'owner' AND date BETWEEN $1 AND $2), 0)::float8 AS spent`,
      [first, last]
    );
    return {
      month, opening, today: todayRow, days,
      balance: balAt.size ? [...balAt.values()].pop() : opening ? Number(opening.amount) || 0 : null,
      balance_today: opening ? (() => { let b = Number(opening.amount) || 0; for (const d of all_) if (d.date <= t) b = round3(b + d.cash_in - d.cash_out - d.withdraw + d.deposit); return b; })() : null,
      moves, last_count: lastCount ? { ...lastCount, expected: expectedAtCount, diff: expectedAtCount === null ? null : round3(lastCount.amount - expectedAtCount) } : null,
      owner, draws: { ...draws, net: round3(draws.withdrawn - draws.spent) },
      month_totals: {
        cash_in: round3(days.reduce((s, d) => s + d.cash_in, 0)), cash_out: round3(days.reduce((s, d) => s + d.cash_out, 0)),
        withdraw: round3(days.reduce((s, d) => s + d.withdraw, 0)), deposit: round3(days.reduce((s, d) => s + d.deposit, 0)),
      },
    };
  });
  // كل معاملات يوم واحد (نقدًا وغير نقدًا): الدفوعات، المبيعات، المداخيل والمصاريف، الأجور، حركات الصندوق
  route('GET', '/api/cash/day', ['admin'], async ({ query }) => {
    const d = date(query.get('date') || today());
    const rows = await all(
      `SELECT * FROM (
         SELECT 'support' AS src, 'in' AS dir, p.id, p.amount::float8 AS amount, COALESCE(p.method, 'cash') AS method, s.full_name AS who, s.id AS who_id, p.month AS detail, p.receipt_no, p.note, p.created_at
           FROM payments p JOIN students s ON s.id = p.student_id WHERE p.paid_on = $1
         UNION ALL SELECT 'program', 'in', p.id, p.amount::float8, COALESCE(p.method, 'cash'), c.full_name, c.id, p.month, p.receipt_no, p.note, p.created_at
           FROM program_payments p JOIN program_children c ON c.id = p.child_id WHERE p.paid_on = $1
         UNION ALL SELECT 'courses', 'in', p.id, p.amount::float8, COALESCE(p.method, 'cash'), cp.full_name, cp.course_id, co.name, p.receipt_no, p.note, p.created_at
           FROM course_payments p JOIN course_participants cp ON cp.id = p.participant_id JOIN courses co ON co.id = cp.course_id WHERE p.paid_on = $1
         UNION ALL SELECT 'product', 'in', ps.id, ps.amount::float8, 'cash', COALESCE(s.full_name, c.full_name, ps.buyer_name), NULL, pr.name || CASE WHEN ps.qty > 1 THEN ' ×' || ps.qty ELSE '' END, NULL, ps.note, ps.created_at
           FROM product_sales ps JOIN products pr ON pr.id = ps.product_id LEFT JOIN students s ON s.id = ps.student_id LEFT JOIN program_children c ON c.id = ps.child_id WHERE ps.sold_on = $1
         UNION ALL SELECT 'ledger', CASE WHEN l.direction = 'income' THEN 'in' ELSE 'out' END, l.id, l.amount::float8, l.paid_from, COALESCE(st.full_name, u.full_name, l.description), NULL, l.category, NULL, l.description, l.created_at
           FROM ledger_entries l LEFT JOIN staff st ON st.id = l.staff_id LEFT JOIN users u ON u.id = l.teacher_id WHERE l.date = $1
         UNION ALL SELECT 'salary', 'out', t.id, t.amount::float8, COALESCE(t.method, 'cash'), u.full_name, u.id, t.month, NULL, t.note, t.created_at
           FROM teacher_payments t JOIN users u ON u.id = t.teacher_id WHERE t.paid_on = $1
         UNION ALL SELECT 'move', CASE WHEN m.kind = 'deposit' THEN 'in' WHEN m.kind = 'withdraw' THEN 'out' ELSE 'count' END, m.id, m.amount::float8, 'cash', m.person, NULL, m.kind, NULL, m.note, m.created_at
           FROM cash_moves m WHERE m.date = $1
       ) x ORDER BY created_at DESC, id DESC`,
      [d]
    );
    const items = rows.map((r) => ({ ...r, label: r.src === 'ledger' ? LEDGER_CATEGORIES[r.dir === 'in' ? 'income' : 'expense']?.[r.detail] || r.detail : null }));
    const sum = (f) => round3(items.filter(f).reduce((t, r) => t + r.amount, 0));
    const isCash = (r) => r.method === 'cash';
    const real = (r) => r.src !== 'move';
    const totals = {
      count: items.filter(real).length,
      in_all: sum((r) => real(r) && r.dir === 'in' && r.method !== 'owner'),
      in_cash: sum((r) => real(r) && r.dir === 'in' && isCash(r)),
      in_bank: sum((r) => real(r) && r.dir === 'in' && !isCash(r) && r.method !== 'owner'),
      out_all: sum((r) => real(r) && r.dir === 'out'),
      out_cash: sum((r) => real(r) && r.dir === 'out' && isCash(r)),
      withdraw: sum((r) => r.src === 'move' && r.detail === 'withdraw'),
      deposit: sum((r) => r.src === 'move' && r.detail === 'deposit'),
    };
    totals.net_cash = round3(totals.in_cash - totals.out_cash);
    return { date: d, items, totals };
  });
  route('POST', '/api/cash/moves', ['admin'], async ({ user, body }) => {
    const kind = ['withdraw', 'deposit', 'count'].includes(body.kind) ? body.kind : null;
    if (!kind) throw new HttpError(400, 'النوع غير صالح');
    const amount = money(body.amount, 'المبلغ');
    if (amount === null || (kind !== 'count' && !amount)) throw new HttpError(400, 'المبلغ إجباري');
    const row = await one(
      `INSERT INTO cash_moves (date, kind, person, amount, note, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [date(body.date || today()), kind, text(body.person, { max: 60, name: 'الشخص' }) || (kind === 'withdraw' ? await getSetting('partners_owner', 'Alaa') : null),
        amount, text(body.note, { max: 300, name: 'ملاحظة' }), user.id]
    );
    return [201, { id: row.id }];
  });
  route('DELETE', '/api/cash/moves/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM cash_moves WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });
  route('PUT', '/api/cash/opening', ['admin'], async ({ body }) => {
    const amount = money(body.amount, 'الرصيد');
    await saveSetting('cash_opening', { date: date(body.date || today()), amount: amount || 0 });
    return { ok: true };
  });

  // ---------- لوحة المشرف: صفحات الإحصائيات ----------
  // المداخيل والمصاريف أسبوعًا بأسبوع لكل برنامج (حسب تاريخ الدفع)
  route('GET', '/api/board/weeks', ['admin'], async ({ query }) => {
    const month = monthParam(query.get('month'));
    const [first, last] = monthRange(month);
    const rows = await all(
      `SELECT EXTRACT(DAY FROM d)::int AS day, act, dir, SUM(a)::float8 AS total FROM (
         SELECT paid_on AS d, 'support' AS act, 'in' AS dir, amount AS a FROM payments WHERE paid_on BETWEEN $1 AND $2
         UNION ALL SELECT paid_on, 'program', 'in', amount FROM program_payments WHERE paid_on BETWEEN $1 AND $2
         UNION ALL SELECT paid_on, 'courses', 'in', amount FROM course_payments WHERE paid_on BETWEEN $1 AND $2
         UNION ALL SELECT sold_on, 'products', 'in', amount FROM product_sales WHERE sold_on BETWEEN $1 AND $2
         UNION ALL SELECT paid_on, 'support', 'out', amount FROM teacher_payments WHERE paid_on BETWEEN $1 AND $2
         UNION ALL SELECT date, activity, CASE WHEN direction = 'income' THEN 'in' ELSE 'out' END, amount FROM ledger_entries WHERE date BETWEEN $1 AND $2
       ) x GROUP BY 1, 2, 3`,
      [first, last]
    );
    const weeks = [1, 8, 15, 22, 29].filter((d) => d <= daysInMonth(month)).map((d, i) => ({
      week: i + 1, from: `${month}-${String(d).padStart(2, '0')}`, to: `${month}-${String(Math.min(d + 6, daysInMonth(month))).padStart(2, '0')}`,
      income: {}, expense: {},
    }));
    for (const r of rows) {
      const w = weeks[Math.min(Math.floor((r.day - 1) / 7), weeks.length - 1)];
      const box = r.dir === 'in' ? w.income : w.expense;
      box[r.act] = round3((box[r.act] || 0) + r.total);
    }
    for (const w of weeks) {
      w.income_total = round3(Object.values(w.income).reduce((t, v) => t + v, 0));
      w.expense_total = round3(Object.values(w.expense).reduce((t, v) => t + v, 0));
      w.net = round3(w.income_total - w.expense_total);
    }
    return { month, weeks };
  });

  // الغيابات والملاحظات: آخر 6 أشهر، وتفاصيل الشهر
  route('GET', '/api/board/attendance', ['admin'], async ({ query }) => {
    const month = monthParam(query.get('month'));
    const [first, last] = monthRange(month);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
    const series = await all(
      `SELECT m, SUM(sup)::int AS support, SUM(prog)::int AS program, SUM(tch)::int AS teachers FROM (
         SELECT to_char(date, 'YYYY-MM') AS m, 1 AS sup, 0 AS prog, 0 AS tch FROM absences
         UNION ALL SELECT to_char(date, 'YYYY-MM'), 0, 1, 0 FROM program_absences
         UNION ALL SELECT to_char(date, 'YYYY-MM'), 0, 0, 1 FROM teacher_hour_adjustments WHERE timetable_id IS NOT NULL AND hours = 0
       ) x WHERE m = ANY($1) GROUP BY m`,
      [months]
    );
    const byLevel = await all(
      `SELECT st.level, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE NOT a.justified)::int AS unjustified
       FROM absences a JOIN students st ON st.id = a.student_id WHERE a.date BETWEEN $1 AND $2 GROUP BY st.level ORDER BY st.level`,
      [first, last]
    );
    const bySubject = await all(
      `SELECT COALESCE(s.name, '—') AS subject, COUNT(*)::int AS n FROM absences a LEFT JOIN subjects s ON s.id = a.subject_id
       WHERE a.date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC`,
      [first, last]
    );
    const topStudents = await all(
      `SELECT st.id, st.full_name, st.level, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE NOT a.justified)::int AS unjustified
       FROM absences a JOIN students st ON st.id = a.student_id WHERE a.date BETWEEN $1 AND $2
       GROUP BY st.id ORDER BY n DESC, st.full_name LIMIT 10`,
      [first, last]
    );
    const byClass = await all(
      `SELECT COALESCE(k.name, '—') AS class_name, COUNT(*)::int AS n FROM program_absences a JOIN program_children c ON c.id = a.child_id
       LEFT JOIN program_classes k ON k.id = c.class_id WHERE a.date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC`,
      [first, last]
    );
    const teacherAbs = await all(
      `SELECT u.id, u.full_name, COUNT(*)::int AS n FROM teacher_hour_adjustments h JOIN users u ON u.id = h.teacher_id
       WHERE h.timetable_id IS NOT NULL AND h.hours = 0 AND h.date BETWEEN $1 AND $2 GROUP BY u.id ORDER BY n DESC`,
      [first, last]
    );
    const notes = await all(
      `SELECT category, COUNT(*)::int AS n FROM (
         SELECT category FROM notes WHERE date BETWEEN $1 AND $2 UNION ALL SELECT category FROM program_notes WHERE date BETWEEN $1 AND $2
       ) x GROUP BY category ORDER BY 2 DESC`,
      [first, last]
    );
    const ratings = await all(
      `SELECT rating, COUNT(*)::int AS n FROM notes WHERE date BETWEEN $1 AND $2 AND rating IS NOT NULL GROUP BY rating`,
      [first, last]
    );
    return {
      month,
      series: months.map((m) => ({ month: m, ...(series.find((x) => x.m === m) || { support: 0, program: 0, teachers: 0 }), m: undefined })),
      by_level: byLevel, by_subject: bySubject, top_students: topStudents, by_class: byClass, teachers: teacherAbs, notes, ratings,
      totals: {
        support: byLevel.reduce((t, x) => t + x.n, 0), unjustified: byLevel.reduce((t, x) => t + x.unjustified, 0),
        program: byClass.reduce((t, x) => t + x.n, 0), teachers: teacherAbs.reduce((t, x) => t + x.n, 0),
        notes: notes.reduce((t, x) => t + x.n, 0),
      },
    };
  });

  // الإشعارات: أجور الشهر الماضي غير المدفوعة، والتلاميذ الذين لم يدفعوا الشهر الحالي
  route('GET', '/api/board/notices', ['admin'], async ({ user }) => {
    const cur = currentMonth();
    const prev = addMonths(cur, -1);
    const salaries = [];
    for (const m of [prev]) {
      const sm = await salariesMonth(m, user);
      for (const g of sm.groups) for (const p of g.people) {
        const rest = round3(p.due - p.paid);
        if (rest > 0.5) salaries.push({ month: m, group: g.label, name: p.name, due: p.due, paid: p.paid, rest, link: p.link || '#/salaries' });
      }
    }
    const fees = await feeTools();
    const students = await all(`SELECT ${STUDENT_COLUMNS}, u.phone AS parent_phone, u.full_name AS parent_name FROM students st LEFT JOIN users u ON u.id = st.parent_id WHERE st.status = 'studying'`);
    const sp = students.length ? await studentPayments(students.map((x) => x.id)) : [];
    const unpaid = [];
    for (const st of students) {
      const f = fees.student(st, sp.filter((p) => p.student_id === st.id));
      const m = f.months.find((x) => x.month === cur);
      if (m && m.remaining > 0) unpaid.push({ kind: 'support', id: st.id, full_name: st.full_name, level: st.level, month_rest: m.remaining, balance: f.balance, phone: st.parent_phone, parent: st.parent_name, link: `#/students/${st.id}` });
    }
    const children = await all(`${CHILD_SELECT} WHERE c.status = 'active'`);
    const pp = children.length ? await programPayments(children.map((c) => c.id)) : [];
    for (const c of children) {
      const f = fees.child(c, pp.filter((p) => p.child_id === c.id));
      const m = f.months.find((x) => x.month === cur);
      if (m && m.remaining > 0) unpaid.push({ kind: 'program', id: c.id, full_name: c.full_name, level: null, class_name: c.class_name, month_rest: m.remaining, balance: f.balance, phone: c.contact_phone, parent: c.contact_name, link: `#/program/child/${c.id}` });
    }
    unpaid.sort((a, b) => b.balance - a.balance);
    return {
      month: cur, prev, salaries, unpaid,
      totals: { salaries: round3(salaries.reduce((t, x) => t + x.rest, 0)), unpaid_month: round3(unpaid.reduce((t, x) => t + x.month_rest, 0)), unpaid_all: round3(unpaid.reduce((t, x) => t + Math.max(x.balance, 0), 0)) },
    };
  });

  // ---------- فضاء المحاسبة: مداخيل البنك كل شهر، مصاريف المحاسبة، الوصولات والملفات ----------
  route('GET', '/api/accounting', ['admin'], async ({ query }) => {
    const month = monthParam(query.get('month'));
    const [first, last] = monthRange(month);
    const lines = await all(
      `SELECT * FROM (
         SELECT 'support' AS kind, p.id, p.receipt_no, p.paid_on::text AS paid_on, p.method, p.amount::float8 AS amount, p.month AS for_month,
           st.full_name AS beneficiary, 'دروس الدعم' AS program
         FROM payments p JOIN students st ON st.id = p.student_id WHERE p.paid_on BETWEEN $1 AND $2
         UNION ALL
         SELECT 'program', p.id, p.receipt_no, p.paid_on::text, p.method, p.amount::float8, p.month, c.full_name, 'البرنامج التربوي'
         FROM program_payments p JOIN program_children c ON c.id = p.child_id WHERE p.paid_on BETWEEN $1 AND $2
         UNION ALL
         SELECT 'course', p.id, p.receipt_no, p.paid_on::text, p.method, p.amount::float8, NULL, cp.full_name, c.name
         FROM course_payments p JOIN course_participants cp ON cp.id = p.participant_id JOIN courses c ON c.id = cp.course_id
         WHERE p.paid_on BETWEEN $1 AND $2
       ) x ORDER BY paid_on, receipt_no`,
      [first, last]
    );
    const byMethod = {};
    for (const l of lines) byMethod[l.method || 'cash'] = round3((byMethod[l.method || 'cash'] || 0) + l.amount);
    const bank = lines.filter((l) => BANK_METHODS.includes(l.method));
    const expenses = await all(
      `SELECT l.id, l.category, l.amount::float8 AS amount, l.date::text, l.description,
         (SELECT COUNT(*)::int FROM documents d WHERE d.ledger_id = l.id) AS files
       FROM ledger_entries l WHERE l.direction = 'expense' AND l.category = ANY($1) AND l.date BETWEEN $2 AND $3 ORDER BY l.date`,
      [ACCOUNTING_CATEGORIES, first, last]
    );
    const documents = await all(
      `SELECT id, folder, month, ledger_id, receipt_no, title, filename, mime, size, created_at::date::text AS created
       FROM documents WHERE folder = 'month' AND month = $1 ORDER BY id`,
      [month]
    );
    return {
      month, bank, by_method: byMethod,
      bank_total: round3(bank.reduce((t, l) => t + l.amount, 0)),
      total: round3(lines.reduce((t, l) => t + l.amount, 0)),
      expenses, expense_categories: Object.fromEntries(ACCOUNTING_CATEGORIES.map((k) => [k, LEDGER_CATEGORIES.expense[k]])),
      new_categories: ACCOUNTING_NEW,
      documents,
    };
  });

  // مصاريف المحاسبة (القباضة، الرسوم الشهرية، التصريح السنوي، أخرى…) من فضاء المحاسبة
  route('POST', '/api/accounting/expenses', ['admin'], async ({ user, body }) => {
    const category = ACCOUNTING_NEW.includes(body.category) ? body.category : null;
    if (!category) throw new HttpError(400, 'اختر النوع');
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const description = text(body.description, { max: 300, name: 'البيان' });
    if (category === 'acc_other' && !description) throw new HttpError(400, 'اكتب البيان');
    const row = await one(
      `INSERT INTO ledger_entries (direction, activity, category, amount, date, description, created_by)
       VALUES ('expense', 'general', $1, $2, $3, $4, $5) RETURNING id`,
      [category, amount, date(body.date || today()), description, user.id]
    );
    return [201, { id: row.id }];
  });
  route('DELETE', '/api/accounting/expenses/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query(
      `DELETE FROM ledger_entries WHERE id = $1 AND direction = 'expense' AND category = ANY($2)`,
      [params.id, ACCOUNTING_CATEGORIES]
    );
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });

  const DOC_MAX = 4 * 1024 * 1024;
  route('GET', '/api/documents', ['admin'], async ({ query }) => ({
    documents: await all(
      `SELECT id, folder, month, ledger_id, receipt_no, title, filename, mime, size, doc_date::text, created_at::date::text AS created
       FROM documents WHERE folder = $1 ${query.get('month') ? 'AND month = $2' : ''} ORDER BY COALESCE(month, '') DESC, doc_date DESC NULLS LAST, id DESC`,
      query.get('month') ? [DOC_FOLDERS.includes(query.get('folder')) ? query.get('folder') : 'month', query.get('month')] : [DOC_FOLDERS.includes(query.get('folder')) ? query.get('folder') : 'month']
    ),
  }));
  // جدول السنة الدراسية للمحاسب: مداخيل البنك، ومدفوعات كل نوع شهرًا بشهر (سبتمبر ← أوت)
  route('GET', '/api/accounting/year', ['admin'], async ({ query }) => {
    const ref = monthParam(query.get('month'));
    const [y, m] = ref.split('-').map(Number);
    const start = m >= 9 ? y : y - 1;
    const months = [];
    for (let mm = `${start}-09`; mm <= `${start + 1}-08`; mm = nextMonth(mm)) months.push(mm);
    const [first] = monthRange(months[0]);
    const [, last] = monthRange(months[11]);
    const bankRows = await all(
      `SELECT to_char(paid_on, 'YYYY-MM') AS month, SUM(amount)::float8 AS total FROM (
         SELECT paid_on, amount, method FROM payments UNION ALL SELECT paid_on, amount, method FROM program_payments
         UNION ALL SELECT paid_on, amount, method FROM course_payments) x
       WHERE method = ANY($1) AND paid_on BETWEEN $2 AND $3 GROUP BY 1`,
      [BANK_METHODS, first, last]
    );
    const exp = await all(
      `SELECT category, to_char(date, 'YYYY-MM') AS month, SUM(amount)::float8 AS total, COUNT(*)::int AS n
       FROM ledger_entries WHERE direction = 'expense' AND category = ANY($1) AND date BETWEEN $2 AND $3 GROUP BY 1, 2`,
      [ACCOUNTING_CATEGORIES, first, last]
    );
    const cell = (cat, mo) => exp.find((e) => e.category === cat && e.month === mo)?.total || 0;
    const groups = ACCOUNTING_GROUPS.map(([key, label, cats]) => ({
      key, label,
      rows: cats
        .filter((c) => ACCOUNTING_NEW.includes(c) || exp.some((e) => e.category === c))
        .map((c) => ({ category: c, label: LEDGER_CATEGORIES.expense[c], months: months.map((mo) => cell(c, mo)), total: round3(months.reduce((t, mo) => t + cell(c, mo), 0)) })),
    }));
    const monthTotals = months.map((mo) => round3(exp.filter((e) => e.month === mo).reduce((t, e) => t + e.total, 0)));
    const bank = months.map((mo) => bankRows.find((b) => b.month === mo)?.total || 0);
    return {
      year: `${start}-${start + 1}`, months, groups, month_totals: monthTotals, bank,
      totals: { bank: round3(bank.reduce((t, v) => t + v, 0)), expenses: round3(monthTotals.reduce((t, v) => t + v, 0)) },
    };
  });
  // محاضر الاجتماعات (من «الاجتماعات والقرارات») مع ملفات PV المرفوعة
  route('GET', '/api/accounting/pv', ['admin'], async () => ({
    meetings: await all(
      `SELECT m.id, m.title, m.date::text, m.attendees, left(COALESCE(m.minutes, m.agenda, ''), 400) AS summary,
         (SELECT COUNT(*)::int FROM decisions d WHERE d.meeting_id = m.id) AS decisions
       FROM meetings m ORDER BY m.date DESC, m.id DESC LIMIT 60`
    ),
  }));

  route('POST', '/api/documents', ['admin'], async ({ user, body }) => {
    const folder = DOC_FOLDERS.includes(body.folder) ? body.folder : 'month';
    const month = ['month', 'bank'].includes(folder) ? String(body.month || '') : null;
    if (month !== null && !MONTH_RE.test(month)) throw new HttpError(400, 'الشهر غير صالح');
    const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
    if (!m) throw new HttpError(400, 'الملف غير صالح');
    const size = Math.floor((m[2].length * 3) / 4);
    if (size > DOC_MAX) throw new HttpError(400, 'الملف أكبر من 4 ميغا');
    const row = await one(
      `INSERT INTO documents (folder, month, ledger_id, receipt_no, title, filename, mime, size, data, uploaded_by, doc_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [folder, month, Number(body.ledger_id) || null, Number(body.receipt_no) || null, text(body.title, { max: 200, name: 'العنوان' }),
        text(body.filename, { required: true, max: 200, name: 'اسم الملف' }), m[1], size, body.data, user.id, body.doc_date ? date(body.doc_date, 'التاريخ') : null]
    );
    return [201, { id: row.id }];
  });
  route('GET', '/api/documents/:id/file', ['admin'], async ({ params }) => {
    const d = await one('SELECT filename, mime, data FROM documents WHERE id = $1', [params.id]);
    if (!d) throw new HttpError(404, 'الملف غير موجود');
    const b64 = d.data.slice(d.data.indexOf(',') + 1);
    return new Response(Buffer.from(b64, 'base64'), {
      headers: { 'Content-Type': d.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(d.filename)}`, 'Cache-Control': 'private, max-age=3600' },
    });
  });
  route('DELETE', '/api/documents/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM documents WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الملف غير موجود');
    return { ok: true };
  });

  // ---------- دفتر الأشهر: كل مبلغ يُحتسب في الشهر الذي يخصّه (الشهر المعني)، حتى لو دُفع لاحقًا ----------
  // دفعات التلاميذ والأطفال: حسب «الشهر» المسجّل، خلاص المدرّسين: حسب شهر الخلاص، الأجور الشهرية: حسب شهر الأجرة،
  // وبقية المصاريف ومعاليم التسجيل والدورات: حسب تاريخها
  async function monthlyBook(months) {
    const byMonth = (rows) => Object.fromEntries(rows.map((r) => [r.m, r.total]));
    const q = (sql) => all(sql, [months]).then(byMonth);
    const [supPay, supReg, progPay, progReg, coursePay, teacherPay, late, productSales] = await Promise.all([
      q(`SELECT month AS m, SUM(amount)::float8 AS total FROM payments WHERE month = ANY($1) GROUP BY 1`),
      Promise.resolve({}),
      q(`SELECT month AS m, SUM(amount)::float8 AS total FROM program_payments WHERE month = ANY($1) GROUP BY 1`),
      Promise.resolve({}),
      q(`SELECT to_char(paid_on, 'YYYY-MM') AS m, SUM(amount)::float8 AS total FROM course_payments WHERE to_char(paid_on, 'YYYY-MM') = ANY($1) GROUP BY 1`),
      q(`SELECT month AS m, SUM(amount)::float8 AS total FROM teacher_payments WHERE month = ANY($1) GROUP BY 1`),
      // منها دُفع بعد شهره (متأخرات)
      q(`SELECT m, SUM(a)::float8 AS total FROM (
           SELECT month AS m, amount AS a FROM payments WHERE month = ANY($1) AND to_char(paid_on, 'YYYY-MM') > month
           UNION ALL SELECT month, amount FROM program_payments WHERE month = ANY($1) AND to_char(paid_on, 'YYYY-MM') > month) x GROUP BY m`),
      q(`SELECT to_char(sold_on, 'YYYY-MM') AS m, SUM(amount)::float8 AS total FROM product_sales WHERE to_char(sold_on, 'YYYY-MM') = ANY($1) GROUP BY 1`),
    ]);
    const ledger = await all(
      `SELECT COALESCE(salary_month, to_char(date, 'YYYY-MM')) AS m, direction, activity, category, SUM(amount)::float8 AS total
       FROM ledger_entries WHERE COALESCE(salary_month, to_char(date, 'YYYY-MM')) = ANY($1) GROUP BY 1, 2, 3, 4`,
      [months]
    );
    return months.map((m) => {
      const L = (f) => round3(ledger.filter((x) => x.m === m && f(x)).reduce((s, x) => s + x.total, 0));
      const income = {
        support: round3((supPay[m] || 0) + (supReg[m] || 0) + L((x) => x.direction === 'income' && x.activity === 'support')),
        program: round3((progPay[m] || 0) + (progReg[m] || 0) + L((x) => x.direction === 'income' && x.activity === 'program')),
        courses: round3((coursePay[m] || 0) + L((x) => x.direction === 'income' && x.activity === 'courses')),
        products: round3(productSales[m] || 0),
        other: L((x) => x.direction === 'income' && x.activity === 'general'),
      };
      const E = (f) => L((x) => x.direction === 'expense' && f(x));
      const expense = {
        salaries_support: round3((teacherPay[m] || 0) + E((x) => x.activity === 'support' && x.category === 'salary')),
        salaries_program: E((x) => x.activity === 'program' && x.category === 'salary'),
        salaries_admin: E((x) => x.activity === 'general' && x.category === 'salary'),
        salaries_courses: E((x) => x.activity === 'courses' && x.category === 'salary'),
        rent: E((x) => x.category === 'rent'),
        other: E((x) => x.category !== 'salary' && x.category !== 'rent'),
      };
      const income_total = round3(Object.values(income).reduce((s, v) => s + v, 0));
      const expense_total = round3(Object.values(expense).reduce((s, v) => s + v, 0));
      return { month: m, income, expense, income_total, expense_total, net: round3(income_total - expense_total), late_collected: round3(late[m] || 0) };
    });
  }

  async function partnerSplit(net, month) {
    const partners = await getSetting('partners', [{ name: 'Aymen', share: 25, from: '2026-09' }]);
    const owner = await getSetting('partners_owner', 'Alaa');
    const shares = {};
    let others = 0;
    for (const p of partners) {
      const pct = month >= p.from ? Number(p.share) || 0 : 0;
      shares[p.name] = round3((net * pct) / 100);
      others += pct;
    }
    shares[owner] = round3((net * (100 - others)) / 100);
    return shares;
  }

  // ---------- لوحة المشرف العام: السنة كاملة (إدارية: جانفي-ديسمبر، أو دراسية: سبتمبر-أوت) ----------
  route('GET', '/api/dashboard/year', ['admin'], async ({ user, query }) => {
    // الإحصائيات حسب صلاحية «stats»، ونصيب الشركاء للمشرف العام فقط
    const showShares = !!user.super_admin || !!permsOf(user).partners;
    const mode = query.get('mode') === 'calendar' ? 'calendar' : 'school';
    const cur = currentMonth();
    const defYear = mode === 'calendar' ? Number(cur.slice(0, 4)) : Number(cur.slice(5, 7)) >= 9 ? Number(cur.slice(0, 4)) : Number(cur.slice(0, 4)) - 1;
    const year = Number(query.get('year')) || defYear;
    const first = mode === 'calendar' ? `${year}-01` : `${year}-09`;
    const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
    const rows = [];
    for (const r of await monthlyBook(months)) {
      rows.push({ ...r, shares: showShares ? await partnerSplit(r.net, r.month) : {}, future: r.month > cur });
    }
    const tot = (f) => round3(rows.reduce((s, r) => s + f(r), 0));
    const keysIn = ['support', 'program', 'courses', 'products', 'other'];
    const keysEx = ['salaries_support', 'salaries_program', 'salaries_admin', 'salaries_courses', 'rent', 'other'];
    const counts = await one(`SELECT
      (SELECT COUNT(*)::int FROM students WHERE status = 'studying') AS support,
      (SELECT COUNT(*)::int FROM students WHERE status = 'waiting') AS waiting,
      (SELECT COUNT(*)::int FROM program_children WHERE status = 'active') AS program,
      (SELECT COUNT(*)::int FROM course_participants) AS courses,
      (SELECT COUNT(*)::int FROM users WHERE role = 'teacher' AND NOT program_staff) AS teachers,
      (SELECT COUNT(*)::int FROM users WHERE role = 'teacher' AND program_staff) AS staff,
      (SELECT COALESCE(SUM(d.amount), 0) - COALESCE((SELECT SUM(amount) FROM center_debt_payments), 0) FROM center_debts d)::float8 AS center_debts`);
    const debts = await familyDebts();
    const acc = months.includes(cur) ? await accrualForMonth(cur) : null;
    const partnerNames = Object.keys(rows[0]?.shares || {});
    return {
      mode, year, months: rows, counts,
      parents_owe: round3(debts.reduce((s, f) => s + f.total, 0)),
      collection: acc ? { month: cur, billed: round3(acc.support.billed + acc.program.billed), collected: round3(acc.support.collected + acc.program.collected) } : null,
      totals: {
        income: Object.fromEntries(keysIn.map((k) => [k, tot((r) => r.income[k])])),
        expense: Object.fromEntries(keysEx.map((k) => [k, tot((r) => r.expense[k])])),
        income_total: tot((r) => r.income_total), expense_total: tot((r) => r.expense_total), net: tot((r) => r.net),
        late_collected: tot((r) => r.late_collected),
        shares: Object.fromEntries(partnerNames.map((n) => [n, tot((r) => r.shares[n] || 0)])),
      },
    };
  });

  // ---------- الشركاء: نصيب كل شريك من المرابيح الشهرية (للمشرف العام فقط) ----------
  const superOnly = (user) => {
    if (!user.super_admin) throw new HttpError(403, 'هذه الصفحة للمشرف العام فقط');
  };
  route('GET', '/api/partners', ['admin'], async ({ user }) => {
    if (!user.super_admin && !permsOf(user).partners) superOnly(user);
    const partners = await getSetting('partners', [{ name: 'Aymen', share: 25, from: '2026-09' }]);
    const owner = await getSetting('partners_owner', 'Alaa');
    const start = partners.reduce((m, p) => (p.from < m ? p.from : m), '9999-12');
    const months = [];
    const list = [];
    for (let m = start; m <= currentMonth(); m = addMonths(m, 1)) list.push(m);
    for (const r of await monthlyBook(list)) {
      months.push({ month: r.month, income: r.income_total, expense: r.expense_total, net: r.net, late: r.late_collected, shares: await partnerSplit(r.net, r.month) });
    }
    const payments = await all(
      `SELECT id, partner, amount::float8 AS amount, paid_on::text, note FROM partner_payments ORDER BY paid_on DESC, id DESC`
    );
    // الشريك وليّ أيضًا: معاليم أبنائه المدفوعة بـ«خصم من نصيب الشريك» تُحتسب كمبلغ أخذه
    for (const p of partners.filter((x) => x.parent_id)) {
      const rows = await all(
        `SELECT * FROM (
           SELECT p.id, p.paid_on::text AS paid_on, p.amount::float8 AS amount, s.full_name AS who, p.month FROM payments p JOIN students s ON s.id = p.student_id
           WHERE p.method = 'partner' AND s.parent_id = $1
           UNION ALL SELECT p.id, p.paid_on::text, p.amount::float8, c.full_name, p.month FROM program_payments p JOIN program_children c ON c.id = p.child_id
             LEFT JOIN students s ON s.id = c.student_id WHERE p.method = 'partner' AND (c.parent_id = $1 OR s.parent_id = $1)
           UNION ALL SELECT r.id, r.paid_on::text, r.amount::float8, COALESCE(s.full_name, c.full_name), 'التسجيل' FROM registration_payments r
             LEFT JOIN students s ON s.id = r.student_id LEFT JOIN program_children c ON c.id = r.child_id
             WHERE r.method = 'partner' AND (s.parent_id = $1 OR c.parent_id = $1)
         ) x`,
        [p.parent_id]
      );
      for (const r of rows) payments.push({ id: null, offset: true, partner: p.name, amount: r.amount, paid_on: r.paid_on, note: `🤝 معلوم ${r.who}${r.month ? ` · ${r.month}` : ''}` });
    }
    payments.sort((a, b) => (a.paid_on < b.paid_on ? 1 : a.paid_on > b.paid_on ? -1 : 0));
    // opening: ما بقي لكل شريك قبل شهر البداية (من الحساب القديم)، history: السجلّ القديم شهرًا بشهر
    const summary = partners.map((p) => {
      const due = round3(months.reduce((t, m) => t + (m.shares[p.name] || 0), 0));
      const paidAfter = round3(payments.filter((x) => x.partner === p.name && x.paid_on >= `${p.from}-01`).reduce((t, x) => t + x.amount, 0));
      const paidBefore = round3(payments.filter((x) => x.partner === p.name && x.paid_on < `${p.from}-01`).reduce((t, x) => t + x.amount, 0));
      const opening = Number(p.opening) || 0;
      return { ...p, opening, due, paid: paidAfter, paid_before: paidBefore, balance: round3(opening + due - paidAfter) };
    });
    const history = await getSetting('partners_history', []);
    // صاحب المشروع: نصيبه = الصافي − نصيب الشركاء، وما أخذه = ما سحبه من الصندوق − ما صرفه منه على المركز
    const ownerDue = round3(months.reduce((t, m) => t + m.net - partners.reduce((u, p) => u + (m.shares[p.name] || 0), 0), 0));
    const od = await one(
      `SELECT COALESCE((SELECT SUM(amount) FROM cash_moves WHERE kind = 'withdraw' AND date >= $1), 0)::float8 AS withdrawn,
         COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE direction = 'expense' AND paid_from = 'owner' AND date >= $1), 0)::float8 AS spent`,
      [`${start}-01`]
    );
    const owner_summary = { name: owner, due: ownerDue, withdrawn: od.withdrawn, spent: od.spent, taken: round3(od.withdrawn - od.spent), balance: round3(ownerDue - (od.withdrawn - od.spent)) };
    // توقّع آخر الشهر الحالي: الربح الحالي − الأجور الباقية (دون غيابات) − المصاريف القارّة الباقية
    const cur = currentMonth();
    let forecast = null;
    if (months.some((m) => m.month === cur)) {
      const f = await monthForecast(user, cur, { partnersBook: true });
      forecast = { month: cur, net_now: f.net_now, salaries_left: f.salaries_left, fixed_left: f.fixed_left, net_expected: f.net_expected, shares: await partnerSplit(f.net_expected, cur) };
    }
    return { owner, partners, months: months.reverse(), payments, summary, history, owner_summary, forecast };
  });
  route('POST', '/api/partners/payments', ['admin'], async ({ user, body }) => {
    superOnly(user);
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const row = await one(
      `INSERT INTO partner_payments (partner, amount, paid_on, note, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [text(body.partner, { required: true, max: 60, name: 'الشريك' }), amount, date(body.paid_on || today()), text(body.note, { max: 300, name: 'ملاحظة' }), user.id]
    );
    return [201, { id: row.id }];
  });
  route('DELETE', '/api/partners/payments/:id', ['admin'], async ({ user, params }) => {
    superOnly(user);
    const { rowCount } = await pool.query('DELETE FROM partner_payments WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });
  route('PUT', '/api/partners/settings', ['admin'], async ({ user, body }) => {
    superOnly(user);
    const list = (Array.isArray(body.partners) ? body.partners : []).map((p) => {
      const share = money(p.share, 'النسبة');
      if (share === null || share > 100) throw new HttpError(400, 'النسبة غير صالحة');
      if (!MONTH_RE.test(p.from || '')) throw new HttpError(400, 'شهر البداية غير صالح');
      return { name: text(p.name, { required: true, max: 60, name: 'الاسم' }), share, from: p.from, opening: money(p.opening, 'الرصيد الافتتاحي') || 0,
        parent_id: Number(p.parent_id) || null };
    });
    await saveSetting('partners', list);
    if (body.owner) await saveSetting('partners_owner', text(body.owner, { max: 60, name: 'الاسم' }));
    return { ok: true };
  });

  // ---------- جدول أوقات البرنامج التربوي ----------
  route('GET', '/api/program/slots', ['admin', 'teacher'], async () => ({
    slots: await all(
      `SELECT s.id, s.class_id, pc.name AS class_name, s.day, s.start_time, s.end_time, s.title, s.teacher_id,
         u.full_name AS teacher_name, s.room
       FROM program_slots s JOIN program_classes pc ON pc.id = s.class_id LEFT JOIN users u ON u.id = s.teacher_id
       ORDER BY s.day, s.start_time, pc.name`
    ),
  }));
  const readProgramSlot = async (body) => {
    const classId = Number(body.class_id);
    if (!(await one('SELECT 1 FROM program_classes WHERE id = $1', [classId]))) throw new HttpError(400, 'اختر القسم');
    const day = Number(body.day);
    if (!(day >= 1 && day <= 7)) throw new HttpError(400, 'اليوم غير صالح');
    if (!TIME_RE.test(body.start_time || '') || !TIME_RE.test(body.end_time || '') || body.start_time >= body.end_time) {
      throw new HttpError(400, 'التوقيت غير صالح');
    }
    const teacherId = body.teacher_id ? Number(body.teacher_id) : null;
    if (teacherId && !(await one(`SELECT 1 FROM users WHERE id = $1 AND role = 'teacher'`, [teacherId]))) throw new HttpError(400, 'المنشط غير موجود');
    return [classId, day, body.start_time, body.end_time, text(body.title, { max: 120, name: 'النشاط' }), teacherId, text(body.room, { max: 60, name: 'القاعة' })];
  };
  route('POST', '/api/program/slots', ['admin'], async ({ body }) => {
    const row = await one(
      `INSERT INTO program_slots (class_id, day, start_time, end_time, title, teacher_id, room) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      await readProgramSlot(body)
    );
    return [201, { id: row.id }];
  });
  route('PUT', '/api/program/slots/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      `UPDATE program_slots SET class_id = $1, day = $2, start_time = $3, end_time = $4, title = $5, teacher_id = $6, room = $7 WHERE id = $8`,
      [...(await readProgramSlot(body)), params.id]
    );
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });
  route('DELETE', '/api/program/slots/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM program_slots WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });

  // آخر ملاحظات المنشطين في كل الأقسام
  route('GET', '/api/program/notes', ['admin'], async ({ query }) => {
    const classId = Number(query.get('class_id')) || null;
    return {
      notes: await all(
        `SELECT n.id, n.child_id, c.full_name AS child_name, pc.name AS class_name, n.category, n.rating, n.content, n.date::text,
           u.full_name AS author_name
         FROM program_notes n JOIN program_children c ON c.id = n.child_id
         LEFT JOIN program_classes pc ON pc.id = c.class_id LEFT JOIN users u ON u.id = n.author_id
         WHERE ($1::int IS NULL OR c.class_id = $1)
         ORDER BY n.date DESC, n.id DESC LIMIT 150`,
        [classId]
      ),
    };
  });

  route('GET', '/api/program', ['admin', 'teacher'], async ({ user }) => {
    const mine = user.role === 'teacher' ? 'WHERE k.teacher_id = $1' : '';
    const classes = await all(
      `SELECT k.id, k.name, k.age_range, k.notes, k.default_fee::float8 AS default_fee, k.formulas, k.teacher_id, u.full_name AS teacher_name,
         (SELECT COUNT(*)::int FROM program_children c WHERE c.class_id = k.id AND c.status = 'active') AS children
       FROM program_classes k LEFT JOIN users u ON u.id = k.teacher_id ${mine} ORDER BY k.name`,
      user.role === 'teacher' ? [user.id] : []
    );
    if (user.role === 'teacher') {
      const children = await all(
        `SELECT c.id, c.full_name, c.birth_date::text, c.class_id, c.status, k.name AS class_name,
           (SELECT COUNT(*)::int FROM program_absences a WHERE a.child_id = c.id) AS absence_count,
           (SELECT COUNT(*)::int FROM program_notes n WHERE n.child_id = c.id) AS note_count
         FROM program_children c JOIN program_classes k ON k.id = c.class_id
         WHERE k.teacher_id = $1 AND c.status = 'active' ORDER BY k.name, c.full_name`,
        [user.id]
      );
      return { classes, children };
    }
    const children = await all(`${CHILD_SELECT} ORDER BY c.status, k.name NULLS LAST, c.full_name`);
    const payments = children.length ? await programPayments(children.map((c) => c.id)) : [];
    const fees = await feeTools();
    const counts = await all(
      `SELECT c.id, (SELECT COUNT(*)::int FROM program_absences a WHERE a.child_id = c.id) AS absence_count,
         (SELECT COUNT(*)::int FROM program_notes n WHERE n.child_id = c.id) AS note_count FROM program_children c`
    );
    const countOf = new Map(counts.map((x) => [x.id, x]));
    for (const c of children) {
      const f = fees.child(c, payments.filter((p) => p.child_id === c.id));
      c.balance = f.balance;
      c.sibling_pct = f.sibling_pct;
      c.absence_count = countOf.get(c.id)?.absence_count ?? 0;
      c.note_count = countOf.get(c.id)?.note_count ?? 0;
    }
    return { classes, children };
  });

  // مدرّس القسم: مؤطّر، أو معلم دعم (يولّي مؤطّرًا أيضًا)، أو ولي (يُفتح له حساب مؤطّر مرتبط به)
  async function classTeacher(rawId) {
    const id = Number(rawId) || null;
    if (!id) return null;
    const t = await userById(id);
    if (!t || !['teacher', 'parent'].includes(t.role)) throw new HttpError(400, 'المدرّس غير موجود');
    if (t.role === 'teacher') {
      if (!t.program_staff && !t.also_program) await pool.query('UPDATE users SET also_program = true WHERE id = $1', [t.id]);
      return t.id;
    }
    // ولي: حساب مؤطّر واحد مرتبط به (يُعاد استعماله)
    const linked = await one(`SELECT id FROM users WHERE role = 'teacher' AND linked_parent_id = $1`, [t.id]);
    if (linked) return linked.id;
    let username = `${t.username}.prog`;
    for (let i = 2; await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username]); i++) username = `${t.username}.prog${i}`;
    const row = await one(
      `INSERT INTO users (username, password_hash, full_name, role, phone, email, program_staff, volunteer, linked_parent_id)
       VALUES ($1, $2, $3, 'teacher', $4, $5, true, true, $6) RETURNING id`,
      [username, hashPassword(crypto.randomBytes(12).toString('hex')), t.full_name, t.phone, t.email, t.id]
    );
    return row.id;
  }

  async function readClass(body) {
    const teacherId = await classTeacher(body.teacher_id);
    return [
      text(body.name, { required: true, max: 120, name: 'اسم القسم' }),
      text(body.age_range, { max: 60, name: 'الأعمار' }),
      text(body.notes, { max: 500, name: 'ملاحظات' }),
      money(body.default_fee, 'المعلوم الشهري'),
      teacherId,
    ];
  }

  // صيغ القسم: [{ name, fee }]
  const readFormulas = (list) =>
    (Array.isArray(list) ? list : [])
      .map((f) => ({ name: text(f?.name, { max: 80, name: 'اسم الصيغة' }), fee: money(f?.fee, 'معلوم الصيغة') }))
      .filter((f) => f.name && f.fee !== null)
      .slice(0, 10);
  const setClassFormulas = async (id, body) => {
    if (body.formulas !== undefined) await pool.query('UPDATE program_classes SET formulas = $1 WHERE id = $2', [JSON.stringify(readFormulas(body.formulas)), id]);
  };
  // صيغة الطفل: المعلوم الشهري يؤخذ من الصيغة إن لم يُكتب مبلغ آخر
  const setChildFormula = async (id, body) => {
    if (body.formula === undefined) return;
    const c = await one('SELECT c.class_id, k.formulas FROM program_children c LEFT JOIN program_classes k ON k.id = c.class_id WHERE c.id = $1', [id]);
    const f = (c?.formulas || []).find((x) => x.name === body.formula);
    await pool.query('UPDATE program_children SET formula = $1 WHERE id = $2', [f ? f.name : null, id]);
    if (f && (body.monthly_fee === undefined || body.monthly_fee === '' || body.monthly_fee === null)) {
      await pool.query('UPDATE program_children SET monthly_fee = $1 WHERE id = $2', [f.fee, id]);
    }
  };

  route('POST', '/api/program/classes', ['admin'], async ({ body }) => {
    const row = await one(
      'INSERT INTO program_classes (name, age_range, notes, default_fee, teacher_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      await readClass(body)
    );
    await setClassFormulas(row.id, body);
    return [201, { class: row }];
  });

  route('PUT', '/api/program/classes/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      'UPDATE program_classes SET name = $1, age_range = $2, notes = $3, default_fee = $4, teacher_id = $5 WHERE id = $6',
      [...(await readClass(body)), params.id]
    );
    if (!rowCount) throw new HttpError(404, 'القسم غير موجود');
    await setClassFormulas(params.id, body);
    return { ok: true };
  });

  // إسناد مجموعة (قسم) لمؤطّر، أو فكّها
  route('PATCH', '/api/program/classes/:id/teacher', ['admin'], async ({ params, body }) => {
    const tid = await classTeacher(body.teacher_id);
    const { rowCount } = await pool.query('UPDATE program_classes SET teacher_id = $1 WHERE id = $2', [tid, params.id]);
    if (!rowCount) throw new HttpError(404, 'القسم غير موجود');
    return { ok: true };
  });

  route('DELETE', '/api/program/classes/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM program_classes WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'القسم غير موجود');
    return { ok: true };
  });

  route('POST', '/api/program/children', ['admin'], async ({ body }) => {
    const vals = await readChild(body);
    const row = await one(
      `INSERT INTO program_children (full_name, birth_date, class_id, guardian_name, guardian_phone, monthly_fee,
         start_date, status, end_date, free, notes, discount, discount_reason, parent_id, student_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      vals
    );
    await setChildFormula(row.id, body);
    // طفل مسجّل أيضًا في الدعم: معلوم التسجيل مرة واحدة (في ملف الدعم)
    if (!vals[14]) await addRegistration('child_id', row.id, vals[6], vals[9]);
    return [201, { child: row }];
  });

  route('PUT', '/api/program/children/:id', ['admin'], async ({ params, body }) => {
    const prev = await one('SELECT monthly_fee::float8 AS monthly_fee, discount::float8 AS discount FROM program_children WHERE id = $1', [params.id]);
    if (!prev) throw new HttpError(404, 'الطفل غير موجود');
    const vals = await readChild(body, params.id);
    await recordFeeChange('child_id', Number(params.id), prev, { monthly_fee: vals[5], discount: vals[11] }, body.fee_from);
    const { rowCount } = await pool.query(
      `UPDATE program_children SET full_name = $1, birth_date = $2, class_id = $3, guardian_name = $4, guardian_phone = $5,
         monthly_fee = $6, start_date = $7, status = $8, end_date = $9, free = $10, notes = $11, discount = $12,
         discount_reason = $13, parent_id = $14, student_id = $15 WHERE id = $16`,
      [...vals, params.id]
    );
    if (!rowCount) throw new HttpError(404, 'الطفل غير موجود');
    await setChildFormula(params.id, body);
    return { ok: true };
  });

  route('DELETE', '/api/program/children/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM program_children WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الطفل غير موجود');
    return { ok: true };
  });

  route('GET', '/api/program/children/:id', ['admin', 'parent', 'teacher'], async ({ user, params }) =>
    childFile(user, await loadChildFor(user, params.id))
  );

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

  // ---------- متابعة الطفل: الغيابات والملاحظات (الإدارة ومنشط القسم) ----------
  const PROGRAM_NOTE_CATEGORIES = ['level', 'content', 'behavior', 'general'];

  route('POST', '/api/program/children/:id/absences', ['admin', 'teacher'], async ({ user, params, body }) => {
    const child = await loadChildFor(user, params.id);
    const absence = await one(
      `INSERT INTO program_absences (child_id, date, justified, reason, recorded_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (child_id, date) DO UPDATE SET reason = EXCLUDED.reason RETURNING id`,
      [child.id, date(body.date || today()), user.role === 'admin' && !!body.justified, text(body.reason, { max: 500, name: 'السبب' }), user.id]
    );
    return [201, { absence }];
  });

  route('PATCH', '/api/program/absences/:id', ['admin'], async ({ params, body }) => {
    const absence = await one('UPDATE program_absences SET justified = $1 WHERE id = $2 RETURNING id, justified', [!!body.justified, params.id]);
    if (!absence) throw new HttpError(404, 'الغياب غير موجود');
    return { absence };
  });

  route('DELETE', '/api/program/absences/:id', ['admin', 'teacher'], async ({ user, params }) => {
    const a = await one('SELECT recorded_by FROM program_absences WHERE id = $1', [params.id]);
    if (!a) throw new HttpError(404, 'الغياب غير موجود');
    if (user.role !== 'admin' && a.recorded_by !== user.id) throw new HttpError(403, 'لا يمكنك حذف غياب سجّله شخص آخر');
    await pool.query('DELETE FROM program_absences WHERE id = $1', [params.id]);
    return { ok: true };
  });

  route('POST', '/api/program/children/:id/notes', ['admin', 'teacher'], async ({ user, params, body }) => {
    const child = await loadChildFor(user, params.id);
    if (!PROGRAM_NOTE_CATEGORIES.includes(body.category)) throw new HttpError(400, 'نوع الملاحظة غير صالح');
    const rating = body.rating || null;
    if (rating && !NOTE_RATINGS.includes(rating)) throw new HttpError(400, 'التقييم غير صالح');
    const note = await one(
      `INSERT INTO program_notes (child_id, category, rating, content, date, author_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [child.id, body.category, rating, text(body.content, { required: true, max: 2000, name: 'نص الملاحظة' }), date(body.date || today()), user.id]
    );
    return [201, { note }];
  });

  route('DELETE', '/api/program/notes/:id', ['admin', 'teacher'], async ({ user, params }) => {
    const n = await one('SELECT author_id FROM program_notes WHERE id = $1', [params.id]);
    if (!n) throw new HttpError(404, 'الملاحظة غير موجودة');
    if (user.role !== 'admin' && n.author_id !== user.id) throw new HttpError(403, 'لا يمكنك حذف ملاحظة كتبها شخص آخر');
    await pool.query('DELETE FROM program_notes WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // الحضور لقسم كامل في يوم: الكل حاضر إلا المحدَّدون
  async function loadClassFor(user, id) {
    const k = await one('SELECT id, name, teacher_id FROM program_classes WHERE id = $1', [Number(id) || 0]);
    if (!k || (user.role === 'teacher' && k.teacher_id !== user.id)) throw new HttpError(404, 'القسم غير موجود');
    return k;
  }

  route('GET', '/api/program/attendance', ['admin', 'teacher'], async ({ user, query }) => {
    const k = await loadClassFor(user, query.get('class_id'));
    const day = date(query.get('date') || today());
    return {
      class: k,
      date: day,
      children: await all(
        `SELECT c.id, c.full_name, EXISTS (SELECT 1 FROM program_absences a WHERE a.child_id = c.id AND a.date = $2) AS absent
         FROM program_children c WHERE c.class_id = $1 AND c.status = 'active' ORDER BY c.full_name`,
        [k.id, day]
      ),
    };
  });

  route('POST', '/api/program/attendance', ['admin', 'teacher'], async ({ user, body }) => {
    const k = await loadClassFor(user, body.class_id);
    const day = date(body.date || today());
    const absent = (Array.isArray(body.absent_ids) ? body.absent_ids : []).map(Number).filter(Number.isInteger);
    await pool.query(
      `DELETE FROM program_absences a USING program_children c
       WHERE a.child_id = c.id AND c.class_id = $1 AND a.date = $2 AND NOT (a.child_id = ANY($3::int[]))`,
      [k.id, day, absent]
    );
    await pool.query(
      `INSERT INTO program_absences (child_id, date, recorded_by)
       SELECT c.id, $2, $4 FROM program_children c WHERE c.class_id = $1 AND c.status = 'active' AND c.id = ANY($3::int[])
       ON CONFLICT (child_id, date) DO NOTHING`,
      [k.id, day, absent, user.id]
    );
    return { ok: true, absent: absent.length };
  });

  // ---------- معلوم التسجيل السنوي ----------
  route('POST', '/api/registration-payments', ['admin'], async ({ user, body }) => {
    let studentId = Number(body.student_id) || null;
    let childId = Number(body.child_id) || null;
    if (childId) {
      const c = await one('SELECT student_id FROM program_children WHERE id = $1', [childId]);
      if (!c) throw new HttpError(404, 'الطفل غير موجود');
      // طفل مرتبط بتلميذ دعم: الدفعة في ملف الدعم
      if (c.student_id) [studentId, childId] = [c.student_id, null];
    } else if (!studentId || !(await getStudent(studentId))) {
      throw new HttpError(404, 'التلميذ غير موجود');
    }
    throw new HttpError(410, 'معلوم التسجيل يُضاف الآن إلى أول شهر: «تعديل» على الشهر ← إضافة مبلغ');
    const year = String(body.school_year || schoolYearOf(currentMonth()));
    if (!/^\d{4}-\d{4}$/.test(year) || Number(year.slice(5)) !== Number(year.slice(0, 4)) + 1) throw new HttpError(400, 'السنة الدراسية غير صالحة');
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const method = body.method || null;
    if (method && !PAYMENT_METHODS.includes(method)) throw new HttpError(400, 'طريقة الدفع غير صالحة');
    const payment = await one(
      `INSERT INTO registration_payments (student_id, child_id, school_year, amount, paid_on, method, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, receipt_no`,
      [studentId, childId, year, amount, date(body.paid_on || today()), method, text(body.note, { max: 300, name: 'الملاحظة' }), user.id]
    );
    return [201, { payment }];
  });

  route('DELETE', '/api/registration-payments/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM registration_payments WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'الدفعة غير موجودة');
    return { ok: true };
  });

  // ---------- الولي: كل أبنائه في كل البرامج (كل طفل مرة واحدة) ----------
  route('GET', '/api/family', ['parent'], async ({ user }) => ({ kids: await familyKids(user) }));

  async function familyKids(user) {
    const fees = await feeTools();
    const students = await all(
      `SELECT ${STUDENT_COLUMNS},
         (SELECT COUNT(*)::int FROM absences a WHERE a.student_id = st.id) AS absence_count,
         (SELECT COUNT(*)::int FROM notes n WHERE n.student_id = st.id AND n.visible_to_parent) AS note_count
       FROM students st WHERE st.parent_id = $1 ORDER BY st.full_name`,
      [user.id]
    );
    const sp = students.length ? await studentPayments(students.map((x) => x.id)) : [];
    const children = await all(
      `${CHILD_SELECT} WHERE COALESCE(sl.parent_id, c.parent_id) = $1 ORDER BY c.full_name`,
      [user.id]
    );
    const pp = children.length ? await programPayments(children.map((c) => c.id)) : [];
    const kids = [];
    for (const st of students) {
      const linked = children.find((c) => c.student_id === st.id);
      const programBalance = linked ? fees.child(linked, pp.filter((p) => p.child_id === linked.id)).balance : 0;
      kids.push({
        type: 'student', id: st.id, full_name: st.full_name, level: st.level, status: st.status,
        has_photo: st.has_photo, photo_version: st.photo_version,
        program: linked ? { id: linked.id, class_name: linked.class_name, status: linked.status } : null,
        absence_count: st.absence_count, note_count: st.note_count,
        balance: round3(fees.student(st, sp.filter((p) => p.student_id === st.id)).balance + programBalance),
        link: `#/students/${st.id}`,
      });
    }
    for (const c of children.filter((x) => !x.student_id)) {
      const counts = await one(
        `SELECT (SELECT COUNT(*)::int FROM program_absences WHERE child_id = $1) AS absence_count,
           (SELECT COUNT(*)::int FROM program_notes WHERE child_id = $1) AS note_count`,
        [c.id]
      );
      kids.push({
        type: 'child', id: c.id, full_name: c.full_name, status: c.status,
        program: { id: c.id, class_name: c.class_name, status: c.status },
        ...counts,
        balance: fees.child(c, pp.filter((p) => p.child_id === c.id)).balance,
        link: `#/kid/${c.id}`,
      });
    }
    return kids;
  }

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
           l.course_id, c.name AS course_name, l.staff_id, l.paid_from, l.fixed_id
         FROM ledger_entries l LEFT JOIN courses c ON c.id = l.course_id
         WHERE to_char(l.date, 'YYYY-MM') = $1 AND ($2::text IS NULL OR l.activity = $2)
         ORDER BY l.date DESC, l.id DESC`,
        [month, activity]
      ),
    };
  });

  route('POST', '/api/ledger', ['admin'], async ({ user, body }) => {
    const row = await one(
      `INSERT INTO ledger_entries (direction, activity, category, amount, date, description, course_id, created_by, paid_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [...readEntry(body), user.id, PAID_FROM.includes(body.paid_from) ? body.paid_from : 'cash']
    );
    return [201, { entry: row }];
  });

  route('PUT', '/api/ledger/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      `UPDATE ledger_entries SET direction = $1, activity = $2, category = $3, amount = $4, date = $5, description = $6,
         course_id = $7, paid_from = COALESCE($9, paid_from) WHERE id = $8`,
      [...readEntry(body), params.id, PAID_FROM.includes(body.paid_from) ? body.paid_from : null]
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
  // المصاريف القارّة: الكراء، المحاسبة والقباضة، الفواتير… (أجور الإدارة من «الأجور»)
  // ======================================================================
  const FIXED_CATEGORIES = { rent: 'الكراء', accounting: 'المحاسبة والقباضة', bills: 'الفواتير (ماء، كهرباء، إنترنت، هاتف)', other: 'أخرى' };
  // الأصناف: يعدّلها المدير (تسمية، حذف، إضافة)؛ «أخرى» ثابتة لما لا صنف له
  const fixedCatList = async () => {
    const saved = await getSetting('fixed_cats', null);
    if (Array.isArray(saved)) return saved;
    // قبل أول تعديل: الأصناف الأساسية + ما أُضيف سابقًا
    const legacy = (await getSetting('fixed_categories', [])) || [];
    return [...Object.entries(FIXED_CATEGORIES).filter(([k]) => k !== 'other').map(([key, label]) => ({ key, label })), ...legacy];
  };
  const fixedCategories = async () => ({ ...Object.fromEntries((await fixedCatList()).map((c) => [c.key, c.label])), other: FIXED_CATEGORIES.other });
  // صنف جديد يُكتب في نموذج المصروف القارّ
  const ensureFixedCategory = async (body) => {
    const label = text(body.new_category, { max: 60, name: 'الصنف' });
    if (body.category !== '__new' || !label) return;
    const list = await fixedCatList();
    const found = list.find((c) => c.label === label);
    if (found) return void (body.category = found.key);
    const key = `c${Date.now().toString(36)}`;
    await saveSetting('fixed_cats', [...list, { key, label }]);
    body.category = key;
  };
  const readFixed = async (body) => {
    await ensureFixedCategory(body);
    const cats = await fixedCategories();
    const category = cats[body.category] ? body.category : 'other';
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const day = Number(body.due_day) || 1;
    if (day < 1 || day > 31) throw new HttpError(400, 'يوم الدفع بين 1 و 31');
    return [text(body.name, { required: true, max: 120, name: 'الاسم' }), category, amount, day,
      PAID_FROM.includes(body.paid_from) ? body.paid_from : 'cash', text(body.notes, { max: 300, name: 'ملاحظات' })];
  };
  // وضعية كل مصروف قارّ في شهر: المدفوع، الباقي، متأخّر أم لا
  async function fixedMonth(month) {
    const rows = await all(
      `SELECT f.id, f.name, f.category, f.amount::float8 AS amount, f.due_day, f.paid_from, f.notes,
         COALESCE((SELECT SUM(l.amount) FROM ledger_entries l WHERE l.fixed_id = f.id AND l.fixed_month = $1), 0)::float8 AS paid,
         (SELECT l.date::text FROM ledger_entries l WHERE l.fixed_id = f.id AND l.fixed_month = $1 ORDER BY l.date DESC LIMIT 1) AS paid_on,
         (SELECT l.id FROM ledger_entries l WHERE l.fixed_id = f.id AND l.fixed_month = $1 ORDER BY l.date DESC LIMIT 1) AS payment_id
       FROM fixed_expenses f WHERE f.active ORDER BY f.due_day, f.name`,
      [month]
    );
    const t = today();
    const cur = currentMonth();
    const cats = await fixedCategories();
    const items = rows.map((f) => {
      const dueDate = `${month}-${String(Math.min(f.due_day, daysInMonth(month))).padStart(2, '0')}`;
      const left = round3(Math.max(f.amount - f.paid, 0));
      const status = !left ? 'paid' : month < cur || dueDate < t ? 'late' : dueDate === t ? 'today' : 'upcoming';
      return { ...f, category_label: cats[f.category] || FIXED_CATEGORIES.other, due_date: dueDate, left, status };
    });
    const sum = (k) => round3(items.reduce((s, x) => s + x[k], 0));
    return { month, items, total: sum('amount'), paid: sum('paid'), left: sum('left') };
  }

  route('GET', '/api/fixed-expenses', ['admin'], async ({ query }) => {
    const month = monthParam(query.get('month'));
    const fixed = await fixedMonth(month);
    // أجور الإطار الإداري والموارد البشرية الأخرى: من صفحة «الأجور» (لا تُعاد كتابتها هنا)
    const people = await staffMonth(month);
    const staff = { people, due: round3(people.reduce((t, p) => t + p.due, 0)), paid: round3(people.reduce((t, p) => t + p.paid, 0)) };
    const staffLeft = round3(people.reduce((t, p) => t + Math.max(p.due - p.paid, 0), 0));
    return {
      ...fixed, categories: await fixedCategories(), category_list: await fixedCatList(),
      staff: { people: staff.people, due: staff.due, paid: staff.paid, left: staffLeft },
      grand: { total: round3(fixed.total + staff.due), paid: round3(fixed.paid + staff.paid), left: round3(fixed.left + staffLeft) },
    };
  });
  route('POST', '/api/fixed-expenses', ['admin'], async ({ body }) => {
    const row = await one(
      'INSERT INTO fixed_expenses (name, category, amount, due_day, paid_from, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      await readFixed(body)
    );
    return [201, { id: row.id }];
  });
  route('PUT', '/api/fixed-expenses/:id', ['admin'], async ({ params, body }) => {
    const { rowCount } = await pool.query(
      'UPDATE fixed_expenses SET name = $1, category = $2, amount = $3, due_day = $4, paid_from = $5, notes = $6 WHERE id = $7 AND active',
      [...(await readFixed(body)), params.id]
    );
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });
  // تعديل الأصناف كلها: تسمية، حذف (بنوده تولّي «أخرى»)، إضافة
  route('PUT', '/api/fixed-expenses/categories', ['admin'], async ({ body }) => {
    const old = await fixedCatList();
    const seen = new Set();
    const list = [];
    for (const [i, c] of (Array.isArray(body.categories) ? body.categories : []).entries()) {
      const label = text(c?.label, { max: 60, name: 'اسم الصنف' });
      if (!label) continue;
      if (list.some((x) => x.label === label)) throw new HttpError(400, `الصنف «${label}» مكرّر`);
      const key = old.some((o) => o.key === c.key) && !seen.has(c.key) ? c.key : `c${Date.now().toString(36)}${i}`;
      seen.add(key);
      list.push({ key, label });
    }
    if (list.length > 30) throw new HttpError(400, 'أكثر من 30 صنفًا');
    const removed = old.filter((o) => !list.some((x) => x.key === o.key)).map((o) => o.key);
    if (removed.length) await pool.query(`UPDATE fixed_expenses SET category = 'other' WHERE category = ANY($1)`, [removed]);
    await saveSetting('fixed_cats', list);
    return { categories: list };
  });
  // أجور المدرّسين والمؤطّرين المتوقّعة إلى آخر الشهر (كل الحصص المبرمجة، دون غيابات)
  route('GET', '/api/fixed-expenses/salaries', ['admin'], async ({ user, query }) => {
    const sm = await salariesMonth(monthParam(query.get('month')), user);
    const groups = sm.groups.filter((g) => g.key !== 'admin').map((g) => {
      const people = g.people.map((p) => ({ id: p.id, name: p.name, basis: p.basis, link: p.link || '#/program/pay', expected: round3(p.expected ?? p.due), paid: p.paid, left: round3(Math.max((p.expected ?? p.due) - p.paid, 0)) }));
      const sum = (k) => round3(people.reduce((t, x) => t + x[k], 0));
      return { key: g.key, label: g.label, people, expected: sum('expected'), paid: sum('paid'), left: sum('left') };
    });
    const sum = (k) => round3(groups.reduce((t, g) => t + g[k], 0));
    return { groups, expected: sum('expected'), paid: sum('paid'), left: sum('left') };
  });

  // الحذف يوقف التذكير فقط: الدفعات السابقة تبقى في السجلّ
  route('DELETE', '/api/fixed-expenses/:id', ['admin'], async ({ params }) => {
    const { rowCount } = await pool.query('UPDATE fixed_expenses SET active = false WHERE id = $1', [params.id]);
    if (!rowCount) throw new HttpError(404, 'غير موجود');
    return { ok: true };
  });
  // دفع مصروف قارّ عن شهر: يُسجَّل في المداخيل والمصاريف كمصروف قارّ
  route('POST', '/api/fixed-expenses/:id/pay', ['admin'], async ({ user, params, body }) => {
    const f = await one('SELECT id, name, category, amount::float8 AS amount, paid_from FROM fixed_expenses WHERE id = $1', [params.id]);
    if (!f) throw new HttpError(404, 'غير موجود');
    const month = monthParam(body.month);
    const amount = body.amount === undefined || body.amount === '' ? f.amount : money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const from = PAID_FROM.includes(body.paid_from) ? body.paid_from : f.paid_from;
    const row = await one(
      `INSERT INTO ledger_entries (direction, activity, category, amount, date, description, created_by, paid_from, fixed_id, fixed_month)
       VALUES ('expense', 'general', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [FIXED_LEDGER[f.category] || 'other', amount, date(body.date || today()), `${f.name} · ${month}`, user.id, from, f.id, month]
    );
    return [201, { id: row.id }];
  });

  // توقّع الشهر: الربح الحالي − ما بقي من الأجور (كل الحصص المبرمجة، دون غيابات) − ما بقي من المصاريف القارّة
  // book: حساب الشركاء (كل مبلغ في شهره)؛ وإلا المقبوض والمدفوع فعليًا (en temps réel، نفس «صافي الشهر»)
  async function monthForecast(user, month = currentMonth(), { partnersBook = false } = {}) {
    const [book] = partnersBook
      ? await monthlyBook([month])
      : [await cashForMonth(month)].map((c) => ({ income_total: c.totals.income, expense_total: c.totals.expense, net: c.totals.net }));
    const sm = await salariesMonth(month, user);
    const groups = sm.groups.map((g) => ({
      key: g.key, label: g.label,
      expected: round3(g.people.reduce((t, p) => t + (p.expected ?? p.due), 0)),
      left: round3(g.people.reduce((t, p) => t + Math.max((p.expected ?? p.due) - p.paid, 0), 0)),
    }));
    const salariesLeft = round3(groups.reduce((t, g) => t + g.left, 0));
    const fixed = await fixedMonth(month);
    const netNow = book?.net ?? 0;
    return {
      month, income: book?.income_total ?? 0, expense: book?.expense_total ?? 0, net_now: netNow,
      salaries: groups, salaries_left: salariesLeft, fixed_left: fixed.left, fixed_items: fixed.items.filter((x) => x.left),
      net_expected: round3(netNow - salariesLeft - fixed.left),
    };
  }
  route('GET', '/api/board/forecast', ['admin'], async ({ user, query }) => monthForecast(user, monthParam(query.get('month'))));

  // ملخّص اليوم: الدفوعات والمصاريف، ملاحظات المعلمين، الغيابات
  route('GET', '/api/board/today', ['admin'], async ({ user, query }) => {
    const d = query.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(query.get('date')) ? query.get('date') : today();
    const p = permsOf(user);
    const money_ = p.cash || p.stats || p.expenses;
    const out = { date: d, finance: null };
    if (money_) {
      const income = await all(
        `SELECT * FROM (
           SELECT 'support' AS kind, p.id, p.amount::float8 AS amount, p.method, p.month, p.receipt_no, s.full_name AS who, p.created_at FROM payments p JOIN students s ON s.id = p.student_id WHERE p.paid_on = $1
           UNION ALL SELECT 'program', p.id, p.amount::float8, p.method, p.month, p.receipt_no, c.full_name, p.created_at FROM program_payments p JOIN program_children c ON c.id = p.child_id WHERE p.paid_on = $1
           UNION ALL SELECT 'course', p.id, p.amount::float8, p.method, NULL, p.receipt_no, cp.full_name, p.created_at FROM course_payments p JOIN course_participants cp ON cp.id = p.participant_id WHERE p.paid_on = $1
           UNION ALL SELECT 'ledger', l.id, l.amount::float8, l.paid_from, NULL, NULL, COALESCE(l.description, l.category), l.created_at FROM ledger_entries l WHERE l.direction = 'income' AND l.date = $1
         ) x ORDER BY created_at DESC`,
        [d]
      );
      const expense = await all(
        `SELECT * FROM (
           SELECT 'ledger' AS kind, l.id, l.amount::float8 AS amount, l.paid_from AS method, l.category, COALESCE(l.description, '') AS who, l.fixed_id, l.created_at
           FROM ledger_entries l WHERE l.direction = 'expense' AND l.date = $1
           UNION ALL SELECT 'teacher', t.id, t.amount::float8, t.method, 'salary', u.full_name, NULL, t.created_at FROM teacher_payments t JOIN users u ON u.id = t.teacher_id WHERE t.paid_on = $1
         ) x ORDER BY created_at DESC`,
        [d]
      );
      for (const e of expense) e.label = e.kind === 'teacher' ? 'أجرة مدرّس' : LEDGER_CATEGORIES.expense[e.category] || e.category;
      const sum = (l) => round3(l.reduce((t, x) => t + x.amount, 0));
      out.finance = { income, expense, income_total: sum(income), expense_total: sum(expense), net: round3(sum(income) - sum(expense)) };
    }
    out.notes = await all(
      `SELECT * FROM (
         SELECT 'support' AS kind, n.id, s.id AS person_id, s.full_name AS who, n.content, n.rating, sub.name AS subject, COALESCE(u.full_name, n.author_label) AS author, n.created_at
         FROM notes n JOIN students s ON s.id = n.student_id LEFT JOIN users u ON u.id = n.author_id LEFT JOIN subjects sub ON sub.id = n.subject_id
         WHERE n.date = $1 OR n.created_at::date = $1::date
         UNION ALL SELECT 'program', n.id, c.id, c.full_name, n.content, n.rating, NULL, u.full_name, n.created_at
         FROM program_notes n JOIN program_children c ON c.id = n.child_id LEFT JOIN users u ON u.id = n.author_id
         WHERE n.date = $1 OR n.created_at::date = $1::date
       ) x ORDER BY created_at DESC LIMIT 200`,
      [d]
    );
    out.absences = await all(
      `SELECT * FROM (
         SELECT 'support' AS kind, a.id, s.id AS person_id, s.full_name AS who, sub.name AS subject, a.justified, a.reason
         FROM absences a JOIN students s ON s.id = a.student_id LEFT JOIN subjects sub ON sub.id = a.subject_id WHERE a.date = $1
         UNION ALL SELECT 'program', a.id, c.id, c.full_name, k.name, a.justified, a.reason
         FROM program_absences a JOIN program_children c ON c.id = a.child_id LEFT JOIN program_classes k ON k.id = c.class_id WHERE a.date = $1
       ) x ORDER BY who`,
      [d]
    );
    return out;
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
        income: [
          ['خلاص التلاميذ', await sumSql('SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM payments WHERE paid_on BETWEEN $1 AND $2', range)],
        ],
        expense: [['خلاص المعلمين (بالساعة)', await sumSql('SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM teacher_payments WHERE paid_on BETWEEN $1 AND $2', range)]],
      },
      program: {
        income: [
          ['خلاص الأطفال', await sumSql('SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM program_payments WHERE paid_on BETWEEN $1 AND $2', range)],
        ],
        expense: [],
      },
      courses: {
        income: [['معاليم المشاركين', await sumSql('SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM course_payments WHERE paid_on BETWEEN $1 AND $2', range)]],
        expense: [],
      },
      general: {
        income: [['بيع المنتجات', await sumSql('SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM product_sales WHERE sold_on BETWEEN $1 AND $2', range)]],
        expense: [],
      },
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
    // المصاريف المشتركة: تبقى وحدها، وتُوزَّع على الأنشطة بالنسب التي تحدّدها الإدارة
    const split = await getSetting('shared_split', {});
    const sharedCost = round3(-activities.find((a) => a.key === 'general').net);
    for (const a of activities) {
      if (a.key === 'general') continue;
      a.shared_pct = Number(split[a.key]) || 0;
      a.shared = round3((sharedCost * a.shared_pct) / 100);
      a.net_after = round3(a.net - a.shared);
    }
    const allocated = SPLIT_KEYS.reduce((t, k) => t + (Number(split[k]) || 0), 0);
    return {
      month,
      activities,
      shared: { cost: sharedCost, allocated, unallocated: round3((sharedCost * (100 - allocated)) / 100) },
      totals: { income: total('income'), expense: total('expense'), net: total('net') },
    };
  }

  // حسب الاستحقاق: ما يجب قبضه ودفعه عن الشهر (حتى لو لم يُدفع بعد)
  async function accrualForMonth(month) {
    const students = await all(`SELECT ${STUDENT_COLUMNS} FROM students st`);
    const sp = students.length ? await studentPayments(students.map((x) => x.id)) : [];
    const fees = await feeTools();
    let supportBilled = 0;
    let supportCollected = 0;
    for (const st of students) {
      const row = fees.student(st, sp.filter((p) => p.student_id === st.id)).months.find((m) => m.month === month);
      if (row) {
        supportBilled += row.due;
        supportCollected += row.paid;
      }
    }
    const teachers = await all(`SELECT id, full_name, hourly_rate::float8 AS hourly_rate FROM users WHERE role = 'teacher' AND NOT program_staff`);
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
      const row = fees.child(c, pp.filter((p) => p.child_id === c.id)).months.find((m) => m.month === month);
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
        activities: Object.fromEntries(
          c.activities.map((a) => [a.key, { income: a.income, expense: a.expense, net: a.net, net_after: a.net_after ?? null }])
        ),
      });
    }
    const sum = (k) => round3(months.reduce((t, m) => t + m.totals[k], 0));
    return { months, totals: { income: sum('income'), expense: sum('expense'), net: sum('net') } };
  });

  // المصاريف العامة للمركز (كراء، نظافة، معدات، صيانة، طباعة…): الشهر حسب الصنف + السنة الدراسية
  route('GET', '/api/finance/general', ['admin'], async ({ query }) => {
    const month = monthParam(query.get('month'));
    const months = schoolYearMonths();
    const byCat = (rows) => rows.map((x) => ({ ...x, label: LEDGER_CATEGORIES[x.direction]?.[x.category] || x.category }));
    const monthRows = byCat(
      await all(
        `SELECT direction, category, SUM(amount)::float8 AS total FROM ledger_entries
         WHERE activity = 'general' AND to_char(date, 'YYYY-MM') = $1 GROUP BY direction, category ORDER BY total DESC`,
        [month]
      )
    );
    const yearRows = byCat(
      await all(
        `SELECT direction, category, SUM(amount)::float8 AS total FROM ledger_entries
         WHERE activity = 'general' AND to_char(date, 'YYYY-MM') = ANY($1) GROUP BY direction, category ORDER BY total DESC`,
        [months]
      )
    );
    const perMonth = await all(
      `SELECT to_char(date, 'YYYY-MM') AS month, SUM(amount) FILTER (WHERE direction = 'expense')::float8 AS expense
       FROM ledger_entries WHERE activity = 'general' AND to_char(date, 'YYYY-MM') = ANY($1) GROUP BY 1`,
      [months]
    );
    const sum = (rows, d) => round3(rows.filter((x) => x.direction === d).reduce((s, x) => s + x.total, 0));
    return {
      month,
      categories: monthRows,
      expense: sum(monthRows, 'expense'),
      income: sum(monthRows, 'income'),
      year: {
        categories: yearRows,
        expense: sum(yearRows, 'expense'),
        months: months.map((m) => ({ month: m, expense: round3(perMonth.find((x) => x.month === m)?.expense || 0) })),
      },
    };
  });

  route('GET', '/api/finance/meta', ['admin'], async () => ({ activities: ACTIVITIES, categories: LEDGER_CATEGORIES }));

  // ======================================================================
  // التعريفات: المعلوم الشهري الافتراضي لكل مستوى في دروس الدعم
  // ======================================================================
  const getSetting = async (key, fallback) => (await one('SELECT value FROM settings WHERE key = $1', [key]))?.value ?? fallback;
  // الصلاحيات المحفوظة: كل ما لم يُوقفه المدير مسموح
  const roleFeatures = async () => {
    const saved = await getSetting('role_features', {});
    return Object.fromEntries(Object.entries(ROLE_FEATURES).map(([g, f]) => [g, Object.fromEntries(Object.keys(f).map((k) => [k, saved?.[g]?.[k] !== false]))]));
  };
  const featureOn = async (user, key) => {
    const groups = featureGroups(user);
    if (!groups.length) return true;
    const rf = await roleFeatures();
    return groups.every((g) => rf[g][key] ?? true);
  };
  route('GET', '/api/role-features', ['admin'], async ({ user }) => {
    if (!user.super_admin) throw new HttpError(403, 'للمدير فقط');
    return { features: Object.fromEntries(Object.entries(ROLE_FEATURES).map(([g, f]) => [g, Object.fromEntries(Object.entries(f).map(([k, [l]]) => [k, l]))])), values: await roleFeatures() };
  });
  route('PUT', '/api/role-features', ['admin'], async ({ user, body }) => {
    if (!user.super_admin) throw new HttpError(403, 'للمدير فقط');
    const values = Object.fromEntries(Object.entries(ROLE_FEATURES).map(([g, f]) => [g, Object.fromEntries(Object.keys(f).map((k) => [k, body?.values?.[g]?.[k] !== false]))]));
    await saveSetting('role_features', values);
    return { values };
  });
  const saveSetting = (key, value) =>
    pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)]
    );
  const percent = (value, name) => {
    const v = money(value, name);
    if (v !== null && v > 100) throw new HttpError(400, `${name} غير صالح`);
    return v;
  };

  // حصة في الأسبوع 100، حصتان 140، 3 حصص 180، 4 حصص 220، 5 فأكثر = الباقة. الرياضيات (7-9) والعلوم (5-6) بحصتين
  const DEFAULT_PRICING = { steps: { 1: 100, 2: 140, 3: 180, 4: 220 }, units: {} };
  route('GET', '/api/settings/fees', ['admin'], async () => ({
    support: await getSetting('support_fees', {}),
    family: await getSetting('family_discounts', {}),
    school_year: schoolYearOf(currentMonth()),
    pricing: await getSetting('support_pricing', DEFAULT_PRICING),
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
    // تخفيض الإخوة (بالمائة على المعلوم الشهري لكل طفل)
    if (body.family) {
      const family = {};
      for (const k of ['two', 'three']) {
        const v = percent(body.family[k], k === 'two' ? 'تخفيض الأخوين' : 'تخفيض ثلاثة إخوة');
        if (v) family[k] = v;
      }
      await saveSetting('family_discounts', family);
    }
    // تسعيرة الدعم حسب عدد الحصص في الأسبوع، وعدد حصص كل مادة
    if (body.pricing) {
      const steps = {};
      for (const n of ['1', '2', '3', '4']) {
        const v = money(body.pricing.steps?.[n], `معلوم ${n} حصص`);
        if (v) steps[n] = v;
      }
      const units = {};
      for (const [id, n] of Object.entries(body.pricing.units || {})) {
        const v = Number(n);
        if (Number.isInteger(Number(id)) && v >= 1 && v <= 6) units[id] = v;
      }
      await saveSetting('support_pricing', { steps, units });
    }
    return { support: fees };
  });

  route('GET', '/api/settings/shared-split', ['admin'], async () => ({ split: await getSetting('shared_split', {}) }));

  route('PUT', '/api/settings/shared-split', ['admin'], async ({ body }) => {
    const split = {};
    for (const k of SPLIT_KEYS) {
      const v = percent(body[k], ACTIVITIES[k]);
      if (v) split[k] = v;
    }
    if (Object.values(split).reduce((t, v) => t + v, 0) > 100) throw new HttpError(400, 'مجموع النسب أكثر من 100%');
    await saveSetting('shared_split', split);
    return { split };
  });

  // ======================================================================
  // الوصولات
  // ======================================================================
  const RECEIPT_SQL = {
    support: `SELECT p.receipt_no, p.amount::float8 AS amount, p.paid_on::text, p.method, p.note, p.month, p.edited_at::date::text AS edited_at,
        st.full_name AS beneficiary, st.level, u.full_name AS payer, u.phone, st.parent_id,
        'دروس الدعم' AS program
      FROM payments p JOIN students st ON st.id = p.student_id LEFT JOIN users u ON u.id = st.parent_id WHERE p.id = $1`,
    program: `SELECT p.receipt_no, p.amount::float8 AS amount, p.paid_on::text, p.method, p.note, p.month, p.edited_at::date::text AS edited_at,
        c.full_name AS beneficiary, NULL AS level, COALESCE(u.full_name, c.guardian_name) AS payer,
        COALESCE(u.phone, c.guardian_phone) AS phone, COALESCE(sl.parent_id, c.parent_id) AS parent_id,
        'البرنامج التربوي' || COALESCE(' — ' || k.name, '') AS program
      FROM program_payments p JOIN program_children c ON c.id = p.child_id LEFT JOIN program_classes k ON k.id = c.class_id
      LEFT JOIN students sl ON sl.id = c.student_id LEFT JOIN users u ON u.id = COALESCE(sl.parent_id, c.parent_id)
      WHERE p.id = $1`,
    registration: `SELECT r.receipt_no, r.amount::float8 AS amount, r.paid_on::text, r.method, r.note, NULL AS month,
        COALESCE(st.full_name, c.full_name) AS beneficiary, st.level, COALESCE(u.full_name, c.guardian_name) AS payer,
        COALESCE(u.phone, c.guardian_phone) AS phone, COALESCE(st.parent_id, c.parent_id) AS parent_id,
        'معلوم التسجيل السنوي ' || r.school_year AS program
      FROM registration_payments r LEFT JOIN students st ON st.id = r.student_id LEFT JOIN program_children c ON c.id = r.child_id
      LEFT JOIN users u ON u.id = COALESCE(st.parent_id, c.parent_id) WHERE r.id = $1`,
    course: `SELECT p.receipt_no, p.amount::float8 AS amount, p.paid_on::text, p.method, p.note, NULL AS month,
        cp.full_name AS beneficiary, NULL AS level, COALESCE(u.full_name, cp.full_name) AS payer,
        COALESCE(cp.phone, u.phone) AS phone, NULL::int AS parent_id, c.name AS program
      FROM course_payments p JOIN course_participants cp ON cp.id = p.participant_id JOIN courses c ON c.id = cp.course_id
      LEFT JOIN students st ON st.id = cp.student_id LEFT JOIN users u ON u.id = st.parent_id
      WHERE p.id = $1`,
  };

  const receiptLines = (no) =>
    all(
      `SELECT 'support' AS kind, p.id, p.month, p.amount::float8 AS amount, st.full_name AS beneficiary, 'دروس الدعم' AS program
         FROM payments p JOIN students st ON st.id = p.student_id WHERE p.receipt_no = $1
       UNION ALL
       SELECT 'program', p.id, p.month, p.amount::float8, c.full_name, 'البرنامج التربوي'
         FROM program_payments p JOIN program_children c ON c.id = p.child_id WHERE p.receipt_no = $1
       ORDER BY beneficiary, month, id`,
      [no]
    );

  // الولي: كل وصولات أبنائه (وصل واحد لكل رقم، حتى لو غطّى أكثر من شهر)
  route('GET', '/api/my-receipts', ['parent'], async ({ user }) => {
    const kids = await familyKids(user);
    const sIds = kids.filter((k) => k.type === 'student').map((k) => k.id);
    const cIds = [
      ...kids.filter((k) => k.type === 'child').map((k) => k.id),
      ...kids.filter((k) => k.type === 'student' && k.program).map((k) => k.program.id),
    ];
    const rows = await all(
      `SELECT * FROM (
         SELECT 'support' AS kind, p.id, p.receipt_no, p.paid_on::text AS paid_on, p.month, p.amount::float8 AS amount, st.full_name AS child, 'دروس الدعم' AS program
         FROM payments p JOIN students st ON st.id = p.student_id WHERE p.student_id = ANY($1::int[])
         UNION ALL
         SELECT 'program', p.id, p.receipt_no, p.paid_on::text, p.month, p.amount::float8, c.full_name, 'البرنامج التربوي'
         FROM program_payments p JOIN program_children c ON c.id = p.child_id WHERE p.child_id = ANY($2::int[])
       ) x ORDER BY paid_on DESC, receipt_no DESC, month`,
      [sIds, cIds]
    );
    const byNo = new Map();
    for (const r of rows) {
      const key = r.receipt_no ?? `${r.kind}-${r.id}`;
      if (!byNo.has(key)) byNo.set(key, { kind: r.kind, id: r.id, receipt_no: r.receipt_no, paid_on: r.paid_on, total: 0, months: [], children: new Set() });
      const g = byNo.get(key);
      g.total = round3(g.total + r.amount);
      g.months.push(r.month);
      g.children.add(r.child);
    }
    return { receipts: [...byNo.values()].map((g) => ({ ...g, months: [...new Set(g.months)].sort(), children: [...g.children] })) };
  });

  for (const kind of Object.keys(RECEIPT_SQL)) {
    // الولي يرى وصولات أبنائه (الدعم، التربوي، التسجيل)
    route('GET', `/api/receipts/${kind}/:id`, kind === 'course' ? ['admin'] : ['admin', 'parent'], async ({ user, params }) => {
      const r = await one(RECEIPT_SQL[kind], [params.id]);
      if (!r || (user.role === 'parent' && r.parent_id !== user.id)) throw new HttpError(404, 'الوصل غير موجود');
      delete r.parent_id;
      // كل أسطر نفس الوصل (دفعة لأكثر من شهر)
      const lines = kind === 'support' || kind === 'program' ? await receiptLines(r.receipt_no) : [];
      const total = lines.length ? round3(lines.reduce((t, l) => t + l.amount, 0)) : r.amount;
      // وصل العائلة: أكثر من ابن في نفس الوصل
      const names = [...new Set(lines.map((l) => l.beneficiary))];
      if (names.length > 1) {
        r.beneficiary = names.join(' · ');
        r.program = [...new Set(lines.map((l) => l.program))].join(' + ');
        r.level = null;
        r.family = true;
      }
      return { receipt: { ...r, kind, lines, total } };
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
      const key = personKey(c.full_name, c.contact_phone);
      const p = (c.student_id && people.get(`s${c.student_id}`)) || people.get(key) ||
        add(`c${c.id}`, { full_name: c.full_name, parent_name: c.contact_name, phone: c.contact_phone });
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
    const fees = await feeTools();
    for (const st of students) {
      const f0 = fees.student(st, sp.filter((p) => p.student_id === st.id));
      if (f0.balance <= 0) continue;
      const oldest = f0.months.filter((m) => m.remaining > 0).map((m) => m.month).sort()[0] || null;
      push(fam(st.parent_phone, st.parent_name, `s${st.id}`), { type: 'support', label: `دروس الدعم — ${st.full_name}`, student: st.full_name,
        amount: f0.balance, oldest, link: `#/students/${st.id}` });
    }
    const children = await all(`${CHILD_SELECT}`);
    const pp = children.length ? await programPayments(children.map((c) => c.id)) : [];
    for (const c of children) {
      const f0 = fees.child(c, pp.filter((p) => p.child_id === c.id));
      if (f0.balance <= 0) continue;
      const oldest = f0.months.filter((m) => m.remaining > 0).map((m) => m.month).sort()[0] || null;
      push(fam(c.contact_phone, c.contact_name, `c${c.id}`), { type: 'program', label: `البرنامج التربوي — ${c.full_name}`, student: c.full_name,
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
      t.created_at, t.done_at, t.position, t.checklist
    FROM center_tasks t LEFT JOIN users u ON u.id = t.assignee_user_id`;
  // قائمة التحقق: [{ text, done }]
  const readChecklist = (v) =>
    (Array.isArray(v) ? v : [])
      .slice(0, 50)
      .map((x) => ({ text: String(x?.text ?? '').trim().slice(0, 200), done: !!x?.done }))
      .filter((x) => x.text);

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
    // عمود «أُنجزت»: آخر 14 يومًا فقط، إلا إذا طُلب الكل
    if (!showDone) where.push(`(t.status <> 'done' OR t.done_at > now() - interval '14 days')`);
    return {
      tasks: await all(
        `${CTASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY (t.status = 'done'), t.position NULLS LAST, CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
           t.due_date NULLS LAST, t.id DESC LIMIT 300`,
        params
      ),
    };
  });

  route('POST', '/api/todo', ['admin'], async ({ user, body }) => {
    const row = await one(
      `INSERT INTO center_tasks (title, description, kind, priority, status, assignee_user_id, assignee_name, due_date,
         decision_id, created_by, checklist, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, -extract(epoch from now())::int) RETURNING id`,
      [...(await readCenterTask(body)), Number(body.decision_id) || null, user.id, JSON.stringify(readChecklist(body.checklist))]
    );
    return [201, { task: row }];
  });

  route('PUT', '/api/todo/:id', ['admin'], async ({ params, body }) => {
    const v = await readCenterTask(body);
    const { rowCount } = await pool.query(
      `UPDATE center_tasks SET title = $1, description = $2, kind = $3, priority = $4, status = $5, assignee_user_id = $6,
         assignee_name = $7, due_date = $8, done_at = CASE WHEN $5 = 'done' THEN COALESCE(done_at, now()) ELSE NULL END,
         checklist = COALESCE($10::jsonb, checklist)
       WHERE id = $9`,
      [...v, params.id, body.checklist === undefined ? null : JSON.stringify(readChecklist(body.checklist))]
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

  // سحب وإفلات: عمود البطاقة الجديد وترتيب بطاقاته
  route('POST', '/api/todo/reorder', ['admin', 'teacher'], async ({ user, body }) => {
    if (!TASK_STATUSES.includes(body.status)) throw new HttpError(400, 'الحالة غير صالحة');
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger).slice(0, 300);
    const moved = Number(body.id);
    const t = await one('SELECT assignee_user_id, decision_id, status FROM center_tasks WHERE id = $1', [moved]);
    if (!t || (user.role === 'teacher' && t.assignee_user_id !== user.id)) throw new HttpError(404, 'المهمة غير موجودة');
    if (t.status !== body.status) {
      await pool.query(
        `UPDATE center_tasks SET status = $1, done_at = CASE WHEN $1 = 'done' THEN now() ELSE NULL END WHERE id = $2`,
        [body.status, moved]
      );
      if (t.decision_id && body.status === 'done') await pool.query(`UPDATE decisions SET status = 'done' WHERE id = $1`, [t.decision_id]);
    }
    // ترتيب العمود (الإدارة فقط؛ المعلم ينقل بطاقته فقط)
    if (user.role === 'admin' && ids.length) {
      await pool.query(
        `UPDATE center_tasks t SET position = x.i FROM unnest($1::int[]) WITH ORDINALITY AS x(id, i) WHERE t.id = x.id`,
        [ids]
      );
    }
    return { ok: true };
  });
  // قائمة التحقق: الإدارة أو المسؤول عن المهمة يشطّب العناصر
  route('PATCH', '/api/todo/:id/checklist', ['admin', 'teacher'], async ({ user, params, body }) => {
    const t = await one('SELECT assignee_user_id FROM center_tasks WHERE id = $1', [params.id]);
    if (!t || (user.role === 'teacher' && t.assignee_user_id !== user.id)) throw new HttpError(404, 'المهمة غير موجودة');
    const list = readChecklist(body.checklist);
    await pool.query('UPDATE center_tasks SET checklist = $1 WHERE id = $2', [JSON.stringify(list), params.id]);
    return { checklist: list };
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
  async function computeAlerts(user) {
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
    if (waiting) add('warning', `${waiting} تلميذ في قائمة الانتظار (تسجيل جديد)`, '#/registrations');
    const pendingTeachers = await all(`SELECT full_name FROM users WHERE NOT approved AND role = 'teacher' ORDER BY id`);
    const parentReqs = await all(`SELECT COALESCE(full_name, google_name, google_email) AS n FROM parent_requests WHERE status = 'pending' ORDER BY id`);
    if (parentReqs.length) add('warning', `${parentReqs.length} ولي دخل بـ Google وينتظر ربط أبنائه`, '#/parent-requests', parentReqs.map((r) => r.n));
    if (pendingTeachers.length) {
      add('warning', `${pendingTeachers.length} معلم سجّل نفسه وينتظر الموافقة`, '#/teachers', pendingTeachers.map((u) => u.full_name));
    }

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
    const teachers = await all(`SELECT id, full_name, hourly_rate::float8 AS hourly_rate FROM users WHERE role = 'teacher' AND NOT program_staff`);
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
    // تذكير بالمصاريف القارّة (لمن يرى المصاريف): المتأخّرة، واللي أجلها خلال 5 أيام
    if (user && permsOf(user).expenses) {
      const fx = await fixedMonth(currentMonth());
      const late = fx.items.filter((x) => x.status === 'late' || x.status === 'today');
      const soonFx = fx.items.filter((x) => x.status === 'upcoming' && x.due_date <= addDays(now, 5));
      if (late.length) add('urgent', `${late.length} مصروف قارّ حلّ أجله ولم يُدفع (${round3(late.reduce((t, x) => t + x.left, 0))} د.ت)`, '#/fixed', late.map((x) => `${x.name}: ${x.left} د.ت (${x.due_date})`));
      if (soonFx.length) add('warning', `${soonFx.length} مصروف قارّ يحلّ أجله خلال 5 أيام`, '#/fixed', soonFx.map((x) => `${x.name}: ${x.left} د.ت (${x.due_date})`));
    }
    return alerts;
  }

  // الرقم على الجرس: التنبيهات التي لم يرها هذا المستخدم بعد (تُعتبر مقروءة بمجرد فتح صفحة التنبيهات)
  const alertKey = (a) => `${a.level}|${a.text}`;
  route('GET', '/api/alerts', ['admin'], async ({ user }) => {
    const alerts = await computeAlerts(user);
    const seen = new Set(await getSetting(`alerts_seen_${user.id}`, []));
    const fresh = alerts.filter((a) => a.level !== 'info' && !seen.has(alertKey(a)));
    return { alerts: alerts.map((a) => ({ ...a, new: a.level !== 'info' && !seen.has(alertKey(a)) })), count: fresh.length };
  });
  route('POST', '/api/alerts/seen', ['admin'], async ({ user }) => {
    const alerts = await computeAlerts(user);
    await saveSetting(`alerts_seen_${user.id}`, alerts.map(alertKey));
    return { ok: true };
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
          (await all(`SELECT id, hourly_rate::float8 AS hourly_rate FROM users WHERE role = 'teacher' AND NOT program_staff`)).map((t) => teacherMonth(t, month))
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

  // دفعة لأكثر من شهر في مرة واحدة: سطر لكل شهر، ووصل واحد (نفس الرقم) لكل الأسطر
  // دفعة لشهر أو أكثر، ولطفل أو أكثر من نفس العائلة: وصل واحد (رقم واحد) فيه تفاصيل كل الأبناء
  route('POST', '/api/pay-months', ['admin'], async ({ user, body }) => {
    const groups = Array.isArray(body.items) && body.items.length ? body.items : [{ kind: body.kind, id: body.id, lines: body.lines }];
    if (groups.length > 10) throw new HttpError(400, 'أكثر من 10 أبناء');
    const items = [];
    for (const g of groups) {
      const kind = g.kind === 'program' ? 'program' : 'support';
      const id = Number(g.id);
      if (kind === 'support') await loadStudentFor(user, id);
      else if (!(await one('SELECT 1 FROM program_children WHERE id = $1', [id]))) throw new HttpError(404, 'الطفل غير موجود');
      const lines = (Array.isArray(g.lines) ? g.lines : [])
        .map((l) => ({ month: String(l.month || ''), amount: money(l.amount, 'المبلغ') }))
        .filter((l) => l.amount > 0);
      if (lines.length > 12) throw new HttpError(400, 'أكثر من 12 شهرًا');
      for (const l of lines) if (!MONTH_RE.test(l.month)) throw new HttpError(400, 'الشهر غير صالح');
      if (lines.length) items.push({ kind, id, lines });
    }
    if (!items.length) throw new HttpError(400, 'اختر شهرًا واحدًا على الأقل بمبلغ');
    const method = body.method || null;
    if (method && !PAYMENT_METHODS.includes(method)) throw new HttpError(400, 'طريقة الدفع غير صالحة');
    const paidOn = date(body.paid_on || today());
    const note = text(body.note, { max: 300, name: 'الملاحظة' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [{ no }] } = await client.query(`SELECT nextval('receipt_seq')::int AS no`);
      let first = null;
      for (const it of items) {
        const table = it.kind === 'support' ? 'payments' : 'program_payments';
        const col = it.kind === 'support' ? 'student_id' : 'child_id';
        for (const l of it.lines) {
          const { rows: [r] } = await client.query(
            `INSERT INTO ${table} (${col}, month, amount, paid_on, method, note, recorded_by, receipt_no)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [it.id, l.month, l.amount, paidOn, method, note, user.id, no]
          );
          first ??= { id: r.id, kind: it.kind };
        }
      }
      await client.query('COMMIT');
      const total = round3(items.reduce((t, it) => t + it.lines.reduce((u, l) => u + l.amount, 0), 0));
      return [201, { payment: { id: first.id, receipt_no: no, kind: first.kind, total, children: items.length } }];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // إخوة التلميذ (نفس الولي) وما بقي عليهم: لخلاصهم في نفس الوصل
  route('GET', '/api/family-dues', ['admin'], async ({ query }) => {
    const kind = query.get('kind') === 'program' ? 'program' : 'support';
    const id = Number(query.get('id')) || 0;
    const row = kind === 'support'
      ? await one('SELECT parent_id AS p FROM students WHERE id = $1', [id])
      : await one('SELECT COALESCE(sl.parent_id, c.parent_id) AS p FROM program_children c LEFT JOIN students sl ON sl.id = c.student_id WHERE c.id = $1', [id]);
    if (!row?.p) return { parent: null, items: [] };
    const parent = await userById(row.p);
    const fees = await feeTools();
    const students = await all(`SELECT ${STUDENT_COLUMNS} FROM students st WHERE st.parent_id = $1 ORDER BY st.full_name`, [row.p]);
    const sp = students.length ? await studentPayments(students.map((x) => x.id)) : [];
    const children = await all(`${CHILD_SELECT} WHERE COALESCE(sl.parent_id, c.parent_id) = $1 ORDER BY c.full_name`, [row.p]);
    const pp = children.length ? await programPayments(children.map((c) => c.id)) : [];
    const items = [];
    const push = (k, x, f, label) => {
      if (k === kind && x.id === id) return;
      const months = (f.months || []).filter((m) => m.remaining > 0).map((m) => ({ month: m.month, rest: m.remaining, paid: m.paid }));
      if (months.length) items.push({ kind: k, id: x.id, full_name: x.full_name, label, months, balance: f.balance });
    };
    for (const st of students) push('support', st, fees.student(st, sp.filter((p) => p.student_id === st.id)), `📚 ${LEVELS.find((l) => l.code === st.level)?.label || st.level}`);
    for (const c of children) push('program', c, fees.child(c, pp.filter((p) => p.child_id === c.id)), `🎨 ${c.class_name || 'البرنامج التربوي'}`);
    return { parent: { id: parent.id, full_name: parent.full_name }, items };
  });

  // تعديل دفعة (حتى بعد الوصل): المبلغ، الشهر، التاريخ، الطريقة، الملاحظة — رقم الوصل لا يتغيّر
  const editPayment = (table) => async ({ params, body }) => {
    const month = String(body.month || '');
    if (!MONTH_RE.test(month)) throw new HttpError(400, 'الشهر غير صالح');
    const amount = money(body.amount, 'المبلغ');
    if (!amount) throw new HttpError(400, 'المبلغ إجباري');
    const method = body.method || null;
    if (method && !PAYMENT_METHODS.includes(method)) throw new HttpError(400, 'طريقة الدفع غير صالحة');
    const row = await one(
      `UPDATE ${table} SET month = $1, amount = $2, paid_on = $3, method = $4, note = $5, edited_at = now() WHERE id = $6 RETURNING id, receipt_no`,
      [month, amount, date(body.paid_on || today()), method, text(body.note, { max: 300, name: 'الملاحظة' }), params.id]
    );
    if (!row) throw new HttpError(404, 'الدفعة غير موجودة');
    return { payment: row };
  };
  route('PUT', '/api/payments/:id', ['admin'], editPayment('payments'));
  route('PUT', '/api/program/payments/:id', ['admin'], editPayment('program_payments'));

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
      `SELECT n.id, n.date::text, n.subject_id, n.category, n.rating, n.behavior, n.content, n.author_id, n.visible_to_parent,
         s.name AS subject_name, COALESCE(u.full_name, n.author_label) AS author_name, u.role AS author_role
       FROM notes n LEFT JOIN subjects s ON s.id = n.subject_id LEFT JOIN users u ON u.id = n.author_id
       WHERE n.student_id = $1 ${user.role === 'parent' ? 'AND n.visible_to_parent' : ''} ORDER BY n.date DESC, n.id DESC`,
      [student.id]
    );
    const finance = user.role === 'teacher' ? null : (await feeTools()).student(student, await studentPayments([student.id]));
    // نفس الطفل في البرنامج التربوي: قسمه، متابعته ووضعيته المالية
    const linked = user.role === 'teacher' ? null : await one(`${CHILD_SELECT} WHERE c.student_id = $1`, [student.id]);
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
    const show = async (k) => user.role !== 'parent' || featureOn(user, k);
    const [showAbs, showEval, showPay, showTt] = [await show('absences'), await show('evaluation'), await show('pay'), await show('timetable')];
    const program = linked ? await childFile(user, linked) : null;
    if (program && !showPay) program.finance = null;
    return {
      student: {
        ...student,
        subjects,
        parent_name: parent?.full_name ?? null,
        parent_phone: parent && user.role !== 'parent' ? parent.phone : null,
      },
      absences: showAbs ? absences : [],
      notes: showEval ? notes : [],
      finance: showPay ? finance : null,
      tasks: showEval ? tasks : [],
      timetable: showTt ? await studentSlots(student, subjects) : [],
      hidden: user.role === 'parent' ? { absences: !showAbs, evaluation: !showEval, pay: !showPay, timetable: !showTt } : undefined,
      // روابط مجموعات واتساب: للإدارة والولي فقط
      whatsapp_groups: user.role === 'teacher' ? [] : await studentWhatsappGroups(student),
      program,
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
    // السلوك مع المستوى في نفس الملاحظة، كما في بطاقة التقييم
    const behavior = body.behavior || null;
    if (behavior && !NOTE_RATINGS.includes(behavior)) throw new HttpError(400, 'تقييم السلوك غير صالح');
    const content = text(body.content, { required: !rating && !behavior, max: 2000, name: 'نص الملاحظة' }) ?? '';
    const note = await one(
      `INSERT INTO notes (student_id, author_id, subject_id, category, rating, behavior, content, date, visible_to_parent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        student.id,
        user.id,
        subjectId,
        body.category,
        rating,
        behavior,
        content,
        date(body.date || today()),
        body.visible_to_parent === undefined ? true : !!body.visible_to_parent,
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

  // ---------- بطاقة التقييم الشهرية (كالبطاقة الورقية) ----------
  // ملاحظات الأساتذة لكل مادة (المستوى والسلوك) + التقييم الإجمالي للإدارة؛ فقط ما يراه الولي
  const REPORT_ORDER = ['الرياضيات', 'العلوم', 'العربية', 'الإنجليزية', 'الفرنسية', 'علوم الحياة والأرض'];
  async function studentReport(user, student, month) {
    let subjects = await studentSubjects(student);
    // دون مواد محدّدة = كل مواد المستوى
    if (!subjects.length) subjects = await all('SELECT id, name, levels FROM subjects WHERE levels IS NULL OR $1 = ANY(levels) ORDER BY id', [student.level]);
    if (user.role === 'teacher') {
      const mine = await teacherSubjects(user.id);
      subjects = subjects.filter((x) => mine.some((m) => m.id === x.id && (!m.teach_levels || m.teach_levels.includes(student.level))));
    }
    const rank = (name) => (REPORT_ORDER.includes(name) ? REPORT_ORDER.indexOf(name) : 99);
    subjects.sort((a, b) => rank(a.name) - rank(b.name) || a.id - b.id);
    const notes = await all(
      `SELECT n.subject_id, n.category, n.rating, n.behavior, n.content, u.role AS author_role
       FROM notes n LEFT JOIN users u ON u.id = n.author_id
       WHERE n.student_id = $1 AND n.visible_to_parent AND ($2 = 'all' OR to_char(n.date, 'YYYY-MM') = $2)
       ORDER BY n.date DESC, n.id DESC`,
      [student.id, month]
    );
    return {
      student: {
        id: student.id, full_name: student.full_name, level: student.level,
        has_photo: student.has_photo, photo_version: student.photo_version,
      },
      month,
      admin_notes:
        user.role === 'teacher' ? [] : notes.filter((n) => !n.subject_id && n.author_role === 'admin' && n.content).map((n) => n.content),
      subjects: subjects.map((x) => {
        const mine = notes.filter((n) => n.subject_id === x.id);
        const academic = mine.filter((n) => n.category !== 'behavior');
        const behavior = mine.filter((n) => n.category === 'behavior');
        return {
          subject: x.name,
          level: academic.find((n) => n.rating)?.rating ?? null,
          behavior: mine.find((n) => n.behavior)?.behavior ?? behavior.find((n) => n.rating)?.rating ?? null,
          notes: academic.map((n) => n.content).filter(Boolean),
          behavior_notes: behavior.map((n) => n.content).filter(Boolean),
        };
      }),
    };
  }
  const reportMonth = (value) => (value === 'all' ? 'all' : monthParam(value));

  route('GET', '/api/students/:id/report', ANY, async ({ user, params, query }) => {
    const student = await loadStudentFor(user, params.id);
    const months = (
      await all(
        `SELECT DISTINCT to_char(date, 'YYYY-MM') AS m FROM notes WHERE student_id = $1 AND visible_to_parent ORDER BY m DESC`,
        [student.id]
      )
    ).map((r) => r.m);
    return { ...(await studentReport(user, student, reportMonth(query.get('month')))), months };
  });

  // بطاقات قسم كامل (للطباعة في ملف واحد)
  route('GET', '/api/reports/class', ['admin'], async ({ user, query }) => {
    const level = query.get('level');
    if (!LEVEL_CODES.includes(level)) throw new HttpError(400, 'المستوى غير صالح');
    const month = reportMonth(query.get('month'));
    const students = await all(
      `SELECT ${STUDENT_COLUMNS} FROM students st WHERE st.level = $1 AND st.status = 'studying' ORDER BY st.full_name`,
      [level]
    );
    const reports = [];
    for (const st of students) reports.push(await studentReport(user, st, month));
    return { month, reports };
  });

  // ---------- الاستيراد من التطبيق السابق (ملفات students.json و notes.json و teachers.json) ----------
  const LEGACY_SUBJECTS = {
    ar: 'العربية', fr: 'الفرنسية', en: 'الإنجليزية', math: 'الرياضيات', svt: 'علوم الحياة والأرض', sci: 'العلوم',
  };
  const LEGACY_LEVEL = { ممتاز: 'excellent', جيد: 'good', حسن: 'good', متوسط: 'average', ضعيف: 'weak', 'يحتاج متابعة': 'weak' };
  const legacyLevel = (grade, mode) => (String(grade) === '6' && mode === 'عن بعد' ? '6-distance' : String(grade));
  const legacySection = (g) => (g === '6o' ? '6-distance' : String(g));
  // الاسم للمقارنة: دون حركات ولا ما بين قوسين، حروف صغيرة
  const looseName = (name) =>
    String(name || '')
      .replace(/\(.*?\)/g, ' ')
      .normalize('NFD')
      .replace(/[̀-ًͯ-ْ]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const sameName = (a, b) => {
    const [x, y] = [looseName(a), looseName(b)];
    if (!x || !y) return false;
    if (x === y) return true;
    const [tx, ty] = [new Set(x.split(' ')), new Set(y.split(' '))];
    const [small, big] = tx.size <= ty.size ? [tx, ty] : [ty, tx];
    return small.size >= 2 && [...small].every((t) => big.has(t));
  };

  route('POST', '/api/import/legacy', ['admin'], async ({ body }) => {
    const legacyStudents = body.students && typeof body.students === 'object' ? Object.entries(body.students) : [];
    const legacyNotes = Array.isArray(body.notes) ? body.notes : [];
    const legacyTeachers = Array.isArray(body.teachers) ? body.teachers : [];
    if (!legacyStudents.length && !legacyNotes.length && !legacyTeachers.length) throw new HttpError(400, 'لا توجد معطيات');
    if (legacyStudents.length > 2000 || legacyNotes.length > 20000) throw new HttpError(400, 'الملف كبير جدًا');

    // المواد: «العلوم» للخامسة والسادسة إن لم تكن موجودة
    if (!(await one(`SELECT 1 FROM subjects WHERE name = 'العلوم'`))) {
      await pool.query(`INSERT INTO subjects (name, levels) VALUES ('العلوم', ARRAY['5', '6', '6-distance'])`);
    }
    const subjectRows = await all('SELECT id, name FROM subjects');
    const subjectId = (code) => subjectRows.find((x) => x.name === LEGACY_SUBJECTS[code])?.id ?? null;
    const result = { students_matched: 0, students_created: 0, notes_added: 0, notes_skipped: 0, teachers: [], parents: [], photo_targets: {} };

    // ----- المعلمون -----
    const teachers = await all(`SELECT id, full_name, legacy_id FROM users WHERE role = 'teacher'`);
    for (const t of legacyTeachers) {
      const label = text(t.label, { max: 120, name: 'اسم المعلم' });
      const legacyId = text(t._id, { max: 60, name: 'المعرّف' });
      if (!label || !legacyId) continue;
      let teacher = teachers.find((x) => x.legacy_id === legacyId) || teachers.find((x) => sameName(x.full_name, label));
      let created = null;
      if (!teacher) {
        let username = legacyId.replace(/^t-/, '').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'prof';
        while (await one('SELECT 1 FROM users WHERE lower(username) = $1', [username])) username += crypto.randomInt(1, 10);
        const pass = String(crypto.randomInt(100000, 1000000));
        teacher = await one(
          `INSERT INTO users (username, password_hash, full_name, role, legacy_id) VALUES ($1, $2, $3, 'teacher', $4) RETURNING id, full_name`,
          [username, hashPassword(pass), label, legacyId]
        );
        created = { username, password: pass };
      } else if (!teacher.legacy_id) {
        await pool.query('UPDATE users SET legacy_id = $1 WHERE id = $2', [legacyId, teacher.id]);
      }
      // المواد والمستويات: تُضاف لما عنده (لا يُحذف شيء)
      const levels = levelsList((Array.isArray(t.grades) ? t.grades : []).map(legacySection));
      for (const code of Array.isArray(t.subjects) ? t.subjects : []) {
        const sid = subjectId(code);
        if (sid) {
          await pool.query(
            `INSERT INTO teacher_subjects (teacher_id, subject_id, levels) VALUES ($1, $2, $3)
             ON CONFLICT (teacher_id, subject_id) DO UPDATE SET levels = EXCLUDED.levels`,
            [teacher.id, sid, levels]
          );
        }
      }
      result.teachers.push({ full_name: teacher.full_name, ...(created || { existing: true }) });
    }

    // ----- التلاميذ: نفس المعرّف، أو نفس الاسم (في نفس المستوى أولًا)، وإلا تلميذ جديد -----
    const existing = await all(`SELECT id, full_name, level, legacy_id, pack, (photo IS NOT NULL) AS has_photo FROM students`);
    const legacyToId = new Map();
    const toCreate = [];
    for (const [legacyId, x] of legacyStudents) {
      if (!x || typeof x !== 'object' || !/^[\w-]{1,40}$/.test(legacyId)) continue;
      const level = legacyLevel(x.grade, x.mode);
      if (!LEVEL_CODES.includes(level) || !text(x.name, { max: 120, name: 'الاسم' })) continue;
      const match =
        existing.find((s) => s.legacy_id === legacyId) ||
        existing.find((s) => !s.legacy_id && s.level === level && sameName(s.full_name, x.name)) ||
        existing.find((s) => !s.legacy_id && sameName(s.full_name, x.name));
      if (match) {
        match.legacy_id = legacyId;
        legacyToId.set(legacyId, match.id);
        await pool.query('UPDATE students SET legacy_id = $1 WHERE id = $2', [legacyId, match.id]);
        // المواد: فقط إن لم تُحدَّد بعد
        const hasSubjects = match.pack || (await one('SELECT 1 FROM student_subjects WHERE student_id = $1 LIMIT 1', [match.id]));
        if (!hasSubjects) await setStudentSubjects(match.id, (x.subjects || []).map(subjectId).filter(Boolean));
        result.students_matched++;
        if (!match.has_photo) result.photo_targets[legacyId] = match.id;
      } else {
        toCreate.push({ legacyId, x, level });
      }
    }
    if (toCreate.length) {
      const imported = await importStudentRows(
        toCreate.map(({ x, level }) => ({
          fullName: text(x.name, { max: 120 }),
          level,
          parentName: text(x.parentName, { max: 120 }),
          phone: text(x.parentPhone, { max: 60 }),
          phoneKey: phoneKey(x.parentPhone),
          city: null,
          school: null,
          remarks: null,
        }))
      );
      result.parents = imported.parents;
      for (const { legacyId, x, level } of toCreate) {
        const row = await one(
          `SELECT id FROM students WHERE lower(full_name) = lower($1) AND level = $2 AND legacy_id IS NULL ORDER BY id DESC LIMIT 1`,
          [text(x.name, { max: 120 }), level]
        );
        if (!row) continue;
        await pool.query(`UPDATE students SET legacy_id = $1, start_date = COALESCE(start_date, $2) WHERE id = $3`, [
          legacyId,
          DATE_RE.test(String(x.createdAt).slice(0, 10)) ? String(x.createdAt).slice(0, 10) : null,
          row.id,
        ]);
        await setStudentSubjects(row.id, (x.subjects || []).map(subjectId).filter(Boolean));
        legacyToId.set(legacyId, row.id);
        result.photo_targets[legacyId] = row.id;
        result.students_created++;
      }
    }
    // ملاحظات تلاميذ استُورِدوا سابقًا
    for (const s of await all('SELECT id, legacy_id FROM students WHERE legacy_id IS NOT NULL')) {
      if (!legacyToId.has(s.legacy_id)) legacyToId.set(s.legacy_id, s.id);
    }

    // ----- الملاحظات (المستوى والسلوك معًا) -----
    for (const n of legacyNotes) {
      const legacyId = typeof n?._id === 'string' && n._id.length <= 80 ? n._id : null;
      const studentId = legacyToId.get(n?.sid);
      const sid = subjectId(n?.subject);
      const at = String(n?.at || '').slice(0, 10);
      if (!legacyId || !studentId || !sid || !DATE_RE.test(at)) {
        result.notes_skipped++;
        continue;
      }
      const rating = LEGACY_LEVEL[n.level] ?? null;
      const behavior = LEGACY_LEVEL[n.behavior] ?? null;
      const content = String(n.text || '').trim().slice(0, 2000);
      if (!rating && !behavior && !content) {
        result.notes_skipped++;
        continue;
      }
      const { rowCount } = await pool.query(
        `INSERT INTO notes (student_id, subject_id, category, rating, behavior, content, date, visible_to_parent, author_label, legacy_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING`,
        [studentId, sid, rating || content ? 'level' : 'behavior', rating ?? (content ? null : behavior), behavior, content, at,
          n.share !== false, text(n.byLabel, { max: 120 }) || 'أستاذ(ة) المادة', legacyId]
      );
      if (rowCount) result.notes_added++;
      else result.notes_skipped++;
    }
    return [201, result];
  });

  // ---------- مراسلة الأولياء (مع أستاذ(ة) مادة أو مع الإدارة) ----------
  // من يرى المحادثة: الإدارة، ولي التلميذ، ومعلم المادة في مستوى التلميذ
  const THREAD_SELECT = `SELECT t.id, t.student_id, t.target, t.subject_id, t.title, t.status, t.created_by,
      t.created_at, t.updated_at, st.full_name AS student_name, st.level, st.parent_id, s.name AS subject_name,
      cu.full_name AS created_by_name, cu.role AS created_by_role
    FROM threads t JOIN students st ON st.id = t.student_id LEFT JOIN subjects s ON s.id = t.subject_id
    LEFT JOIN users cu ON cu.id = t.created_by`;
  function threadScope(user, params) {
    if (user.role === 'admin') return 'TRUE';
    params.push(user.id);
    const me = `$${params.length}`;
    if (user.role === 'parent') return `st.parent_id = ${me}`;
    return `t.target = 'subject' AND EXISTS (SELECT 1 FROM teacher_subjects ts WHERE ts.teacher_id = ${me}
      AND ts.subject_id = t.subject_id AND (ts.levels IS NULL OR st.level = ANY(ts.levels)))`;
  }
  async function loadThreadFor(user, id) {
    const params = [Number(id) || 0];
    const thread = await one(`${THREAD_SELECT} WHERE t.id = $1 AND ${threadScope(user, params)}`, params);
    if (!thread) throw new HttpError(404, 'المحادثة غير موجودة');
    return thread;
  }
  // الولي لا يرى أسماء المدرّسين: «أستاذ(ة) المادة» أو «إدارة فيد»
  const speaker = (viewer, thread, m) =>
    m.author_id === viewer.id ? 'أنا' :
    viewer.role !== 'parent' ? m.author_name || '—' :
    m.author_role === 'parent' ? m.author_name : m.author_role === 'admin' ? 'إدارة فيد' : `أستاذ(ة) ${thread.subject_name || 'المادة'}`;

  route('GET', '/api/threads', ANY, async ({ user, query }) => {
    const params = [];
    const where = [threadScope(user, params)];
    if (['open', 'closed'].includes(query.get('status'))) {
      params.push(query.get('status'));
      where.push(`t.status = $${params.length}`);
    }
    if (Number(query.get('student_id'))) {
      params.push(Number(query.get('student_id')));
      where.push(`t.student_id = $${params.length}`);
    }
    params.push(user.id);
    const me = `$${params.length}`;
    const threads = await all(
      `${THREAD_SELECT.replace('FROM threads t', `,
         (SELECT body FROM thread_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
         (SELECT COUNT(*)::int FROM thread_messages m WHERE m.thread_id = t.id
            AND m.id > COALESCE((SELECT last_read_id FROM thread_reads r WHERE r.thread_id = t.id AND r.user_id = ${me}), 0)
            AND m.author_id IS DISTINCT FROM ${me}) AS unread
       FROM threads t`)}
       WHERE ${where.join(' AND ')} ORDER BY t.status, t.updated_at DESC`,
      params
    );
    for (const t of threads) delete t.parent_id;
    return { threads, unread: threads.reduce((n, t) => n + t.unread, 0) };
  });

  route('GET', '/api/threads/unread', ANY, async ({ user }) => {
    const params = [];
    const scope = threadScope(user, params);
    params.push(user.id);
    const me = `$${params.length}`;
    const row = await one(
      `SELECT COUNT(*)::int AS n FROM thread_messages m JOIN threads t ON t.id = m.thread_id JOIN students st ON st.id = t.student_id
       WHERE ${scope} AND m.author_id IS DISTINCT FROM ${me}
         AND m.id > COALESCE((SELECT last_read_id FROM thread_reads r WHERE r.thread_id = t.id AND r.user_id = ${me}), 0)
         AND m.id > ${Number(await getSetting(`mail_badge_${user.id}`, 0)) || 0}`,
      params
    );
    return { count: row.n };
  });
  // الضغط على أيقونة الرسائل: يختفي العدد (الرسائل تبقى غير مقروءة داخل الصفحة)
  route('POST', '/api/threads/badge-seen', ANY, async ({ user }) => {
    const last = await one('SELECT COALESCE(MAX(id), 0)::int AS id FROM thread_messages');
    await saveSetting(`mail_badge_${user.id}`, last.id);
    return { ok: true };
  });

  // محادثة جديدة: الولي (لابنه)، المعلم (في مادته)، أو الإدارة
  route('POST', '/api/threads', ANY, async ({ user, body }) => {
    const student = await loadStudentFor(user, body.student_id);
    let target = body.target === 'subject' ? 'subject' : 'admin';
    let subjectId = null;
    if (user.role === 'teacher') target = 'subject';
    if (target === 'subject') {
      subjectId = Number(body.subject_id) || 0;
      const subjects = await studentSubjects(student);
      if (!subjects.some((x) => x.id === subjectId)) throw new HttpError(400, 'المادة غير موجودة لهذا التلميذ');
      if (user.role === 'teacher' && !(await teaches(user.id, subjectId, student.level))) throw new HttpError(403, 'هذه المادة ليست من موادك');
    }
    const msg = text(body.body, { required: true, max: 4000, name: 'الرسالة' });
    const thread = await one(
      `INSERT INTO threads (student_id, created_by, target, subject_id, title) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [student.id, user.id, target, subjectId, text(body.title, { max: 150, name: 'الموضوع' })]
    );
    const m = await one('INSERT INTO thread_messages (thread_id, author_id, body) VALUES ($1, $2, $3) RETURNING id', [thread.id, user.id, msg]);
    await pool.query('INSERT INTO thread_reads (thread_id, user_id, last_read_id) VALUES ($1, $2, $3)', [thread.id, user.id, m.id]);
    return [201, { thread }];
  });

  // رسالة لكامل القسم (دروس الدعم) بضغطة زر: محادثة مع ولي كل تلميذ في المستوى والمادة
  route('POST', '/api/threads/group', ['admin', 'teacher'], async ({ user, body }) => {
    if (!LEVEL_CODES.includes(body.level)) throw new HttpError(400, 'اختر المستوى');
    let subjectId = Number(body.subject_id) || null;
    if (user.role === 'teacher') {
      if (!subjectId || !(await teaches(user.id, subjectId, body.level))) throw new HttpError(403, 'هذه المادة ليست من موادك في هذا المستوى');
    }
    const msg = text(body.body, { required: true, max: 4000, name: 'الرسالة' });
    const title = text(body.title, { max: 150, name: 'الموضوع' });
    const students = await all(
      `SELECT st.id FROM students st WHERE st.level = $1 AND st.status = 'studying' AND st.parent_id IS NOT NULL
         AND ($2::int IS NULL OR st.pack OR EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.student_id = st.id AND ss.subject_id = $2)
              OR NOT EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.student_id = st.id))`,
      [body.level, subjectId]
    );
    if (!students.length) throw new HttpError(400, 'لا يوجد أولياء في هذا القسم');
    for (const st of students) {
      const thread = await one(
        `INSERT INTO threads (student_id, created_by, target, subject_id, title) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [st.id, user.id, subjectId ? 'subject' : 'admin', subjectId, title]
      );
      const m = await one('INSERT INTO thread_messages (thread_id, author_id, body) VALUES ($1, $2, $3) RETURNING id', [thread.id, user.id, msg]);
      await pool.query('INSERT INTO thread_reads (thread_id, user_id, last_read_id) VALUES ($1, $2, $3)', [thread.id, user.id, m.id]);
    }
    return [201, { sent: students.length }];
  });

  route('GET', '/api/threads/:id', ANY, async ({ user, params }) => {
    const thread = await loadThreadFor(user, params.id);
    const messages = await all(
      `SELECT m.id, m.body, m.created_at, m.author_id, u.full_name AS author_name, u.role AS author_role
       FROM thread_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.thread_id = $1 ORDER BY m.id`,
      [thread.id]
    );
    if (messages.length) {
      await pool.query(
        `INSERT INTO thread_reads (thread_id, user_id, last_read_id) VALUES ($1, $2, $3)
         ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_id = GREATEST(thread_reads.last_read_id, EXCLUDED.last_read_id)`,
        [thread.id, user.id, messages.at(-1).id]
      );
    }
    delete thread.parent_id;
    return {
      thread,
      messages: messages.map((m) => ({ id: m.id, body: m.body, created_at: m.created_at, mine: m.author_id === user.id,
        from: speaker(user, thread, m), from_role: m.author_role })),
    };
  });

  route('POST', '/api/threads/:id/messages', ANY, async ({ user, params, body }) => {
    const thread = await loadThreadFor(user, params.id);
    const m = await one('INSERT INTO thread_messages (thread_id, author_id, body) VALUES ($1, $2, $3) RETURNING id', [
      thread.id, user.id, text(body.body, { required: true, max: 4000, name: 'الرسالة' }),
    ]);
    // ردّ الولي يعيد فتح المحادثة المغلقة
    await pool.query(`UPDATE threads SET updated_at = now(), status = CASE WHEN $2 THEN 'open' ELSE status END WHERE id = $1`, [
      thread.id, user.role === 'parent',
    ]);
    await pool.query(
      `INSERT INTO thread_reads (thread_id, user_id, last_read_id) VALUES ($1, $2, $3)
       ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_id = EXCLUDED.last_read_id`,
      [thread.id, user.id, m.id]
    );
    return [201, { message: m }];
  });

  route('PATCH', '/api/threads/:id', ['admin', 'teacher'], async ({ user, params, body }) => {
    const thread = await loadThreadFor(user, params.id);
    await pool.query('UPDATE threads SET status = $1 WHERE id = $2', [body.status === 'closed' ? 'closed' : 'open', thread.id]);
    return { ok: true };
  });

  // ---------- إدخال بطاقات التقييم لقسم كامل (مادة واحدة، شهر واحد) ----------
  async function cardScope(user, levelValue, subjectValue) {
    if (!LEVEL_CODES.includes(levelValue)) throw new HttpError(400, 'المستوى غير صالح');
    const subject = await one('SELECT * FROM subjects WHERE id = $1', [Number(subjectValue) || 0]);
    if (!subject || !subjectFitsLevel(subject, levelValue)) throw new HttpError(400, 'المادة غير موجودة في هذا المستوى');
    if (user.role === 'teacher' && !(await teaches(user.id, subject.id, levelValue))) throw new HttpError(403, 'هذه المادة ليست من موادك في هذا المستوى');
    // التلاميذ الذين يدرسون هذه المادة (pack أو دون مواد محدّدة = كل مواد المستوى)
    const students = await all(
      `SELECT st.id, st.full_name, (st.photo IS NOT NULL) AS has_photo, st.photo_version FROM students st
       WHERE st.level = $1 AND st.status = 'studying'
         AND (st.pack OR EXISTS (SELECT 1 FROM student_subjects x WHERE x.student_id = st.id AND x.subject_id = $2)
              OR NOT EXISTS (SELECT 1 FROM student_subjects x WHERE x.student_id = st.id))
       ORDER BY st.full_name`,
      [levelValue, subject.id]
    );
    return { subject, students };
  }
  // تاريخ ملاحظة البطاقة: آخر يوم في الشهر (أو اليوم إن كان الشهر الحالي)
  const cardDate = (month) => {
    const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    return last < today() ? last : today();
  };

  route('GET', '/api/evaluations', ['admin', 'teacher'], async ({ user, query }) => {
    const { subject, students } = await cardScope(user, query.get('level'), query.get('subject_id'));
    const month = monthParam(query.get('month'));
    const cards = await all(
      `SELECT student_id, rating, behavior, content, visible_to_parent FROM notes WHERE subject_id = $1 AND card_month = $2`,
      [subject.id, month]
    );
    return { subject, month, students: students.map((st) => ({ ...st, card: cards.find((c) => c.student_id === st.id) || null })) };
  });

  route('POST', '/api/evaluations', ['admin', 'teacher'], async ({ user, body }) => {
    const { subject, students } = await cardScope(user, body.level, body.subject_id);
    const month = monthParam(body.month);
    const allowed = new Set(students.map((st) => st.id));
    let saved = 0;
    for (const e of Array.isArray(body.entries) ? body.entries : []) {
      const studentId = Number(e.student_id);
      if (!allowed.has(studentId)) continue;
      const rating = NOTE_RATINGS.includes(e.rating) ? e.rating : null;
      const behavior = NOTE_RATINGS.includes(e.behavior) ? e.behavior : null;
      const content = text(e.content, { max: 2000, name: 'الملاحظة' }) ?? '';
      if (!rating && !behavior && !content) {
        await pool.query('DELETE FROM notes WHERE student_id = $1 AND subject_id = $2 AND card_month = $3', [studentId, subject.id, month]);
        continue;
      }
      await pool.query(
        `INSERT INTO notes (student_id, author_id, subject_id, category, rating, behavior, content, date, card_month, author_label)
         VALUES ($1, $2, $3, 'level', $4, $5, $6, $7, $8, $9)
         ON CONFLICT (student_id, subject_id, card_month) WHERE card_month IS NOT NULL
         DO UPDATE SET rating = EXCLUDED.rating, behavior = EXCLUDED.behavior, content = EXCLUDED.content, author_id = EXCLUDED.author_id`,
        [studentId, user.id, subject.id, rating, behavior, content, cardDate(month), month, 'بطاقة التقييم']
      );
      saved++;
    }
    return { saved };
  });

  // ---------- نظرة حسب القسم: التلاميذ × المواد، آخر مستوى وسلوك ----------
  route('GET', '/api/overview', ['admin', 'teacher'], async ({ user, query }) => {
    const level = query.get('level');
    if (!LEVEL_CODES.includes(level)) throw new HttpError(400, 'المستوى غير صالح');
    let subjects = await all('SELECT id, name, levels FROM subjects WHERE levels IS NULL OR $1 = ANY(levels) ORDER BY id', [level]);
    if (user.role === 'teacher') {
      const mine = await teacherSubjects(user.id);
      subjects = subjects.filter((x) => mine.some((m) => m.id === x.id && (!m.teach_levels || m.teach_levels.includes(level))));
    }
    const rank = (name) => (REPORT_ORDER.includes(name) ? REPORT_ORDER.indexOf(name) : 99);
    subjects.sort((a, b) => rank(a.name) - rank(b.name) || a.id - b.id);
    const students = await all(
      `SELECT ${STUDENT_COLUMNS} FROM students st WHERE st.level = $1 AND st.status = 'studying' ORDER BY st.full_name`,
      [level]
    );
    const notes = students.length
      ? await all(
          `SELECT student_id, subject_id, category, rating, behavior, date::text FROM notes
           WHERE student_id = ANY($1::int[]) AND subject_id IS NOT NULL ORDER BY date DESC, id DESC`,
          [students.map((x) => x.id)]
        )
      : [];
    const rows = [];
    for (const st of students) {
      // دون مواد محدّدة = كل مواد المستوى (كما في قائمة المعلم والحضور)
      const own = await studentSubjects(st);
      const enrolled = new Set((own.length ? own : subjects).map((x) => x.id));
      rows.push({
        id: st.id, full_name: st.full_name, has_photo: st.has_photo, photo_version: st.photo_version,
        cells: subjects.map((x) => {
          if (!enrolled.has(x.id)) return null;
          const mine = notes.filter((n) => n.student_id === st.id && n.subject_id === x.id);
          const academic = mine.find((n) => n.category !== 'behavior' && n.rating);
          return {
            level: academic?.rating ?? null,
            behavior: mine.find((n) => n.behavior)?.behavior ?? mine.find((n) => n.category === 'behavior' && n.rating)?.rating ?? null,
            date: mine[0]?.date ?? null,
          };
        }),
      });
    }
    const counts = { excellent: 0, good: 0, average: 0, weak: 0 };
    for (const r of rows) for (const c of r.cells) if (c?.level) counts[c.level]++;
    return { level, subjects: subjects.map(({ id, name }) => ({ id, name })), students: rows, counts };
  });

  // ---------- الصفحة الرئيسية للمعلم والولي ----------
  // المعلم: تلاميذه، حصص اليوم، ملاحظاته (وهل يراها الولي)، غياباته، وأجرة الشهر
  route('GET', '/api/home/teacher', ['teacher'], async ({ user }) => {
    const month = currentMonth();
    const teacher = await one(`SELECT id, full_name, hourly_rate::float8 AS hourly_rate FROM users WHERE id = $1`, [user.id]);
    const pay = await teacherMonth(teacher, month);
    const counts = await one(
      `SELECT
         (SELECT COUNT(*)::int FROM students st WHERE ${teacherStudentsSql('$1')}) AS students,
         (SELECT COUNT(*)::int FROM notes WHERE author_id = $1 AND to_char(date, 'YYYY-MM') = $2) AS notes_month,
         (SELECT COUNT(*)::int FROM absences WHERE recorded_by = $1 AND to_char(date, 'YYYY-MM') = $2) AS absences_month`,
      [user.id, month]
    );
    return {
      month,
      ...counts,
      today: pay.sessions.filter((x) => x.date === today() && x.timetable_id),
      pay: {
        hourly_rate: pay.hourly_rate, hours_done: pay.hours_done, hours_planned: pay.hours_planned,
        due: pay.due, paid: pay.paid, remaining: pay.remaining, payments: pay.payments,
      },
      notes: await all(
        `SELECT n.id, n.date::text, n.category, n.rating, n.behavior, n.content, n.visible_to_parent,
           st.id AS student_id, st.full_name AS student_name, s.name AS subject_name
         FROM notes n JOIN students st ON st.id = n.student_id LEFT JOIN subjects s ON s.id = n.subject_id
         WHERE n.author_id = $1 ORDER BY n.date DESC, n.id DESC LIMIT 8`,
        [user.id]
      ),
      absences: await all(
        `SELECT a.date::text, st.id AS student_id, st.full_name AS student_name, s.name AS subject_name, a.justified
         FROM absences a JOIN students st ON st.id = a.student_id LEFT JOIN subjects s ON s.id = a.subject_id
         WHERE a.recorded_by = $1 ORDER BY a.date DESC, a.id DESC LIMIT 6`,
        [user.id]
      ),
    };
  });

  // ملف الولي (للإدارة): معطياته وأبناؤه في كل البرامج وما بقي عليهم
  route('GET', '/api/parents/:id', ['admin'], async ({ params }) => {
    const parent = await userById(params.id);
    if (!parent || parent.role !== 'parent') throw new HttpError(404, 'الولي غير موجود');
    const g = await one('SELECT google_email FROM users WHERE id = $1', [parent.id]);
    const kids = (await familyKids(parent)).map((k) => ({ ...k, link: k.type === 'child' ? `#/program/child/${k.id}` : k.link }));
    return { parent: { ...parent, google_email: g?.google_email || null }, kids, balance: round3(kids.reduce((t, k) => t + Math.max(k.balance, 0), 0)) };
  });

  // الولي: أبناؤه، آخر ملاحظات المعلمين (التي يراها)، الغيابات، وكل ما دفعه
  route('GET', '/api/home/parent', ['parent'], async ({ user }) => {
    const kids = await familyKids(user);
    const sIds = kids.filter((k) => k.type === 'student').map((k) => k.id);
    const cIds = [
      ...kids.filter((k) => k.type === 'child').map((k) => k.id),
      ...kids.filter((k) => k.type === 'student' && k.program).map((k) => k.program.id),
    ];
    const notes = await all(
      `SELECT * FROM (
         SELECT n.date::text AS date, n.id, n.category, n.rating, n.behavior, n.content, st.full_name AS child, s.name AS subject_name,
           u.role AS author_role, '#/students/' || st.id AS link
         FROM notes n JOIN students st ON st.id = n.student_id LEFT JOIN subjects s ON s.id = n.subject_id
         LEFT JOIN users u ON u.id = n.author_id
         WHERE n.student_id = ANY($1::int[]) AND n.visible_to_parent
         UNION ALL
         SELECT n.date::text AS date, n.id, n.category, n.rating, NULL::text, n.content, c.full_name, 'البرنامج التربوي', u.role,
           '#/kid/' || c.id
         FROM program_notes n JOIN program_children c ON c.id = n.child_id LEFT JOIN users u ON u.id = n.author_id
         WHERE n.child_id = ANY($2::int[])
       ) x ORDER BY date DESC, id DESC LIMIT 10`,
      [sIds, cIds]
    );
    const payments = await all(
      `SELECT * FROM (
         SELECT 'support' AS kind, p.id, p.paid_on::text AS paid_on, p.amount::float8 AS amount, p.month, p.receipt_no, st.full_name AS child, 'دروس الدعم' AS program
         FROM payments p JOIN students st ON st.id = p.student_id WHERE p.student_id = ANY($1::int[])
         UNION ALL
         SELECT 'program', p.id, p.paid_on::text, p.amount::float8, p.month, p.receipt_no, c.full_name, 'البرنامج التربوي'
         FROM program_payments p JOIN program_children c ON c.id = p.child_id WHERE p.child_id = ANY($2::int[])

       ) x ORDER BY paid_on DESC, receipt_no DESC LIMIT 12`,
      [sIds, cIds]
    );
    const absences = await all(
      `SELECT * FROM (
         SELECT a.date::text AS date, st.full_name AS child, s.name AS subject_name, a.justified FROM absences a
         JOIN students st ON st.id = a.student_id LEFT JOIN subjects s ON s.id = a.subject_id WHERE a.student_id = ANY($1::int[])
         UNION ALL
         SELECT a.date::text, c.full_name, 'البرنامج التربوي', a.justified FROM program_absences a
         JOIN program_children c ON c.id = a.child_id WHERE a.child_id = ANY($2::int[])
       ) x ORDER BY date DESC LIMIT 6`,
      [sIds, cIds]
    );
    return {
      kids,
      balance: round3(kids.reduce((t, k) => t + Math.max(k.balance, 0), 0)),
      notes: notes.map(({ author_role, ...n }) => ({ ...n, from: author_role === 'admin' ? 'إدارة فيد' : `أستاذ(ة) ${n.subject_name || ''}`.trim() })),
      payments,
      absences,
    };
  });

  // ---------- لوحة الإدارة ----------
  route('GET', '/api/stats', ['admin'], async () => {
    const counts = await one(`SELECT
      (SELECT COUNT(*)::int FROM students WHERE status = 'studying') AS students,
      (SELECT COUNT(*)::int FROM users WHERE role = 'teacher' AND NOT program_staff) AS teachers,
      (SELECT COUNT(DISTINCT parent_id)::int FROM students WHERE parent_id IS NOT NULL AND status <> 'left') AS parents,
      (SELECT COUNT(*)::int FROM absences WHERE date >= current_date - 30) AS absences_month,
      (SELECT COUNT(*)::int FROM students WHERE status = 'waiting') AS waiting`);
    const students = await all(`SELECT ${STUDENT_COLUMNS} FROM students st`);
    const payments = students.length ? await studentPayments(students.map((st) => st.id)) : [];
    const fees = await feeTools();
    const month = currentMonth();
    const unpaid = students
      .map((st) => ({
        id: st.id,
        full_name: st.full_name,
        level: st.level,
        balance: fees.student(st, payments.filter((p) => p.student_id === st.id)).balance,
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
              t + (fees.student(st, []).months.find((m) => m.month === month)?.due ?? 0),
            0
          )
        ),
        collected: round3(payments.filter((p) => p.month === month).reduce((t, p) => t + p.amount, 0)),
        outstanding: round3(unpaid.reduce((t, st) => t + st.balance, 0)),
        unpaid: unpaid.slice(0, 15),
        unpaid_count: unpaid.length,
        // اليوم (دروس الدعم): ما دُفع اليوم، وما صُرف اليوم (خلاص المدرّسين ومصاريف الدعم)
        today: await one(
          `SELECT COALESCE((SELECT SUM(amount) FROM payments WHERE paid_on = CURRENT_DATE), 0)::float8 AS income,
             COALESCE((SELECT COUNT(*) FROM payments WHERE paid_on = CURRENT_DATE), 0)::int AS payments,
             (COALESCE((SELECT SUM(amount) FROM teacher_payments WHERE paid_on = CURRENT_DATE), 0)
              + COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE direction = 'expense' AND activity = 'support' AND date = CURRENT_DATE), 0))::float8 AS expense`
        ),
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
      await loadLevels();
      const match = routes
        .filter((r) => r.re.test(url.pathname))
        .find((r) => r.method === request.method);
      if (!match) throw new HttpError(404, 'غير موجود');

      const token = parseCookies(request.headers.get('cookie') || '')[SESSION_COOKIE] || null;
      let user = null;
      if (token) {
        const row = await one('SELECT user_id, impersonator_id FROM sessions WHERE token = $1 AND expires_at > now()', [token]);
        if (row) user = await userById(row.user_id);
        if (user && !user.approved) user = null;
        // آخر نشاط (مرّة كل 5 دقائق على الأكثر، ولا يُحتسب وضع التجربة)
        if (user && !row.impersonator_id && (!user.last_seen || Date.now() - new Date(user.last_seen).getTime() > 300000)) {
          pool.query(`UPDATE users SET last_seen = now() WHERE id = $1`, [user.id]).catch(() => {});
        }
        if (user && row.impersonator_id) {
          user.impersonated_by = row.impersonator_id;
          // وضع التجربة للاطّلاع فقط
          if (!['GET', 'HEAD'].includes(request.method) && !/^\/api\/(logout|impersonate\/stop|alerts\/seen|threads\/badge-seen)$/.test(url.pathname)) {
            throw new HttpError(403, 'وضع التجربة للاطّلاع فقط: ارجع لحسابك باش تعدّل');
          }
        }
      }
      if (match.roles) {
        if (!user) throw new HttpError(401, 'يجب تسجيل الدخول');
        if (match.roles.length && !match.roles.includes(user.role)) throw new HttpError(403, 'ليس لديك صلاحية');
      }
      // المعلمون والمؤطّرون والأولياء: ما أوقفه المدير محجوب
      if (user && featureGroups(user).length && url.pathname !== '/api/me') {
        const rf = await getSetting('role_features', null);
        if (rf) {
          for (const g of featureGroups(user)) {
            for (const [k, [label, re]] of Object.entries(ROLE_FEATURES[g])) {
              if (re && rf[g]?.[k] === false && re.test(url.pathname)) throw new HttpError(403, `هذه الخاصية موقوفة من الإدارة: ${label}`);
            }
          }
        }
      }
      if (user?.role === 'admin' && !user.super_admin) {
        const perms = permsOf(user);
        for (const [m, p, perm] of PERMISSION_RULES) {
          if (m.test(request.method) && p.test(url.pathname) && !perms[perm]) throw new HttpError(403, `ليس لديك صلاحية: ${PERMISSIONS[perm]}`);
        }
        // حساب للاطّلاع فقط: كل تعديل مرفوض (ما عدا الخروج وتغيير كلمة سرّه وقراءة التنبيهات)
        if (perms.read_only && !['GET', 'HEAD'].includes(request.method) && !/^\/api\/(logout|me\/password|alerts\/seen|threads\/badge-seen)$/.test(url.pathname)) {
          throw new HttpError(403, 'هذا الحساب للاطّلاع فقط');
        }
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
