'use strict';

const state = { user: null, meta: null };

const ROLE_LABELS = { admin: 'الإدارة', teacher: 'معلم', parent: 'ولي' };
const CATEGORY_LABELS = { behavior: 'السلوك', level: 'المستوى', general: 'عامة' };
const RATING_LABELS = { excellent: 'ممتاز', good: 'حسن', average: 'متوسط', weak: 'ضعيف' };
// سلالم بطاقة التقييم: المستوى والسلوك
const LEVEL_WORDS = { excellent: 'ممتاز', good: 'جيد', average: 'متوسط', weak: 'ضعيف' };
const BEHAVIOR_WORDS = { excellent: 'ممتاز', good: 'حسن', average: 'متوسط', weak: 'يحتاج متابعة' };
const STATUS_LABELS = { studying: 'يدرس', waiting: 'في الانتظار', left: 'خرج', stopped: 'متوقف' };
const statusBadge = (st) => `<span class="badge status-${esc(st)}">${STATUS_LABELS[st] || esc(st)}</span>`;

// ---------- أدوات ----------
const $ = (sel, root = document) => root.querySelector(sel);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function levelLabel(code) {
  const level = state.meta?.levels.find((l) => l.code === code);
  return level ? level.label : code;
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const MONTHS_AR = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const PAYMENT_LABELS = { cash: 'نقدًا', transfer: 'تحويل بنكي', cheque: 'صك', d17: 'D17', other: 'أخرى' };

function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return `${MONTHS_AR[Number(mo) - 1]} ${y}`;
}

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  return `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 })}\u00A0د.ت`;
}

function avatar(st, cls = '') {
  const initial = esc((st.full_name || '?').trim().charAt(0).toUpperCase());
  return st.has_photo
    ? `<img class="avatar ${cls}" src="/api/students/${st.id}/photo?v=${st.photo_version}" alt="" loading="lazy">`
    : `<span class="avatar ${cls}">${initial}</span>`;
}

// ---------- واتساب ----------
// رقم دولي لواتساب: الرقم الأول فقط، والأرقام التونسية (8 أرقام) يُضاف لها 216
function waNumber(phone) {
  const first = String(phone || '').split(/[\/,;]|\s-\s|-(?=\d{6})/)[0];
  let digits = first.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length === 8) digits = '216' + digits;
  return digits.length >= 10 ? digits : null;
}

const waUrl = (phone, message = '') =>
  `https://wa.me/${waNumber(phone)}${message ? `?text=${encodeURIComponent(message)}` : ''}`;

const WA_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';

// زر واتساب صغير بجانب رقم الهاتف
function waButton(phone, message = '', label = '') {
  if (!waNumber(phone)) return '';
  return `<a class="wa-btn" href="${esc(waUrl(phone, message))}" target="_blank" rel="noopener" title="واتساب">${WA_ICON}${label ? ` ${esc(label)}` : ''}</a>`;
}

// نماذج الرسائل: {الولي} {التلميذ} {المبلغ} {التاريخ}
const WA_TEMPLATES = {
  general: { label: 'رسالة عامة', text: 'السلام عليكم {الولي}،\n' },
  absence: {
    label: 'إعلام بغياب',
    text: 'السلام عليكم {الولي}،\nنعلمكم أن {التلميذ} تغيّب اليوم {التاريخ} عن حصة الدروس الخصوصية. نرجو إعلامنا بالسبب.\nإدارة فيد',
  },
  payment: {
    label: 'تذكير بالخلاص',
    text: 'السلام عليكم {الولي}،\nنذكّركم بأن المبلغ المتبقي لخلاص الدروس الخصوصية لـ {التلميذ} هو {المبلغ}. تجدون التفاصيل في حسابكم على المنصة.\nشكرًا، إدارة فيد',
  },
  account: {
    label: 'رابط المنصة',
    text: 'السلام عليكم {الولي}،\nيمكنكم متابعة {التلميذ} (الغيابات، الملاحظات، جدول الأوقات والخلاص) على منصة فيد:\n{الرابط}',
  },
};

function fillTemplate(text, vars) {
  return text
    .replaceAll('{الولي}', vars.parent || '')
    .replaceAll('{التلميذ}', vars.student || '')
    .replaceAll('{المبلغ}', vars.amount || '')
    .replaceAll('{التاريخ}', fmtDate(today()))
    .replaceAll('{الرابط}', location.origin);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// نافذة كتابة رسالة واتساب لولي
function waComposer(phone, vars, initial = 'general') {
  openModal(
    'رسالة واتساب للولي',
    `<p class="muted small" dir="ltr">+${esc(waNumber(phone))}</p>
     <label>النموذج<select id="wa-template">${Object.entries(WA_TEMPLATES)
       .map(([k, t]) => `<option value="${k}" ${k === initial ? 'selected' : ''}>${t.label}</option>`)
       .join('')}</select></label>
     <label>الرسالة<textarea id="wa-text" rows="6"></textarea></label>`,
    async () => {
      window.open(waUrl(phone, $('#wa-text').value), '_blank', 'noopener');
    }
  );
  $('#modal-form button[type=submit]').textContent = 'فتح واتساب';
  const sync = () => ($('#wa-text').value = fillTemplate(WA_TEMPLATES[$('#wa-template').value].text, vars));
  $('#wa-template').addEventListener('change', sync);
  sync();
}

// تصغير الصورة في المتصفح قبل رفعها (JPEG مربّعة 320px)
// صور HEIC (كاميرا أغلب هواتف Android وiPhone): المتصفح لا يقرأها، فتُحوَّل إلى JPEG أولًا
const isHeic = (file) => /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
let heicLib = null;
function loadHeic() {
  return (heicLib ??= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/heic2any.min.js';
    sc.onload = () => resolve(window.heic2any);
    sc.onerror = () => {
      heicLib = null;
      reject(new Error('تعذّر تحميل قارئ صور HEIC، تحقّق من الاتصال'));
    };
    document.head.appendChild(sc);
  }));
}

function drawSquare(src, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas
        .getContext('2d')
        .drawImage(img, (img.width - side) / 2, (img.height - side) * (img.height > img.width ? 0.3 : 0.5), side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('unreadable'));
    img.src = URL.createObjectURL(src);
  });
}

async function resizeImage(file, size = 320) {
  // نجرّب القراءة مباشرة (Safari يقرأ HEIC)، وإلا نحوّلها
  try {
    return await drawSquare(file, size);
  } catch {
    if (!isHeic(file)) throw new Error('تعذّرت قراءة الصورة، جرّب صورة أخرى (JPG أو PNG).');
  }
  try {
    const heic2any = await loadHeic();
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    return await drawSquare(Array.isArray(out) ? out[0] : out, size);
  } catch (err) {
    throw new Error(err.message?.includes('HEIC') ? err.message : 'تعذّر تحويل صورة HEIC، جرّب صورة أخرى.');
  }
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') {
    state.user = null;
    location.hash = '#/login';
  }
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 3000);
}

function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox' && el.name.endsWith('[]')) {
      const key = el.name.slice(0, -2);
      data[key] = data[key] || [];
      if (el.checked) data[key].push(key === 'levels' ? el.value : Number(el.value));
    } else if (el.type === 'checkbox') {
      data[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) data[el.name] = el.value;
    } else {
      data[el.name] = el.value;
    }
  }
  return data;
}

// نافذة منبثقة عامة: onSubmit يرجع وعدًا، الخطأ يظهر داخل النافذة
function openModal(title, bodyHtml, onSubmit) {
  const dialog = $('#modal');
  const form = $('#modal-form');
  const error = $('#modal-error');
  $('#modal-title').textContent = title;
  $('#modal-form button[type=submit]').textContent = 'حفظ';
  $('#modal-body').innerHTML = bodyHtml;
  error.hidden = true;
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await onSubmit(formData(form));
      dialog.close();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };
  $('#modal-cancel').onclick = () => dialog.close();
  dialog.showModal();
  form.querySelector('input, select, textarea')?.focus();
}

function confirmAction(message) {
  return window.confirm(message);
}

function levelOptions(selected, withAll = false) {
  return (
    (withAll ? '<option value="">كل المستويات</option>' : '') +
    state.meta.levels
      .map((l) => `<option value="${esc(l.code)}" ${l.code === selected ? 'selected' : ''}>${esc(l.label)}</option>`)
      .join('')
  );
}

function subjectOptions(subjects, selected, emptyLabel) {
  return (
    (emptyLabel ? `<option value="">${esc(emptyLabel)}</option>` : '') +
    subjects
      .map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`)
      .join('')
  );
}

// ---------- التوجيه ----------
const routes = [
  [/^#\/login$/, viewLogin],
  [/^#\/students$/, viewStudents],
  [/^#\/students\/(\d+)$/, viewStudent],
  [/^#\/teachers$/, (el) => viewUsers(el, 'teacher', 'support')],
  [/^#\/parents$/, (el) => viewUsers(el, 'parent')],
  [/^#\/admins$/, (el) => viewUsers(el, 'admin')],
  [/^#\/subjects$/, viewSubjects],
  [/^#\/import$/, viewImport],
  [/^#\/photos$/, (el) => viewBulkPhotos(el)],
  [/^#\/general$/, (el) => viewGeneralExpenses(el)],
  [/^#\/google-link$/, (el) => viewGoogleLink(el)],
  [/^#\/parent-requests$/, (el) => viewParentRequests(el)],
  [/^#\/register$/, viewRegister],
  [/^#\/attendance$/, viewAttendance],
  [/^#\/tasks$/, viewTasks],
  [/^#\/timetable$/, viewTimetable],
  [/^#\/whatsapp$/, viewWhatsappGroups],
  [/^#\/broadcast$/, viewBroadcast],
  [/^#\/payroll$/, viewPayroll],
  [/^#\/home$/, (el) =>
    state.user.role === 'teacher' ? (state.user.program_staff ? viewProgram(el) : viewTeacherHome(el)) : state.user.role === 'parent' ? viewParentHome(el) : viewHome(el)],
  [/^#\/program$/, (el) => viewProgram(el)],
  [/^#\/program\/child\/(\d+)$/, (el, id) => viewProgramChild(el, Number(id))],
  [/^#\/kid\/(\d+)$/, (el, id) => viewProgramChild(el, Number(id))],
  [/^#\/program\/attendance$/, (el) => viewProgramAttendance(el)],
  [/^#\/program\/board$/, (el) => viewProgramBoard(el)],
  [/^#\/program\/timetable$/, (el) => viewProgramTimetable(el)],
  [/^#\/program\/notes$/, (el) => viewProgramNotes(el)],
  [/^#\/program\/pay$/, (el) => viewProgramPay(el)],
  [/^#\/program\/posts$/, (el) => viewProgramPosts(el)],
  [/^#\/program\/staff$/, (el) => viewUsers(el, 'teacher', 'program')],
  [/^#\/support\/teachers$/, (el) => viewUsers(el, 'teacher', 'support')],
  [/^#\/group-message$/, (el) => viewGroupMessage(el)],
  [/^#\/partners$/, (el) => viewPartners(el)],
  [/^#\/salaries$/, (el) => viewSalaries(el)],
  [/^#\/board$/, (el) => viewBoard(el)],
  [/^#\/center-debts$/, (el) => viewCenterDebts(el)],
  [/^#\/products$/, (el) => viewProducts(el)],
  [/^#\/courses$/, (el) => viewCourses(el)],
  [/^#\/courses\/(\d+)$/, (el, id) => viewCourse(el, Number(id))],
  [/^#\/ledger$/, (el) => viewLedger(el)],
  [/^#\/staff$/, (el) => viewStaff(el)],
  [/^#\/finance$/, (el) => viewFinance(el)],
  [/^#\/people$/, (el) => viewPeople(el)],
  [/^#\/debts$/, (el) => viewDebts(el)],
  [/^#\/receipts$/, (el) => viewReceipts(el)],
  [/^#\/receipt\/(support|program|course|registration)\/(\d+)$/, (el, kind, id) => viewReceipt(el, kind, Number(id))],
  [/^#\/todo$/, (el) => viewTodo(el)],
  [/^#\/meetings$/, (el) => viewMeetings(el)],
  [/^#\/alerts$/, (el) => viewAlerts(el)],
  [/^#\/fees$/, (el) => viewFees(el)],
  [/^#\/payroll\/(\d+)$/, (el, id) => viewTeacherPay(el, Number(id))],
  [/^#\/my-pay$/, (el) => viewTeacherPay(el, state.user.id)],
  [/^#\/registrations$/, (el) => {
    sessionStorage.setItem('statusFilter', 'waiting');
    sessionStorage.setItem('levelFilter', '');
    return viewStudents(el);
  }],
  [/^#\/report\/(\d+)$/, (el, id) => viewReport(el, Number(id))],
  [/^#\/report-class$/, (el) => viewClassReports(el)],
  [/^#\/messages$/, (el) => viewMessages(el)],
  [/^#\/messages\/(\d+)$/, (el, id) => viewThread(el, Number(id))],
  [/^#\/evaluations$/, (el) => viewEvaluations(el)],
  [/^#\/overview$/, (el) => viewOverview(el)],
  [/^#\/register-teacher$/, (el) => viewRegisterTeacher(el)],
  [/^#\/account$/, viewAccount],
  [/^#\/dashboard$/, viewDashboard],
];

function homeFor(user) {
  return '#/home';
}

let navCount = 0;
async function router() {
  const hash = location.hash || '#/';
  const isPublic = ['#/login', '#/register', '#/register-teacher', '#/google-link'].includes(hash);
  if (!state.user && !isPublic) {
    try {
      const { user } = await api('GET', '/api/me');
      state.user = user;
      state.meta = await api('GET', '/api/meta');
    } catch {
      location.hash = '#/login';
      return;
    }
  }
  if ($('#modal').open) $('#modal').close();
  renderTopbar();
  if (state.user && (hash === '#/' || isPublic)) {
    location.hash = homeFor(state.user);
    return;
  }
  const nav = ++navCount;
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (m) {
      const el = $('#view');
      el.innerHTML = '<p class="muted">جاري التحميل…</p>';
      try {
        await view(el, ...m.slice(1));
      } catch (err) {
        // خطأ صفحة غادرها المستعمل قبل أن تكتمل: لا يُكتب فوق الصفحة الجديدة
        if (nav === navCount) el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
      }
      return;
    }
  }
  location.hash = state.user ? homeFor(state.user) : '#/login';
}

// القائمة: عناصر أساسية، وبعضها مجموعات بعناصر فرعية
const NAV = {
  admin: [
    ['#/home', 'الرئيسية'],
    ['#/board', 'لوحة المشرف'],
    {
      label: 'دروس الدعم',
      items: [
        ['#/dashboard', 'لوحة دروس الدعم'],
        ['', 'التلاميذ'],
        ['#/students', 'قائمة التلاميذ'],
        ['#/attendance', 'الغيابات'],
        ['', 'التنظيم'],
        ['#/timetable', 'جداول الأوقات'],
        ['#/subjects', 'المواد'],
        ['', 'المدرّسون'],
        ['#/support/teachers', 'قائمة المدرّسين'],
        ['#/payroll', 'خلاص المدرّسين (الرواتب الشهرية)'],
        ['', 'التقييم'],
        ['#/evaluations', 'إدخال الملاحظات'],
        ['#/overview', 'الرؤية الإجمالية والطباعة'],
        ['#/tasks', 'تمارين وأنشطة القسم'],
        ['#/group-message', 'رسالة لكامل القسم'],
      ],
    },
    {
      label: 'البرنامج التربوي',
      items: [
        ['#/program/board', 'لوحة التحكم'],
        ['#/program', 'الأطفال والأقسام والغيابات'],
        ['#/program/timetable', 'جداول الأوقات'],
        ['#/program/posts', 'أنشطة ورسائل الأقسام'],
        ['', 'المؤطّرون'],
        ['#/program/staff', 'قائمة المؤطّرين'],
        ['#/program/pay', 'خلاص المؤطّرين'],
        ['#/program/notes', 'ملاحظات المؤطّرين'],
      ],
    },
    ['#/courses', 'الدورات والأنشطة'],
    {
      label: 'إدارة المركز',
      items: [
        ['#/alerts', 'التنبيهات'],
        ['#/todo', 'المهام والمشاكل'],
        ['#/meetings', 'الاجتماعات والقرارات'],
        ['#/people', 'كل تلاميذ المركز'],
        ['', 'المالية'],
        ['#/general', 'المصاريف العامة للمركز'],
        ['#/finance', 'المردودية المالية'],
        ['#/debts', 'المتخلّد بذمتهم'],
        ['#/receipts', 'الوصولات'],
        ['#/ledger', 'المداخيل والمصاريف'],
        ['#/fees', 'التعريفات والتخفيضات'],
        ['#/products', 'المنتجات (كتب ومراجع)'],
        ['#/salaries', 'الأجور (كل الإطار)'],
        ['#/center-debts', 'ديون المركز'],
        ['#/partners', 'الشركاء والمرابيح'],
      ],
    },
    {
      label: 'التواصل',
      items: [
        ['#/messages', 'رسائل الأولياء'],
        ['#/broadcast', 'رسالة جماعية'],
        ['#/whatsapp', 'مجموعات واتساب'],
      ],
    },
    {
      label: 'الحسابات',
      items: [
        ['#/support/teachers', 'مدرّسو دروس الدعم'],
        ['#/program/staff', 'مؤطّرو البرنامج التربوي'],
        ['#/parents', 'الأولياء'],
        ['#/parent-requests', 'طلبات أولياء Google'],
        ['#/admins', 'الإدارة'],
        ['#/account', 'حسابي'],
      ],
    },
  ],
  teacher: [
    ['#/home', 'الرئيسية'],
    ['#/students', 'تلاميذي'],
    ['#/timetable', 'جدولي'],
    ['#/attendance', 'الغيابات'],
    ['#/tasks', 'تمارين وأنشطة القسم'],
    ['#/group-message', 'رسالة لكامل القسم'],
    ['#/evaluations', 'بطاقات التقييم'],
    ['#/overview', 'نظرة القسم'],
    ['#/messages', 'الرسائل'],
    ['#/my-pay', 'ساعاتي وخلاصي'],
    ['#/program', 'البرنامج التربوي'],
    ['#/program/posts', 'أنشطة ورسائل قسمي'],
    ['#/todo', 'مهامي'],
    ['#/account', 'حسابي'],
  ],
  // مؤطّر البرنامج التربوي: لا علاقة له بدروس الدعم
  program_staff: [
    ['#/home', 'الرئيسية'],
    ['#/program/posts', 'أنشطة ورسائل قسمي'],
    ['#/program/attendance', 'الغيابات'],
    ['#/program/timetable', 'جدول الأوقات'],
    ['#/program/pay', 'أجرتي'],
    ['#/account', 'حسابي'],
  ],
  parent: [
    ['#/home', 'الرئيسية'],
    ['#/students', 'أبنائي'],
    ['#/timetable', 'جدول الأوقات'],
    ['#/messages', 'الرسائل'],
    ['#/account', 'حسابي'],
  ],
};

// لافتة الترحيب في الصفحات الرئيسية
function heroBanner({ sub = '', art = '🎓', actions = '' } = {}) {
  const h = new Date().getHours();
  const hello = h < 12 ? 'صباح الخير' : 'مساء الخير';
  const first = esc(String(state.user?.full_name || '').split(' ')[0]);
  const day = new Date().toLocaleDateString('ar-TN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `<section class="hero"><div>
      <small>${esc(day)}</small>
      <h2>${hello}${first ? `، ${first}` : ''} 👋</h2>
      ${sub ? `<p>${sub}</p>` : ''}
      ${actions ? `<div class="hero-actions">${actions}</div>` : ''}
    </div><div class="hero-art" aria-hidden="true">${art}</div></section>`;
}

// ---------- أيقونات القائمة (خطوط بسيطة) ----------
const ICON_PATHS = {
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  spark: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  check: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
};
const icon = (name) =>
  `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.grid}</svg>`;
const GROUP_ICONS = { 'دروس الدعم': 'book', 'البرنامج التربوي': 'spark', 'إدارة المركز': 'building', 'التواصل': 'chat', 'الحسابات': 'users' };
const LINK_ICONS = {
  '#/home': 'home', '#/courses': 'flag', '#/students': 'users', '#/timetable': 'calendar', '#/program/timetable': 'calendar',
  '#/attendance': 'check', '#/program/attendance': 'check', '#/messages': 'chat', '#/my-pay': 'wallet', '#/program/pay': 'wallet',
  '#/account': 'user', '#/tasks': 'clipboard', '#/evaluations': 'clipboard', '#/overview': 'chart', '#/program/posts': 'star',
  '#/todo': 'clipboard', '#/program': 'spark', '#/group-message': 'chat', '#/board': 'chart',
};
// شريط التنقل السفلي في الهاتف: 4 وجهات حسب الدور + «المزيد»
const TABS = {
  admin: [['#/home', 'الرئيسية', 'home'], ['#/students', 'الدعم', 'book'], ['#/program', 'التربوي', 'spark'], ['#/messages', 'الرسائل', 'chat']],
  teacher: [['#/home', 'الرئيسية', 'home'], ['#/students', 'تلاميذي', 'users'], ['#/attendance', 'الغيابات', 'check'], ['#/messages', 'الرسائل', 'chat']],
  program_staff: [['#/home', 'الرئيسية', 'home'], ['#/program/posts', 'الأنشطة', 'star'], ['#/program/attendance', 'الغيابات', 'check'], ['#/program/pay', 'أجرتي', 'wallet']],
  parent: [['#/home', 'الرئيسية', 'home'], ['#/students', 'أبنائي', 'smile'], ['#/timetable', 'الجدول', 'calendar'], ['#/messages', 'الرسائل', 'chat']],
};

function renderTopbar() {
  const bar = $('#topbar');
  closeSubnav();
  if (!state.user) {
    bar.hidden = true;
    $('#tabbar').hidden = true;
    document.body.classList.remove('shell');
    return;
  }
  bar.hidden = false;
  document.body.classList.add('shell');
  const current = location.hash.split('?')[0];
  const navKey = state.user.role === 'teacher' && state.user.program_staff ? 'program_staff' : state.user.role;
  const exact = JSON.stringify(NAV[navKey]).includes(`"${current}"`);
  const isActive = (href) => current === href || (!exact && href !== '#/' && current.startsWith(href + '/'));
  // «البرنامج التربوي» للمعلم فقط إن كان منشّطًا لقسم
  const nav = NAV[navKey]
    .filter((e) => !(navKey === 'teacher' && String(e[0]).startsWith('#/program') && !state.user.program_classes))
    .filter((e) => !(Array.isArray(e) && e[0] === '#/board' && !state.user.super_admin))
    .map((e) => (Array.isArray(e) || state.user.super_admin ? e : { ...e, items: e.items.filter(([h]) => h !== '#/partners') }));
  $('#nav').innerHTML = nav
    .map((entry, i) =>
      Array.isArray(entry)
        ? `<a href="${entry[0]}" class="${isActive(entry[0]) ? 'active' : ''}">${entry[1]}</a>`
        : `<button type="button" class="nav-group ${entry.items.some(([h]) => isActive(h)) ? 'active' : ''}" data-group="${i}"
             aria-haspopup="true" aria-expanded="false">${entry.label} <span class="caret">▾</span></button>`
    )
    .join('');
  $('#nav').querySelectorAll('.nav-group').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = $('#subnav');
      if (!panel.hidden && panel.dataset.group === btn.dataset.group) return closeSubnav();
      openSubnav(btn, nav[Number(btn.dataset.group)], isActive);
    })
  );
  $('#who-name').textContent = `${state.user.full_name} · ${ROLE_LABELS[state.user.role]}`;

  // نسخة عمودية من نفس القائمة: المجموعة التي فيها الصفحة الحالية مفتوحة
  const initial = esc((state.user.full_name || '?').trim().charAt(0).toUpperCase());
  $('#vmenu').innerHTML =
    `<a class="side-brand" href="#/home"><img src="feed-logo.png" alt="فيد"></a>
     <div class="side-links">` +
    nav
      .map((entry) =>
        Array.isArray(entry)
          ? `<a href="${entry[0]}" class="top ${isActive(entry[0]) ? 'active' : ''}">${icon(LINK_ICONS[entry[0]])}<span>${entry[1]}</span></a>`
          : `<details ${entry.items.some(([h]) => isActive(h)) ? 'open' : ''}><summary>${icon(GROUP_ICONS[entry.label])}<span>${entry.label}</span></summary>${entry.items
              .map(([h, l]) => navItem(h, l, isActive))
              .join('')}</details>`
      )
      .join('') +
    `</div>
     <div class="vmenu-user"><span class="avatar sm">${initial}</span><div><b>${esc(state.user.full_name)}</b><small>${ROLE_LABELS[state.user.role]}</small></div>
       <button class="side-out" id="side-logout" title="خروج">${icon('logout')}</button></div>`;
  $('#side-logout').addEventListener('click', () => $('#logout').click());
  // شريط التنقل السفلي (الهاتف)
  const tabs = TABS[navKey] || TABS.parent;
  $('#tabbar').hidden = false;
  $('#tabbar').innerHTML =
    tabs.map(([h, l, ic]) => `<a href="${h}" class="${isActive(h) ? 'on' : ''}">${icon(ic)}<span>${l}</span></a>`).join('') +
    `<button type="button" id="tab-more" class="${tabs.some(([h]) => isActive(h)) ? '' : 'on'}">${icon('grid')}<span>المزيد</span></button>`;
  $('#tab-more').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = $('#vmenu').hidden;
    $('#vmenu').hidden = !open;
    document.body.classList.toggle('sheet-open', open);
  });
  $('#vmenu').querySelectorAll('a').forEach((a) => a.addEventListener('click', closeVmenu));
  $('#bell').hidden = state.user.role !== 'admin';
  if (state.user.role === 'admin') refreshBell();
  refreshMail();
  fitNav();
}

// جرس التنبيهات (الإدارة): يُحدَّث كل دقيقتين على الأكثر
let bellAt = 0;
async function refreshBell(force = false) {
  if (!force && Date.now() - bellAt < 120000) return;
  bellAt = Date.now();
  try {
    const { count } = await api('GET', '/api/alerts');
    $('#bell-count').textContent = count;
    $('#bell-count').hidden = !count;
  } catch {
    /* لا شيء */
  }
}

// القائمة على سطر واحد فقط؛ إذا لم تتّسع تتحوّل إلى زر ☰ وقائمة عمودية
function fitNav() {
  const bar = $('#topbar');
  if (bar.hidden) return;
  bar.classList.remove('compact');
  $('#menu-toggle').hidden = true;
  const nav = $('#nav');
  if (nav.scrollWidth > nav.clientWidth + 1) {
    bar.classList.add('compact');
    $('#menu-toggle').hidden = false;
  } else {
    closeVmenu();
  }
}

function closeVmenu() {
  $('#vmenu').hidden = true;
  document.body.classList.remove('sheet-open');
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
}

$('#menu-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $('#vmenu').hidden;
  $('#vmenu').hidden = !open;
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#vmenu')) closeVmenu();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeVmenu());
let fitTimer;
window.addEventListener('resize', () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(fitNav, 100);
});
document.fonts?.ready.then(fitNav);

// عنصر قائمة فرعية؛ href فارغ = عنوان فرعي داخل المجموعة (مثل «المالية» تحت «إدارة المركز»)
const navItem = (href, label, isActive) =>
  href ? `<a href="${href}" class="${isActive(href) ? 'active' : ''}">${label}</a>` : `<div class="nav-sub">${label}</div>`;

function openSubnav(btn, group, isActive) {
  closeSubnav();
  const panel = $('#subnav');
  const bar = $('#topbar').getBoundingClientRect();
  const rect = btn.getBoundingClientRect();
  panel.innerHTML = group.items
    .map(([href, label]) => navItem(href, label, isActive))
    .join('');
  panel.dataset.group = btn.dataset.group;
  panel.style.top = `${rect.bottom - bar.top + 6}px`;
  if (window.innerWidth <= 600) {
    panel.style.right = panel.style.left = '8px';
  } else {
    panel.style.left = 'auto';
    panel.style.right = `${Math.max(bar.right - rect.right, 8)}px`;
  }
  panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  panel.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeSubnav));
}

function closeSubnav() {
  const panel = $('#subnav');
  if (panel) panel.hidden = true;
  document.querySelectorAll('.nav-group[aria-expanded=true]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#subnav')) closeSubnav();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeSubnav());
window.addEventListener('resize', closeSubnav);

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  state.user = null;
  location.hash = '#/login';
});

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

// ---------- تسجيل الدخول ----------
function viewLogin(el) {
  el.innerHTML = `
    <div class="login">
      <div class="card">
        <div class="login-hero">
          <img src="feed-logo-white.png" alt="فيد">
          <span class="tag">فضاء الأولياء والمعلمين والإدارة</span>
          <h1>متابعة التلاميذ في منصّة <em>فيد</em> التعليميّة</h1>
        </div>
        <form id="login-form">
          <label>اسم المستخدم (أو رقم بطاقة التعريف)<input name="username" autocomplete="username" required></label>
          <label>كلمة السر<input name="password" type="password" autocomplete="current-password" required></label>
          <p class="error" id="login-error" hidden></p>
          <button class="btn block">دخول</button>
          <div id="google-box" class="google-box" hidden><div class="or"><span>أو</span></div><div id="google-btn"></div>
            <p class="muted small center">للأولياء: ادخل بحساب Google واختر أبناءك.</p></div>
          <p class="muted small center">ولي جديد؟ <a href="#/register"><b>سجّل أبناءك من هنا</b></a></p>
          <p class="muted small center">مدرّس؟ <a href="#/register-teacher">أنشئ حسابك</a></p>
        </form>
      </div>
    </div>`;
  setupGoogleLogin();
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { user } = await api('POST', '/api/login', formData(e.target));
      state.user = user;
      state.meta = await api('GET', '/api/meta');
      if (user.role === 'teacher') state.user = (await api('GET', '/api/me')).user;
      location.hash = homeFor(user);
    } catch (err) {
      const p = $('#login-error');
      p.textContent = err.message;
      p.hidden = false;
    }
  });
}

// ---------- لوحة القيادة (الإدارة) ----------
async function viewDashboard(el) {
  const s = await api('GET', '/api/stats');
  const byLevel = Object.fromEntries(s.by_level.map((r) => [r.level, r.n]));
  el.innerHTML = `
    <a href="#/home" class="muted small">→ الرئيسية</a>
    <h2>لوحة دروس الدعم</h2>
    <div class="stats">
      <div class="stat"><b>${s.students}</b><span>تلميذ يدرس</span></div>
      <div class="stat"><b>${s.teachers}</b><span>معلم</span></div>
      <div class="stat"><b>${s.parents}</b><span>ولي (دروس الدعم)</span></div>
      <div class="stat warn"><b>${s.absences_month}</b><span>غياب (30 يومًا)</span></div>
    </div>
    ${
      s.waiting
        ? `<a class="card alert-card" href="#/students" id="waiting-link">🕓 <b>${s.waiting}</b> تلميذ في الانتظار (تسجيلات جديدة) — اضغط للمراجعة والتأكيد</a>`
        : ''
    }
    <div class="card share">
      <span>🔗 رابط تسجيل الأولياء:</span>
      <code dir="ltr" id="reg-link">${esc(location.origin)}/#/register</code>
      <button class="btn small ghost" id="copy-reg">نسخ</button>
    </div>
    <div id="support-board"></div>
    ${
      s.finance.unpaid.length
        ? `<section class="card"><h3>تلاميذ عليهم مبالغ</h3><ul class="levels">${s.finance.unpaid
            .map(
              (u) => `<li><a href="#/students/${u.id}">${esc(u.full_name)} <span class="muted small">${esc(levelLabel(u.level))}</span></a>
                <b class="owed">${fmtMoney(u.balance)}</b></li>`
            )
            .join('')}</ul></section>`
        : ''
    }
    <div class="grid2">
      <section class="card">
        <h3>التلاميذ حسب المستوى</h3>
        <ul class="levels">
          ${state.meta.levels
            .map(
              (l) => `<li><a href="#/students" data-level="${esc(l.code)}">${esc(l.label)}</a>
                <b>${byLevel[l.code] || 0}</b></li>`
            )
            .join('')}
        </ul>
      </section>
      <section class="card">
        <h3>آخر الملاحظات</h3>
        ${
          s.recent_notes.length
            ? `<ul class="recent">${s.recent_notes
                .map(
                  (n) => `<li><a href="#/students/${n.student_id}">${esc(n.student_name)}</a>
                    <span class="badge ${n.category}">${CATEGORY_LABELS[n.category]}</span>
                    <span class="muted small">${esc(n.subject_name || 'الإدارة')} · ${esc(n.author_name || '')} · ${fmtDate(n.date)}</span>
                    <p>${esc(n.content)}</p></li>`
                )
                .join('')}</ul>`
            : '<p class="muted">لا توجد ملاحظات بعد.</p>'
        }
      </section>
    </div>`;
  el.querySelectorAll('[data-level]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      sessionStorage.setItem('levelFilter', a.dataset.level);
      location.hash = '#/students';
    })
  );
  $('#waiting-link')?.addEventListener('click', () => {
    sessionStorage.setItem('statusFilter', 'waiting');
    sessionStorage.setItem('levelFilter', '');
  });
  activityBoard($('#support-board'), 'support').catch((err) => toast(err.message, true));
  $('#copy-reg').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#reg-link').textContent);
      toast('تم نسخ الرابط');
    } catch {
      toast('انسخ الرابط يدويًا', true);
    }
  });
}

// ---------- قائمة التلاميذ ----------
// المواد في القائمة: «باقة كاملة» أو أسماء المواد المسجّل فيها
const SUBJECT_SHORT = { 'العربية': 'عربية', 'الفرنسية': 'فرنسية', 'الإنجليزية': 'إنجليزية', 'الرياضيات': 'رياضيات' };
function subjectsCell(s) {
  if (s.pack) return '<span class="badge pack">باقة كاملة</span>';
  if (!s.subject_names?.length) return '<span class="muted small">—</span>';
  return s.subject_names.map((n) => `<span class="pill small">${esc(SUBJECT_SHORT[n] || n)}</span>`).join(' ');
}

// ---------- عرض التلاميذ: جدول أو بطاقات ----------
const VIEW_ICONS = {
  table: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  cards: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
};
function studentsView(key = 'studentsView') {
  let v = null;
  try {
    v = localStorage.getItem(key);
  } catch {}
  return v === 'table' || v === 'cards' ? v : matchMedia('(max-width: 640px)').matches ? 'cards' : 'table';
}
function viewToggle() {
  return `<div class="view-toggle" role="group" aria-label="طريقة العرض">
    <button type="button" data-view="table" title="جدول">${VIEW_ICONS.table}<span>جدول</span></button>
    <button type="button" data-view="cards" title="بطاقات">${VIEW_ICONS.cards}<span>بطاقات</span></button></div>`;
}
// يربط أزرار العرض: يحفظ الاختيار ويعيد الرسم
function bindViewToggle(el, key, get, set, render) {
  const sync = () => el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === get()));
  sync();
  el.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      set(b.dataset.view);
      try {
        localStorage.setItem(key, b.dataset.view);
      } catch {}
      sync();
      render();
    })
  );
}
// لون مميز لكل مستوى (شريط البطاقة)
function levelHue(level) {
  const n = parseInt(level, 10);
  return { 5: 262, 6: 200, 7: 152, 8: 28, 9: 330 }[n] ?? 262;
}
function studentCards(students, role) {
  const admin = role === 'admin';
  return `<div class="scards">${students
    .map((s) => {
      const money = !admin
        ? ''
        : s.balance > 0
        ? `<div class="sc-stat owe"><b>${fmtMoney(s.balance)}</b><span>الباقي</span></div>`
        : s.monthly_fee || s.free
        ? `<div class="sc-stat ok"><b>✓</b><span>${s.free ? 'مجاني' : 'خالص'}</span></div>`
        : '<div class="sc-stat"><b>—</b><span>الخلاص</span></div>';
      return `<article class="scard" style="--lv:${levelHue(s.level)}">
        <a class="sc-head" href="#/students/${s.id}">
          ${avatar(s, 'md')}
          <div class="sc-id">
            <h3>${esc(s.full_name)}</h3>
            <div class="sc-tags"><span class="sc-level">${esc(levelLabel(s.level))}</span>${s.status !== 'studying' ? statusBadge(s.status) : ''}</div>
            <div class="sc-since">${s.start_date ? `دخل المركز ${fmtDate(s.start_date)}` : '<span class="muted">تاريخ الدخول غير محدّد</span>'}</div>
          </div>
        </a>
        <div class="sc-subjects">${subjectsCell(s)}</div>
        <div class="sc-parent">
          <span class="sc-ico" aria-hidden="true">👤</span>
          <div><b>${esc(s.parent_name || 'بدون ولي')}</b>${s.parent_phone ? `<span dir="ltr" class="muted small">${esc(s.parent_phone)}</span>` : ''}</div>
          ${admin && s.parent_phone ? waButton(s.parent_phone) : ''}
        </div>
        <div class="sc-stats">
          <div class="sc-stat ${s.unjustified_count ? 'warn' : ''}"><b>${s.absence_count}</b><span>غيابات${s.unjustified_count ? ` · ${s.unjustified_count} غير مبرر` : ''}</span></div>
          <div class="sc-stat"><b>${s.note_count}</b><span>ملاحظات</span></div>
          ${money}
        </div>
        ${
          admin
            ? `<div class="sc-actions"><a class="btn ghost small" href="#/students/${s.id}">الملف</a>
                <button class="btn ghost small" data-edit="${s.id}">تعديل</button>
                <button class="btn link danger small" data-del="${s.id}" title="حذف">حذف</button></div>`
            : ''
        }
      </article>`;
    })
    .join('')}</div>`;
}

async function viewStudents(el) {
  const role = state.user.role;
  state.parentsCache = null;
  if (role === 'parent') return viewMyChildren(el);

  const level = sessionStorage.getItem('levelFilter') || '';
  el.innerHTML = `
    <div class="page-head">
      <h2>التلاميذ</h2>
      ${
        role === 'admin'
          ? `<div class="actions">
             <button class="btn" id="add-student">+ تلميذ جديد</button></div>`
          : ''
      }
    </div>
    <div class="filters">
      <select id="f-level" aria-label="المستوى">${levelOptions(level, true)}</select>
      ${
        role === 'admin'
          ? `<select id="f-status" aria-label="الحالة"><option value="">كل الحالات</option>${Object.entries(STATUS_LABELS)
              .map(([k, v]) => `<option value="${k}" ${(sessionStorage.getItem('statusFilter') ?? 'studying') === k ? 'selected' : ''}>${v}</option>`)
              .join('')}</select>`
          : ''
      }
      <input id="f-q" type="search" placeholder="بحث بالاسم…">
      ${viewToggle()}
    </div>
    <div id="students-list"></div>`;

  let view = studentsView();
  let current = [];

  const load = async () => {
    const params = new URLSearchParams();
    const lvl = $('#f-level').value;
    sessionStorage.setItem('levelFilter', lvl);
    if (lvl) params.set('level', lvl);
    const status = $('#f-status')?.value;
    if (status !== undefined) sessionStorage.setItem('statusFilter', status);
    if (status) params.set('status', status);
    if ($('#f-q').value.trim()) params.set('q', $('#f-q').value.trim());
    const { students } = await api('GET', '/api/students?' + params);
    current = students;
    render();
  };

  const render = () => {
    const students = current;
    $('#students-list').innerHTML = !students.length
      ? '<div class="card muted">لا يوجد تلاميذ.</div>'
      : view === 'cards'
      ? studentCards(students, role)
      : `<div class="table-wrap as-table"><table>
          <thead><tr><th>الاسم</th><th>المستوى</th><th>تاريخ الدخول</th><th>المواد</th><th>الولي</th><th>الغيابات</th><th>الملاحظات</th>${
            role === 'admin' ? '<th>الباقي</th><th></th>' : ''
          }</tr></thead>
          <tbody>${students
            .map(
              (s) => `<tr>
                <td><a class="who-cell" href="#/students/${s.id}">${avatar(s, 'sm')}<b>${esc(s.full_name)}</b></a>
                  ${s.status !== 'studying' ? statusBadge(s.status) : ''}</td>
                <td><span class="pill">${esc(levelLabel(s.level))}</span></td>
                <td class="nowrap">${s.start_date ? fmtDate(s.start_date) : '<span class="muted">—</span>'}</td>
                <td>${subjectsCell(s)}</td>
                <td>${esc(s.parent_name || '—')}${
                  s.parent_phone
                    ? `<div class="muted small phone-line"><span dir="ltr">${esc(s.parent_phone)}</span>${role === 'admin' ? waButton(s.parent_phone) : ''}</div>`
                    : ''
                }</td>
                <td>${s.absence_count}${s.unjustified_count ? ` <span class="badge weak">${s.unjustified_count} غير مبرر</span>` : ''}</td>
                <td>${s.note_count}</td>
                ${role === 'admin' ? `<td>${s.free ? '<span class="badge free">مجاني</span>' : s.balance > 0 ? `<b class="owed">${fmtMoney(s.balance)}</b>` : s.monthly_fee ? '<span class="badge good">خالص</span>' : '—'}</td>` : ''}
                ${
                  role === 'admin'
                    ? `<td class="row-actions"><button class="btn ghost small" data-edit="${s.id}">تعديل</button>
                       <button class="btn danger small" data-del="${s.id}">حذف</button></td>`
                    : ''
                }
              </tr>`
            )
            .join('')}</tbody></table></div>`;

    $('#students-list').querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => studentForm(students.find((s) => s.id === Number(b.dataset.edit)), load))
    );
    $('#students-list').querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('حذف التلميذ مع كل غياباته وملاحظاته؟')) return;
        await api('DELETE', `/api/students/${b.dataset.del}`);
        toast('تم الحذف');
        load();
      })
    );
  };

  bindViewToggle(el, 'studentsView', () => view, (v) => (view = v), render);
  $('#f-level').addEventListener('change', load);
  $('#f-status')?.addEventListener('change', load);
  let timer;
  $('#f-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });
  $('#add-student')?.addEventListener('click', () => studentForm(null, load));
  await load();
}

// السعر حسب التسعيرة: عدد حصص المواد المختارة في الأسبوع، أو الباقة
function suggestFee(level, pack, subjectIds) {
  const pr = state.meta.pricing;
  const packFee = Number(state.meta.pack_fees?.[level]) || null;
  if (!pr) return null;
  if (pack) return packFee ? { fee: packFee, label: 'الباقة' } : null;
  const subs = state.meta.subjects.filter((s) => subjectIds.includes(s.id) && (!s.levels || s.levels.includes(level)));
  if (!subs.length) return null;
  const n = subs.reduce((t, s) => t + (Number(pr.units?.[s.id]) || 1), 0);
  const step = n >= 5 ? packFee : Number(pr.steps?.[String(n)]) || null;
  const fee = packFee && step ? Math.min(step, packFee) : step || packFee;
  return fee ? { fee, label: n >= 5 || fee === packFee ? `${n} حصص = الباقة` : `${n === 1 ? 'حصة' : n === 2 ? 'حصتان' : n + ' حصص'} في الأسبوع` } : null;
}

async function studentForm(student, onDone) {
  // معطيات القائمة تكفي (لا حاجة لتحميل ملف التلميذ كاملًا)، والأولياء يُحمّلون مرة واحدة
  const listed = student && ('subject_ids' in student || student.subjects);
  const [parents, s] = await Promise.all([
    (state.parentsCache ??= api('GET', '/api/users?role=parent').then((r) => r.users)).catch((e) => {
      state.parentsCache = null;
      throw e;
    }),
    !student ? {} : listed ? student : api('GET', `/api/students/${student.id}`).then((r) => r.student),
  ]);
  const enrolled = new Set(s.pack ? [] : s.subjects ? s.subjects.map((x) => x.id) : s.subject_ids || []);
  openModal(
    student ? 'تعديل تلميذ' : 'تلميذ جديد',
    `<label>الاسم واللقب<input name="full_name" value="${esc(s.full_name)}" required></label>
     <div class="row">
       <label>المستوى<select name="level">${levelOptions(s.level || sessionStorage.getItem('levelFilter') || '5')}</select></label>
       ${s.group_name ? `<label>الفوج<input name="group_name" value="${esc(s.group_name)}"></label>` : ''}
     </div>
     <div class="row">
       <label>تاريخ الولادة<input name="birth_date" type="date" value="${esc(s.birth_date)}"></label>
       <label>المدينة<input name="city" value="${esc(s.city)}"></label>
     </div>
     <label>العنوان<input name="address" value="${esc(s.address)}"></label>
     <label>المؤسسة التربوية التي يدرس فيها<input name="school" value="${esc(s.school)}"></label>
     <fieldset><legend>المواد المسجّل فيها</legend>
       <label class="check pack"><input type="checkbox" name="pack" ${s.pack ? 'checked' : ''}> <b>Pack</b> — كل مواد المستوى</label>
       <div class="checks" id="subject-checks">${state.meta.subjects
         .map(
           (x) => `<label class="check"><input type="checkbox" name="subject_ids[]" value="${x.id}" ${enrolled.has(x.id) ? 'checked' : ''}> ${esc(x.name)}${
             x.levels ? ` <span class="muted small">(${esc(levelsText(x.levels))})</span>` : ''
           }</label>`
         )
         .join('')}</div>
     </fieldset>
     <div class="row">
       <label>الحالة<select name="status">${Object.entries(STATUS_LABELS)
         .map(([k, v]) => `<option value="${k}" ${(s.status || 'studying') === k ? 'selected' : ''}>${v}</option>`)
         .join('')}</select></label>
       <label>تاريخ الدخول للمركز<input name="start_date" type="date" value="${esc(s.start_date || (student ? '' : today()))}"></label>
     </div>
     <label id="end-date-field">تاريخ الخروج / التوقف<input name="end_date" type="date" value="${esc(s.end_date || '')}"></label>
     <div class="row">
       <label>المبلغ الشهري المتفق عليه (د.ت)<input name="monthly_fee" inputmode="decimal" value="${esc(s.monthly_fee ?? '')}" placeholder="مثال: 120">
         <small class="fee-hint" id="fee-hint"></small></label>
       <label class="check free-check"><input type="checkbox" name="free" ${s.free ? 'checked' : ''}> يدرس مجانًا</label>
     </div>
     <div class="row">
       <label>تخفيض شهري (د.ت)<input name="discount" inputmode="decimal" value="${esc(s.discount ?? '')}" placeholder="0"></label>
       <label>سبب التخفيض<input name="discount_reason" value="${esc(s.discount_reason || '')}" placeholder="مثال: إخوة، منحة"></label>
     </div>
     <label class="check"><input type="checkbox" name="no_sibling" ${s.no_sibling ? 'checked' : ''}> بدون تخفيض الإخوة (يدفع المعلوم كاملًا حتى لو عندو إخوة)</label>
     <label>ملاحظات التسجيل<input name="remarks" value="${esc(s.remarks)}" placeholder="مثال: ما عدا الفرنسية"></label>
     <label>الولي
       <select name="parent_id">
         <option value="">— بدون —</option>
         ${parents
           .map((p) => `<option value="${p.id}" ${p.id === s.parent_id ? 'selected' : ''}>${esc(p.full_name)} (${esc(p.username)})</option>`)
           .join('')}
       </select>
     </label>`,
    async (data) => {
      if (data.pack) data.subject_ids = [];
      if (student) await api('PUT', `/api/students/${student.id}`, data);
      else await api('POST', '/api/students', data);
      toast('تم الحفظ');
      onDone();
    }
  );
  const pack = $('#modal input[name=pack]');
  const syncPack = () => $('#subject-checks').classList.toggle('disabled', pack.checked);
  pack.addEventListener('change', syncPack);
  syncPack();
  // السعر المقترح حسب التسعيرة: يُطبَّق وحده لتلميذ جديد، ويُقترح للقديم بزر
  const feeInput = $('#modal input[name=monthly_fee]');
  const levelSel = $('#modal select[name=level]');
  const hint = $('#fee-hint');
  feeInput.addEventListener('input', () => (feeInput.dataset.touched = '1'));
  const applyFee = () => {
    const ids = [...$('#modal').querySelectorAll('input[name="subject_ids[]"]:checked')].map((x) => Number(x.value));
    const sug = suggestFee(levelSel.value, pack.checked, ids);
    if (!sug) return (hint.textContent = '');
    if (!student && !feeInput.dataset.touched) feeInput.value = sug.fee;
    hint.innerHTML = Number(feeInput.value) === sug.fee
      ? `✓ حسب التسعيرة: ${esc(sug.label)}`
      : `حسب التسعيرة: <b>${fmtMoney(sug.fee)}</b> (${esc(sug.label)}) <button type="button" class="link small" id="fee-apply">تطبيق</button>`;
    $('#fee-apply')?.addEventListener('click', () => {
      feeInput.value = sug.fee;
      feeInput.dataset.touched = '1';
      applyFee();
    });
  };
  levelSel.addEventListener('change', applyFee);
  pack.addEventListener('change', applyFee);
  feeInput.addEventListener('input', applyFee);
  $('#modal').querySelectorAll('input[name="subject_ids[]"]').forEach((x) => x.addEventListener('change', applyFee));
  applyFee();
  const statusSel = $('#modal select[name=status]');
  const syncStatus = () => ($('#end-date-field').hidden = !['left', 'stopped'].includes(statusSel.value));
  statusSel.addEventListener('change', syncStatus);
  syncStatus();
}

// ---------- فضاء الولي ----------
async function viewMyChildren(el) {
  const { kids } = await api('GET', '/api/family');
  if (kids.length === 1) {
    location.hash = kids[0].link;
    return;
  }
  el.innerHTML = `
    <h2>أبنائي</h2>
    ${
      kids.length
        ? `<div class="cards">${kids
            .map(
              (s) => `<a class="card child" href="${s.link}">
                <div class="child-head">${s.type === 'student' ? avatar(s, 'md') : avatar({ full_name: s.full_name }, 'md')}<div>
                  <h3>${esc(s.full_name)}</h3>
                  ${s.level ? `<span class="pill">${esc(levelLabel(s.level))}</span>` : ''}
                  ${s.program ? `<span class="pill">🎨 ${esc(s.program.class_name || 'البرنامج التربوي')}</span>` : ''}
                  ${s.type === 'student' && s.status !== 'studying' ? statusBadge(s.status) : ''}
                </div></div>
                ${s.status === 'waiting' ? '<p class="muted small">التسجيل في انتظار تأكيد الإدارة.</p>' : ''}
                <div class="mini-stats">
                  <span>الغيابات: <b>${s.absence_count}</b></span>
                  <span>الملاحظات: <b>${s.note_count}</b></span>
                  ${s.balance > 0 ? `<span>الباقي: <b class="owed">${fmtMoney(s.balance)}</b></span>` : ''}
                </div>
              </a>`
            )
            .join('')}</div>`
        : '<div class="card muted">لم يتم ربط أي تلميذ بحسابك بعد. اتصل بالإدارة.</div>'
    }`;
}

// شبكة معلومات: أيقونة + عنوان + قيمة (والفارغ يظهر «غير محدّد»)
const INFO_ICONS = {
  school: '<path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 11.2V16c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5v-4.8M21 9v5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  cake: '<path d="M4 20h16v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6ZM4 16c2 1 4 1 6 0s4-1 6 0 3 .5 4 0M12 12V8M12 5.5c.8-.6 1-1.4 0-2.5-1 1.1-.8 1.9 0 2.5Z"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10" r="2.4"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.3c-.6-.9-1.6-1.3-2.8-1.3-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.3 0-2.4-.5-2.9-1.4M12 6.5V8M12 16v1.5"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
};
function yearsOld(birth) {
  const b = new Date(birth);
  const n = new Date();
  let y = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) y--;
  return y > 0 && y < 30 ? `${y} سنة` : '';
}
function infoGrid(items) {
  return `<div class="info-grid">${items
    .filter(Boolean)
    .map((it) => {
      const empty = !it.value;
      const val = empty ? '<span class="info-empty">غير محدّد</span>' : it.raw ? it.value : esc(it.value);
      return `<div class="info-item ${it.wide ? 'wide' : ''} ${it.strong && !empty ? 'strong' : ''}">
        <span class="info-ico"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${INFO_ICONS[it.icon]}</svg></span>
        <div class="info-body"><span class="info-label">${it.label}</span><div class="info-value ${it.wide ? 'chips' : ''}">${val}</div>${it.sub ? `<span class="info-sub">${it.sub}</span>` : ''}</div>
      </div>`;
    })
    .join('')}</div>`;
}

// ---------- أزرار الإجراءات السريعة (ملف التلميذ) ----------
const QA_ICONS = {
  note: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m13.5 7.5 3 3"/>',
  absent: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M10 13.5l4 4M14 13.5l-4 4"/>',
  wa: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.2Z"/><path d="M9 9.5c0 2.8 2.2 5 5 5l1.2-1.3-1.7-1-1 .7a3.6 3.6 0 0 1-2-2l.7-1-1-1.7Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  report: '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  edit: '<path d="M12 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
};
function quickActions(items) {
  const list = items.filter(Boolean);
  return `<div class="qa qa-${list.length}">${list
    .map((a) => {
      const inner = `<span class="qa-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${QA_ICONS[a.icon]}</svg>${a.plus ? '<i>+</i>' : ''}</span><span class="qa-label">${esc(a.label)}</span>`;
      return a.href
        ? `<a class="qa-btn tone-${a.tone}" href="${a.href}">${inner}</a>`
        : `<button type="button" class="qa-btn tone-${a.tone}" id="${a.id}">${inner}</button>`;
    })
    .join('')}</div>`;
}

// ---------- ملف التلميذ ----------
async function viewStudent(el, id) {
  const role = state.user.role;
  const { student, absences, notes, finance, tasks, timetable, whatsapp_groups, program } = await api('GET', `/api/students/${id}`);
  const adminNotes = notes.filter((n) => !n.subject_id && n.author_role === 'admin');
  const teacherNotes = notes.filter((n) => !adminNotes.includes(n));
  const unjustified = absences.filter((a) => !a.justified).length;

  // تجميع ملاحظات المعلمين حسب المادة
  const bySubject = new Map();
  for (const n of teacherNotes) {
    const key = n.subject_name || 'مادة محذوفة';
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(n);
  }

  const canDelete = (authorId) => role === 'admin' || authorId === state.user.id;

  const noteItem = (n) => `
    <li class="note">
      <div class="note-head">
        <span class="badge ${n.category}">${CATEGORY_LABELS[n.category]}</span>
        ${n.rating ? `<span class="badge ${n.rating}">${n.category === 'behavior' ? BEHAVIOR_WORDS[n.rating] : LEVEL_WORDS[n.rating]}</span>` : ''}
        ${n.behavior ? `<span class="badge ${n.behavior}">السلوك: ${BEHAVIOR_WORDS[n.behavior]}</span>` : ''}
        ${n.visible_to_parent === false ? '<span class="badge general">🔒 لا يراها الولي</span>' : ''}
        <span class="muted small">${fmtDate(n.date)} · ${esc(n.author_name || '')}</span>
        ${role !== 'parent' && canDelete(n.author_id) ? `<button class="link danger" data-del-note="${n.id}">حذف</button>` : ''}
      </div>
      ${n.content ? `<p>${esc(n.content)}</p>` : ''}
    </li>`;

  el.innerHTML = `
    <div class="page-head">
      <div class="student-head">
        <div class="photo-wrap">
          ${avatar(student, 'lg')}
          ${
            role === 'admin'
              ? `<label class="photo-btn" title="تغيير الصورة">📷<input type="file" accept="image/*" id="photo-input" hidden></label>
                 ${student.has_photo ? '<button class="link danger small" id="photo-del">حذف الصورة</button>' : ''}`
              : ''
          }
        </div>
        <div>
        ${role !== 'parent' ? `<a href="#/students" class="muted small">→ الرجوع إلى القائمة</a>` : ''}
        <h2>${esc(student.full_name)}</h2>
        <div class="meta">
          <span class="pill">${esc(levelLabel(student.level))}</span>
          ${
            role === 'admin'
              ? `<select id="status-quick" class="status-quick status-${esc(student.status)}" title="تغيير الحالة">${Object.entries(STATUS_LABELS)
                  .map(([k, v]) => `<option value="${k}" ${student.status === k ? 'selected' : ''}>${v}</option>`)
                  .join('')}</select>`
              : statusBadge(student.status)
          }${student.free ? ' <span class="badge free">مجاني</span>' : ''}
          ${student.group_name ? `<span>الفوج: ${esc(student.group_name)}</span>` : ''}
          ${student.parent_name ? `<span>الولي: ${esc(student.parent_name)}</span>` : ''}
          ${student.parent_phone ? `<span dir="ltr">${esc(student.parent_phone)}</span>` : ''}
        </div>
        ${student.remarks ? `<p class="remarks">📝 ${esc(student.remarks)}</p>` : ''}
        </div>
      </div>
      ${quickActions(
        role === 'parent'
          ? [
              { id: 'new-thread', icon: 'mail', label: 'مراسلة', tone: 'purple' },
              { href: `#/report/${student.id}`, icon: 'report', label: 'بطاقة التقييم', tone: 'blue' },
            ]
          : [
              { id: 'add-note', icon: 'note', label: 'ملاحظة', tone: 'purple', plus: true },
              { id: 'add-absence', icon: 'absent', label: 'غياب', tone: 'pink', plus: true },
              role === 'admin' && waNumber(student.parent_phone) ? { id: 'wa-parent', icon: 'wa', label: 'واتساب', tone: 'green' } : null,
              { id: 'new-thread', icon: 'mail', label: 'مراسلة الولي', tone: 'sky' },
              { href: `#/report/${student.id}`, icon: 'report', label: 'بطاقة التقييم', tone: 'blue' },
              role === 'admin' ? { id: 'edit-student', icon: 'edit', label: 'تعديل', tone: 'gray' } : null,
            ]
      )}
    </div>

    <div class="stats">
      <div class="stat"><b>${absences.length}</b><span>مجموع الغيابات</span></div>
      <div class="stat warn"><b>${unjustified}</b><span>غيابات غير مبررة</span></div>
      <div class="stat"><b>${teacherNotes.length}</b><span>ملاحظات المعلمين</span></div>
      <div class="stat"><b>${adminNotes.length}</b><span>ملاحظات الإدارة</span></div>
    </div>

    <section class="card info-card">
      <div class="section-head"><h3>🪪 معلومات التلميذ</h3>${role === 'admin' ? '<button class="link small" id="info-edit">✏️ تعديل</button>' : ''}</div>
      ${infoGrid([
        { icon: 'school', label: 'المؤسسة التربوية', value: student.school },
        { icon: 'calendar', label: 'تاريخ الدخول للمركز', value: student.start_date && fmtDate(student.start_date),
          sub: student.end_date ? `${STATUS_LABELS[student.status]} في ${fmtDate(student.end_date)}` : '' },
        { icon: 'cake', label: 'تاريخ الولادة', value: student.birth_date && fmtDate(student.birth_date), sub: student.birth_date ? yearsOld(student.birth_date) : '' },
        { icon: 'pin', label: 'العنوان', value: [student.address, student.city].filter(Boolean).join('، ') },
        { icon: 'user', label: 'الولي', value: student.parent_name && esc(student.parent_name),
          sub: student.parent_phone ? `<a href="tel:${esc(student.parent_phone)}" dir="ltr">${esc(student.parent_phone)}</a>` : '', raw: true },
        finance
          ? { icon: 'coin', label: 'المبلغ الشهري', value: student.free ? 'مجاني' : finance.monthly_fee ? fmtMoney(finance.monthly_fee) : '',
              sub: student.discount ? `تخفيض ${fmtMoney(student.discount)}${student.discount_reason ? ' · ' + esc(student.discount_reason) : ''}` : '', strong: true, raw: true }
          : null,
        { icon: 'book', label: 'المواد المسجّل فيها', wide: true, raw: true,
          value: (student.pack ? '<span class="badge pack">باقة كاملة</span>' : '') +
            student.subjects.map((x) => `<span class="info-chip">${esc(SUBJECT_SHORT[x.name] || x.name)}</span>`).join('') },
      ])}
    </section>
${finance ? financeSection(finance, role, 'support', program ? '💰 الوضعية المالية — دروس الدعم' : '💰 الوضعية المالية') : ''}
    ${program ? childProgramSections(program, role) : ''}
    ${
      whatsapp_groups.length
        ? `<section class="card wa-groups"><h3>💬 مجموعة واتساب</h3>${whatsapp_groups
            .map(
              (g) => `<a class="btn wa" href="${esc(g.invite_link)}" target="_blank" rel="noopener">${WA_ICON} ${esc(g.name)}${
                role === 'parent' ? ' — انضم' : ''
              }</a>`
            )
            .join(' ')}</section>`
        : ''
    }
    <section class="card">
      <h3>🗓 جدول الأوقات</h3>
      ${weekView(timetable, { showTeacher: true })}
    </section>
    <section class="card">
      <h3>📌 مهام القسم</h3>
      ${tasks.length ? `<ul class="tasks">${tasks.map((t) => taskItem(t, false)).join('')}</ul>` : '<p class="muted">لا توجد مهام.</p>'}
    </section>

    <section class="card">
      <h3>🏫 ملاحظات الإدارة</h3>
      ${adminNotes.length ? `<ul class="notes">${adminNotes.map(noteItem).join('')}</ul>` : '<p class="muted">لا توجد ملاحظات.</p>'}
    </section>

    <section class="card">
      <h3>📚 ملاحظات المعلمين حسب المادة</h3>
      ${
        bySubject.size
          ? [...bySubject.entries()]
              .map(
                ([subject, list]) => `<details class="subject" open>
                  <summary>${esc(subject)} <span class="muted small">(${list.length})</span></summary>
                  <ul class="notes">${list.map(noteItem).join('')}</ul>
                </details>`
              )
              .join('')
          : '<p class="muted">لا توجد ملاحظات.</p>'
      }
    </section>

    <section class="card">
      <h3>📅 الغيابات</h3>
      ${
        absences.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>التاريخ</th><th>المادة</th><th>الحالة</th><th>السبب</th><th>سجّله</th>${role !== 'parent' ? '<th></th>' : ''}</tr></thead>
              <tbody>${absences
                .map(
                  (a) => `<tr>
                    <td>${fmtDate(a.date)}</td>
                    <td>${esc(a.subject_name || '—')}</td>
                    <td>${a.justified ? '<span class="badge good">مبرر</span>' : '<span class="badge weak">غير مبرر</span>'}</td>
                    <td>${esc(a.reason || '—')}</td>
                    <td class="muted small">${esc(a.recorded_by_name || '')}</td>
                    ${
                      role !== 'parent'
                        ? `<td class="row-actions">
                            ${role === 'admin' ? `<button class="link" data-justify="${a.id}" data-j="${a.justified ? 0 : 1}">${a.justified ? 'إلغاء التبرير' : 'تبرير'}</button>` : ''}
                            ${canDelete(a.recorded_by) ? `<button class="link danger" data-del-abs="${a.id}">حذف</button>` : ''}
                          </td>`
                        : ''
                    }
                  </tr>`
                )
                .join('')}</tbody></table></div>`
          : '<p class="muted">لا توجد غيابات 👏</p>'
      }
    </section>`;

  const reload = () => viewStudent(el, id);

  // المواد المتاحة: مواد المعلم، في مستوى التلميذ، والتي سجّل فيها التلميذ
  const enrolledIds = new Set(student.subjects.map((s) => s.id));
  const mySubjects = (role === 'teacher' ? state.user.subjects || [] : state.meta.subjects).filter(
    (s) =>
      (!s.levels || s.levels.includes(student.level)) &&
      (!s.teach_levels || s.teach_levels.includes(student.level)) &&
      (!enrolledIds.size || enrolledIds.has(s.id))
  );

  $('#wa-parent')?.addEventListener('click', () =>
    waComposer(
      student.parent_phone,
      {
        parent: student.parent_name,
        student: student.full_name,
        amount: finance && finance.balance > 0 ? fmtMoney(finance.balance) : '',
      },
      finance && finance.balance > 0 ? 'payment' : 'general'
    )
  );

  $('#status-quick')?.addEventListener('change', async (e) => {
    const status = e.target.value;
    let end_date;
    if (['left', 'stopped'].includes(status)) {
      end_date = prompt('تاريخ الخروج / التوقف (YYYY-MM-DD):', today());
      if (end_date === null) return (e.target.value = student.status);
    }
    try {
      await api('PATCH', `/api/students/${id}/status`, { status, end_date });
      toast(`الحالة: ${STATUS_LABELS[status]}`);
      reload();
    } catch (err) {
      e.target.value = student.status;
      toast(err.message, true);
    }
  });
  $('#edit-student')?.addEventListener('click', () => studentForm(student, reload));
  $('#info-edit')?.addEventListener('click', () => studentForm(student, reload));

  $('#photo-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // الرفع قد يأخذ بضع ثوانٍ: الصورة تظهر حالًا مع «جاري الرفع» حتى لا يُعاد الرفع
    const wrap = el.querySelector('.photo-wrap');
    const btn = el.querySelector('.photo-btn');
    btn.hidden = true;
    wrap.classList.add('uploading');
    try {
      const photo = await resizeImage(file);
      wrap.querySelector('.avatar').outerHTML = `<img class="avatar lg" src="${photo}" alt="">`;
      await api('PUT', `/api/students/${id}/photo`, { photo });
      toast('تم تحديث الصورة');
      reload();
    } catch (err) {
      wrap.classList.remove('uploading');
      btn.hidden = false;
      toast(err.message, true);
    }
    e.target.value = '';
  });
  $('#photo-del')?.addEventListener('click', async () => {
    if (!confirmAction('حذف صورة التلميذ؟')) return;
    await api('PUT', `/api/students/${id}/photo`, { photo: null }).catch((err) => toast(err.message, true));
    reload();
  });

  $('#new-thread')?.addEventListener('click', () =>
    newThreadForm(
      student,
      student.subjects.length ? student.subjects : state.meta.subjects.filter((x) => !x.levels || x.levels.includes(student.level))
    )
  );
  if (finance) bindFinance(el, finance, { kind: 'support', id }, reload);
  if (program?.finance) bindFinance(el, program.finance, { kind: 'program', id: program.child.id }, reload);
  if (program) bindChildFollowUp(el, program, reload);

  $('#add-note')?.addEventListener('click', () => {
    if (role === 'teacher' && !mySubjects.length) return toast('ليس لك أي مادة في مستوى هذا التلميذ، اتصل بالإدارة', true);
    openModal(
      role === 'admin' ? 'ملاحظة من الإدارة' : 'ملاحظة جديدة',
      `${role === 'teacher' ? `<label>المادة<select name="subject_id">${subjectOptions(mySubjects)}</select></label>` : ''}
       <div class="row">
         <label>النوع<select name="category">
           <option value="level">المستوى</option>
           <option value="behavior">السلوك</option>
           <option value="general">عامة</option>
         </select></label>
         <label>التاريخ<input type="date" name="date" value="${today()}"></label>
       </div>
       <div class="row">
         <label>المستوى<select name="rating">
           <option value="">—</option>
           ${Object.entries(LEVEL_WORDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
         </select></label>
         <label>السلوك<select name="behavior">
           <option value="">—</option>
           ${Object.entries(BEHAVIOR_WORDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
         </select></label>
       </div>
       <label>الملاحظة<textarea name="content" rows="4" placeholder="اختياري إن حدّدت المستوى أو السلوك"></textarea></label>
       <label class="check"><input type="checkbox" name="visible_to_parent" checked> يراها الولي (وتظهر في بطاقة التقييم)</label>`,
      async (data) => {
        await api('POST', `/api/students/${id}/notes`, data);
        toast('تمت إضافة الملاحظة');
        reload();
      }
    );
  });

  $('#add-absence')?.addEventListener('click', () => {
    if (role === 'teacher' && !mySubjects.length) return toast('ليس لك أي مادة في مستوى هذا التلميذ، اتصل بالإدارة', true);
    openModal(
      'تسجيل غياب',
      `<label>التاريخ<input type="date" name="date" value="${today()}"></label>
       <label>المادة<select name="subject_id">${subjectOptions(mySubjects, null, role === 'admin' ? '— كل اليوم —' : '')}</select></label>
       <label>ملاحظة / سبب<input name="reason"></label>
       ${role === 'admin' ? '<label class="check"><input type="checkbox" name="justified"> غياب مبرر</label>' : ''}`,
      async (data) => {
        await api('POST', `/api/students/${id}/absences`, data);
        toast('تم تسجيل الغياب');
        reload();
      }
    );
  });

  el.querySelectorAll('[data-del-note]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذه الملاحظة؟')) return;
      await api('DELETE', `/api/notes/${b.dataset.delNote}`).catch((e) => toast(e.message, true));
      reload();
    })
  );
  el.querySelectorAll('[data-del-abs]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذا الغياب؟')) return;
      await api('DELETE', `/api/absences/${b.dataset.delAbs}`).catch((e) => toast(e.message, true));
      reload();
    })
  );
  el.querySelectorAll('[data-justify]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('PATCH', `/api/absences/${b.dataset.justify}`, { justified: b.dataset.j === '1' }).catch((e) =>
        toast(e.message, true)
      );
      reload();
    })
  );
}

// الوضعية المالية: الولي والإدارة (kind: support أو program — قسمان في نفس الصفحة ممكن)
function financeSection(f, role, kind = 'support', title = '💰 الوضعية المالية') {
  const status = (m) =>
    m.adjustment?.kind === 'exempt' && !m.paid
      ? '<span class="badge general">معفى</span>'
      : m.due === 0
      ? '<span class="badge general">دفع مسبق</span>'
      : m.remaining === 0
        ? '<span class="badge good">خالص</span>'
        : m.paid > 0
          ? '<span class="badge average">جزئي</span>'
          : '<span class="badge weak">غير خالص</span>';
  const regDue = f.registration.some((r) => r.remaining > 0);
  return `
    <section class="card">
      <div class="section-head">
        <h3>${title}</h3>
        ${
          role === 'admin'
            ? `<div>${regDue ? `<button class="btn small ghost" data-add-reg="${kind}">+ معلوم التسجيل</button> ` : ''}<button class="btn small ghost" data-sell="${kind}">📗 بيع منتج</button> <button class="btn small" data-add-pay="${kind}">+ دفعة</button></div>`
            : ''
        }
      </div>
      ${f.free ? '<p class="free-note">🎓 يدرس مجانًا.</p>' : ''}
      ${!f.free && f.discount ? `<p class="free-note">🏷️ تخفيض ${fmtMoney(f.discount)} في الشهر${f.discount_reason ? ` (${esc(f.discount_reason)})` : ''} — المبلغ الصافي: <b>${fmtMoney(f.net_fee)}</b></p>` : ''}
      ${!f.free && f.sibling_pct ? `<p class="free-note">👨‍👩‍👧 تخفيض الإخوة: <b>${f.sibling_pct}%</b> هذا الشهر</p>` : ''}
      <div class="stats compact">
        <div class="stat"><b>${f.free ? 'مجاني' : fmtMoney(f.monthly_fee)}</b><span>المبلغ الشهري</span></div>
        <div class="stat"><b>${fmtMoney(f.total_due)}</b><span>مجموع المستحق</span></div>
        <div class="stat good"><b>${fmtMoney(f.total_paid)}</b><span>مجموع المدفوع</span></div>
        <div class="stat ${f.balance > 0 ? 'warn' : 'good'}"><b>${fmtMoney(Math.max(f.balance, 0))}</b><span>${
          f.balance < 0 ? `الباقي (رصيد مسبق ${fmtMoney(-f.balance)})` : 'الباقي'
        }</span></div>
      </div>
      ${
        f.registration.length
          ? `<h4>🪪 معلوم التسجيل السنوي</h4>
            <div class="mcards">${f.registration
              .map(
                (r) => `<article class="mcard ${r.remaining ? 'due' : 'ok'}">
                  <header><b>${esc(r.school_year)}</b>${r.remaining ? '<span class="badge weak">غير خالص</span>' : '<span class="badge good">خالص</span>'}</header>
                  <div class="mc-nums">
                    <div><small>المعلوم</small><b>${fmtMoney(r.due)}</b></div>
                    <div><small>المدفوع</small><b class="${r.paid ? 'in' : ''}">${fmtMoney(r.paid)}</b></div>
                    <div><small>الباقي</small><b class="${r.remaining ? 'owed' : ''}">${r.remaining ? fmtMoney(r.remaining) : '—'}</b></div>
                  </div>
                  ${
                    r.payments.length
                      ? `<ul class="mc-pays">${r.payments
                          .map(
                            (p) => `<li><span>✓ <b>${fmtMoney(p.amount)}</b> · ${fmtDate(p.paid_on)}</span><span class="mc-acts"><a class="receipt-link" href="#/receipt/registration/${p.id}">🧾 ${p.receipt_no ?? ''}</a>${
                              role === 'admin' ? `<button class="link danger" data-del-reg="${p.id}" aria-label="حذف">✕</button>` : ''
                            }</span></li>`
                          )
                          .join('')}</ul>`
                      : ''
                  }
                </article>`
              )
              .join('')}</div>
            <h4>📆 المعلوم الشهري</h4>`
          : ''
      }
      ${
        f.months.length
          ? `<div class="mcards">${f.months
              .map((m) => {
                const notes = [
                  m.prorata ? `جزء من الشهر (${esc(m.prorata)} يوم)` : '',
                  m.sibling_pct ? `تخفيض الإخوة ${m.sibling_pct}%` : '',
                ].filter(Boolean);
                const a = m.adjustment;
                return `<article class="mcard ${m.remaining > 0 ? (m.paid > 0 ? 'part' : 'due') : 'ok'}">
                  <header>
                    <b>${esc(monthLabel(m.month))}</b>
                    ${status(m)}
                    ${role === 'admin' ? `<button type="button" class="mc-edit" data-adj-month="${m.month}" data-kind="${kind}" title="غياب أو تعديل مبلغ الشهر" aria-label="تعديل مبلغ ${esc(monthLabel(m.month))}">✂️ <span>تعديل</span></button>` : ''}
                  </header>
                  <div class="mc-nums">
                    <div><small>المستحق</small><b>${fmtMoney(m.due)}</b></div>
                    <div><small>المدفوع</small><b class="${m.paid ? 'in' : ''}">${fmtMoney(m.paid)}</b></div>
                    <div><small>الباقي</small><b class="${m.remaining ? 'owed' : ''}">${m.remaining ? fmtMoney(m.remaining) : '—'}</b></div>
                  </div>
                  ${
                    a || notes.length || m.extras?.length
                      ? `<div class="mc-tags">${a ? `<span class="mc-tag adj">✂️ ${esc(adjLabel(a))}${a.reason ? ` · ${esc(a.reason)}` : ''} <s>${fmtMoney(a.original)}</s></span>` : ''}${(m.extras || [])
                          .map((x) => `<span class="mc-tag plus">+ ${fmtMoney(x.amount)} · ${esc(x.reason || '')}${role === 'admin' ? ` <button class="link danger" data-del-extra="${x.id}" aria-label="حذف">✕</button>` : ''}</span>`)
                          .join('')}${notes
                          .map((n) => `<span class="mc-tag">${n}</span>`)
                          .join('')}</div>`
                      : ''
                  }
                  ${
                    m.payments.length
                      ? `<ul class="mc-pays">${m.payments
                          .map(
                            (p) => `<li><span>✓ <b>${fmtMoney(p.amount)}</b> · ${fmtDate(p.paid_on)}${p.method ? ` · ${esc(PAYMENT_LABELS[p.method] || p.method)}` : ''}${
                              p.note ? ` · <span class="muted">${esc(p.note)}</span>` : ''
                            }</span><span class="mc-acts"><a class="receipt-link" href="#/receipt/${kind}/${p.id}">🧾 ${p.receipt_no ?? ''}</a>${
                              role === 'admin' ? `<button class="link danger" data-del-pay="${p.id}" data-kind="${kind}" aria-label="حذف الدفعة">✕</button>` : ''
                            }</span></li>`
                          )
                          .join('')}</ul>`
                      : ''
                  }
                </article>`;
              })
              .join('')}</div>`
          : `<p class="muted">${f.monthly_fee ? 'لا توجد أشهر مستحقة بعد.' : 'لم يُحدَّد المبلغ الشهري بعد.'}</p>`
      }
    </section>`;
}

// أزرار الوضعية المالية: دفعة شهرية، معلوم التسجيل، حذف
// target: { kind, id } — kind = support (تلميذ دعم) أو program (طفل التربوي)
const adjLabel = (a) =>
  a.kind === 'exempt' ? 'معفى (غياب الشهر كاملًا)' : a.kind === 'absent_days' ? `غياب ${a.value} ${a.value >= 3 && a.value <= 10 ? 'أيام' : 'يوم'}` : `مبلغ معدّل ${fmtMoney(a.value)}`;

function bindFinance(el, f, { kind, id }, reload) {
  el.querySelectorAll(`[data-sell="${kind}"]`).forEach((b) =>
    b.addEventListener('click', () => sellProductModal(reload, kind === 'support' ? { student_id: id } : { child_id: id }).catch((err) => toast(err.message, true)))
  );
  el.querySelectorAll('[data-del-extra]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف المبلغ المضاف لهذا الشهر؟')) return;
      await api('DELETE', `/api/fee-extras/${b.dataset.delExtra}`).catch((err) => toast(err.message, true));
      reload();
    })
  );
  el.querySelectorAll(`[data-adj-month][data-kind="${kind}"]`).forEach((b) =>
    b.addEventListener('click', () => {
      const m = f.months.find((x) => x.month === b.dataset.adjMonth);
      const a = m.adjustment;
      openModal(
        `تعديل مبلغ ${monthLabel(m.month)}`,
        `<p class="muted small">المبلغ العادي لهذا الشهر: <b>${fmtMoney(a ? a.original : m.due)}</b></p>
         <label class="check"><input type="radio" name="kind" value="exempt" ${!a || a.kind === 'exempt' ? 'checked' : ''}> تغيّب الشهر كاملًا (لا شيء عليه)</label>
         <label class="check"><input type="radio" name="kind" value="absent_days" ${a?.kind === 'absent_days' ? 'checked' : ''}> تغيّب جزءًا من الشهر</label>
         <label id="adj-days">عدد أيام الغياب<input name="days" inputmode="numeric" value="${a?.kind === 'absent_days' ? esc(a.value) : ''}" placeholder="مثال: 10"></label>
         <label class="check"><input type="radio" name="kind" value="amount" ${a?.kind === 'amount' ? 'checked' : ''}> مبلغ آخر</label>
         <label class="check"><input type="radio" name="kind" value="extra"> إضافة مبلغ لهذا الشهر (مثلًا معلوم التسجيل)</label>
         <div class="row" id="adj-extra"><label>المبلغ المضاف (د.ت)<input name="extra_amount" inputmode="decimal" value="40"></label>
           <label>البيان<input name="extra_reason" value="معلوم التسجيل"></label></div>
         <label id="adj-amount">المبلغ المطلوب لهذا الشهر (د.ت)<input name="amount" inputmode="decimal" value="${a?.kind === 'amount' ? esc(a.value) : ''}"></label>
         <label>السبب<input name="reason" value="${esc(a?.reason || '')}" placeholder="مثال: مرض، سفر"></label>
         ${a ? '<p><button type="button" class="btn small danger" id="adj-del">إلغاء التعديل والرجوع للمبلغ العادي</button></p>' : ''}`,
        async (data) => {
          if (data.kind === 'extra') {
            await api('POST', '/api/fee-extras', {
              [kind === 'support' ? 'student_id' : 'child_id']: id,
              month: m.month,
              amount: data.extra_amount,
              reason: data.extra_reason,
            });
            toast('تمت إضافة المبلغ إلى الشهر');
            return reload();
          }
          await api('PUT', '/api/fee-adjustments', {
            [kind === 'support' ? 'student_id' : 'child_id']: id,
            month: m.month,
            kind: data.kind,
            value: data.kind === 'absent_days' ? data.days : data.kind === 'amount' ? data.amount : null,
            reason: data.reason,
          });
          toast('تم تعديل مبلغ الشهر');
          reload();
        }
      );
      const sync = () => {
        const k = $('#modal input[name=kind]:checked').value;
        $('#adj-days').hidden = k !== 'absent_days';
        $('#adj-amount').hidden = k !== 'amount';
        $('#adj-extra').hidden = k !== 'extra';
      };
      $('#modal').querySelectorAll('input[name=kind]').forEach((x) => x.addEventListener('change', sync));
      sync();
      $('#adj-del')?.addEventListener('click', async () => {
        await api('DELETE', `/api/fee-adjustments/${a.id}`).catch((err) => toast(err.message, true));
        $('#modal').close();
        toast('رجع المبلغ العادي');
        reload();
      });
    })
  );
  const urls = {
    support: { pay: `/api/students/${id}/payments`, del: (x) => `/api/payments/${x}`, reg: { student_id: id } },
    program: { pay: `/api/program/children/${id}/payments`, del: (x) => `/api/program/payments/${x}`, reg: { child_id: id } },
  }[kind];
  const methods = () => Object.entries(PAYMENT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  const afterPay = (receiptKind, payment) => {
    toast('تم تسجيل الدفعة');
    if (confirmAction(`تم تسجيل الدفعة (وصل رقم ${payment.receipt_no}). فتح الوصل للطباعة؟`)) location.hash = `#/receipt/${receiptKind}/${payment.id}`;
    else reload();
  };
  el.querySelector(`[data-add-pay="${kind}"]`)?.addEventListener('click', () => {
    const current = f.months.find((m) => m.remaining > 0) || { month: today().slice(0, 7), remaining: f.net_fee || f.monthly_fee || '' };
    openModal(
      'تسجيل دفعة',
      `<div class="row">
         <label>الشهر<input type="month" name="month" value="${esc(current.month)}" required></label>
         <label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${esc(current.remaining || '')}" required></label>
       </div>
       <div class="row">
         <label>تاريخ الدفع<input type="date" name="paid_on" value="${today()}"></label>
         <label>طريقة الدفع<select name="method">${methods()}</select></label>
       </div>
       <label>ملاحظة<input name="note" placeholder="مثال: رقم الوصل"></label>`,
      async (data) => afterPay(kind, (await api('POST', urls.pay, data)).payment)
    );
  });
  el.querySelector(`[data-add-reg="${kind}"]`)?.addEventListener('click', () => {
    const r = f.registration.find((x) => x.remaining > 0);
    openModal(
      'معلوم التسجيل السنوي',
      `<div class="row">
         <label>السنة الدراسية<input name="school_year" value="${esc(r.school_year)}" dir="ltr" required></label>
         <label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${esc(r.remaining)}" required></label>
       </div>
       <div class="row">
         <label>تاريخ الدفع<input type="date" name="paid_on" value="${today()}"></label>
         <label>طريقة الدفع<select name="method">${methods()}</select></label>
       </div>
       <p class="muted small">يُدفع مرة واحدة في السنة حتى لو كان الطفل في دروس الدعم والبرنامج التربوي معًا.</p>`,
      async (data) => afterPay('registration', (await api('POST', '/api/registration-payments', { ...data, ...urls.reg })).payment)
    );
  });
  el.querySelectorAll(`[data-del-pay][data-kind="${kind}"]`).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذه الدفعة؟')) return;
      await api('DELETE', urls.del(b.dataset.delPay)).catch((e) => toast(e.message, true));
      reload();
    })
  );
  el.querySelectorAll('[data-del-reg]').forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف دفعة معلوم التسجيل؟')) return;
      await api('DELETE', `/api/registration-payments/${b.dataset.delReg}`).catch((e) => toast(e.message, true));
      reload();
    });
  });
}

// ---------- المستخدمون ----------
async function viewUsers(el, role, scope = null) {
  const titles = { teacher: scope === 'program' ? 'المؤطّرون (البرنامج التربوي)' : scope === 'support' ? 'مدرّسو دروس الدعم' : 'المعلمون', parent: 'الأولياء', admin: 'حسابات الإدارة' };
  const addLabels = { teacher: scope === 'program' ? '+ مؤطّر جديد' : '+ مدرّس جديد', parent: '+ ولي جديد', admin: '+ حساب إدارة' };
  let { users } = await api('GET', `/api/users?role=${role}`);
  // المدرّسون: من عنده مواد (دروس الدعم) / المؤطّرون: من عنده قسم في التربوي. الحساب الجديد بلا شيء يظهر في الاثنين
  const isProgram = (u) => !!u.program_staff;
  if (scope === 'support') users = users.filter((u) => !isProgram(u));
  if (scope === 'program') users = users.filter(isProgram);
  const prog = scope === 'program';
  el.innerHTML = `
    <div class="page-head">
      <h2>${titles[role]}</h2>
      <button class="btn" id="add-user">${addLabels[role]}</button>
    </div>
    ${
      users.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الهاتف</th>${role === 'parent' ? '<th>ب.ت.و</th>' : ''}
              ${role === 'teacher' ? (prog ? '<th>الأقسام</th><th>الأجرة الشهرية</th>' : '<th>المواد</th><th>معلوم الساعة</th>') : ''}${role === 'parent' ? '<th>الأبناء</th>' : ''}<th></th></tr></thead>
            <tbody>${users
              .map(
                (u) => `<tr>
                  <td><b>${esc(u.full_name)}</b>${u.approved === false ? ' <span class="badge average">ينتظر الموافقة</span>' : ''}</td>
                  <td dir="ltr">${esc(u.username)}</td>
                  <td><span class="phone-line"><span dir="ltr">${esc(u.phone || '—')}</span>${waButton(u.phone)}</span></td>${role === 'parent' ? `<td dir="ltr">${esc(u.cin || '—')}</td>` : ''}
                  ${role === 'teacher' && prog ? `<td>${u.program_classes ? `${u.program_classes} قسم` : '<span class="muted">—</span>'}</td>
                    <td>${u.monthly_salary ? fmtMoney(u.monthly_salary) : ''}${u.pay_per_child ? ` ${fmtMoney(u.pay_per_child)} / طفل` : ''}${!u.monthly_salary && !u.pay_per_child ? '<span class="muted">—</span>' : ''}</td>` : ''}
                  ${role === 'teacher' && !prog ? `<td>${u.subjects.map((s) => `<span class="pill">${esc(s.name)}</span>`).join(' ') || '—'}</td>
                    <td>${u.hourly_rate ? fmtMoney(u.hourly_rate) : '<span class="muted">—</span>'} <a class="small" href="#/payroll/${u.id}">الساعات ←</a></td>` : ''}
                  ${
                    role === 'parent'
                      ? `<td>${u.children.map((c) => `<a href="#/students/${c.id}">${esc(c.full_name)}</a>`).join('، ') || '—'}</td>`
                      : ''
                  }
                  <td class="row-actions">
                    ${u.approved === false ? `<button class="btn small" data-approve="${u.id}">✔ تفعيل</button>` : ''}
                    <button class="btn ghost small" data-edit="${u.id}">تعديل</button>
                    ${u.id !== state.user.id ? `<button class="btn danger small" data-del="${u.id}">حذف</button>` : ''}
                  </td>
                </tr>`
              )
              .join('')}</tbody></table></div>`
        : '<div class="card muted">لا توجد حسابات.</div>'
    }`;

  const reload = () => viewUsers(el, role, scope);
  const form = (user) => {
    const u = user || {};
    const ids = new Set((u.subjects || []).map((s) => s.id));
    const teach = new Map((u.subjects || []).map((s) => [s.id, s.teach_levels || []]));
    openModal(
      user ? 'تعديل الحساب' : addLabels[role].slice(2),
      `<label>الاسم واللقب<input name="full_name" value="${esc(u.full_name)}" required></label>
       <div class="row">
         <label>اسم المستخدم<input name="username" value="${esc(u.username)}" dir="ltr" required></label>
         <label>الهاتف<input name="phone" value="${esc(u.phone)}" dir="ltr"></label>
       </div>
       ${role === 'teacher' && !prog ? `<label>معلوم الساعة (د.ت)<input name="hourly_rate" inputmode="decimal" value="${esc(u.hourly_rate ?? '')}" placeholder="مثال: 20"></label>` : ''}
       ${prog ? `<div class="row"><label>الأجرة الشهرية الثابتة (د.ت)<input name="monthly_salary" inputmode="decimal" value="${esc(u.monthly_salary ?? '')}" placeholder="مثال: 500"></label>
         <label>أو مبلغ عن كل طفل يدفع (د.ت)<input name="pay_per_child" inputmode="decimal" value="${esc(u.pay_per_child ?? '')}" placeholder="مثال: 40"></label></div>
         <p class="muted small">القسم الذي يرافقه يُحدَّد من «الأطفال والأقسام» (تعديل القسم ← المؤطّر).</p>` : ''}
       <div class="row">
         <label>رقم بطاقة التعريف<input name="cin" value="${esc(u.cin)}" dir="ltr" inputmode="numeric"></label>
         <label>البريد الإلكتروني<input name="email" type="email" value="${esc(u.email)}" dir="ltr"></label>
       </div>
       <div>
         <label>العنوان<input name="address" value="${esc(u.address)}"></label>
       </div>
       <label>${user ? 'كلمة سر جديدة (اتركها فارغة للإبقاء على القديمة)' : 'كلمة السر'}
         <input name="password" type="text" dir="ltr" ${user ? '' : 'required'} minlength="6"></label>
       ${
         role === 'teacher' && !prog
           ? `<fieldset><legend>المواد التي يدرّسها</legend><div class="checks">${state.meta.subjects
               .map(
                 (s) => `<div class="subject-levels"><label class="check"><input type="checkbox" name="subject_ids[]" value="${s.id}" ${ids.has(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>
                   <span class="lv-chips">${state.meta.levels
                     .filter((l) => !s.levels || s.levels.includes(l.code))
                     .map((l) => `<label class="chip-check"><input type="checkbox" data-lv="${s.id}" value="${l.code}" ${teach.get(s.id)?.includes(l.code) ? 'checked' : ''}> ${esc(l.code === '6-distance' ? '6 عن بعد' : l.code)}</label>`)
                     .join('')}</span></div>`
               )
               .join('')}</div>
               <p class="muted small">حدّد المستويات التي يدرّس فيها كل مادة. دون تحديد = كل مستويات المادة.</p></fieldset>`
           : ''
       }`,
      async (data) => {
        if (prog) data.program_staff = true;
        else if (role === 'teacher') {
          data.subject_levels = {};
          for (const i of $('#modal').querySelectorAll('[data-lv]:checked')) (data.subject_levels[i.dataset.lv] ||= []).push(i.value);
        }
        if (user) await api('PUT', `/api/users/${user.id}`, data);
        else await api('POST', '/api/users', { ...data, role });
        toast('تم الحفظ');
        reload();
      }
    );
  };

  $('#add-user').addEventListener('click', () => form(null));
  el.querySelectorAll('[data-approve]').forEach((b) =>
    b.addEventListener('click', async () => {
      const u = users.find((x) => x.id === Number(b.dataset.approve));
      if (!confirmAction(`تفعيل حساب ${u.full_name}؟ (راجع موادّه ومستوياته بزر «تعديل»)`)) return;
      await api('POST', `/api/users/${u.id}/approve`).catch((e) => toast(e.message, true));
      reload();
    })
  );
  el.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => form(users.find((u) => u.id === Number(b.dataset.edit))))
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذا الحساب؟')) return;
      await api('DELETE', `/api/users/${b.dataset.del}`).catch((e) => toast(e.message, true));
      reload();
    })
  );
}

// ---------- المواد ----------
function levelsText(levels) {
  return levels ? levels.map(levelShort).join('، ') : 'كل المستويات';
}
// اسم قصير للمستوى: «5»، «6 عن بعد»… (الاسم الكامل في التلميح)
const levelShort = (code) => String(code).replace('-distance', ' عن بعد');
const levelChips = (levels) =>
  levels
    ? `<span class="lv-chipset">${levels.map((c) => `<span class="lv-chip" title="${esc(levelLabel(c))}">${esc(levelShort(c))}</span>`).join('')}</span>`
    : '<span class="lv-chip all">كل المستويات</span>';

function subjectForm(subject, onDone) {
  const sel = new Set(subject?.levels || []);
  openModal(
    subject ? 'تعديل المادة' : 'مادة جديدة',
    `<label>اسم المادة<input name="name" value="${esc(subject?.name)}" required></label>
     <fieldset><legend>المستويات (لا تختر شيئًا = كل المستويات)</legend><div class="checks">${state.meta.levels
       .map(
         (l) => `<label class="chip-check lg" title="${esc(l.label)}"><input type="checkbox" name="levels[]" value="${esc(l.code)}" ${sel.has(l.code) ? 'checked' : ''}> ${esc(levelShort(l.code))}</label>`
       )
       .join('')}</div></fieldset>`,
    async (data) => {
      if (subject) await api('PUT', `/api/subjects/${subject.id}`, data);
      else await api('POST', '/api/subjects', data);
      toast('تم الحفظ');
      onDone();
    }
  );
}

async function viewSubjects(el) {
  state.meta = await api('GET', '/api/meta');
  const reload = () => viewSubjects(el);
  el.innerHTML = `
    <div class="page-head">
      <h2>المواد</h2>
      <button class="btn" id="add-subject">+ مادة جديدة</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>المادة</th><th>المستويات</th><th></th></tr></thead>
      <tbody>${state.meta.subjects
        .map(
          (s) => `<tr><td><b>${esc(s.name)}</b></td><td>${levelChips(s.levels)}</td>
            <td class="row-actions"><button class="btn ghost small" data-edit="${s.id}">تعديل</button>
            <button class="btn danger small" data-del="${s.id}">حذف</button></td></tr>`
        )
        .join('')}</tbody>
    </table></div>`;
  $('#add-subject').addEventListener('click', () => subjectForm(null, reload));
  el.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => subjectForm(state.meta.subjects.find((s) => s.id === Number(b.dataset.edit)), reload))
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف المادة؟ الملاحظات المرتبطة بها تبقى دون مادة.')) return;
      await api('DELETE', `/api/subjects/${b.dataset.del}`).catch((e) => toast(e.message, true));
      reload();
    })
  );
}

// ---------- استيراد قائمة التلاميذ ----------
// يقبل جدولًا منسوخًا من Excel / Google Sheets (أعمدة مفصولة بـ Tab)، أو جدول Markdown، أو CSV
// ترتيب الأعمدة: (#) التلميذ، القسم، الولي، الهاتف، المدينة، المؤسسة
function parseLevel(value) {
  const v = String(value || '').toLowerCase();
  if (/ligne|distance|online|بعد/.test(v)) return '6-distance';
  const m = v.match(/[5-9]/);
  return m ? m[0] : null;
}

function parseStudentList(raw) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines.some((l) => l.includes('\t'))
    ? '\t'
    : lines.some((l) => l.includes('|'))
      ? '|'
      : lines.some((l) => l.includes(';'))
        ? ';'
        : ',';
  const rows = [];
  for (const line of lines) {
    if (!line.includes(sep)) continue;
    if (/^[\s|:-]+$/.test(line)) continue; // سطر الفصل في Markdown
    let cells = line.split(sep).map((c) => c.trim());
    if (sep === '|') cells = cells.slice(line.trim().startsWith('|') ? 1 : 0, line.trim().endsWith('|') ? -1 : undefined);
    if (/^\d+$/.test(cells[0]) || cells[0] === '#') cells = cells.slice(1);
    if (/élève|eleve|^nom|التلميذ|^اسم/i.test(cells[0] || '') || /^classe$/i.test(cells[1] || '')) continue;
    const [name = '', classe = '', parent = '', phone = '', city = '', school = ''] = cells;
    if (!name) continue;
    const remarks = (name.match(/\(([^)]*)\)/g) || []).map((x) => x.slice(1, -1).trim()).join('، ');
    rows.push({
      full_name: name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(),
      level: parseLevel(classe),
      classe,
      parent_name: parent,
      phone,
      city,
      school,
      remarks,
    });
  }
  return rows;
}

function downloadCsv(filename, header, rows) {
  const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [header, ...rows].map((r) => r.map(quote).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function viewImport(el) {
  if (state.user.role !== 'admin') throw new Error('ليس لديك صلاحية');
  el.innerHTML = `
    <a href="#/students" class="muted small">→ الرجوع إلى القائمة</a>
    <h2>استيراد قائمة التلاميذ</h2>
    <div class="card">
      <p>انسخ الجدول من Excel أو Google Sheets والصقه هنا. ترتيب الأعمدة:
        <b>التلميذ، القسم، الولي، الهاتف، المدينة، المؤسسة</b> (عمود الترقيم # وسطر العناوين يُتجاهلان).</p>
      <ul class="muted small">
        <li>القسم: 5ème … 9ème، و«6ème en ligne» تُسجّل في «السادسة أساسي (عن بعد)».</li>
        <li>ما بين قوسين في اسم التلميذ، مثل (SAUF FR)، يُنقل إلى «ملاحظات التسجيل».</li>
        <li>يُنشأ حساب لكل ولي: اسم المستخدم رقم الهاتف وكلمة سر من 6 أرقام. الإخوة يُربطون بنفس الولي.</li>
        <li>التلميذ الموجود مسبقًا (نفس الاسم والمستوى) لا يُضاف مرة ثانية.</li>
      </ul>
      <textarea id="import-text" rows="10" dir="auto" placeholder="الصق الجدول هنا…"></textarea>
      <button class="btn" id="import-preview">معاينة</button>
    </div>
    <div id="import-result"></div>
    ${legacyImportSection()}`;
  bindLegacyImport();

  $('#import-preview').addEventListener('click', () => {
    const rows = parseStudentList($('#import-text').value);
    const valid = rows.filter((r) => r.full_name && r.level);
    const counts = {};
    for (const r of valid) counts[r.level] = (counts[r.level] || 0) + 1;
    const result = $('#import-result');
    if (!rows.length) {
      result.innerHTML = '<div class="card error">لم يتم التعرف على أي سطر. تأكد من نسخ الجدول كاملًا.</div>';
      return;
    }
    result.innerHTML = `
      <div class="card">
        <h3>المعاينة: ${valid.length} تلميذ</h3>
        <p>${state.meta.levels.filter((l) => counts[l.code]).map((l) => `<span class="pill">${esc(l.label)}: ${counts[l.code]}</span>`).join(' ')}</p>
        ${rows.length > valid.length ? `<p class="error">${rows.length - valid.length} سطر لم يُعرف مستواه ولن يُستورد (بالأحمر).</p>` : ''}
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>التلميذ</th><th>المستوى</th><th>ملاحظات</th><th>الولي</th><th>الهاتف</th><th>المدينة</th><th>المؤسسة</th></tr></thead>
          <tbody>${rows
            .map(
              (r, i) => `<tr class="${r.level ? '' : 'bad'}"><td>${i + 1}</td><td><b>${esc(r.full_name)}</b></td>
                <td>${r.level ? esc(levelLabel(r.level)) : esc(r.classe) + ' ⚠'}</td><td>${esc(r.remarks)}</td>
                <td>${esc(r.parent_name)}</td><td dir="ltr">${esc(r.phone)}</td><td>${esc(r.city)}</td><td>${esc(r.school)}</td></tr>`
            )
            .join('')}</tbody>
        </table></div>
        <p><button class="btn" id="import-go" ${valid.length ? '' : 'disabled'}>استيراد ${valid.length} تلميذ</button></p>
      </div>`;
    $('#import-go').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'جاري الاستيراد…';
      try {
        const res = await api('POST', '/api/import/students', {
          rows: valid.map(({ classe, ...r }) => r),
        });
        showImportResult(result, res);
      } catch (err) {
        toast(err.message, true);
        e.target.disabled = false;
        e.target.textContent = `استيراد ${valid.length} تلميذ`;
      }
    });
  });
}

function showImportResult(el, res) {
  const csvRows = res.parents.map((p) => [p.full_name, p.username, p.password, p.phone, p.children.join(' / ')]);
  el.innerHTML = `
    <div class="card">
      <h3>✅ تمت إضافة ${res.created_students} تلميذ و${res.parents.length} حساب ولي</h3>
      ${res.skipped.length ? `<p class="muted">موجودون مسبقًا ولم يُضافوا: ${res.skipped.map(esc).join('، ')}</p>` : ''}
      ${
        res.parents.length
          ? `<p class="error"><b>مهم:</b> كلمات السر تظهر هنا مرة واحدة فقط. حمّلها أو اطبعها الآن وأعطِ كل ولي معلوماته.</p>
             <p class="actions"><button class="btn" id="dl-csv">⬇ تحميل (Excel / CSV)</button>
               <button class="btn ghost" id="print">🖨 طباعة</button></p>
             <div class="table-wrap print-area"><table>
               <thead><tr><th>الولي</th><th>اسم المستخدم</th><th>كلمة السر</th><th>الهاتف</th><th>الأبناء</th></tr></thead>
               <tbody>${res.parents
                 .map(
                   (p) => `<tr><td>${esc(p.full_name)}</td><td dir="ltr"><b>${esc(p.username)}</b></td>
                     <td dir="ltr"><b>${esc(p.password)}</b></td><td dir="ltr">${esc(p.phone || '')}</td><td>${p.children.map(esc).join('، ')}</td></tr>`
                 )
                 .join('')}</tbody>
             </table></div>`
          : ''
      }
      <p><a href="#/students" class="btn ghost">عرض قائمة التلاميذ</a></p>
    </div>`;
  $('#dl-csv')?.addEventListener('click', () =>
    downloadCsv('comptes-parents-feed.csv', ['الولي', 'اسم المستخدم', 'كلمة السر', 'الهاتف', 'الأبناء'], csvRows)
  );
  $('#print')?.addEventListener('click', () => window.print());
}

// ---------- المهام العامة للقسم ----------
function taskItem(t, canDelete) {
  const late = t.due_date && t.due_date < today();
  return `<li class="task">
    <div class="note-head">
      <span class="pill">${esc(t.subject_name || '')}</span>
      <span class="pill">${esc(levelLabel(t.level))}</span>
      ${t.due_date ? `<span class="badge ${late ? 'general' : 'average'}">آخر أجل: ${fmtDate(t.due_date)}</span>` : ''}
      <span class="muted small">${esc(t.author_name || '')}</span>
      ${canDelete ? `<button class="link danger" data-del-task="${t.id}">حذف</button>` : ''}
    </div>
    <b>${esc(t.title)}</b>
    ${t.description ? `<p>${esc(t.description)}</p>` : ''}
  </li>`;
}

// المواد التي يستطيع المستخدم العمل عليها (المعلم: مواده فقط)
const workSubjects = () => (state.user.role === 'teacher' ? state.user.subjects || [] : state.meta.subjects);
const subjectLevels = (subject) =>
  state.meta.levels.filter(
    (l) => (!subject?.levels || subject.levels.includes(l.code)) && (!subject?.teach_levels || subject.teach_levels.includes(l.code))
  );

function bindSubjectLevel(subjectSel, levelSel, selectedLevel) {
  const sync = () => {
    const subject = workSubjects().find((x) => x.id === Number(subjectSel.value));
    const keep = levelSel.value || selectedLevel;
    levelSel.innerHTML = subjectLevels(subject)
      .map((l) => `<option value="${esc(l.code)}" ${l.code === keep ? 'selected' : ''}>${esc(l.label)}</option>`)
      .join('');
  };
  subjectSel.addEventListener('change', sync);
  sync();
}

async function viewTasks(el) {
  const { tasks } = await api('GET', '/api/tasks');
  const subjects = workSubjects();
  el.innerHTML = `
    <h2>مهام القسم</h2>
    ${
      subjects.length
        ? `<div class="card">
            <h3>مهمة جديدة لكل القسم</h3>
            <form id="task-form">
              <div class="row">
                <label>المادة<select name="subject_id" id="t-subject">${subjectOptions(subjects)}</select></label>
                <label>المستوى<select name="level" id="t-level"></select></label>
              </div>
              <label>العنوان<input name="title" required placeholder="مثال: تمارين الصفحة 45"></label>
              <label>التفاصيل<textarea name="description" rows="3"></textarea></label>
              <label>آخر أجل<input type="date" name="due_date"></label>
              <button class="btn">نشر المهمة</button>
              <p class="muted small">تظهر المهمة لكل أولياء تلاميذ هذا المستوى المسجّلين في المادة.</p>
            </form>
          </div>`
        : '<div class="card muted">لم تُسند لك أي مادة بعد.</div>'
    }
    <section class="card">
      <h3>${state.user.role === 'admin' ? 'كل المهام' : 'مهامي'}</h3>
      ${tasks.length ? `<ul class="tasks">${tasks.map((t) => taskItem(t, true)).join('')}</ul>` : '<p class="muted">لا توجد مهام بعد.</p>'}
    </section>`;
  if ($('#task-form')) {
    bindSubjectLevel($('#t-subject'), $('#t-level'), sessionStorage.getItem('levelFilter'));
    $('#task-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/tasks', formData(e.target));
        toast('تم نشر المهمة');
        viewTasks(el);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }
  el.querySelectorAll('[data-del-task]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذه المهمة؟')) return;
      await api('DELETE', `/api/tasks/${b.dataset.delTask}`).catch((err) => toast(err.message, true));
      viewTasks(el);
    })
  );
}

// ---------- الحضور ----------
async function viewAttendance(el) {
  const subjects = workSubjects();
  if (!subjects.length) {
    el.innerHTML = '<h2>الغيابات</h2><div class="card muted">لم تُسند لك أي مادة بعد.</div>';
    return;
  }
  el.innerHTML = `
    <h2>تسجيل الغيابات</h2>
    <div class="filters">
      <select id="a-subject">${subjectOptions(subjects, Number(sessionStorage.getItem('attSubject')) || null)}</select>
      <select id="a-level"></select>
      <input type="date" id="a-date" value="${today()}">
    </div>
    <div id="att-list"></div>`;
  bindSubjectLevel($('#a-subject'), $('#a-level'), sessionStorage.getItem('attLevel') || sessionStorage.getItem('levelFilter'));

  const load = async () => {
    const params = new URLSearchParams({ subject_id: $('#a-subject').value, level: $('#a-level').value, date: $('#a-date').value });
    sessionStorage.setItem('attSubject', params.get('subject_id'));
    sessionStorage.setItem('attLevel', params.get('level'));
    const list = $('#att-list');
    try {
      const { students } = await api('GET', '/api/attendance?' + params);
      list.innerHTML = students.length
        ? `<div class="card">
            <p class="muted">كل التلاميذ حاضرون افتراضيًا: اضغط فقط على من تغيّب.</p>
            <ul class="att">${students
              .map(
                (st) => `<li><button type="button" class="att-row ${st.absent ? 'absent' : ''}" data-id="${st.id}">
                  ${avatar(st, 'sm')}<span>${esc(st.full_name)}</span><b class="att-state"></b></button></li>`
              )
              .join('')}</ul>
            <p class="att-summary"></p>
            <button class="btn" id="att-save">حفظ الغيابات</button>
          </div>`
        : '<div class="card muted">لا يوجد تلاميذ يدرسون هذه المادة في هذا المستوى.</div>';
      const summary = () => {
        const absent = list.querySelectorAll('.att-row.absent').length;
        list.querySelector('.att-summary').textContent = `الحاضرون: ${students.length - absent} — الغائبون: ${absent}`;
      };
      list.querySelectorAll('.att-row').forEach((b) =>
        b.addEventListener('click', () => {
          b.classList.toggle('absent');
          summary();
        })
      );
      if (students.length) summary();
      $('#att-save')?.addEventListener('click', async () => {
        try {
          await api('POST', '/api/attendance', {
            ...Object.fromEntries(params),
            absent_ids: [...list.querySelectorAll('.att-row.absent')].map((b) => Number(b.dataset.id)),
          });
          toast('تم حفظ الغيابات');
        } catch (err) {
          toast(err.message, true);
        }
      });
    } catch (err) {
      list.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
    }
  };
  for (const id of ['#a-subject', '#a-level', '#a-date']) $(id).addEventListener('change', load);
  await load();
}

// ---------- جداول الأوقات ----------
const DAYS_AR = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
const todayIso = () => new Date().getDay() || 7;

// عرض أسبوعي: عمود لكل يوم فيه حصص
function weekView(slots, { showLevel = false, showTeacher = false, showChild = false, editable = false } = {}) {
  if (!slots.length) return '<p class="muted">لا توجد حصص في الجدول بعد.</p>';
  const days = [...new Set(slots.map((x) => x.day))].sort((a, b) => a - b);
  return `<div class="week">${days
    .map(
      (d) => `<div class="day ${d === todayIso() ? 'today' : ''}">
        <h4>${DAYS_AR[d - 1]}${d === todayIso() ? ' <span class="badge average">اليوم</span>' : ''}</h4>
        ${slots
          .filter((x) => x.day === d)
          .map(
            (x) => `<div class="slot">
              <div class="slot-time">من <bdi>${esc(x.start_time)}</bdi> إلى <bdi>${esc(x.end_time)}</bdi></div>
              <b>${esc(x.subject_name || '')}</b>
              ${showChild && x.child_name ? `<div class="slot-child">👤 ${esc(x.child_name)}</div>` : ''}
              ${showLevel ? `<div class="muted small">${esc(levelLabel(x.level))}${x.group_name ? ` — فوج ${esc(x.group_name)}` : ''}</div>` : ''}
              ${!showLevel && x.group_name ? `<span class="badge general">فوج ${esc(x.group_name)}</span>` : ''}
              ${showTeacher && x.teacher_name ? `<div class="muted small">👩‍🏫 ${esc(x.teacher_name)}</div>` : ''}
              ${x.room ? `<div class="muted small">📍 ${esc(x.room)}</div>` : ''}
              ${
                editable
                  ? `<div class="slot-actions"><button class="link" data-edit-slot="${x.id}">تعديل</button>
                     <button class="link danger" data-del-slot="${x.id}">حذف</button></div>`
                  : ''
              }
            </div>`
          )
          .join('')}
      </div>`
    )
    .join('')}</div>`;
}

async function viewTimetable(el) {
  const role = state.user.role;
  if (role === 'teacher') {
    const { slots } = await api('GET', '/api/timetable');
    const hours = slots.reduce((t, x) => t + (toMinutes(x.end_time) - toMinutes(x.start_time)), 0) / 60;
    el.innerHTML = `<h2>جدولي</h2>
      <p class="muted">${slots.length} حصة في الأسبوع — ${hours.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ساعة</p>
      <div class="card">${weekView(slots, { showLevel: true })}</div>`;
    return;
  }
  if (role === 'parent') {
    const { children } = await api('GET', '/api/timetable/children');
    const slots = children
      .flatMap((c) => c.slots.map((x) => ({ ...x, child_name: c.full_name })))
      .sort((a, b) => a.day - b.day || a.start_time.localeCompare(b.start_time));
    el.innerHTML = `<h2>جدول الأوقات</h2>
      ${children.length > 1 ? `<p class="muted">جدول كل أبنائك معًا: ${children.map((c) => esc(c.full_name)).join('، ')}</p>` : ''}
      <div class="card">${weekView(slots, { showTeacher: true, showChild: children.length > 1 })}</div>`;
    return;
  }

  // الإدارة: جدول كل مستوى
  const level = sessionStorage.getItem('ttLevel') || state.meta.levels[0].code;
  const teachers = (await api('GET', '/api/users?role=teacher')).users.filter((u) => !u.program_staff);
  el.innerHTML = `
    <div class="page-head">
      <h2>جداول الأوقات</h2>
      <button class="btn" id="add-slot">+ حصة جديدة</button>
    </div>
    <div class="filters"><select id="tt-level">${levelOptions(level)}</select></div>
    <div class="card" id="tt-week"></div>`;

  const load = async () => {
    const lvl = $('#tt-level').value;
    sessionStorage.setItem('ttLevel', lvl);
    const { slots } = await api('GET', '/api/timetable?level=' + encodeURIComponent(lvl));
    $('#tt-week').innerHTML = weekView(slots, { showTeacher: true, editable: true, showLevel: false });
    $('#tt-week').querySelectorAll('[data-edit-slot]').forEach((b) =>
      b.addEventListener('click', () => slotForm(slots.find((x) => x.id === Number(b.dataset.editSlot))))
    );
    $('#tt-week').querySelectorAll('[data-del-slot]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('حذف هذه الحصة من الجدول ابتداءً من اليوم؟ (الساعات الماضية تبقى محتسبة للمعلم)')) return;
        await api('DELETE', `/api/timetable/${b.dataset.delSlot}`).catch((err) => toast(err.message, true));
        load();
      })
    );
  };

  const slotForm = (slot) => {
    const lvl = slot?.level || $('#tt-level').value;
    const subjects = state.meta.subjects.filter((x) => !x.levels || x.levels.includes(lvl));
    openModal(
      slot ? 'تعديل الحصة' : `حصة جديدة — ${levelLabel(lvl)}`,
      `<input type="hidden" name="level" value="${esc(lvl)}">
       <div class="row">
         <label>اليوم<select name="day">${DAYS_AR.map((d, i) => `<option value="${i + 1}" ${slot?.day === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
         <label>الفوج (اختياري)<input name="group_name" value="${esc(slot?.group_name || '')}" placeholder="كل الأفواج"></label>
       </div>
       <div class="row">
         <label>من<input type="time" name="start_time" value="${esc(slot?.start_time || '14:00')}" required></label>
         <label>إلى<input type="time" name="end_time" value="${esc(slot?.end_time || '15:30')}" required></label>
       </div>
       <label>المادة<select name="subject_id" id="slot-subject">${subjectOptions(subjects, slot?.subject_id)}</select></label>
       <label>المعلم<select name="teacher_id" id="slot-teacher"></select></label>
       <label>القاعة / الرابط<input name="room" value="${esc(slot?.room || '')}" placeholder="مثال: قاعة 2 أو عن بعد"></label>
       <label>تُحتسب ابتداءً من<input type="date" name="valid_from" value="${esc(slot ? today() : today())}"></label>
       <p class="muted small">${slot ? 'التعديل يُطبَّق ابتداءً من هذا التاريخ، والأسابيع الماضية تبقى كما هي في حساب ساعات المعلم.' : 'لحساب ساعات المعلم: ضع تاريخ بداية الدراسة إن كانت الحصة قائمة منذ مدة.'}</p>`,
      async (data) => {
        if (slot) await api('PUT', `/api/timetable/${slot.id}`, data);
        else await api('POST', '/api/timetable', data);
        toast('تم الحفظ');
        load();
      }
    );
    // المعلمون الذين يدرّسون المادة المختارة
    const syncTeachers = () => {
      const sid = Number($('#slot-subject').value);
      const list = teachers.filter((t) => t.subjects.some((x) => x.id === sid));
      $('#slot-teacher').innerHTML =
        '<option value="">— بدون —</option>' +
        list.map((t) => `<option value="${t.id}" ${t.id === slot?.teacher_id ? 'selected' : ''}>${esc(t.full_name)}</option>`).join('');
      if (list.length === 1 && !slot) $('#slot-teacher').value = list[0].id;
    };
    $('#slot-subject').addEventListener('change', syncTeachers);
    syncTeachers();
  };

  $('#tt-level').addEventListener('change', load);
  $('#add-slot').addEventListener('click', () => slotForm(null));
  await load();
}

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ---------- مجموعات واتساب ----------
const groupScope = (g) =>
  g.level ? `${levelLabel(g.level)}${g.group_name ? ` — فوج ${g.group_name}` : ' — كل الأفواج'}` : 'كل المستويات';

async function viewWhatsappGroups(el) {
  const { groups } = await api('GET', '/api/whatsapp-groups');
  el.innerHTML = `
    <div class="page-head">
      <h2>مجموعات واتساب</h2>
      <button class="btn" id="add-group">+ مجموعة</button>
    </div>
    <p class="muted">أضف رابط الدعوة لكل مجموعة (في واتساب: معلومات المجموعة ← الدعوة عبر رابط). الولي يجد رابط مجموعة ابنه في صفحته.</p>
    ${
      groups.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>المجموعة</th><th>التلاميذ المعنيون</th><th></th></tr></thead>
            <tbody>${groups
              .map(
                (g) => `<tr><td><b>${esc(g.name)}</b></td><td>${esc(groupScope(g))}</td>
                  <td class="row-actions"><a class="btn wa small" href="${esc(g.invite_link)}" target="_blank" rel="noopener">${WA_ICON} فتح</a>
                    <button class="btn ghost small" data-edit="${g.id}">تعديل</button>
                    <button class="btn danger small" data-del="${g.id}">حذف</button></td></tr>`
              )
              .join('')}</tbody></table></div>`
        : '<div class="card muted">لا توجد مجموعات بعد.</div>'
    }`;
  const reload = () => viewWhatsappGroups(el);
  const form = (g) =>
    openModal(
      g ? 'تعديل المجموعة' : 'مجموعة واتساب جديدة',
      `<label>الاسم<input name="name" value="${esc(g?.name || '')}" required placeholder="مثال: أولياء التاسعة — فوج أ"></label>
       <div class="row">
         <label>المستوى<select name="level"><option value="">كل المستويات</option>${state.meta.levels
           .map((l) => `<option value="${esc(l.code)}" ${g?.level === l.code ? 'selected' : ''}>${esc(l.label)}</option>`)
           .join('')}</select></label>
         <label>الفوج (اختياري)<input name="group_name" value="${esc(g?.group_name || '')}" placeholder="كل الأفواج"></label>
       </div>
       <label>رابط الدعوة<input name="invite_link" dir="ltr" value="${esc(g?.invite_link || '')}" required placeholder="https://chat.whatsapp.com/..."></label>`,
      async (data) => {
        if (g) await api('PUT', `/api/whatsapp-groups/${g.id}`, data);
        else await api('POST', '/api/whatsapp-groups', data);
        toast('تم الحفظ');
        reload();
      }
    );
  $('#add-group').addEventListener('click', () => form(null));
  el.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => form(groups.find((g) => g.id === Number(b.dataset.edit))))
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذه المجموعة من المنصة؟ (لا تُحذف من واتساب)')) return;
      await api('DELETE', `/api/whatsapp-groups/${b.dataset.del}`).catch((err) => toast(err.message, true));
      reload();
    })
  );
}

// ---------- رسالة جماعية ----------
async function viewBroadcast(el) {
  const { groups } = await api('GET', '/api/whatsapp-groups');
  el.innerHTML = `
    <h2>رسالة جماعية عبر واتساب</h2>
    <div class="card">
      <div class="row">
        <label>المستوى<select id="b-level"><option value="">كل المستويات</option>${state.meta.levels
          .map((l) => `<option value="${esc(l.code)}">${esc(l.label)}</option>`)
          .join('')}</select></label>
        <label>الفوج (اختياري)<input id="b-group" placeholder="كل الأفواج"></label>
      </div>
      <label>النموذج<select id="b-template">${Object.entries(WA_TEMPLATES)
        .map(([k, t]) => `<option value="${k}">${t.label}</option>`)
        .join('')}</select></label>
      <label>الرسالة<textarea id="b-text" rows="6"></textarea></label>
      <p class="muted small">المتغيرات: <code>{الولي}</code> <code>{التلميذ}</code> <code>{المبلغ}</code> <code>{التاريخ}</code> <code>{الرابط}</code> — تُعوَّض لكل ولي عند الإرسال الفردي.</p>
      <label class="check"><input type="checkbox" id="b-owing"> فقط الأولياء الذين عليهم مبالغ</label>
      <button class="btn" id="b-prepare">تحضير الإرسال</button>
    </div>
    <div id="b-result"></div>`;
  const sync = () => ($('#b-text').value = WA_TEMPLATES[$('#b-template').value].text);
  $('#b-template').addEventListener('change', () => {
    sync();
    if ($('#b-template').value === 'payment') $('#b-owing').checked = true;
  });
  sync();

  $('#b-prepare').addEventListener('click', async () => {
    const level = $('#b-level').value;
    const group = $('#b-group').value.trim().toLowerCase();
    const message = $('#b-text').value;
    const params = new URLSearchParams({ status: 'studying' });
    if (level) params.set('level', level);
    let { students } = await api('GET', '/api/students?' + params);
    if (group) students = students.filter((st) => (st.group_name || '').toLowerCase() === group);
    if ($('#b-owing').checked) students = students.filter((st) => st.balance > 0);

    // ولي واحد لعدة أبناء: رسالة واحدة
    const families = new Map();
    for (const st of students) {
      const key = waNumber(st.parent_phone) || `none-${st.id}`;
      if (!families.has(key)) families.set(key, { phone: st.parent_phone, parent: st.parent_name, kids: [], balance: 0 });
      const f = families.get(key);
      f.kids.push(st.full_name);
      f.balance += Math.max(st.balance || 0, 0);
    }
    const list = [...families.values()];
    const reachable = list.filter((f) => waNumber(f.phone));
    const matchingGroups = groups.filter(
      (g) => (!level ? !g.level : g.level === level) && (!g.group_name || !group || g.group_name.toLowerCase() === group)
    );

    $('#b-result').innerHTML = `
      ${
        matchingGroups.length
          ? `<div class="card"><h3>💬 الإرسال في مجموعة واتساب</h3>
              <p class="muted small">واتساب لا يسمح بالنشر الآلي في المجموعات: اضغط الزر، تُنسخ الرسالة وتُفتح المجموعة، ثم الصق الرسالة وأرسلها.</p>
              ${matchingGroups
                .map((g) => `<button class="btn wa" data-group-link="${esc(g.invite_link)}">${WA_ICON} نسخ وفتح «${esc(g.name)}»</button>`)
                .join(' ')}</div>`
          : ''
      }
      <div class="card">
        <h3>👤 الإرسال لكل ولي (${reachable.length} ولي)</h3>
        ${list.length > reachable.length ? `<p class="error small">${list.length - reachable.length} ولي دون رقم هاتف صالح.</p>` : ''}
        <p class="muted small">كل زر يفتح محادثة الولي والرسالة جاهزة باسمه واسم ابنه. اضغط «إرسال» في واتساب ثم ارجع للقائمة.</p>
        <p class="b-progress"></p>
        <ul class="recipients">${reachable
          .map(
            (f, i) => `<li><div><b>${esc(f.parent || 'ولي')}</b> <span class="muted small">${esc(f.kids.join('، '))}</span>
                ${f.balance > 0 ? `<span class="owed small">${fmtMoney(f.balance)}</span>` : ''}</div>
              <a class="btn wa small" target="_blank" rel="noopener" data-i="${i}"
                href="${esc(waUrl(f.phone, fillTemplate(message, { parent: f.parent, student: f.kids.join(' و'), amount: fmtMoney(f.balance) })))}">${WA_ICON} إرسال</a></li>`
          )
          .join('')}</ul>
      </div>`;
    const progress = () => {
      const sent = $('#b-result').querySelectorAll('.recipients a.sent').length;
      $('#b-result .b-progress').textContent = `تم فتح ${sent} من ${reachable.length}`;
    };
    $('#b-result').querySelectorAll('.recipients a').forEach((a) =>
      a.addEventListener('click', () => {
        a.classList.add('sent');
        a.innerHTML = `${WA_ICON} تم ✓`;
        progress();
      })
    );
    progress();
    $('#b-result').querySelectorAll('[data-group-link]').forEach((b) =>
      b.addEventListener('click', () => {
        // النسخ يبدأ قبل فتح النافذة حتى لا يحجبها المتصفح
        copyText(fillTemplate(message, { parent: 'أولياءنا الكرام', student: 'أبنائكم' })).then((ok) =>
          toast(ok ? 'تم نسخ الرسالة، الصقها في المجموعة' : 'انسخ الرسالة يدويًا', !ok)
        );
        window.open(b.dataset.groupLink, '_blank', 'noopener');
      })
    );
  });
}

// ---------- ساعات وخلاص المعلمين ----------
const SESSION_LABELS = {
  done: ['تمت', 'good'],
  planned: ['مبرمجة', 'general'],
  absent: ['غياب', 'weak'],
  adjusted: ['معدّلة', 'average'],
  extra: ['إضافية', 'level'],
};
const fmtHours = (h) => `${Number(h).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} س`;
const payMonth = () => sessionStorage.getItem('payMonth') || today().slice(0, 7);
const weekdayName = (d) => DAYS_AR[(new Date(d + 'T00:00:00Z').getUTCDay() || 7) - 1];

async function viewPayroll(el) {
  el.innerHTML = `
    <div class="page-head">
      <h2>ساعات وخلاص المعلمين</h2>
      <input type="month" id="pay-month" value="${payMonth()}">
    </div>
    <div id="pay-body"></div>`;
  const load = async () => {
    sessionStorage.setItem('payMonth', $('#pay-month').value);
    const { teachers, totals, month } = await api('GET', '/api/payroll?month=' + $('#pay-month').value);
    $('#pay-body').innerHTML = `
      <div class="stats compact">
        <div class="stat"><b>${fmtHours(totals.hours_done)}</b><span>الساعات المنجزة — ${esc(monthLabel(month))}</span></div>
        <div class="stat"><b>${fmtMoney(totals.due)}</b><span>المستحق</span></div>
        <div class="stat good"><b>${fmtMoney(totals.paid)}</b><span>المدفوع</span></div>
        <div class="stat warn"><b>${fmtMoney(totals.remaining)}</b><span>الباقي</span></div>
      </div>
      ${
        teachers.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>المعلم</th><th>معلوم الساعة</th><th>الحصص</th><th>الساعات</th><th>المستحق</th><th>المدفوع</th><th>الباقي</th><th></th></tr></thead>
              <tbody>${teachers
                .map(
                  (t) => `<tr>
                    <td><b>${esc(t.full_name)}</b></td>
                    <td>${t.hourly_rate ? fmtMoney(t.hourly_rate) : '<span class="error small">غير محدّد</span>'}</td>
                    <td>${t.sessions}${t.absences ? ` <span class="badge weak">${t.absences} غياب</span>` : ''}</td>
                    <td><b>${fmtHours(t.hours_done)}</b>${t.hours_planned ? `<div class="muted small">+ ${fmtHours(t.hours_planned)} مبرمجة</div>` : ''}</td>
                    <td>${fmtMoney(t.due)}</td>
                    <td>${fmtMoney(t.paid)}</td>
                    <td>${t.remaining > 0 ? `<b class="owed">${fmtMoney(t.remaining)}</b>` : t.due > 0 ? '<span class="badge good">خالص</span>' : '—'}</td>
                    <td><a class="btn ghost small" href="#/payroll/${t.id}">التفاصيل</a></td>
                  </tr>`
                )
                .join('')}</tbody></table></div>`
          : '<div class="card muted">لا يوجد معلمون.</div>'
      }
      <p class="muted small">الساعات تُحسب تلقائيًا من جدول الأوقات، يومًا بيوم من 1 إلى آخر الشهر. الحصص المقبلة «مبرمجة» ولا تدخل في المستحق حتى يحين موعدها.</p>`;
  };
  $('#pay-month').addEventListener('change', load);
  await load();
}

async function viewTeacherPay(el, teacherId) {
  const isAdmin = state.user.role === 'admin';
  el.innerHTML = `
    <div class="page-head">
      <div>
        ${isAdmin ? '<a href="#/payroll" class="muted small">→ كل المعلمين</a>' : ''}
        <h2 id="tp-title">ساعاتي وخلاصي</h2>
      </div>
      <input type="month" id="tp-month" value="${payMonth()}">
    </div>
    <div id="tp-body"></div>
    <section class="card"><h3>📆 السنة الدراسية</h3><div id="tp-year"></div></section>`;

  const loadYear = async () => {
    const { months, totals } = await api('GET', `/api/payroll/${teacherId}/year`);
    $('#tp-year').innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>الشهر</th><th>الساعات</th><th>المستحق</th><th>المدفوع</th><th>الباقي</th></tr></thead>
      <tbody>${[...months]
        .reverse()
        .map(
          (m) => `<tr class="clickable" data-month="${m.month}">
            <td><b>${esc(monthLabel(m.month))}</b></td>
            <td>${fmtHours(m.hours_done)}${m.hours_planned ? ` <span class="muted small">(+${fmtHours(m.hours_planned)})</span>` : ''}</td>
            <td>${fmtMoney(m.due)}</td>
            <td>${fmtMoney(m.paid)}${m.payments.some((p) => p.kind === 'advance') ? ' <span class="badge average">تسبقة</span>' : ''}</td>
            <td>${m.remaining > 0 ? `<b class="owed">${fmtMoney(m.remaining)}</b>` : m.due > 0 ? '<span class="badge good">خالص</span>' : '—'}</td>
          </tr>`
        )
        .join('')}</tbody>
      <tfoot><tr><th>المجموع</th><th>${fmtHours(totals.hours_done)}</th><th>${fmtMoney(totals.due)}</th><th>${fmtMoney(totals.paid)}</th><th>${fmtMoney(totals.remaining)}</th></tr></tfoot>
    </table></div>`;
    $('#tp-year').querySelectorAll('[data-month]').forEach((tr) =>
      tr.addEventListener('click', () => {
        $('#tp-month').value = tr.dataset.month;
        load();
        el.scrollIntoView({ behavior: 'smooth' });
      })
    );
  };

  const load = async () => {
    const month = $('#tp-month').value;
    sessionStorage.setItem('payMonth', month);
    const m = await api('GET', `/api/payroll/${teacherId}?month=${month}`);
    if (isAdmin) $('#tp-title').textContent = m.teacher.full_name;
    $('#tp-body').innerHTML = `
      <div class="stats compact">
        <div class="stat"><b>${m.hourly_rate ? fmtMoney(m.hourly_rate) : '—'}</b><span>معلوم الساعة</span></div>
        <div class="stat"><b>${fmtHours(m.hours_done)}</b><span>الساعات المنجزة${m.hours_planned ? ` (+${fmtHours(m.hours_planned)} مبرمجة)` : ''}</span></div>
        <div class="stat"><b>${fmtMoney(m.due)}</b><span>المستحق — ${esc(monthLabel(month))}</span></div>
        <div class="stat good"><b>${fmtMoney(m.paid)}</b><span>المدفوع</span></div>
        <div class="stat ${m.remaining > 0 ? 'warn' : 'good'}"><b>${fmtMoney(Math.max(m.remaining, 0))}</b><span>${m.remaining < 0 ? `الباقي (دُفع زيادة ${fmtMoney(-m.remaining)})` : 'الباقي'}</span></div>
      </div>
      ${!m.hourly_rate ? `<p class="error">لم يُحدَّد معلوم الساعة${isAdmin ? ' — حدّده من «الحسابات ← المعلمون ← تعديل»' : ''}.</p>` : ''}
      <section class="card">
        <div class="section-head">
          <h3>💵 الدفعات</h3>
          ${isAdmin ? '<button class="btn small" id="tp-pay">+ دفعة</button>' : ''}
        </div>
        ${
          m.payments.length
            ? `<ul class="levels">${m.payments
                .map(
                  (p) => `<li><span>${fmtDate(p.paid_on)} — ${p.kind === 'advance' ? '<span class="badge average">تسبقة</span>' : '<span class="badge good">خلاص</span>'}
                    ${p.method ? esc(PAYMENT_LABELS[p.method] || p.method) : ''} ${p.note ? `<span class="muted small">${esc(p.note)}</span>` : ''}</span>
                    <span><b>${fmtMoney(p.amount)}</b>${isAdmin ? ` <button class="link danger" data-del-pay="${p.id}">حذف</button>` : ''}</span></li>`
                )
                .join('')}</ul>`
            : '<p class="muted">لا توجد دفعات لهذا الشهر.</p>'
        }
      </section>
      <section class="card">
        <div class="section-head">
          <h3>🕘 الحصص يومًا بيوم</h3>
          ${isAdmin ? '<button class="btn small ghost" id="tp-extra">+ حصة إضافية</button>' : ''}
        </div>
        ${
          m.sessions.length
            ? `<div class="table-wrap"><table>
                <thead><tr><th>التاريخ</th><th>الحصة</th><th>الساعات</th><th>الحالة</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
                <tbody>${m.sessions
                  .map((x, i) => {
                    const [label, cls] = SESSION_LABELS[x.status];
                    return `<tr class="${x.status === 'planned' ? 'planned' : ''}">
                      <td><b>${weekdayName(x.date)}</b> ${fmtDate(x.date)}</td>
                      <td>${
                        x.timetable_id
                          ? `من <bdi>${esc(x.start_time)}</bdi> إلى <bdi>${esc(x.end_time)}</bdi> — ${esc(x.subject_name || '')}
                             <span class="muted small">${esc(levelLabel(x.level))}${x.group_name ? ` (${esc(x.group_name)})` : ''}</span>`
                          : '<span class="muted">حصة إضافية</span>'
                      }${x.note ? `<div class="muted small">📝 ${esc(x.note)}</div>` : ''}</td>
                      <td>${fmtHours(x.hours)}${x.status === 'adjusted' ? ` <span class="muted small">(بدل ${fmtHours(x.scheduled_hours)})</span>` : ''}</td>
                      <td><span class="badge ${cls}">${label}</span></td>
                      ${
                        isAdmin
                          ? `<td class="row-actions">${
                              x.timetable_id && x.status !== 'absent'
                                ? `<button class="link danger" data-absent="${i}">غياب</button> <button class="link" data-hours="${i}">تعديل</button>`
                                : ''
                            }${x.adjustment_id ? ` <button class="link" data-undo="${x.adjustment_id}">${x.status === 'extra' ? 'حذف' : 'إلغاء التعديل'}</button>` : ''}</td>`
                          : ''
                      }
                    </tr>`;
                  })
                  .join('')}</tbody>
                <tfoot><tr><th colspan="2">المجموع المنجز</th><th>${fmtHours(m.hours_done)}</th><th colspan="${isAdmin ? 2 : 1}">${fmtMoney(m.due)}</th></tr></tfoot>
              </table></div>`
            : '<p class="muted">لا توجد حصص في هذا الشهر. تأكد من جدول الأوقات.</p>'
        }
      </section>`;

    if (!isAdmin) return;
    const reload = () => Promise.all([load(), loadYear()]);
    const adjust = (body) =>
      api('POST', `/api/payroll/${teacherId}/adjustments`, body)
        .then(() => {
          toast('تم التعديل');
          reload();
        })
        .catch((err) => toast(err.message, true));
    $('#tp-body').querySelectorAll('[data-absent]').forEach((b) =>
      b.addEventListener('click', () => {
        const x = m.sessions[Number(b.dataset.absent)];
        openModal(
          `غياب المعلم — ${weekdayName(x.date)} ${fmtDate(x.date)}`,
          `<p>هذه الحصة لن تُحتسب (${fmtHours(x.scheduled_hours)}).</p><label>ملاحظة<input name="note" placeholder="مثال: غياب بعذر"></label>`,
          (data) => adjust({ date: x.date, timetable_id: x.timetable_id, hours: 0, note: data.note })
        );
      })
    );
    $('#tp-body').querySelectorAll('[data-hours]').forEach((b) =>
      b.addEventListener('click', () => {
        const x = m.sessions[Number(b.dataset.hours)];
        openModal(
          `تعديل مدة الحصة — ${weekdayName(x.date)} ${fmtDate(x.date)}`,
          `<label>عدد الساعات المنجزة<input name="hours" inputmode="decimal" value="${x.hours}" required></label>
           <label>ملاحظة<input name="note" value="${esc(x.note || '')}"></label>`,
          (data) => adjust({ date: x.date, timetable_id: x.timetable_id, hours: data.hours, note: data.note })
        );
      })
    );
    $('#tp-body').querySelectorAll('[data-undo]').forEach((b) =>
      b.addEventListener('click', async () => {
        await api('DELETE', `/api/payroll/adjustments/${b.dataset.undo}`).catch((err) => toast(err.message, true));
        reload();
      })
    );
    $('#tp-extra').addEventListener('click', () =>
      openModal(
        'حصة إضافية',
        `<div class="row"><label>التاريخ<input type="date" name="date" value="${today()}" required></label>
           <label>عدد الساعات<input name="hours" inputmode="decimal" value="1.5" required></label></div>
         <label>ملاحظة<input name="note" placeholder="مثال: حصة تدارك للتاسعة"></label>`,
        (data) => adjust(data)
      )
    );
    $('#tp-pay').addEventListener('click', () =>
      openModal(
        `دفعة للمعلم — ${monthLabel(month)}`,
        `<div class="row">
           <label>النوع<select name="kind"><option value="full">خلاص الشهر</option><option value="advance">تسبقة</option></select></label>
           <label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${Math.max(m.remaining, 0) || ''}" required></label>
         </div>
         <input type="hidden" name="month" value="${month}">
         <div class="row">
           <label>تاريخ الدفع<input type="date" name="paid_on" value="${today()}"></label>
           <label>طريقة الدفع<select name="method">${Object.entries(PAYMENT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
         </div>
         <label>ملاحظة<input name="note"></label>`,
        async (data) => {
          await api('POST', `/api/payroll/${teacherId}/payments`, data);
          toast('تم تسجيل الدفعة');
          reload();
        }
      )
    );
    $('#tp-body').querySelectorAll('[data-del-pay]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('حذف هذه الدفعة؟')) return;
        await api('DELETE', `/api/payroll/payments/${b.dataset.delPay}`).catch((err) => toast(err.message, true));
        reload();
      })
    );
  };

  $('#tp-month').addEventListener('change', load);
  await Promise.all([load(), loadYear()]);
}

// ---------- تسجيل الأولياء (رابط عمومي) ----------
async function viewRegister(el) {
  const meta = await api('GET', '/api/public/meta');
  const levelOpts = meta.levels.map((l) => `<option value="${esc(l.code)}">${esc(l.label)}</option>`).join('');
  let n = 0;
  const childBlock = () => {
    const k = n++;
    return `<fieldset class="child-block" data-k="${k}">
      <legend>الابن ${k + 1}</legend>
      ${k ? '<button type="button" class="link danger remove-child">حذف</button>' : ''}
      <label>الاسم واللقب<input name="c${k}_full_name" required></label>
      <div class="row">
        <label>المستوى<select name="c${k}_level" class="c-level">${levelOpts}</select></label>
        <label>تاريخ الولادة<input type="date" name="c${k}_birth_date"></label>
      </div>
      <label>المؤسسة التربوية التي يدرس فيها<input name="c${k}_school"></label>
      <label class="check pack"><input type="checkbox" name="c${k}_pack" class="c-pack"> <b>Pack</b> — كل المواد</label>
      <div class="checks c-subjects"></div>
      <label>ملاحظات<input name="c${k}_remarks"></label>
    </fieldset>`;
  };
  const syncChild = (fs) => {
    const level = fs.querySelector('.c-level').value;
    const k = fs.dataset.k;
    const box = fs.querySelector('.c-subjects');
    const checked = new Set([...box.querySelectorAll('input:checked')].map((i) => i.value));
    box.innerHTML = meta.subjects
      .filter((x) => !x.levels || x.levels.includes(level))
      .map(
        (x) => `<label class="check"><input type="checkbox" name="c${k}_subject" value="${x.id}" ${checked.has(String(x.id)) ? 'checked' : ''}> ${esc(x.name)}</label>`
      )
      .join('');
    box.classList.toggle('disabled', fs.querySelector('.c-pack').checked);
  };

  el.innerHTML = `
    <div class="register">
      <div class="login-hero">
        <img src="feed-logo-white.png" alt="فيد">
        <span class="tag">تسجيل جديد</span>
        <h1>سجّل أبناءك في الدروس الخصوصية بـ <em>فيد</em></h1>
      </div>
      <form id="reg-form" class="card" novalidate>
        <h3>معطيات الولي</h3>
        <label>الاسم واللقب<input name="p_full_name" required></label>
        <div class="row">
          <label>رقم بطاقة التعريف الوطنية<input name="p_cin" required dir="ltr" inputmode="numeric" maxlength="12"></label>
          <label>الهاتف<input name="p_phone" required dir="ltr" inputmode="tel" placeholder="22 123 456"></label>
        </div>
        <div class="row">
          <label>البريد الإلكتروني (اختياري)<input name="p_email" type="email" dir="ltr"></label>
          <label>العنوان<input name="p_address"></label>
        </div>
        <div class="row">
          <label>كلمة السر (6 أحرف على الأقل)<input name="p_password" type="password" required minlength="6"></label>
          <label>تأكيد كلمة السر<input name="p_password2" type="password" required></label>
        </div>
        <input name="website" class="hp" tabindex="-1" autocomplete="off">
        <h3>الأبناء</h3>
        <div id="children">${childBlock()}</div>
        <button type="button" class="btn ghost" id="add-child">+ ابن آخر</button>
        <p class="error" id="reg-error" hidden></p>
        <button class="btn block" id="reg-submit">إرسال التسجيل والدخول</button>
        <p class="muted small center">بعد التسجيل تدخل مباشرة بحسابك (اسم المستخدم: رقم الهاتف أو رقم بطاقة التعريف). الإدارة تؤكد التسجيل وتحدد المبلغ الشهري.</p>
        <p class="center"><a href="#/login">عندي حساب، الدخول</a></p>
      </form>
    </div>`;

  const children = $('#children');
  const bind = (fs) => {
    fs.querySelector('.c-level').addEventListener('change', () => syncChild(fs));
    fs.querySelector('.c-pack').addEventListener('change', () => syncChild(fs));
    fs.querySelector('.remove-child')?.addEventListener('click', () => fs.remove());
    syncChild(fs);
  };
  bind(children.querySelector('.child-block'));
  $('#add-child').addEventListener('click', () => {
    children.insertAdjacentHTML('beforeend', childBlock());
    bind(children.lastElementChild);
  });

  $('#reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#reg-error');
    const v = (name) => f.elements[name]?.value ?? '';
    try {
      if (v('p_password') !== v('p_password2')) throw new Error('كلمتا السر غير متطابقتين');
      const body = {
        website: v('website'),
        parent: {
          full_name: v('p_full_name'),
          cin: v('p_cin'),
          phone: v('p_phone'),
          email: v('p_email'),
          address: v('p_address'),
          password: v('p_password'),
        },
        children: [...children.querySelectorAll('.child-block')].map((fs) => {
          const k = fs.dataset.k;
          return {
            full_name: v(`c${k}_full_name`),
            level: v(`c${k}_level`),
            birth_date: v(`c${k}_birth_date`),
            school: v(`c${k}_school`),
            remarks: v(`c${k}_remarks`),
            pack: fs.querySelector('.c-pack').checked,
            subject_ids: [...fs.querySelectorAll(`input[name=c${k}_subject]:checked`)].map((i) => Number(i.value)),
          };
        }),
      };
      $('#reg-submit').disabled = true;
      const { user } = await api('POST', '/api/register', body);
      state.user = user;
      state.meta = await api('GET', '/api/meta');
      toast('تم التسجيل، مرحبًا بك!');
      location.hash = '#/home';
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      $('#reg-submit').disabled = false;
    }
  });
}

// ---------- حسابي ----------
function viewAccount(el) {
  const u = state.user;
  el.innerHTML = `
    <h2>حسابي</h2>
    <div class="card narrow">
      <p><b>${esc(u.full_name)}</b> · ${ROLE_LABELS[u.role]}</p>
      <p class="muted" dir="ltr">${esc(u.username)}</p>
      ${u.subjects?.length ? `<p>المواد: ${u.subjects.map((s) => `<span class="pill">${esc(s.name)}</span>`).join(' ')}</p>` : ''}
      <h3>تغيير كلمة السر</h3>
      <form id="pw-form">
        <label>كلمة السر الحالية<input name="current" type="password" required></label>
        <label>كلمة السر الجديدة<input name="next" type="password" minlength="6" required></label>
        <button class="btn">تغيير</button>
      </form>
    </div>`;
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/me/password', formData(e.target));
      e.target.reset();
      toast('تم تغيير كلمة السر');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- منتقي الشهر: بالعربية وبشكل التصميم الجديد (يعوّض input type=month للمتصفح) ----------
// الحقل الأصلي يبقى (مخفيًا) بنفس id وname، فكل الشيفرة القديمة تقرأ .value وتسمع change كما هي
const ym = (v) => (/^\d{4}-\d{2}$/.test(v || '') ? v : today().slice(0, 7));
const shiftMonth = (v, n) => {
  const [y, m] = ym(v).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const chev = (dir) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir === 'right' ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'}"/></svg>`;
function enhanceMonthInput(input) {
  if (input.dataset.mp) return;
  input.dataset.mp = '1';
  input.type = 'hidden';
  const box = document.createElement('div');
  box.className = 'mpick';
  box.innerHTML = `<button type="button" class="mp-step" data-step="-1" aria-label="الشهر السابق">${chev('right')}</button>
    <button type="button" class="mp-label"></button>
    <button type="button" class="mp-step" data-step="1" aria-label="الشهر الموالي">${chev('left')}</button>
    <div class="mp-pop" hidden></div>`;
  input.after(box);
  const label = box.querySelector('.mp-label');
  const pop = box.querySelector('.mp-pop');
  let year;
  const sync = () => (label.textContent = monthLabel(ym(input.value)));
  const set = (v) => {
    input.value = v;
    sync();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const drawPop = () => {
    const cur = ym(input.value);
    pop.innerHTML = `<div class="mp-year"><button type="button" data-y="-1">${chev('right')}</button><b>${year}</b><button type="button" data-y="1">${chev('left')}</button></div>
      <div class="mp-grid">${MONTHS_AR.map((n, i) => {
        const v = `${year}-${String(i + 1).padStart(2, '0')}`;
        return `<button type="button" data-v="${v}" class="${v === cur ? 'on' : ''}${v === today().slice(0, 7) ? ' now' : ''}">${n}</button>`;
      }).join('')}</div>`;
  };
  box.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.step) return set(shiftMonth(input.value, Number(b.dataset.step)));
    if (b.classList.contains('mp-label')) {
      year = Number(ym(input.value).slice(0, 4));
      drawPop();
      document.querySelectorAll('.mp-pop').forEach((p) => p !== pop && (p.hidden = true));
      pop.hidden = !pop.hidden;
      document.body.appendChild(pop);
      // فوق كل شيء (حتى داخل اللافتة أو النافذة)
      const r = box.getBoundingClientRect();
      pop.style.top = `${Math.min(r.bottom + 6, innerHeight - 250)}px`;
      pop.style.left = `${Math.max(8, Math.min(r.right - 268, innerWidth - 276))}px`;
      return;
    }
    if (b.dataset.y) return (year += Number(b.dataset.y)), drawPop();
    if (b.dataset.v) {
      pop.hidden = true;
      set(b.dataset.v);
    }
  });
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.y) return (year += Number(b.dataset.y)), drawPop();
    if (b.dataset.v) {
      pop.hidden = true;
      set(b.dataset.v);
    }
  });
  // الصفحة تتبدّل: نحذف القائمة المعلّقة في body
  new MutationObserver(() => !box.isConnected && pop.remove()).observe(document.body, { childList: true, subtree: true });
  // تغيير القيمة من الشيفرة (مثلًا النقر على شهر في جدول السنة)
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); sync(); },
  });
  sync();
}
document.addEventListener('click', () => document.querySelectorAll('.mp-pop').forEach((p) => (p.hidden = true)));
new MutationObserver(() => document.querySelectorAll('input[type=month]').forEach(enhanceMonthInput)).observe(document.body, {
  childList: true,
  subtree: true,
});

// ---------- القوائم المنسدلة: بدل قائمة الهاتف الخام، قائمة بتصميم التطبيقة ----------
// الـ select الأصلي يبقى (يعرض القيمة ويُرسَل مع النموذج)، وفوقه زر شفاف يفتح قائمتنا:
// في الحاسوب قائمة تحت الخانة، وفي الهاتف لوحة من الأسفل.
const isPhone = () => matchMedia('(max-width: 640px)').matches;
function closeSelectPop() {
  document.querySelectorAll('.sel-pop, .sel-bg').forEach((x) => x.remove());
  document.body.classList.remove('sel-open');
}
function selectTitle(select) {
  const label = select.closest('label');
  const t = label ? [...label.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim() : '';
  return t || select.getAttribute('aria-label') || select.title || 'اختر';
}
function openSelectPop(select) {
  closeSelectPop();
  if (select.disabled) return;
  const host = select.closest('dialog[open]') || document.body;
  const phone = isPhone();
  const items = [];
  const optRow = (o) =>
    `<button type="button" class="sel-opt ${o.selected ? 'on' : ''}" data-i="${o.index}" ${o.disabled ? 'disabled' : ''}>
      <span>${esc(o.textContent.trim())}</span>${o.selected ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>' : ''}</button>`;
  for (const node of select.children) {
    if (node.tagName === 'OPTGROUP') items.push(`<div class="sel-group">${esc(node.label)}</div>`, ...[...node.children].map(optRow));
    else if (node.tagName === 'OPTION') items.push(optRow(node));
  }
  const many = select.options.length > 9;
  const pop = document.createElement('div');
  pop.className = `sel-pop ${phone ? 'sheet' : 'drop'}`;
  pop.dataset.for = select.dataset.sel;
  pop.setAttribute('role', 'listbox');
  pop.innerHTML = `${phone ? `<div class="sel-grip"></div><div class="sel-title">${esc(selectTitle(select))}</div>` : ''}
    ${many ? '<input class="sel-search" type="search" placeholder="بحث…" autocomplete="off">' : ''}
    <div class="sel-list">${items.join('')}</div>`;
  if (phone) {
    const bg = document.createElement('div');
    bg.className = 'sel-bg';
    bg.addEventListener('click', closeSelectPop);
    host.appendChild(bg);
    document.body.classList.add('sel-open');
  }
  host.appendChild(pop);
  if (!phone) {
    const r = select.getBoundingClientRect();
    const w = Math.max(r.width, 220);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    const below = innerHeight - r.bottom - 12;
    if (below < 220 && r.top > below) pop.style.bottom = `${innerHeight - r.top + 6}px`, (pop.style.maxHeight = `${Math.min(340, r.top - 16)}px`);
    else pop.style.top = `${r.bottom + 6}px`, (pop.style.maxHeight = `${Math.min(340, below)}px`);
  }
  pop.querySelector('.sel-opt.on')?.scrollIntoView({ block: 'center' });
  const search = pop.querySelector('.sel-search');
  if (search) {
    if (!phone) search.focus();
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      pop.querySelectorAll('.sel-opt').forEach((b) => (b.hidden = q && !b.textContent.toLowerCase().includes(q)));
      pop.querySelectorAll('.sel-group').forEach((g) => (g.hidden = !!q));
    });
  }
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('.sel-opt');
    if (!b || b.disabled) return;
    const i = Number(b.dataset.i);
    closeSelectPop();
    if (select.selectedIndex !== i) {
      select.selectedIndex = i;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    select.focus({ preventScroll: true });
  });
}
enhanceSelect.n = 0;
function enhanceSelect(select) {
  if (select.dataset.sel || select.multiple || select.size > 1 || select.hasAttribute('data-native')) return;
  select.dataset.sel = String(++enhanceSelect.n);
  const wrap = document.createElement('span');
  wrap.className = 'sel-wrap';
  select.before(wrap);
  const hit = document.createElement('button');
  hit.type = 'button';
  hit.className = 'sel-hit';
  hit.tabIndex = -1;
  hit.setAttribute('aria-hidden', 'true');
  wrap.append(select, hit);
  hit.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (document.querySelector('.sel-pop')?.dataset.for === select.dataset.sel) return closeSelectPop();
    openSelectPop(select);
  });
  select.addEventListener('keydown', (e) => {
    if ([' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(e.key) && !e.altKey) {
      e.preventDefault();
      openSelectPop(select);
    }
  });
}
document.addEventListener('click', (e) => !e.target.closest('.sel-pop') && closeSelectPop());
document.addEventListener('keydown', (e) => e.key === 'Escape' && document.querySelector('.sel-pop') && (e.preventDefault(), closeSelectPop()));
addEventListener('resize', () => !isPhone() && closeSelectPop());
document.addEventListener('scroll', (e) => !e.target.closest?.('.sel-pop') && !isPhone() && closeSelectPop(), true);
new MutationObserver(() => document.querySelectorAll('select:not([data-sel])').forEach(enhanceSelect)).observe(document.body, { childList: true, subtree: true });

// ---------- الجداول في الهاتف: كل سطر يصبح بطاقة، وكل خانة تحمل اسم عمودها ----------
function labelTable(table) {
  if (table.dataset.labeled) return;
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  if (!heads.length) return;
  table.dataset.labeled = '1';
  table.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
    let col = 0;
    [...tr.children].forEach((td) => {
      if (!td.hasAttribute('data-label')) td.setAttribute('data-label', heads[col] || '');
      col += Number(td.getAttribute('colspan')) || 1;
    });
  });
}
new MutationObserver(() => document.querySelectorAll('.table-wrap table:not([data-labeled])').forEach(labelTable)).observe(document.body, {
  childList: true,
  subtree: true,
});
