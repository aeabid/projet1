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
const PAYMENT_LABELS = { cash: 'نقدًا', bank: 'بنك الشركة', transfer: 'تحويل بنكي', cheque: 'صك', d17: 'D17', other: 'أخرى' };

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

// الرابط الرسمي للمنصّة: كل رابط يُرسَل للأولياء والمدرّسين يكون بهذا العنوان
const PUBLIC_URL = 'https://education.feed.tn';

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
    .replaceAll('{الرابط}', PUBLIC_URL);
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
  // خطأ تقني من صفحة غادرها المستخدم قبل اكتمال تحميلها (العنصر لم يعد موجودًا): لا يُعرض
  if (isError && /properties of (null|undefined)/.test(String(message))) return console.warn('stale page update:', message);
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
  $('#modal-form button[type=submit]').hidden = false;
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

// اسم قصير للقسم (في الشارات): «السادسة أساسي (عن بعد)» ← «6 عن بعد»
const LEVEL_SHORT = { 5: '5', 6: '6', '6-distance': '6 عن بعد', 7: '7', 8: '8', 9: '9' };
const levelShort = (code) => LEVEL_SHORT[code] || levelLabel(code).replace(/\s*أساسي\s*/, ' ').trim();

// ---------- الأقسام (المستويات): إضافة، تعديل، ترتيب، حذف ----------
async function viewLevels(el) {
  const { levels } = await api('GET', '/api/levels');
  let list = levels.map((l) => ({ ...l }));
  const render = () => {
    el.innerHTML = `
      <div class="page-head"><div><h2>🏫 الأقسام</h2>
        <p class="muted small">مستويات دروس الدعم: تظهر في التلاميذ، المواد، جداول الأوقات واستمارة المدرّسين. قسم فيه تلاميذ لا يُحذف.</p></div>
        <button class="btn" id="lv-add">+ قسم</button></div>
      <ul class="lv-list">${list
        .map(
          (l, i) => `<li data-i="${i}">
            <span class="lv-badge" style="--lv:${levelHue(l.code)}">${esc(levelShort(l.code) || '؟')}</span>
            <label class="lv-name">اسم القسم<input data-f="label" value="${esc(l.label)}" placeholder="مثال: الأولى ثانوي"></label>
            <label class="lv-code">الرمز<input data-f="code" value="${esc(l.code)}" dir="ltr" ${l.students !== undefined && l.saved !== false ? 'readonly' : ''} placeholder="مثال: 1s"></label>
            <span class="lv-count">${l.students ? `👥 ${l.students}` : '<span class="muted small">فارغ</span>'}</span>
            <span class="lv-acts">
              <button type="button" class="icon-btn" data-up="${i}" ${i ? '' : 'disabled'} title="فوق">▲</button>
              <button type="button" class="icon-btn" data-down="${i}" ${i < list.length - 1 ? '' : 'disabled'} title="لوطة">▼</button>
              <button type="button" class="icon-btn danger" data-del="${i}" ${l.students ? 'disabled title="فيه تلاميذ"' : 'title="حذف"'}>✕</button>
            </span>
          </li>`
        )
        .join('')}</ul>
      <div class="perm-foot sticky"><button class="btn" id="lv-save">💾 حفظ الأقسام</button><span class="muted small">الرمز ما يتبدّلش بعد الحفظ (مربوط بالتلاميذ والحصص)، أما الاسم والترتيب يتبدّلو وقت ما تحب.</span></div>`;
    const read = () => el.querySelectorAll('.lv-list li').forEach((li) => {
      const l = list[Number(li.dataset.i)];
      li.querySelectorAll('[data-f]').forEach((x) => (l[x.dataset.f] = x.value.trim()));
    });
    const move = (i, d) => { read(); [list[i], list[i + d]] = [list[i + d], list[i]]; render(); };
    el.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.up), -1)));
    el.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.down), 1)));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      read();
      const l = list[Number(b.dataset.del)];
      if (!confirmAction(`حذف قسم «${l.label}»؟`)) return;
      list.splice(Number(b.dataset.del), 1);
      render();
    }));
    $('#lv-add').addEventListener('click', () => {
      read();
      list.push({ code: '', label: '', saved: false });
      render();
      el.querySelector('.lv-list li:last-child input[data-f=label]').focus();
    });
    $('#lv-save').addEventListener('click', async () => {
      read();
      try {
        await api('PUT', '/api/levels', { levels: list.map(({ code, label }) => ({ code, label })) });
        state.meta = await api('GET', '/api/meta');
        toast('تم حفظ الأقسام');
        viewLevels(el);
      } catch (err) {
        toast(err.message, true);
      }
    });
  };
  render();
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
  [/^#\/parents\/(\d+)$/, (el, id) => viewParent(el, Number(id))],
  [/^#\/admins$/, (el) => viewUsers(el, 'admin')],
  [/^#\/subjects$/, viewSubjects],
  [/^#\/import$/, viewImport],
  [/^#\/photos$/, (el) => viewBulkPhotos(el)],
  [/^#\/general$/, (el) => viewGeneralExpenses(el)],
  [/^#\/google-link$/, (el) => viewGoogleLink(el)],
  [/^#\/parent-requests$/, (el) => viewParentRequests(el)],
  [/^#\/register$/, viewRegister],
  [/^#\/attendance$/, viewAttendance],
  [/^#\/levels$/, (el) => viewLevels(el)],
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
  [/^#\/support\/teachers\/timetable$/, (el) => viewTimetable(el, 'teacher')],
  [/^#\/support\/teachers\/absences$/, (el) => viewTeacherAbsences(el)],
  [/^#\/group-message$/, (el) => viewGroupMessage(el)],
  [/^#\/partners$/, (el) => viewPartners(el)],
  [/^#\/salaries$/, (el) => viewSalaries(el)],
  [/^#\/board(?:\/(cash|month|absences|notices))?$/, (el, tab) => viewBoardHub(el, tab || '')],
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
  [/^#\/my-receipts$/, (el) => viewMyReceipts(el)],
  [/^#\/permissions$/, (el) => viewPermissions(el)],
  [/^#\/accounting$/, (el) => viewAccounting(el)],
  [/^#\/cash$/, (el) => viewCash(el)],
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
  // إداري بلا إحصائيات ولا تلاميذ (مثلًا المحاسبة): يبدأ من فضاء المحاسبة
  if (user?.role === 'admin' && !user.super_admin && !user.perms?.stats && !user.perms?.school && user.perms?.accounting) return '#/accounting';
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
  // ولي سجّل أبناءه بالرابط: المنصة تفتح، لكن لا يرى شيئًا حتى تفعّل الإدارة التسجيل
  if (state.user?.role === 'parent' && state.user.waiting && !['#/account', '#/password'].includes(hash)) {
    viewWaiting($('#view'));
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
        if (nav === navCount) {
          // خطأ برمجي: نُظهر مكانه (سطر صغير) لتسهيل إصلاحه
          const where = err instanceof TypeError || err instanceof ReferenceError ? (err.stack || '').split('\n').find((l) => /\.js:\d+/.test(l)) || '' : '';
          el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p>${
            where ? `<p class="muted small" dir="ltr">${esc(where.trim().replace(location.origin + '/', ''))} · ${esc(hash)}</p>` : ''
          }<p><button class="btn small ghost" onclick="location.reload()">إعادة تحميل الصفحة</button></p></div>`;
        }
      }
      return;
    }
  }
  location.hash = state.user ? homeFor(state.user) : '#/login';
}

// ---------- الصلاحيات: الإداري يرى ما سُمح له به فقط (المشرف العام يرى كل شيء) ----------
const can = (perm) => !state.user || state.user.role !== 'admin' || state.user.super_admin || !!state.user.perms?.[perm];
const HASH_PERM = {
  '#/board': 'stats', '#/finance': 'stats', '#/general': 'stats', '#/dashboard': 'school', '#/program/board': 'school',
  '#/payroll': 'salaries', '#/program/pay': 'salaries', '#/salaries': 'salaries', '#/staff': 'salaries',
  '#/fees': 'fees', '#/accounting': 'accounting', '#/cash': 'cash', '#/ledger': 'expenses',
  '#/partners': 'partners', '#/permissions': 'super', '#/admins': 'super', '#/center-debts': 'expenses',
  '#/people': 'school', '#/parents': 'school', '#/parent-requests': 'school', '#/students': 'school', '#/program': 'school',
  '#/attendance': 'school', '#/messages': 'school', '#/broadcast': 'school', '#/whatsapp': 'school', '#/courses': 'school',
  '#/support/teachers': 'accounts', '#/program/staff': 'accounts', '#/debts': 'school',
  '#/levels': 'school', '#/receipts': 'school', '#/products': 'school', '#/todo': 'school', '#/meetings': 'school', '#/alerts': 'school',
};
const GROUP_PERM = { 'دروس الدعم': 'school', 'البرنامج التربوي': 'school', 'التواصل': 'school', 'إدارة المركز': 'school' };
const navAllowed = (h) => {
  const p = HASH_PERM[h];
  if (!p || state.user?.role !== 'admin') return true;
  return p === 'super' ? !!state.user.super_admin : can(p);
};
// عناوين فرعية بلا عناصر تحتها تُحذف
const tidyItems = (items) => items.filter(([h], i) => h || (items[i + 1] && items[i + 1][0]));

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
        ['#/levels', 'الأقسام'],
        ['#/subjects', 'المواد'],
        ['', 'المدرّسون'],
        ['#/support/teachers', 'قائمة المدرّسين'],
        ['#/support/teachers/timetable', 'جداول أوقات المدرّسين'],
        ['#/support/teachers/absences', 'غيابات المدرّسين'],
        ['#/payroll', 'رواتب مدرّسي الدعم'],
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
      ],
    },
    {
      label: 'المالية والمحاسبة',
      items: [
        ['', 'اليومي'],
        ['#/cash', 'الصندوق اليومي'],
        ['#/ledger', 'المداخيل والمصاريف'],
        ['#/receipts', 'الوصولات'],
        ['', 'المستحقات'],
        ['#/debts', 'المتخلّد بذمّة الأولياء'],
        ['#/salaries', 'الأجور'],
        ['#/center-debts', 'ديون المركز'],
        ['', 'الأسعار'],
        ['#/fees', 'التعريفات والتخفيضات'],
        ['#/products', 'المنتجات'],
        ['', 'المحاسبة'],
        ['#/accounting', 'فضاء المحاسبة'],
        ['#/finance', 'المردودية المالية'],
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
        ['#/permissions', 'الصلاحيات'],
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
    ['#/my-receipts', 'وصولاتي'],
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
const GROUP_ICONS = { 'دروس الدعم': 'book', 'البرنامج التربوي': 'spark', 'إدارة المركز': 'building', 'المالية والمحاسبة': 'wallet', 'التواصل': 'chat', 'الحسابات': 'users' };
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
  // وضع التجربة: شريط في الأعلى للرجوع إلى حساب المدير
  let ib = $('#imp-bar');
  if (state.user?.impersonated_by) {
    if (!ib) {
      ib = document.createElement('div');
      ib.id = 'imp-bar';
      document.body.prepend(ib);
    }
    ib.innerHTML = `<span>👁 أنت تشاهد التطبيقة كـ <b>${esc(state.user.full_name)}</b> (${esc(state.user.role_label || '')}) — للاطّلاع فقط</span><button type="button" class="btn small" id="imp-stop">↩ رجوع إلى حسابي</button>`;
    document.body.classList.add('impersonating');
    $('#imp-stop').onclick = async () => {
      await api('POST', '/api/impersonate/stop').catch((e) => toast(e.message, true));
      location.hash = '#/home';
      location.reload();
    };
  } else if (ib) {
    ib.remove();
    document.body.classList.remove('impersonating');
  }
  document.body.classList.toggle('read-only', !!(state.user?.role === 'admin' && !state.user.super_admin && state.user.perms?.read_only));
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
    .map((e) => (Array.isArray(e) ? e : { ...e, items: tidyItems(e.items.filter(([h]) => !h || navAllowed(h))) }))
    .filter((e) => (Array.isArray(e) ? navAllowed(e[0]) && !(e[0] === '#/courses' && !can('school')) : e.items.length && !(GROUP_PERM[e.label] && !can(GROUP_PERM[e.label]))));
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
  $('#who-name').textContent = `${state.user.full_name} · ${state.user.role_label || ROLE_LABELS[state.user.role]}`;

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
     <div class="vmenu-user"><span class="avatar sm">${initial}</span><div><b>${esc(state.user.full_name)}</b><small>${esc(state.user.role_label || ROLE_LABELS[state.user.role])}</small></div>
       <button class="side-out" id="side-logout" title="خروج">${icon('logout')}</button></div>`;
  $('#side-logout').addEventListener('click', () => $('#logout').click());
  // شريط التنقل السفلي (الهاتف)
  const tabs = (TABS[navKey] || TABS.parent).filter(([h]) => navAllowed(h));
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
  $('#mail').hidden = state.user.role === 'admin' && !can('school');
  $('#bell').hidden = state.user.role !== 'admin' || !can('school');
  if (state.user.role === 'admin' && can('school')) refreshBell();
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
    ${
      s.finance?.today && can('school')
        ? `<section class="cash-today sup-today">
            <div class="ct-head"><b>💰 دروس الدعم · اليوم ${fmtDate(today())}</b><a class="link small" href="#/students" id="sup-owed">المتخلّد بذمتهم ←</a></div>
            <div class="ct-grid">
              <div class="bal"><small>المتخلّد بالذمّة</small><b>${fmtMoney(s.finance.outstanding)}</b><i>${s.finance.unpaid_count} تلميذ لم يدفع بعد</i></div>
              <div class="in"><small>المدخول اليوم</small><b>${fmtMoney(s.finance.today.income)}</b><i>${s.finance.today.payments} دفعة</i></div>
              <div class="out"><small>المصاريف اليوم</small><b>${fmtMoney(s.finance.today.expense)}</b><i>رواتب المدرّسين ومصاريف الدعم</i></div>
              <div class="${s.finance.today.income - s.finance.today.expense >= 0 ? 'in' : 'out'}"><small>الصافي اليوم</small><b>${fmtMoney(Math.round((s.finance.today.income - s.finance.today.expense) * 1000) / 1000)}</b></div>
            </div></section>`
        : ''
    }
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
      <code dir="ltr" id="reg-link">${PUBLIC_URL}/#/register</code>
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
  $('#sup-owed')?.addEventListener('click', () => {
    sessionStorage.setItem('payFilter', 'due');
    sessionStorage.setItem('statusFilter', '');
  });
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
// زر الخلاص في القوائم: لونه يقول الحالة (أخضر خالص، وردي باقي، رمادي مجاني أو بلا معلوم)
function payButton(kind, x) {
  const n = (v) => fmtMoney(v).replace(/\s*د\.ت$/, '');
  const [cls, top, sub] = x.free
    ? ['free', 'مجاني', 'معفى']
    : x.balance > 0
    ? ['due', n(x.balance), 'باقي · د.ت']
    : x.monthly_fee
    ? ['ok', 'خالص', x.balance < 0 ? `رصيد +${n(-x.balance)}` : 'مدفوع']
    : ['none', '—', 'بلا معلوم'];
  const ico = cls === 'ok' ? '<path d="M20 6 9 17l-5-5"/>' : '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14.5h2"/>';
  return `<button type="button" class="pay-btn ${cls}" data-pay="${kind}:${x.id}" title="الخلاص"><span class="pb-ico"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ico}</svg></span><span class="pb-txt"><b>${top}</b><i>${sub}</i></span></button>`;
}
function bindPayButtons(root, reload) {
  root.querySelectorAll('[data-pay]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const [kind, id] = b.dataset.pay.split(':');
      paySheet(kind, Number(id), reload).catch((err) => toast(err.message, true));
    })
  );
}

// خانة الولي في الجداول (الدعم والتربوي): الاسم (رابط لملفه) ثم الهاتف وواتساب
function parentCell(name, phone, parentId, admin = true) {
  const n = name ? (admin && parentId ? `<a href="#/parents/${parentId}">${esc(name)}</a>` : esc(name)) : '—';
  // رقمان أو أكثر («99664944 / 94480056»): كل رقم في سطر، مصفوف تحت الاسم كبقية الأرقام
  const tels = String(phone || '').split(/\s*[\/,;]\s*|\s+-\s+/).map((t) => t.trim()).filter(Boolean);
  return `${n}${tels.map((t) => `<div class="muted small phone-line"><span dir="ltr">${esc(t)}</span>${admin ? waButton(t) : ''}</div>`).join('')}`;
}

// فلتر الخلاص في القوائم: الكل، لم يدفع بعد (باقي عليه)، خالص
function payFilterSelect(id) {
  const v = sessionStorage.getItem('payFilter') || '';
  return `<select id="${id}" aria-label="الخلاص">${[['', 'كل الخلاص'], ['due', 'لم يدفع بعد'], ['ok', 'خالص']]
    .map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`)
    .join('')}</select>`;
}
function applyPayFilter(list, f) {
  if (f === 'due') return list.filter((x) => !x.free && x.balance > 0).sort((a, b) => b.balance - a.balance);
  if (f === 'ok') return list.filter((x) => x.free || (x.monthly_fee && x.balance <= 0));
  return list;
}
function payFilterSummary(list, f) {
  if (f !== 'due') return '';
  const total = list.reduce((t, x) => t + x.balance, 0);
  return `<div class="pf-sum"><span>💰 <b>${list.length}</b> لم يدفعو بعد</span><span>المجموع الباقي: <b>${fmtMoney(total)}</b></span></div>`;
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
          <div><b>${esc(s.parent_name || 'بدون ولي')}</b>${String(s.parent_phone || '').split(/\s*[\/,;]\s*/).filter(Boolean).map((t) => `<span dir="ltr" class="muted small">${esc(t)}</span>`).join('')}</div>
          ${admin && s.parent_phone ? waButton(s.parent_phone) : ''}
        </div>
        <div class="sc-stats">
          <div class="sc-stat"><b>${s.absence_count}</b><span>غيابات</span></div>
          <div class="sc-stat"><b>${s.note_count}</b><span>ملاحظات</span></div>
        </div>
        ${admin ? `<div class="sc-actions"><a class="btn ghost small" href="#/students/${s.id}">الملف</a>${payButton('support', s)}</div>` : ''}
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
    ${role === 'admin' ? '<div class="stats compact" id="sup-stats"></div>' : ''}
    <div class="filters">
      <select id="f-level" aria-label="المستوى">${levelOptions(level, true)}</select>
      ${
        role === 'admin'
          ? `<select id="f-status" aria-label="الحالة"><option value="">كل الحالات</option>${Object.entries(STATUS_LABELS)
              .map(([k, v]) => `<option value="${k}" ${(sessionStorage.getItem('statusFilter') ?? 'studying') === k ? 'selected' : ''}>${v}</option>`)
              .join('')}</select>`
          : ''
      }
      ${role === 'admin' ? payFilterSelect('f-pay') : ''}
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
    if (!$('#students-list')) return; // الصفحة تبدّلت قبل اكتمال التحميل
    const students = applyPayFilter(current, $('#f-pay')?.value);
    rememberList('support', students);
    $('#students-list').innerHTML = payFilterSummary(students, $('#f-pay')?.value) + (!students.length
      ? '<div class="card muted">لا يوجد تلاميذ.</div>'
      : view === 'cards'
      ? studentCards(students, role)
      : `<div class="table-wrap as-table"><table>
          <thead><tr><th>الاسم</th><th>المستوى</th><th>تاريخ الدخول</th><th>المواد</th><th>الولي</th><th>الغيابات</th><th>الملاحظات</th>${
            role === 'admin' ? '<th>الخلاص</th>' : ''
          }</tr></thead>
          <tbody>${students
            .map(
              (s) => `<tr>
                <td><a class="who-cell" href="#/students/${s.id}">${avatar(s, 'sm')}<b>${esc(s.full_name)}</b></a>
                  ${s.status !== 'studying' ? statusBadge(s.status) : ''}</td>
                <td><span class="pill">${esc(levelLabel(s.level))}</span></td>
                <td class="nowrap">${s.start_date ? fmtDate(s.start_date) : '<span class="muted">—</span>'}</td>
                <td>${subjectsCell(s)}</td>
                <td>${parentCell(s.parent_name, s.parent_phone, s.parent_id, role === 'admin')}</td>
                <td>${s.absence_count}</td>
                <td>${s.note_count}</td>
                ${role === 'admin' ? `<td>${payButton('support', s)}</td>` : ''}
              </tr>`
            )
            .join('')}</tbody></table></div>`);

    bindPayButtons($('#students-list'), load);
  };

  bindViewToggle(el, 'studentsView', () => view, (v) => (view = v), render);
  $('#f-level').addEventListener('change', load);
  $('#f-status')?.addEventListener('change', load);
  $('#f-pay')?.addEventListener('change', () => (sessionStorage.setItem('payFilter', $('#f-pay').value), render()));
  let timer;
  $('#f-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });
  $('#add-student')?.addEventListener('click', () => studentForm(null, load));
  if (role === 'admin') loadSupportStats();
  await load();
}

// إحصائيات صغيرة فوق قائمة الدعم (مثل البرنامج التربوي) — على كل التلاميذ الذين يدرسون
async function loadSupportStats() {
  const { students } = await api('GET', '/api/students?status=studying').catch(() => ({ students: null }));
  const box = $('#sup-stats');
  if (!box || !students) return;
  const levels = new Set(students.map((s) => s.level)).size;
  const expected = students.filter((s) => !s.free).reduce((t, s) => t + (s.monthly_fee || 0), 0);
  const due = students.filter((s) => !s.free && s.balance > 0);
  const owed = due.reduce((t, s) => t + s.balance, 0);
  box.innerHTML = `
    <div class="stat"><b>${students.length}</b><span>تلميذ يدرس</span></div>
    <div class="stat"><b>${levels}</b><span>مستويات</span></div>
    <div class="stat good"><b>${fmtMoney(expected)}</b><span>المنتظر شهريًا</span></div>
    <div class="stat warn"><b>${fmtMoney(owed)}</b><span>مبالغ غير مدفوعة · ${due.length} تلميذ</span></div>`;
}

// السعر حسب التسعيرة: عدد حصص المواد المختارة في الأسبوع، أو الباقة
function suggestFee(level, pack, subjectIds, meta = state.meta) {
  const pr = meta.pricing;
  const packFee = Number(meta.pack_fees?.[level]) || null;
  if (!pr) return null;
  if (pack) return packFee ? { fee: packFee, label: 'الباقة' } : null;
  const subs = meta.subjects.filter((s) => subjectIds.includes(s.id) && (!s.levels || s.levels.includes(level)));
  if (!subs.length) return null;
  const n = subs.reduce((t, s) => t + (Number(pr.units?.[s.id]) || 1), 0);
  const step = n >= 5 ? packFee : Number(pr.steps?.[String(n)]) || null;
  const fee = packFee && step ? Math.min(step, packFee) : step || packFee;
  return fee ? { fee, label: n >= 5 || fee === packFee ? `${n} حصص = الباقة` : `${n === 1 ? 'حصة' : n === 2 ? 'حصتان' : n + ' حصص'} في الأسبوع` } : null;
}

// تغيير المعلوم في الاستمارة: من أي شهر يُطبَّق (الأشهر قبله تبقى بمعلومها)
function feeFromField(startDate) {
  const cur = today().slice(0, 7);
  const first = (startDate || cur).slice(0, 7);
  const opts = [];
  for (let m = first; m <= shiftMonth(cur, 2); m = shiftMonth(m, 1)) opts.push(m);
  return `<div class="fee-from" id="fee-from" hidden>
    <label>المعلوم الجديد يُطبَّق ابتداءً من<select name="fee_from">${opts
      .map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${esc(monthLabel(m))}${m === cur ? ' (الشهر الحالي)' : ''}</option>`)
      .join('')}<option value="all">كل الأشهر (تصحيح خطأ)</option></select></label>
    <p class="muted small">الأشهر قبل هذا الشهر تبقى بمعلومها القديم.</p></div>`;
}
function bindFeeFrom(modal) {
  const box = modal.querySelector('#fee-from');
  if (!box) return;
  const ins = ['monthly_fee', 'discount'].map((n) => modal.querySelector(`input[name=${n}]`)).filter(Boolean);
  const init = ins.map((i) => i.value);
  const sync = () => (box.hidden = ins.every((i, k) => i.value === init[k]));
  ins.forEach((i) => i.addEventListener('input', sync));
  sync();
}

// اسم الولي في القوائم: الهاتف (أو اسم المستخدم) معزول من اليسار لليمين حتى لا ينقلب ترتيبه
function parentLabel(p) {
  const tel = (p.phone || p.username || '').split(/\s*[\/,;]\s*|\s+-\s+/)[0].replace(/^\+?216\s*/, '');
  return `${p.full_name}${tel ? ` · \u2066${tel}\u2069` : ''}`;
}

async function studentForm(student, onDone, preChild = null) {
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
  // تلميذ جديد: إمكانية أخذه مباشرة من أطفال البرنامج التربوي (غير المسجّلين في الدعم)
  const kids = student ? [] : await api('GET', '/api/program').then((r) => r.children.filter((c) => c.status === 'active' && !c.student_id)).catch(() => []);
  openModal(
    student ? 'تعديل تلميذ' : 'تلميذ جديد',
    `${kids.length ? `<label class="from-prog">🎨 من البرنامج التربوي (اختياري)<select name="from_child_id"><option value="">— تلميذ جديد تمامًا —</option>${kids
      .map((c) => `<option value="${c.id}">${esc(c.full_name)}${c.class_name ? ` — ${esc(c.class_name)}` : ''}</option>`)
      .join('')}</select><small class="muted">يعبّي الاسم وتاريخ الولادة والولي وحدو، ويربط الملفّين. معلوم التسجيل ما يتعاودش.</small></label>` : ''}
    <label>الاسم واللقب<input name="full_name" value="${esc(s.full_name)}" required></label>
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
     ${student ? feeFromField(s.start_date) : ''}
     <label class="check"><input type="checkbox" name="no_sibling" ${s.no_sibling ? 'checked' : ''}> بدون تخفيض الإخوة (يدفع المعلوم كاملًا حتى لو عندو إخوة)</label>
     <label>ملاحظات التسجيل<input name="remarks" value="${esc(s.remarks)}" placeholder="مثال: ما عدا الفرنسية"></label>
     <label>الولي
       <select name="parent_id">
         <option value="">— بدون —</option>
         ${parents.map((p) => `<option value="${p.id}" ${p.id === s.parent_id ? 'selected' : ''}>${esc(parentLabel(p))}</option>`).join('')}
       </select>
     </label>
     <details class="new-parent" id="np-box"><summary>+ ولي جديد (غير موجود في القائمة)</summary>
       <div class="row"><label>اسم الولي ولقبه<input id="np-name"></label>
         <label>الهاتف<input id="np-phone" inputmode="tel" placeholder="مثال: 98123456"></label></div>
       <p class="muted small">يُنشأ له حساب: اسم المستخدم وكلمة السر = رقم الهاتف (يبدّلها من بعد).</p>
       <button type="button" class="btn small" id="np-add">إضافة الولي واختياره</button>
     </details>`,
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
      feeInput.dispatchEvent(new Event('input'));
    });
  };
  levelSel.addEventListener('change', applyFee);
  pack.addEventListener('change', applyFee);
  feeInput.addEventListener('input', applyFee);
  $('#modal').querySelectorAll('input[name="subject_ids[]"]').forEach((x) => x.addEventListener('change', applyFee));
  applyFee();
  bindFeeFrom($('#modal'));
  // إضافة ولي جديد دون مغادرة الاستمارة
  $('#np-add').addEventListener('click', async () => {
    const full_name = $('#np-name').value.trim();
    const phone = $('#np-phone').value.replace(/\s+/g, '').replace(/^\+?216/, '');
    if (!full_name) return toast('اكتب اسم الولي', true);
    if (!/^\d{8}$/.test(phone)) return toast('اكتب رقم هاتف من 8 أرقام', true);
    try {
      const { user } = await api('POST', '/api/users', { role: 'parent', username: phone, full_name, phone, password: phone });
      state.parentsCache = null;
      const sel = $('#modal select[name=parent_id]');
      sel.insertAdjacentHTML('beforeend', `<option value="${user.id}">${esc(parentLabel(user))}</option>`);
      sel.value = String(user.id);
      $('#np-box').open = false;
      $('#np-name').value = $('#np-phone').value = '';
      toast(`أُضيف الولي ${full_name} واختير`);
    } catch (err) {
      toast(err.status === 409 || /مستعمل/.test(err.message) ? 'هذا الرقم عنده حساب: ابحث عنه في قائمة الأولياء' : err.message, true);
    }
  });
  $('#modal select[name=from_child_id]')?.addEventListener('change', (e) => {
    const c = kids.find((x) => x.id === Number(e.target.value));
    if (!c) return;
    const f = $('#modal');
    f.querySelector('input[name=full_name]').value = c.full_name;
    if (c.birth_date) f.querySelector('input[name=birth_date]').value = c.birth_date.slice(0, 10);
    const ps = f.querySelector('select[name=parent_id]');
    if (c.parent_id && ps.querySelector(`option[value="${c.parent_id}"]`)) ps.value = String(c.parent_id);
  });
  if (preChild && $('#modal select[name=from_child_id]')) {
    $('#modal select[name=from_child_id]').value = String(preChild);
    $('#modal select[name=from_child_id]').dispatchEvent(new Event('change'));
  }
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

// ---------- تبويبات الملف (التلميذ والطفل) ----------
function fileTabs(tabs) {
  const list = tabs.filter(Boolean);
  return `<div class="file-tabs" role="tablist">${list.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
}
// ---------- التنقّل بين الملفات (التلميذ السابق / التالي) حسب آخر قائمة معروضة ----------
function rememberList(key, items) {
  try {
    sessionStorage.setItem('navList:' + key, JSON.stringify(items.map((x) => [x.id, x.full_name])));
  } catch {}
}
async function fileNavList(key) {
  try {
    const l = JSON.parse(sessionStorage.getItem('navList:' + key) || 'null');
    if (Array.isArray(l) && l.length) return l;
  } catch {}
  // فتح الملف مباشرة: القائمة الافتراضية (يدرسون، حسب الاسم)
  const list =
    key === 'support'
      ? (await api('GET', '/api/students?status=studying').catch(() => ({ students: [] }))).students
      : (await api('GET', '/api/program').catch(() => ({ children: [] }))).children.filter((c) => c.status === 'active');
  rememberList(key, list);
  return list.map((x) => [x.id, x.full_name]);
}
// شريط ‹ السابق | 3 / 70 | التالي › ، ويُحفظ التبويب المفتوح عند الانتقال
async function mountFileNav(el, key, id, hrefOf) {
  const box = el.querySelector('#file-nav');
  if (!box) return;
  const list = await fileNavList(key);
  const i = list.findIndex(([x]) => x === Number(id));
  if (i < 0 || !box.isConnected) return (box.hidden = true);
  const prev = list[i - 1], next = list[i + 1];
  const go = (it) => {
    if (!it) return;
    const tab = el.querySelector('.file-tabs [data-tab].on')?.dataset.tab;
    if (tab) sessionStorage.setItem('fileTab:' + hrefOf(it[0]), tab);
    location.hash = hrefOf(it[0]);
  };
  box.innerHTML = `
    <button type="button" class="fn-btn" data-dir="-1" ${prev ? '' : 'disabled'} title="السابق">${navArrow('prev')}<span>${prev ? esc(prev[1]) : ''}</span></button>
    <span class="fn-pos" dir="ltr">${i + 1} / ${list.length}</span>
    <button type="button" class="fn-btn next" data-dir="1" ${next ? '' : 'disabled'} title="التالي"><span>${next ? esc(next[1]) : ''}</span>${navArrow('next')}</button>`;
  box.hidden = false;
  box.querySelector('[data-dir="-1"]').addEventListener('click', () => go(prev));
  box.querySelector('[data-dir="1"]').addEventListener('click', () => go(next));
  fileNavKeys = (dir) => go(dir < 0 ? prev : next);
  // سحب أفقي في الهاتف
  let sx = null, sy = 0;
  el.addEventListener('touchstart', (e) => ((sx = e.touches[0].clientX), (sy = e.touches[0].clientY)), { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sx === null || e.target.closest('.table-wrap, .kanban, .file-tabs, input, textarea')) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 90 && Math.abs(dy) < 50) go(dx > 0 ? next : prev); // RTL: السحب لليمين = التالي
  });
}
const navArrow = (d) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d === 'prev' ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'}"/></svg>`;
let fileNavKeys = null;
addEventListener('hashchange', () => (fileNavKeys = null));
document.addEventListener('keydown', (e) => {
  if (!fileNavKeys || !['ArrowLeft', 'ArrowRight'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]') || $('#modal').open) return;
  if (!$('#file-nav') || $('#file-nav').hidden) return;
  fileNavKeys(e.key === 'ArrowRight' ? -1 : 1); // RTL: اليمين = السابق
});

function bindFileTabs(el) {
  const tabs = [...el.querySelectorAll('[data-tab]')];
  const show = (k) => {
    if (!tabs.some((t) => t.dataset.tab === k)) k = tabs[0]?.dataset.tab;
    tabs.forEach((t) => t.classList.toggle('on', t.dataset.tab === k));
    el.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('on', p.dataset.panel === k));
    sessionStorage.setItem('fileTab:' + location.hash, k);
  };
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
  el.querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => {
      show(b.dataset.goto);
      el.querySelector('.file-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    })
  );
  show(sessionStorage.getItem('fileTab:' + location.hash) || tabs[0]?.dataset.tab);
}

// ---------- أزرار الإجراءات السريعة (ملف التلميذ) ----------
const QA_ICONS = {
  note: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m13.5 7.5 3 3"/>',
  absent: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M10 13.5l4 4M14 13.5l-4 4"/>',
  wa: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.2Z"/><path d="M9 9.5c0 2.8 2.2 5 5 5l1.2-1.3-1.7-1-1 .7a3.6 3.6 0 0 1-2-2l.7-1-1-1.7Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  report: '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  edit: '<path d="M12 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.2-8.2M17 6l2 2M15 8l2 2"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
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
    ${role !== 'parent' ? '<nav class="file-nav" id="file-nav" hidden></nav>' : ''}
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
          ${student.parent_name ? `<span>الولي: ${role === 'admin' ? `<a href="#/parents/${student.parent_id}">${esc(student.parent_name)}</a>` : esc(student.parent_name)}</span>` : ''}
          ${student.parent_phone ? `<span dir="ltr">${esc(student.parent_phone)}</span>` : ''}
        </div>
        ${student.remarks ? `<p class="remarks">📝 ${esc(student.remarks)}</p>` : ''}
        </div>
      </div>
    </div>

    ${fileTabs([
      ['home', 'نظرة عامة'],
      finance || program?.finance ? ['pay', 'الخلاص'] : null,
      ['follow', 'المتابعة'],
      ['info', 'المعلومات'],
    ])}
    <div class="tab-panel" data-panel="home">
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
            ]
      )}
      <div class="ov-grid">
        ${finance ? `<button type="button" class="ov-card ov-pay ${finance.free ? '' : finance.balance > 0 ? 'due' : 'ok'}" data-goto="pay">
          <small>الخلاص</small><b>${finance.free ? 'مجاني' : finance.balance > 0 ? `${fmtMoney(finance.balance)} باقي` : 'خالص ✓'}</b>
          <span>${role === 'admin' ? '💰 تسجيل دفعة ←' : 'التفاصيل ←'}</span></button>` : ''}
        <button type="button" class="ov-card" data-goto="follow"><small>الغيابات</small><b>${absences.length}</b>
          <span>${unjustified ? `${unjustified} غير مبرر` : 'كلها مبررة'}</span></button>
        <button type="button" class="ov-card" data-goto="follow"><small>آخر ملاحظة</small>
          <b class="ov-text">${notes[0] ? esc(notes[0].content || CATEGORY_LABELS[notes[0].category] || '') : '—'}</b>
          <span>${notes[0] ? fmtDate(notes[0].date) : 'لا توجد ملاحظات'}</span></button>
        <a class="ov-card" href="#/report/${student.id}"><small>بطاقة التقييم</small><b>📄 الشهرية</b><span>فتح ←</span></a>
      </div>
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
    </div>
    <div class="tab-panel" data-panel="pay">
      ${finance ? financeSection(finance, role, 'support', program ? '💰 الوضعية المالية — دروس الدعم' : '💰 الوضعية المالية', { registration: true }) : ''}
      ${program?.finance ? financeSection(program.finance, role, 'program', '💰 الوضعية المالية — البرنامج التربوي') : ''}
    </div>
    <div class="tab-panel" data-panel="follow">
      ${program ? classPostsSection(program.posts) + childFollowUpSection(program, role) : ''}
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
    </section>    </div>
    <div class="tab-panel" data-panel="info">
    <section class="card info-card">
      <div class="section-head"><h3>🪪 معلومات التلميذ</h3>${role === 'admin' ? '<button class="link small" id="info-edit">✏️ تعديل</button>' : ''}</div>
      ${infoGrid([
        { icon: 'school', label: 'المؤسسة التربوية', value: student.school },
        { icon: 'calendar', label: 'تاريخ الدخول للمركز', value: student.start_date && fmtDate(student.start_date),
          sub: student.end_date ? `${STATUS_LABELS[student.status]} في ${fmtDate(student.end_date)}` : '' },
        { icon: 'cake', label: 'تاريخ الولادة', value: student.birth_date && fmtDate(student.birth_date), sub: student.birth_date ? yearsOld(student.birth_date) : '' },
        { icon: 'pin', label: 'العنوان', value: [student.address, student.city].filter(Boolean).join('، ') },
        { icon: 'user', label: 'الولي', raw: true,
          value: student.parent_id
            ? role === 'admin' ? `<a href="#/parents/${student.parent_id}">${esc(student.parent_name)} ←</a>` : esc(student.parent_name)
            : '',
          sub: (student.parent_phone ? `<a href="tel:${esc(student.parent_phone.split(/\s*[\/,;]\s*/)[0])}" dir="ltr">${esc(student.parent_phone)}</a>` : role === 'admin' && student.parent_id ? 'بلا رقم هاتف' : '') +
            (role === 'admin'
              ? student.parent_id
                ? ` <button type="button" class="link small" id="parent-edit">✏️ ${student.parent_phone ? 'تعديل' : 'إضافة رقم'}</button>`
                : ' <button type="button" class="link small" id="parent-add">+ إضافة ولي</button>'
              : '') },
        finance
          ? { icon: 'coin', label: 'المبلغ الشهري', value: student.free ? 'مجاني' : finance.monthly_fee ? fmtMoney(finance.monthly_fee) : '',
              sub: student.discount ? `تخفيض ${fmtMoney(student.discount)}${student.discount_reason ? ' · ' + esc(student.discount_reason) : ''}` : '', strong: true, raw: true }
          : null,
        { icon: 'book', label: 'المواد المسجّل فيها', wide: true, raw: true,
          value: (student.pack ? '<span class="badge pack">باقة كاملة</span>' : '') +
            student.subjects.map((x) => `<span class="info-chip">${esc(SUBJECT_SHORT[x.name] || x.name)}</span>`).join('') },
      ])}
    </section>
      ${role === 'admin' ? `<div class="info-acts"><button class="btn" id="info-edit2">✏️ تعديل المعطيات</button>
        <button class="btn danger ghost" id="del-student">حذف التلميذ</button></div>` : ''}
    </div>`;

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
  $('#info-edit2')?.addEventListener('click', () => studentForm(student, reload));
  $('#parent-edit')?.addEventListener('click', () => parentQuickEdit(student.parent_id, reload).catch((err) => toast(err.message, true)));
  $('#parent-add')?.addEventListener('click', async () => {
    await studentForm(student, reload);
    const box = $('#np-box');
    if (box) (box.open = true), box.scrollIntoView({ block: 'center' });
  });
  $('#del-student')?.addEventListener('click', async () => {
    if (!confirmAction(`حذف ${student.full_name} مع كل غياباته وملاحظاته ودفوعاته؟`)) return;
    await api('DELETE', `/api/students/${id}`).catch((err) => toast(err.message, true));
    toast('تم الحذف');
    location.hash = '#/students';
  });
  bindFileTabs(el);
  if (role !== 'parent') mountFileNav(el, 'support', id, (x) => `#/students/${x}`);

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
function financeSection(f, role, kind = 'support', title = '💰 الوضعية المالية', { registration = false } = {}) {
  // معلوم التسجيل: يُضاف اختياريًا لأول شهر (عادة 40، أو مخفّض، أو معفى)
  const isReg = (x) => /تسجيل/.test(x.reason || '');
  const hasReg = f.months.some((m) => (m.extras || []).some(isReg));
  const asc = [...f.months].sort((a, b) => a.month.localeCompare(b.month));
  // الشهر الذي دُفع فيه زيادة (غالبًا معلوم التسجيل)، وإلا أول شهر
  const firstMonth = (asc.find((m) => m.paid > m.due && m.due > 0) || asc.find((m) => m.due > 0 || m.adjustment))?.month;
  const askReg = registration && role === 'admin' && !hasReg && !f.free && firstMonth;
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
                          .map((x) => `<span class="mc-tag ${x.amount && (!x.registration || x.paid >= x.amount) ? 'plus' : x.registration && x.amount ? 'opt' : ''}">${
                            !x.amount
                              ? `${esc(x.reason || 'معلوم التسجيل')}: معفى`
                              : !x.registration || x.paid >= x.amount
                              ? `+ ${fmtMoney(x.amount)} · ${esc(x.reason || '')}${x.registration ? ' ✓' : ''}`
                              : x.paid > 0
                              ? `${esc(x.reason)}: ${fmtMoney(x.paid)} من ${fmtMoney(x.amount)}`
                              : `${esc(x.reason)} ${fmtMoney(x.amount)} · غير مدفوع`
                          }${role === 'admin' ? ` <button class="link danger" data-del-extra="${x.id}" aria-label="حذف">✕</button>` : ''}</span>`)
                          .join('')}${notes
                          .map((n) => `<span class="mc-tag">${n}</span>`)
                          .join('')}</div>`
                      : ''
                  }
                  ${
                    askReg && m.month === firstMonth
                      ? `<div class="mc-reg"><span>🪪 معلوم التسجيل <small>(أول شهر · 40 عادةً)</small></span>
                          <div class="mc-reg-opts">${[40, 30, 20].map((v) => `<button type="button" data-reg-set="${v}" data-kind="${kind}" data-month="${m.month}">${v}</button>`).join('')}
                            <button type="button" data-reg-set="other" data-kind="${kind}" data-month="${m.month}">مبلغ آخر</button>
                            <button type="button" class="ex" data-reg-set="0" data-kind="${kind}" data-month="${m.month}">معفى</button></div></div>`
                      : ''
                  }
                  ${
                    m.payments.length
                      ? `<ul class="mc-pays">${m.payments
                          .map(
                            (p) => `<li><span>✓ <b>${fmtMoney(p.amount)}</b> · ${fmtDate(p.paid_on)}${p.method ? ` · ${esc(PAYMENT_LABELS[p.method] || p.method)}` : ''}${
                              p.note ? ` · <span class="muted">${esc(p.note)}</span>` : ''
                            }${p.edited ? ' <span class="mc-edited">معدّل</span>' : ''}</span><span class="mc-acts"><a class="receipt-link" href="#/receipt/${kind}/${p.id}">🧾 ${p.receipt_no ?? ''}</a>${
                              role === 'admin' ? `<button class="link mc-pedit" data-edit-pay="${p.id}" data-kind="${kind}" aria-label="تعديل الدفعة" title="تعديل">✏️</button><button class="link danger" data-del-pay="${p.id}" data-kind="${kind}" aria-label="حذف الدفعة">✕</button>` : ''
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

// ---------- لوحة الخلاص: تُفتح من القائمة أو من الملف، دفعة لشهر أو أكثر ووصل واحد ----------
function closePaySheet() {
  document.querySelectorAll('.pay-sheet, .pay-bg').forEach((x) => x.remove());
  document.body.classList.remove('sel-open');
}
function receiptWaText(r) {
  const link = `${PUBLIC_URL}/#/receipt/${r.kind}/${r.id}`;
  return `السلام عليكم ${r.payer || ''}،\nتسلّمنا خلاصكم — مركز فيد 🌿\nوصل رقم ${r.receipt_no} · ${fmtDate(r.paid_on)}\n${r.beneficiary}: ${r.months
    .map(monthLabel)
    .join('، ')}\nالمبلغ: ${fmtMoney(r.total)}\n\nالوصل في حسابكم على التطبيقة:\n${link}\nشكرًا لكم.`;
}
async function paySheet(kind, id, onDone0) {
  closePaySheet();
  // التحديث بعد الدفع: فقط إن بقي المستعمل في نفس الصفحة
  const fromHash = location.hash;
  const onDone = () => location.hash === fromHash && onDone0?.();
  const file = await api('GET', kind === 'support' ? `/api/students/${id}` : `/api/program/children/${id}`);
  const person = kind === 'support' ? file.student : file.child;
  const f = file.finance;
  if (!f) return toast('لا توجد معطيات مالية', true);
  const phone = kind === 'support' ? person.parent_phone : person.contact_phone;
  const payer = kind === 'support' ? person.parent_name : person.contact_name;
  const level = kind === 'support' ? levelLabel(person.level) : person.class_name || 'البرنامج التربوي';
  const skip = kind === 'support' ? ['07', '08'] : ['06', '07', '08'];
  const monthFee = f.free ? 0 : f.sibling_pct ? Math.round(f.net_fee * (100 - f.sibling_pct)) / 100 : f.net_fee;
  // الأشهر: المستحقة (من الأقدم) ثم 4 أشهر قادمة للدفع المسبق
  const past = [...f.months].sort((a, b) => a.month.localeCompare(b.month));
  const chips = past.map((m) => ({ month: m.month, due: m.due, paid: m.paid, rest: m.remaining }));
  let next = past.length ? past[past.length - 1].month : today().slice(0, 7);
  for (let n = 0; n < 4 && monthFee > 0; ) {
    next = shiftMonth(next, 1);
    if (skip.includes(next.slice(5))) continue;
    if (!chips.some((c) => c.month === next)) chips.push({ month: next, due: monthFee, paid: 0, rest: monthFee, future: true }), n++;
  }
  // معلوم تسجيل محدّد ولم يُدفع: يُضاف للدفعة باختيار الإدارة
  // معلوم التسجيل داخل مستحق أول شهر: لا يُضاف مرة ثانية
  const reg = null;
  let withReg = false;
  const firstDue = chips.find((c) => c.rest > 0);
  const selected = new Set(firstDue ? [firstDue.month] : []);
  const bg = document.createElement('div');
  bg.className = 'pay-bg';
  bg.addEventListener('click', closePaySheet);
  const sh = document.createElement('div');
  sh.className = 'pay-sheet';
  document.body.append(bg, sh);
  document.body.classList.add('sel-open');
  const head = `<div class="ps-grip"></div>
    <div class="ps-head">${kind === 'support' ? avatar(person, 'md') : avatar({ full_name: person.full_name }, 'md')}
      <div class="ps-who"><b>${esc(person.full_name)}</b><span>${esc(level)}${f.free ? ' · مجاني' : monthFee ? ` · ${fmtMoney(monthFee)} في الشهر` : ''}</span></div>
      <button type="button" class="ps-x" aria-label="إغلاق">✕</button></div>`;
  const render = () => {
    const lines = chips.filter((c) => selected.has(c.month)).map((c) => ({ month: c.month, amount: c.rest }));
    if (withReg && reg) {
      const l = lines.find((x) => x.month === reg.month);
      if (l) l.amount = Math.round((l.amount + reg.rest) * 1000) / 1000;
      else lines.unshift({ month: reg.month, amount: reg.rest });
    }
    const total = lines.reduce((t, l) => t + l.amount, 0);
    sh.innerHTML = `${head}
      <div class="ps-kpis"><div><b>${fmtMoney(f.total_due)}</b><small>المستحق</small></div><div><b class="in">${fmtMoney(f.total_paid)}</b><small>المدفوع</small></div>
        <div><b class="${f.balance > 0 ? 'owed' : 'in'}">${f.balance > 0 ? fmtMoney(f.balance) : '✓'}</b><small>${f.balance > 0 ? 'الباقي' : f.balance < 0 ? `رصيد ${fmtMoney(-f.balance)}` : 'خالص'}</small></div></div>
      <p class="ps-hint">اختر شهرًا أو أكثر (تنجم تخلّص أشهر قادمة مسبقًا):</p>
      <div class="ps-months">${chips
        .map((c) => {
          const st = c.future ? 'fut' : c.rest <= 0 ? 'ok' : c.paid > 0 ? 'part' : 'due';
          const can = c.rest > 0;
          return `<button type="button" class="ps-m ${st} ${selected.has(c.month) ? 'sel' : ''}" data-m="${c.month}" ${can ? '' : 'disabled'}>
            <span>${MONTHS_AR[Number(c.month.slice(5)) - 1]}</span><b>${st === 'ok' ? '✓' : fmtMoney(c.rest)}</b>${st === 'part' ? '<i>جزئي</i>' : c.future ? '<i>مسبق</i>' : ''}</button>`;
        })
        .join('')}</div>
      ${reg ? `<label class="ps-reg"><input type="checkbox" id="ps-reg" ${withReg ? 'checked' : ''}> 🪪 + معلوم التسجيل <b>${fmtMoney(reg.rest)}</b> <small>(${esc(monthLabel(reg.month))} · اختياري)</small></label>` : ''}
      <form class="ps-form">
        <div class="ps-row"><label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${total || ''}" required></label>
          <label>طريقة الدفع<select name="method">${Object.entries(PAYMENT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
        <p class="ps-split" id="ps-split"></p>
        <details class="ps-more"><summary>التاريخ وملاحظة</summary>
          <div class="ps-row"><label>تاريخ الدفع<input type="date" name="paid_on" value="${today()}"></label><label>ملاحظة<input name="note"></label></div></details>
        <button class="btn block ps-go" ${lines.length ? '' : 'disabled'}>✓ تسجيل الدفعة + الوصل</button>
      </form>
      <div class="ps-links"><a href="${kind === 'support' ? `#/students/${id}` : `#/program/child/${id}`}" data-tab-pay>فتح الملف ←</a></div>`;
    const amountIn = sh.querySelector('[name=amount]');
    // توزيع المبلغ على الأشهر المختارة من الأقدم، والزائد على آخر شهر
    const split = () => {
      let left = Number(String(amountIn.value).replace(',', '.')) || 0;
      const out = lines.map((l, i) => {
        const a = i === lines.length - 1 ? left : Math.min(l.amount, left);
        left = Math.round((left - a) * 1000) / 1000;
        return { month: l.month, amount: Math.max(Math.round(a * 1000) / 1000, 0) };
      });
      sh.querySelector('#ps-split').innerHTML = out.length > 1 || (out[0] && out[0].amount !== lines[0].amount)
        ? out.map((l) => `<span>${esc(monthLabel(l.month))}: <b>${fmtMoney(l.amount)}</b></span>`).join('')
        : '';
      return out.filter((l) => l.amount > 0);
    };
    amountIn.addEventListener('input', split);
    split();
    sh.querySelectorAll('[data-m]').forEach((b) =>
      b.addEventListener('click', () => {
        const m = b.dataset.m;
        if (selected.has(m)) selected.delete(m);
        else selected.add(m);
        render();
      })
    );
    sh.querySelector('#ps-reg')?.addEventListener('change', (e) => {
      withReg = e.target.checked;
      render();
    });
    sh.querySelector('.ps-x').addEventListener('click', closePaySheet);
    sh.querySelector('[data-tab-pay]').addEventListener('click', () => {
      sessionStorage.setItem('fileTab:' + (kind === 'support' ? `#/students/${id}` : `#/program/child/${id}`), 'pay');
      closePaySheet();
    });
    sh.querySelector('.ps-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = formData(e.target);
      const parts = split();
      if (!parts.length) return toast('المبلغ إجباري', true);
      const btn = sh.querySelector('.ps-go');
      btn.disabled = true;
      try {
        const { payment } = await api('POST', '/api/pay-months', { kind, id, lines: parts, method: data.method, paid_on: data.paid_on, note: data.note });
        done({ ...payment, kind, paid_on: data.paid_on || today(), months: parts.map((p) => p.month), beneficiary: person.full_name, payer });
      } catch (err) {
        btn.disabled = false;
        toast(err.message, true);
      }
    });
  };
  // بعد الدفع: الوصل جاهز للطباعة وللإرسال، ويظهر في حساب الولي
  const done = (r) => {
    onDone?.();
    const hasParent = kind === 'support' ? !!person.parent_id : !!(person.family_parent_id || person.parent_id);
    sh.innerHTML = `${head}
      <div class="ps-done"><div class="ps-check">✓</div>
        <h3>تم تسجيل الدفعة</h3>
        <p>وصل رقم <b>${r.receipt_no}</b> · ${fmtMoney(r.total)}<br><span class="muted small">${r.months.map((m) => esc(monthLabel(m))).join('، ')}</span></p>
        ${hasParent ? '<p class="ps-note">🧾 الوصل وصل لحساب الولي في التطبيقة</p>' : '<p class="ps-note warn">الولي ما عندوش حساب في التطبيقة: ابعثلو الوصل بواتساب</p>'}
        <div class="ps-acts">
          <a class="btn" href="#/receipt/${r.kind}/${r.id}" id="ps-open">🖨 الوصل / طباعة</a>
          ${waNumber(phone) ? `<a class="btn wa" target="_blank" rel="noopener" href="${esc(waUrl(phone, receiptWaText(r)))}">${WA_ICON} واتساب الولي</a>` : ''}
        </div>
        <button type="button" class="link" id="ps-close">إغلاق</button></div>`;
    sh.querySelector('.ps-x').addEventListener('click', closePaySheet);
    sh.querySelector('#ps-close').addEventListener('click', closePaySheet);
    sh.querySelector('#ps-open').addEventListener('click', closePaySheet);
  };
  render();
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && document.querySelector('.pay-sheet') && closePaySheet());
addEventListener('hashchange', closePaySheet);

function bindFinance(el, f, { kind, id }, reload) {
  el.querySelectorAll(`[data-reg-set][data-kind="${kind}"]`).forEach((b) =>
    b.addEventListener('click', async () => {
      let v = b.dataset.regSet;
      if (v === 'other') {
        v = prompt('مبلغ معلوم التسجيل (د.ت):', '40');
        if (v === null) return;
      }
      const amount = Number(String(v).replace(',', '.')) || 0;
      try {
        await api('POST', '/api/fee-extras', {
          [kind === 'support' ? 'student_id' : 'child_id']: id,
          month: b.dataset.month,
          amount,
          exempt: !amount,
          reason: 'معلوم التسجيل',
        });
        toast(amount ? `أُضيف معلوم التسجيل ${fmtMoney(amount)}` : 'معفى من معلوم التسجيل');
        reload();
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
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
         <label class="check"><input type="radio" name="kind" value="free_month" ${!a || (a.kind === 'exempt' && a.reason === 'معفى') ? 'checked' : ''}> معفى هذا الشهر (لا يدفع شيئًا)</label>
         <label class="check"><input type="radio" name="kind" value="exempt" ${a?.kind === 'exempt' && a.reason !== 'معفى' ? 'checked' : ''}> تغيّب الشهر كاملًا (لا شيء عليه)</label>
         <label class="check"><input type="radio" name="kind" value="absent_days" ${a?.kind === 'absent_days' ? 'checked' : ''}> تغيّب جزءًا من الشهر</label>
         <label id="adj-days">عدد أيام الغياب<input name="days" inputmode="numeric" value="${a?.kind === 'absent_days' ? esc(a.value) : ''}" placeholder="مثال: 10"></label>
         <label class="check"><input type="radio" name="kind" value="amount" ${a?.kind === 'amount' ? 'checked' : ''}> مبلغ آخر</label>
         <label class="check"><input type="radio" name="kind" value="extra"> إضافة مبلغ لهذا الشهر (معلوم التسجيل أو غيره)</label>
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
          if (data.kind === 'free_month') {
            data.kind = 'exempt';
            data.reason = 'معفى';
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
  el.querySelector(`[data-add-pay="${kind}"]`)?.addEventListener('click', () => paySheet(kind, id, reload).catch((err) => toast(err.message, true)));
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
  el.querySelectorAll(`[data-edit-pay][data-kind="${kind}"]`).forEach((b) =>
    b.addEventListener('click', () => {
      const p = f.months.flatMap((m) => m.payments).find((x) => x.id === Number(b.dataset.editPay));
      if (!p) return;
      openModal(
        `تعديل الدفعة — وصل ${p.receipt_no ?? ''}`,
        `<p class="muted small">الوصل يحافظ على نفس الرقم، ويتبدّل فيه المبلغ والمعطيات (ويظهر «معدّل»).</p>
         <div class="row">
           <label>الشهر<input type="month" name="month" value="${esc(p.month)}" required></label>
           <label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${esc(p.amount)}" required></label>
         </div>
         <div class="row">
           <label>تاريخ الدفع<input type="date" name="paid_on" value="${esc(p.paid_on)}"></label>
           <label>طريقة الدفع<select name="method">${Object.entries(PAYMENT_LABELS)
             .map(([k, v]) => `<option value="${k}" ${p.method === k ? 'selected' : ''}>${v}</option>`)
             .join('')}</select></label>
         </div>
         <label>ملاحظة<input name="note" value="${esc(p.note || '')}"></label>`,
        async (data) => {
          await api('PUT', kind === 'support' ? `/api/payments/${p.id}` : `/api/program/payments/${p.id}`, data);
          toast('تم تعديل الدفعة');
          reload();
        }
      );
    })
  );
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
// ---------- كلمة سر أوّلية + إرسالها عبر واتساب ----------
const ROLE_WORD = { parent: 'الولي', teacher: 'المدرّس', admin: 'الإداري' };
async function issuePassword(u, onDone) {
  if (!confirmAction(`إصدار كلمة سر جديدة لـ ${u.full_name}؟\nكلمة السر القديمة تتبطّل، ويخرج من حسابه في كل الأجهزة.`)) return;
  let r;
  try {
    r = await api('POST', `/api/users/${u.id}/new-password`);
  } catch (err) {
    return toast(err.message, true);
  }
  const link = PUBLIC_URL;
  const hello = r.role === 'parent' ? 'مرحبا' : 'مرحبا أستاذ(ة)';
  const msg = `${hello} ${r.full_name} 🌿\nحسابك في منصّة مركز فيد:\n🔗 ${link}\n👤 اسم المستخدم: ${r.username}\n🔑 كلمة السر: ${r.password}\nننصحك بتغيير كلمة السر بعد أوّل دخول (حسابي ← كلمة السر).`;
  const phone = u.phone || r.phone;
  openModal(
    '🔑 كلمة السر الجديدة',
    `<div class="pw-card">
       <div><small>اسم المستخدم</small><b dir="ltr">${esc(r.username)}</b></div>
       <div><small>كلمة السر</small><b dir="ltr" class="pw">${esc(r.password)}</b></div>
     </div>
     <p class="muted small">ابعثها لـ${esc(ROLE_WORD[r.role] || '')} ${esc(r.full_name)} عبر واتساب، ولا انسخها. ما تظهرش مرّة أخرى.</p>
     <div class="pw-acts">
       ${waNumber(phone) ? `<a class="btn wa" target="_blank" rel="noopener" href="${esc(waUrl(phone, msg))}">${WA_ICON} إرسال عبر واتساب</a>` : '<span class="muted small">لا رقم هاتف لإرسال واتساب.</span>'}
       <button type="button" class="btn ghost" id="pw-copy">📋 نسخ الرسالة</button>
     </div>`,
    async () => {}
  );
  $('#modal-form button[type=submit]').textContent = 'تم';
  $('#pw-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(msg);
      toast('تم النسخ');
    } catch {
      toast('تعذّر النسخ', true);
    }
  });
  onDone?.();
}

// ---------- قائمة المدرّسين / المؤطّرين: بطاقات أو جدول ----------
function viewStaffList(el, users, { prog, title, addLabel, reload, edit }) {
  let view = studentsView(prog ? 'progStaffView' : 'teachersView');
  const phones = (u) => String(u.phone || '').split(/\s*[\/,;]\s*/).filter(Boolean);
  const subj = (u) => (prog ? (u.program_classes ? `<span class="pk-chip prog">🎨 ${u.program_classes} قسم</span>` : '') : (u.subjects || []).map((x) => `<span class="pk-chip">${esc(x.name)}${x.teach_levels?.length ? `<i>${esc(x.teach_levels.join('، '))}</i>` : ''}</span>`).join(''));
  const pay = (u) =>
    prog
      ? u.monthly_salary ? `${fmtMoney(u.monthly_salary)} / شهر` : u.pay_per_child ? `${fmtMoney(u.pay_per_child)} / طفل` : '<span class="muted">الأجرة غير محدّدة</span>'
      : u.hourly_rate != null ? `${fmtMoney(u.hourly_rate)} / ساعة` : '<span class="error">معلوم الساعة غير محدّد</span>';
  const payLink = (u) => (prog ? '#/program/pay' : `#/payroll/${u.id}`);
  el.innerHTML = `
    <div class="page-head"><h2>${esc(title)} <span class="muted small">(${users.length})</span></h2><button class="btn" id="add-user">${esc(addLabel)}</button></div>
    <div class="filters"><input id="sq" type="search" placeholder="بحث بالاسم أو الهاتف أو المادة…">${viewToggle()}</div>
    <div id="s-list"></div>`;
  const render = () => {
    const q = $('#sq').value.trim().toLowerCase();
    const list = users.filter((u) => !q || [u.full_name, u.phone, u.username, ...(u.subjects || []).map((x) => x.name)].some((x) => String(x || '').toLowerCase().includes(q)));
    $('#s-list').innerHTML = !list.length
      ? '<div class="card muted">لا توجد حسابات.</div>'
      : view === 'cards'
      ? `<div class="pcards">${list
          .map(
            (u) => `<article class="pcard staff ${u.approved === false ? 'pending' : ''}">
              <div class="pc-head">${avatar({ full_name: u.full_name }, 'md')}
                <div><h3>${esc(u.full_name)}</h3><span class="pc-rate">${pay(u)}</span></div>
                ${u.approved === false ? '<span class="badge average">ينتظر الموافقة</span>' : ''}</div>
              <div class="pc-phones">${phones(u).length ? phones(u).map((p) => `<span class="pc-phone"><span dir="ltr">${esc(p)}</span><a class="pc-call" href="tel:${esc(p)}" aria-label="اتصال">📞</a>${waButton(p)}</span>`).join('') : '<span class="muted small">لا هاتف</span>'}</div>
              <div class="pc-kids">${subj(u) || '<span class="muted small">—</span>'}</div>
              <div class="pc-foot"><span class="muted small" dir="ltr">👤 ${esc(u.username)}</span>
                <span>${u.approved === false ? `<button class="btn small" data-approve="${u.id}">✔ تفعيل</button>` : ''}<a class="btn ghost small" href="${payLink(u)}">${prog ? 'الأجرة' : 'الساعات'}</a><button class="btn ghost small" data-pw="${u.id}" title="كلمة سر جديدة">🔑</button><button class="btn ghost small" data-edit="${u.id}">تعديل</button></span></div>
            </article>`
          )
          .join('')}</div>`
      : `<div class="table-wrap as-table"><table>
          <thead><tr><th>الاسم</th><th>الهاتف</th><th>${prog ? 'الأقسام' : 'المواد'}</th><th>${prog ? 'الأجرة' : 'معلوم الساعة'}</th><th>اسم المستخدم</th><th></th></tr></thead>
          <tbody>${list
            .map(
              (u) => `<tr>
                <td><span class="who-cell">${avatar({ full_name: u.full_name }, 'sm')}<b>${esc(u.full_name)}</b></span>${u.approved === false ? ' <span class="badge average">ينتظر الموافقة</span>' : ''}</td>
                <td>${phones(u).map((p) => `<span class="phone-line"><span dir="ltr">${esc(p)}</span>${waButton(p)}</span>`).join('') || '<span class="muted">—</span>'}</td>
                <td><div class="pc-kids">${subj(u) || '<span class="muted">—</span>'}</div></td>
                <td class="nowrap">${pay(u)} <a class="small" href="${payLink(u)}">←</a></td>
                <td class="nowrap" dir="ltr">${esc(u.username)}</td>
                <td class="row-actions">${u.approved === false ? `<button class="btn small" data-approve="${u.id}">✔ تفعيل</button>` : ''}<button class="btn ghost small" data-pw="${u.id}" title="كلمة سر جديدة">🔑 كلمة سر</button><button class="btn ghost small" data-edit="${u.id}">تعديل</button><button class="btn danger small" data-del="${u.id}">حذف</button></td>
              </tr>`
            )
            .join('')}</tbody></table></div>`;
    const find = (id) => users.find((u) => u.id === Number(id));
    $('#s-list').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => edit(find(b.dataset.edit))));
    $('#s-list').querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', () => issuePassword(find(b.dataset.pw))));
    $('#s-list').querySelectorAll('[data-approve]').forEach((b) =>
      b.addEventListener('click', async () => {
        const u = find(b.dataset.approve);
        if (!confirmAction(`تفعيل حساب ${u.full_name}؟ (راجع موادّه ومستوياته بزر «تعديل»)`)) return;
        await api('POST', `/api/users/${u.id}/approve`).catch((e) => toast(e.message, true));
        reload();
      })
    );
    $('#s-list').querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        const u = find(b.dataset.del);
        if (!confirmAction(`حذف حساب ${u.full_name}؟`)) return;
        await api('DELETE', `/api/users/${u.id}`).catch((e) => toast(e.message, true));
        reload();
      })
    );
  };
  bindViewToggle(el, prog ? 'progStaffView' : 'teachersView', () => view, (v) => (view = v), render);
  let timer;
  $('#sq').addEventListener('input', () => (clearTimeout(timer), (timer = setTimeout(render, 150))));
  $('#add-user').addEventListener('click', () => edit(null));
  render();
}

// قائمة الأولياء: بطاقات أو جدول
function viewParentsList(el, users, reload, edit) {
  const kidsOf = (u) => [
    ...u.children.map((c) => `<a class="pk-chip" href="#/students/${c.id}">📚 ${esc(c.full_name)}<i>${esc(levelLabel(c.level))}</i></a>`),
    ...(u.program_children || []).map((c) => `<a class="pk-chip prog" href="#/program/child/${c.id}">🎨 ${esc(c.full_name)}${c.class_name ? `<i>${esc(c.class_name)}</i>` : ''}</a>`),
  ];
  const phones = (u) => String(u.phone || '').split(/\s*[\/,;]\s*/).filter(Boolean);
  const count = (u) => u.children.length + (u.program_children || []).length;
  let view = studentsView('parentsView');
  el.innerHTML = `
    <div class="page-head"><h2>الأولياء <span class="muted small">(${users.length})</span></h2><button class="btn" id="add-user">+ ولي جديد</button></div>
    <div class="filters"><input id="pq" type="search" placeholder="بحث بالاسم أو الهاتف أو اسم الابن…">${viewToggle()}</div>
    <div id="p-list"></div>`;
  const render = () => {
    const q = $('#pq').value.trim().toLowerCase();
    const list = users.filter((u) => !q || [u.full_name, u.phone, u.username, u.cin, ...u.children.map((c) => c.full_name), ...(u.program_children || []).map((c) => c.full_name)].some((x) => String(x || '').toLowerCase().includes(q)));
    $('#p-list').innerHTML = !list.length
      ? '<div class="card muted">لا يوجد أولياء.</div>'
      : view === 'cards'
      ? `<div class="pcards">${list
          .map(
            (u) => `<article class="pcard">
              <a class="pc-head" href="#/parents/${u.id}">${avatar({ full_name: u.full_name }, 'md')}
                <div><h3>${esc(u.full_name)}</h3><span class="muted small">${count(u) ? `${count(u)} ${count(u) === 1 ? 'ابن' : 'أبناء'}` : 'بلا أبناء'}${u.google_email ? ' · Google' : ''}</span></div></a>
              <div class="pc-phones">${phones(u).length ? phones(u).map((p) => `<span class="pc-phone"><span dir="ltr">${esc(p)}</span><a class="pc-call" href="tel:${esc(p)}" aria-label="اتصال">📞</a>${waButton(p)}</span>`).join('') : '<span class="muted small">لا هاتف</span>'}</div>
              <div class="pc-kids">${kidsOf(u).join('') || '<span class="muted small">—</span>'}</div>
              <div class="pc-foot"><span class="muted small" dir="ltr">${esc(u.username)}${u.cin ? ` · ${esc(u.cin)}` : ''}</span>
                <span><a class="btn ghost small" href="#/parents/${u.id}">الملف</a><button class="btn ghost small" data-pw="${u.id}" title="كلمة سر جديدة">🔑</button><button class="btn ghost small" data-edit="${u.id}">تعديل</button></span></div>
            </article>`
          )
          .join('')}</div>`
      : `<div class="table-wrap as-table"><table>
          <thead><tr><th>الولي</th><th>الهاتف</th><th>الأبناء</th><th>اسم المستخدم</th><th></th></tr></thead>
          <tbody>${list
            .map(
              (u) => `<tr>
                <td><a class="who-cell" href="#/parents/${u.id}">${avatar({ full_name: u.full_name }, 'sm')}<b>${esc(u.full_name)}</b></a></td>
                <td>${phones(u).map((p) => `<span class="phone-line"><span dir="ltr">${esc(p)}</span>${waButton(p)}</span>`).join('') || '<span class="muted">—</span>'}</td>
                <td><div class="pc-kids">${kidsOf(u).join('') || '<span class="muted">—</span>'}</div></td>
                <td class="nowrap" dir="ltr">${esc(u.username)}</td>
                <td class="row-actions"><button class="btn ghost small" data-pw="${u.id}">🔑 كلمة سر</button><button class="btn ghost small" data-edit="${u.id}">تعديل</button>${u.id !== state.user.id ? `<button class="btn danger small" data-del="${u.id}">حذف</button>` : ''}</td>
              </tr>`
            )
            .join('')}</tbody></table></div>`;
    $('#p-list').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => edit(users.find((u) => u.id === Number(b.dataset.edit)))));
    $('#p-list').querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', () => issuePassword(users.find((u) => u.id === Number(b.dataset.pw)))));
    $('#p-list').querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        const u = users.find((x) => x.id === Number(b.dataset.del));
        if (!confirmAction(`حذف حساب ${u.full_name}؟`)) return;
        await api('DELETE', `/api/users/${u.id}`).catch((e) => toast(e.message, true));
        reload();
      })
    );
  };
  bindViewToggle(el, 'parentsView', () => view, (v) => (view = v), render);
  let timer;
  $('#pq').addEventListener('input', () => (clearTimeout(timer), (timer = setTimeout(render, 150))));
  $('#add-user').addEventListener('click', () => edit(null));
  render();
}

async function viewUsers(el, role, scope = null) {
  const titles = { teacher: scope === 'program' ? 'المؤطّرون (البرنامج التربوي)' : scope === 'support' ? 'مدرّسو دروس الدعم' : 'المعلمون', parent: 'الأولياء', admin: 'حسابات الإدارة' };
  const addLabels = { teacher: scope === 'program' ? '+ مؤطّر جديد' : '+ مدرّس جديد', parent: '+ ولي جديد', admin: '+ حساب إدارة' };
  let { users } = await api('GET', `/api/users?role=${role}`);
  // المدرّسون: من عنده مواد (دروس الدعم) / المؤطّرون: من عنده قسم في التربوي. الحساب الجديد بلا شيء يظهر في الاثنين
  const isProgram = (u) => !!u.program_staff;
  if (scope === 'support') users = users.filter((u) => !isProgram(u));
  if (scope === 'program') users = users.filter(isProgram);
  const prog = scope === 'program';
  if (role === 'admin') el.innerHTML = `
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
                  <td>${role === 'parent' ? `<a href="#/parents/${u.id}"><b>${esc(u.full_name)}</b></a>` : `<b>${esc(u.full_name)}</b>`}${u.approved === false ? ' <span class="badge average">ينتظر الموافقة</span>' : ''}</td>
                  <td dir="ltr">${esc(u.username)}</td>
                  <td><span class="phone-line"><span dir="ltr">${esc(u.phone || '—')}</span>${waButton(u.phone)}</span></td>${role === 'parent' ? `<td dir="ltr">${esc(u.cin || '—')}</td>` : ''}
                  ${role === 'teacher' && prog ? `<td>${u.program_classes ? `${u.program_classes} قسم` : '<span class="muted">—</span>'}</td>
                    <td>${u.monthly_salary ? fmtMoney(u.monthly_salary) : ''}${u.pay_per_child ? ` ${fmtMoney(u.pay_per_child)} / طفل` : ''}${!u.monthly_salary && !u.pay_per_child ? '<span class="muted">—</span>' : ''}</td>` : ''}
                  ${role === 'teacher' && !prog ? `<td>${u.subjects.map((s) => `<span class="pill">${esc(s.name)}</span>`).join(' ') || '—'}</td>
                    <td>${u.hourly_rate != null ? fmtMoney(u.hourly_rate) : '<span class="muted">—</span>'} <a class="small" href="#/payroll/${u.id}">الساعات ←</a></td>` : ''}
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
           ? `<fieldset class="sl-box"><legend>المواد والأقسام التي يدرّسها</legend>
               <p class="muted small">فعّل المادة، ثم اختر أقسامها. دون اختيار قسم = يدرّسها في كل أقسامها.</p>
               <div class="sl-list">${state.meta.subjects
               .map((s) => {
                 const lvls = state.meta.levels.filter((l) => !s.levels || s.levels.includes(l.code));
                 return `<div class="sl-row ${ids.has(s.id) ? 'on' : ''}">
                   <label class="sl-subj"><span class="switch"><input type="checkbox" name="subject_ids[]" value="${s.id}" ${ids.has(s.id) ? 'checked' : ''}><i></i></span><b>${esc(s.name)}</b><small class="sl-hint"></small></label>
                   <div class="sl-levels">${lvls
                     .map((l) => `<label class="sl-chip" title="${esc(l.label)}"><input type="checkbox" data-lv="${s.id}" value="${esc(l.code)}" ${teach.get(s.id)?.includes(l.code) ? 'checked' : ''}><span>${esc(levelShort(l.code))}</span></label>`)
                     .join('') || '<span class="muted small">لا أقسام لهذه المادة</span>'}</div>
                 </div>`;
               })
               .join('')}</div></fieldset>`
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
    // المادة غير مفعّلة: أقسامها معطّلة؛ والتلميح يقول «كل الأقسام» أو عددها
    const sync = () =>
      $('#modal').querySelectorAll('.sl-row').forEach((row) => {
        const on = row.querySelector('input[name="subject_ids[]"]').checked;
        const picked = row.querySelectorAll('[data-lv]:checked').length;
        row.classList.toggle('on', on);
        row.querySelectorAll('[data-lv]').forEach((c) => (c.disabled = !on));
        row.querySelector('.sl-hint').textContent = !on ? '' : picked ? `${picked} أقسام` : 'كل الأقسام';
      });
    $('#modal').querySelector('.sl-list')?.addEventListener('change', sync);
    sync();
  };

  // الأولياء: عرض بطاقات أو جدول، مع بحث
  if (role === 'parent') return viewParentsList(el, users, reload, form);
  if (role === 'teacher') return viewStaffList(el, users, { prog, title: titles[role], addLabel: addLabels[role], reload, edit: form });
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
const levelChips = (levels) =>
  levels
    ? `<span class="lv-chipset">${levels.map((c) => `<span class="lv-chip" title="${esc(levelLabel(c))}">${esc(levelShort(c))}</span>`).join('')}</span>`
    : '<span class="lv-chip all">كل الأقسام</span>';

function subjectForm(subject, onDone) {
  const sel = new Set(subject?.levels || []);
  openModal(
    subject ? 'تعديل المادة' : 'مادة جديدة',
    `<label>اسم المادة<input name="name" value="${esc(subject?.name)}" required></label>
     <div class="sf-levels">
       <div class="sf-head"><b>الأقسام اللي تدرَّس فيها المادة</b><a class="link small" href="#/levels">إدارة الأقسام ←</a></div>
       <div class="sf-modes">
         <label><input type="radio" name="sf_mode" value="all" ${sel.size ? '' : 'checked'}><span>🏫 كل الأقسام</span></label>
         <label><input type="radio" name="sf_mode" value="some" ${sel.size ? 'checked' : ''}><span>🎯 أقسام معيّنة</span></label>
       </div>
       <div class="sl-levels sf-chips">${state.meta.levels
         .map((l) => `<label class="sl-chip" title="${esc(l.label)}"><input type="checkbox" name="levels[]" value="${esc(l.code)}" ${sel.has(l.code) ? 'checked' : ''}><span>${esc(l.label)}</span></label>`)
         .join('')}</div>
       <small class="muted" id="sf-hint"></small>
     </div>`,
    async (data) => {
      // «كل الأقسام»: لا أقسام محدّدة
      if ($('#modal input[name=sf_mode]:checked').value === 'all') data.levels = [];
      else if (!$('#modal').querySelectorAll('input[name="levels[]"]:checked').length) throw new Error('اختر قسمًا واحدًا على الأقل، أو «كل الأقسام»');
      delete data.sf_mode;
      if (subject) await api('PUT', `/api/subjects/${subject.id}`, data);
      else await api('POST', '/api/subjects', data);
      toast('تم الحفظ');
      onDone();
    }
  );
  const box = $('#modal .sf-levels');
  const sync = () => {
    const some = box.querySelector('input[name=sf_mode]:checked').value === 'some';
    const n = box.querySelectorAll('input[name="levels[]"]:checked').length;
    box.querySelector('.sf-chips').hidden = !some;
    $('#sf-hint').textContent = some ? (n ? `${n} من ${state.meta.levels.length} أقسام` : 'اختر الأقسام') : `المادة تظهر في الأقسام الكل (${state.meta.levels.length})، وحتى في أي قسم جديد.`;
  };
  box.addEventListener('change', sync);
  sync();
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
      <thead><tr><th>المادة</th><th>الأقسام</th><th></th></tr></thead>
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
    const remarks = ''; // ما بين قوسين في الاسم (مثل SAUF FR) يُحذف ولا يُنقل
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
        <li>ما بين قوسين في اسم التلميذ، مثل (SAUF FR)، يُحذف.</li>
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
    <p class="muted small" id="a-hint"></p>
    <div id="att-list"></div>`;
  bindSubjectLevel($('#a-subject'), $('#a-level'), sessionStorage.getItem('attLevel') || sessionStorage.getItem('levelFilter'));

  // المواد المعروضة: فقط التي تُدرَّس في يوم التاريخ المختار (حسب جدول الأوقات)
  const { slots } = await api('GET', '/api/timetable').catch(() => ({ slots: [] }));
  const dayOf = (d) => new Date(d + 'T12:00:00').getDay() || 7;
  const filterByDay = () => {
    const day = dayOf($('#a-date').value);
    const todays = slots.filter((x) => Number(x.day) === day);
    const ids = new Set(todays.map((x) => x.subject_id));
    const list = subjects.filter((x) => ids.has(x.id));
    const hint = $('#a-hint');
    if (!slots.length) return (hint.textContent = '');
    const cur = Number($('#a-subject').value);
    if (!list.length) {
      hint.textContent = `لا حصص في جدول الأوقات يوم ${DAYS_AR[day - 1]}.`;
      $('#a-subject').innerHTML = '';
      $('#a-level').innerHTML = '';
      return;
    }
    hint.textContent = `المواد التي تُدرَّس يوم ${DAYS_AR[day - 1]}`;
    $('#a-subject').innerHTML = subjectOptions(list, list.some((x) => x.id === cur) ? cur : list[0].id);
    // المستويات: التي تدرس هذه المادة ذلك اليوم
    const lv = new Set(todays.filter((x) => x.subject_id === Number($('#a-subject').value)).map((x) => x.level));
    const keep = $('#a-level').value || sessionStorage.getItem('attLevel');
    const subject = subjects.find((x) => x.id === Number($('#a-subject').value));
    const levels = subjectLevels(subject).filter((l) => lv.has(l.code));
    $('#a-level').innerHTML = levels.map((l) => `<option value="${esc(l.code)}" ${l.code === keep ? 'selected' : ''}>${esc(l.label)}</option>`).join('');
  };
  filterByDay();

  const load = async () => {
    if (!$('#a-subject').value || !$('#a-level').value) {
      $('#att-list').innerHTML = '<div class="card muted">لا توجد حصة في هذا اليوم. اختر تاريخًا آخر.</div>';
      return;
    }
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
  $('#a-date').addEventListener('change', () => (filterByDay(), load()));
  $('#a-subject').addEventListener('change', () => (filterByDay(), load()));
  $('#a-level').addEventListener('change', load);
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

async function viewTimetable(el, mode = 'level') {
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

  // الإدارة: جدول كل مستوى، أو جدول كل معلّم (نفس الحصص: أي تعديل يظهر في الاثنين)
  const byTeacher = mode === 'teacher';
  const level = sessionStorage.getItem('ttLevel') || state.meta.levels[0].code;
  const teachers = (await api('GET', '/api/users?role=teacher')).users.filter((u) => !u.program_staff);
  const tSel = Number(sessionStorage.getItem('ttTeacher')) || teachers[0]?.id;
  el.innerHTML = `
    <div class="page-head">
      <div><h2>${byTeacher ? 'جداول أوقات المدرّسين' : 'جداول الأوقات'}</h2>
        <p class="muted small">${byTeacher ? 'يُستخرج وحده من جداول المستويات: أي تعديل هنا يظهر في جدول التلاميذ، والعكس.' : 'جدول المدرّس يُستخرج وحده من هنا: <a href="#/support/teachers/timetable">جداول أوقات المدرّسين ←</a>'}</p></div>
      <button class="btn" id="add-slot">+ حصة جديدة</button>
    </div>
    <div class="filters">${
      byTeacher
        ? `<select id="tt-teacher" aria-label="المدرّس">${teachers.map((t) => `<option value="${t.id}" ${t.id === tSel ? 'selected' : ''}>${esc(t.full_name)}</option>`).join('')}</select>`
        : `<select id="tt-level" aria-label="المستوى">${levelOptions(level)}</select>`
    }</div>
    <p class="muted small" id="tt-sum"></p>
    <div class="card" id="tt-week"></div>`;

  const load = async () => {
    let slots;
    if (byTeacher) {
      const tid = $('#tt-teacher').value;
      sessionStorage.setItem('ttTeacher', tid);
      ({ slots } = await api('GET', '/api/timetable?teacher=' + encodeURIComponent(tid)));
      const hours = slots.reduce((t, x) => t + (toMinutes(x.end_time) - toMinutes(x.start_time)), 0) / 60;
      $('#tt-sum').textContent = `${slots.length} حصة في الأسبوع · ${hours.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ساعة`;
    } else {
      const lvl = $('#tt-level').value;
      sessionStorage.setItem('ttLevel', lvl);
      ({ slots } = await api('GET', '/api/timetable?level=' + encodeURIComponent(lvl)));
    }
    $('#tt-week').innerHTML = weekView(slots, { showTeacher: !byTeacher, editable: true, showLevel: byTeacher });
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
    const lvl = slot?.level || (byTeacher ? state.meta.levels[0].code : $('#tt-level').value);
    const subjects = state.meta.subjects.filter((x) => !x.levels || x.levels.includes(lvl));
    const presetTeacher = !slot && byTeacher ? Number($('#tt-teacher').value) : null;
    openModal(
      slot ? 'تعديل الحصة' : byTeacher ? 'حصة جديدة' : `حصة جديدة — ${levelLabel(lvl)}`,
      `${byTeacher ? `<label>المستوى<select name="level" id="slot-level">${levelOptions(lvl)}</select></label>` : `<input type="hidden" name="level" value="${esc(lvl)}">`}
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
       <p class="muted small">تُحتسب ساعات المدرّس من أول الشهر الحالي إلى آخره (والتعديل يُطبَّق على كامل الشهر). الأشهر الماضية تُسجَّل يدويًا.</p>`,
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
      const want = slot?.teacher_id || presetTeacher;
      $('#slot-teacher').innerHTML =
        '<option value="">— بدون —</option>' +
        list.map((t) => `<option value="${t.id}" ${t.id === want ? 'selected' : ''}>${esc(t.full_name)}</option>`).join('');
      if (list.length === 1 && !slot && !presetTeacher) $('#slot-teacher').value = list[0].id;
    };
    // في جدول المدرّس: المواد حسب المستوى المختار، ومواد هذا المدرّس أولًا
    const syncSubjects = () => {
      const l = $('#slot-level').value;
      const mine = teachers.find((t) => t.id === presetTeacher)?.subjects.map((x) => x.id) || [];
      const subs = state.meta.subjects.filter((x) => (!x.levels || x.levels.includes(l)) && (!mine.length || mine.includes(x.id)));
      $('#slot-subject').innerHTML = subjectOptions(subs.length ? subs : state.meta.subjects.filter((x) => !x.levels || x.levels.includes(l)), slot?.subject_id);
      syncTeachers();
    };
    $('#slot-subject').addEventListener('change', syncTeachers);
    if ($('#slot-level')) {
      $('#slot-level').addEventListener('change', syncSubjects);
      syncSubjects();
    } else syncTeachers();
  };

  ($('#tt-level') || $('#tt-teacher')).addEventListener('change', load);
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
  paused: ['موقوفة (عطلة)', 'status-left'],
};
const fmtHours = (h) => `${Number(h).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} س`;
const payMonth = () => sessionStorage.getItem('payMonth') || today().slice(0, 7);
const weekdayName = (d) => DAYS_AR[(new Date(d + 'T00:00:00Z').getUTCDay() || 7) - 1];

// ---------- غيابات المدرّسين: الكل حاضر افتراضيًا، الإدارة تسجّل الغياب فقط ----------
async function viewTeacherAbsences(el) {
  let day = sessionStorage.getItem('taDay') || today();
  el.innerHTML = `
    <div class="page-head"><div><h2>غيابات المدرّسين</h2>
      <p class="muted small">كل مدرّس حاضر افتراضيًا في حصصه. اضغط على الحصة اللي غاب فيها: تُحتسب 0 ساعة في خلاصه.</p></div></div>
    <div class="ta-day"><button type="button" class="btn ghost small" data-step="-1" aria-label="اليوم السابق">›</button>
      <input type="date" id="ta-date"><button type="button" class="btn ghost small" data-step="1" aria-label="اليوم الموالي">‹</button>
      <button type="button" class="btn ghost small" id="ta-today">اليوم</button></div>
    <div id="ta-list"><p class="muted">جاري التحميل…</p></div>`;
  const load = async () => {
    $('#ta-date').value = day;
    sessionStorage.setItem('taDay', day);
    const r = await api('GET', '/api/teacher-attendance?date=' + day);
    if (!$('#ta-list')) return;
    const absent = r.sessions.filter((x) => x.absent).length;
    $('#ta-list').innerHTML = `
      <p class="ta-sum"><b>${esc(weekdayName(day))} ${fmtDate(day)}</b> · ${r.sessions.length} حصة${absent ? ` · <span class="owed">${absent} غياب</span>` : r.sessions.length ? ' · الكل حاضر ✓' : ''}</p>
      ${r.pause ? `<div class="pf-sum warn-box">⏸ يوم موقوف العدّ (${esc(r.pause)}): الحصص لا تُحتسب هذا اليوم.</div>` : ''}
      ${
        r.sessions.length
          ? `<div class="ta-list">${r.sessions
              .map(
                (x) => `<button type="button" class="ta-row ${x.absent ? 'absent' : ''}" data-slot="${x.id}" data-absent="${x.absent ? 1 : 0}">
                  <span class="ta-time">${esc(x.start_time)}<small>${esc(x.end_time)}</small></span>
                  <span class="ta-main"><b>${esc(x.teacher_name || '—')}</b><small>${esc(levelLabel(x.level))}${x.group_name ? ` · فوج ${esc(x.group_name)}` : ''} · ${esc(x.subject_name || '')}</small></span>
                  <span class="ta-state">${x.absent ? '✕ غائب' : '✓ حاضر'}</span></button>`
              )
              .join('')}</div>`
          : '<div class="card muted">لا حصص مبرمجة في هذا اليوم.</div>'
      }`;
    $('#ta-list').querySelectorAll('[data-slot]').forEach((b) =>
      b.addEventListener('click', async () => {
        const absent = b.dataset.absent !== '1';
        b.disabled = true;
        try {
          await api('POST', '/api/teacher-attendance', { date: day, timetable_id: b.dataset.slot, absent });
          toast(absent ? 'سُجّل الغياب: الحصة لا تُحتسب' : 'أُلغي الغياب');
        } catch (err) {
          toast(err.message, true);
        }
        load();
      })
    );
  };
  el.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const d = new Date(day + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + Number(b.dataset.step));
      day = d.toISOString().slice(0, 10);
      load();
    })
  );
  $('#ta-date').addEventListener('change', (e) => ((day = e.target.value || today()), load()));
  $('#ta-today').addEventListener('click', () => ((day = today()), load()));
  await load();
}

// مفتاح «حصة 1:45 = ساعتان» لكل مدرّس (قرار المدير حسب المدرّس)
const roundSwitch = (t, compact = false) =>
  `<label class="round-sw ${compact ? 'compact' : ''}" title="كل حصة 1:45 تُحتسب ساعتين لهذا المدرّس"><span class="switch"><input type="checkbox" data-round="${t.id}" ${t.round_hours ? 'checked' : ''}><i></i></span>${compact ? '' : '<span>حصة 1:45 = ساعتان</span>'}</label>`;
async function viewPayroll(el) {
  el.innerHTML = `
    <div class="page-head">
      <div><h2>رواتب مدرّسي الدعم</h2>
        <p class="muted small">الساعات تُضاف وحدها يومًا بيوم من <a href="#/support/teachers/timetable">جدول الأوقات</a>، إلا غياب المدرّس (تسجّله الإدارة) أو فترة «إيقاف العدّ» (عطلة، امتحانات).</p></div>
      <input type="month" id="pay-month" value="${payMonth()}">
    </div>
    <div id="pay-body"><p class="muted">جاري التحميل…</p></div>`;
  let view = studentsView('payView');
  let data;
  const render = () => {
    const { teachers, totals, month, pauses } = data;
    const status = (t) => (t.remaining > 0 ? 'due' : t.due > 0 ? 'ok' : 'none');
    const rateCell = (t) => (t.hourly_rate != null ? `${fmtMoney(t.hourly_rate)} / س` : '<span class="error small">معلوم الساعة غير محدّد</span>');
    const noSlots = (t) => (t.slots_per_week ? '' : `<a class="pr-warn" href="#/support/teachers/timetable">⚠️ لا حصص له في الجدول</a>`);
    const remainCell = (t) => (t.remaining > 0 ? `<b class="owed">${fmtMoney(t.remaining)}</b>` : t.due > 0 ? '<span class="badge good">خالص</span>' : '—');
    $('#pay-body').innerHTML = `
      <div class="fb-kpis">
        <div class="fb-kpi net"><span>الساعات المنجزة · ${esc(monthLabel(month))}</span><b>${fmtHours(totals.hours_done)}</b><small>+ ${fmtHours(totals.hours_planned || 0)} مبرمجة لبقية الشهر</small></div>
        <div class="fb-kpi out"><span>المستحق إلى اليوم</span><b>${fmtMoney(totals.due)}</b><small>مدفوع ${fmtMoney(totals.paid)}</small></div>
        <div class="fb-kpi ${totals.remaining > 0 ? 'out' : 'in'}"><span>الباقي للخلاص</span><b>${fmtMoney(totals.remaining)}</b><small>${teachers.filter((t) => t.remaining > 0).length} مدرّس</small></div>
      </div>
      <section class="card pauses"><div class="section-head"><h3>⏸ إيقاف العدّ</h3><button class="btn small ghost" id="pz-add">+ عطلة / امتحانات</button></div>
        ${
          pauses.length
            ? `<ul class="levels">${pauses
                .map(
                  (p) => `<li><span><b>${fmtDate(p.date_from)}${p.date_to !== p.date_from ? ` ← ${fmtDate(p.date_to)}` : ''}</b> · ${esc(p.reason || 'إيقاف')}
                    <span class="muted small">${p.teacher_name ? esc(p.teacher_name) : 'كل المدرّسين'}</span></span><button class="link danger small" data-del-pz="${p.id}">حذف</button></li>`
                )
                .join('')}</ul>`
            : '<p class="muted small">لا عطل هذا الشهر: كل الحصص المبرمجة تُحتسب.</p>'
        }</section>
      <div class="filters">${viewToggle()}</div>
      ${
        !teachers.length
          ? '<div class="card muted">لا يوجد مدرّسون.</div>'
          : view === 'cards'
          ? `<div class="scards">${teachers
              .map((t) => {
                const total = t.hours_done + t.hours_planned;
                const pct = total ? Math.round((t.hours_done / total) * 100) : 0;
                return `<article class="scard pr-card ${status(t)}" style="--lv:${status(t) === 'due' ? 330 : status(t) === 'ok' ? 152 : 230}">
                  <a class="sc-head" href="#/payroll/${t.id}">${avatar({ full_name: t.full_name }, 'md')}
                    <div class="sc-id"><h3>${esc(t.full_name)}</h3><div class="sc-tags"><span class="sc-level">${rateCell(t)}</span></div>${noSlots(t)}</div></a>
                  <div class="pr-bar"><i style="width:${pct}%"></i></div>
                  <div class="pr-hours"><span><b>${fmtHours(t.hours_done)}</b> منجزة</span><span class="muted">${fmtHours(t.hours_planned)} مبرمجة</span></div>
                  <div class="sc-stats">
                    <div class="sc-stat ${t.absences ? 'warn' : ''}"><b>${t.sessions}</b><span>حصة${t.absences ? ` · ${t.absences} غياب` : ''}${t.paused ? ` · ${t.paused} موقوفة` : ''}</span></div>
                    <div class="sc-stat"><b>${fmtMoney(t.due)}</b><span>المستحق</span></div>
                    <div class="sc-stat ${status(t) === 'due' ? 'owe' : status(t) === 'ok' ? 'ok' : ''}"><b>${t.remaining > 0 ? fmtMoney(t.remaining) : t.due > 0 ? '✓' : '—'}</b><span>${t.remaining > 0 ? 'الباقي' : t.due > 0 ? 'خالص' : 'الباقي'}</span></div>
                  </div>
                  ${roundSwitch(t)}
                  <div class="sc-actions"><a class="btn ghost small" href="#/payroll/${t.id}">التفاصيل والخلاص</a>${waNumber(t.phone) ? waButton(t.phone) : ''}</div>
                </article>`;
              })
              .join('')}</div>`
          : `<div class="table-wrap as-table"><table>
              <thead><tr><th>المدرّس</th><th>معلوم الساعة</th><th>1:45 = 2س</th><th>الحصص</th><th>الساعات</th><th>المستحق</th><th>المدفوع</th><th>الباقي</th></tr></thead>
              <tbody>${teachers
                .map(
                  (t) => `<tr>
                    <td><a class="who-cell" href="#/payroll/${t.id}">${avatar({ full_name: t.full_name }, 'sm')}<b>${esc(t.full_name)}</b></a>${noSlots(t)}</td>
                    <td class="nowrap">${rateCell(t)}</td>
                    <td>${roundSwitch(t, true)}</td>
                    <td>${t.sessions}${t.absences ? ` <span class="badge weak">${t.absences} غياب</span>` : ''}${t.paused ? ` <span class="badge status-left">${t.paused} موقوفة</span>` : ''}</td>
                    <td class="nowrap"><b>${fmtHours(t.hours_done)}</b>${t.hours_planned ? `<div class="muted small">+ ${fmtHours(t.hours_planned)} مبرمجة</div>` : ''}</td>
                    <td class="nowrap">${fmtMoney(t.due)}</td>
                    <td class="nowrap">${fmtMoney(t.paid)}</td>
                    <td class="nowrap">${remainCell(t)}</td>
                  </tr>`
                )
                .join('')}</tbody></table></div>`
      }`;
    bindViewToggle($('#pay-body'), 'payView', () => view, (v) => (view = v), render);
    $('#pay-body').querySelectorAll('[data-round]').forEach((c) =>
      c.addEventListener('change', async () => {
        try {
          await api('PUT', `/api/payroll/${c.dataset.round}/round-hours`, { on: c.checked });
          toast(c.checked ? 'حصص 1:45 تُحتسب ساعتين لهذا المدرّس' : 'رجعت الحصص تُحتسب بمدّتها الحقيقية');
          load();
        } catch (err) {
          toast(err.message, true);
          c.checked = !c.checked;
        }
      })
    );
    $('#pz-add').addEventListener('click', () =>
      openModal(
        '⏸ إيقاف عدّ الساعات',
        `<p class="muted small">الحصص في هذه الفترة لا تُحتسب (عطلة، أسبوع امتحانات، تغيير الجدول…). تنجم تلغيها في أي وقت.</p>
         <div class="row"><label>من<input type="date" name="date_from" value="${today()}" required></label>
           <label>إلى<input type="date" name="date_to" value="${today()}" required></label></div>
         <label>السبب<input name="reason" placeholder="مثال: عطلة الشتاء، امتحانات الثلاثي"></label>
         <label>المدرّسون<select name="teacher_id"><option value="">كل المدرّسين</option>${teachers.map((t) => `<option value="${t.id}">${esc(t.full_name)}</option>`).join('')}</select></label>`,
        async (f) => {
          await api('POST', '/api/payroll/pauses', f);
          toast('تم إيقاف العدّ في هذه الفترة');
          load();
        }
      )
    );
    $('#pay-body').querySelectorAll('[data-del-pz]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('إلغاء الإيقاف؟ الحصص في هذه الفترة ترجع تُحتسب.')) return;
        await api('DELETE', `/api/payroll/pauses/${b.dataset.delPz}`).catch((err) => toast(err.message, true));
        load();
      })
    );
  };
  const load = async () => {
    sessionStorage.setItem('payMonth', $('#pay-month').value);
    data = await api('GET', '/api/payroll?month=' + $('#pay-month').value);
    if ($('#pay-body')) render();
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
        <div class="stat"><b>${m.hourly_rate != null ? fmtMoney(m.hourly_rate) : '—'}</b><span>معلوم الساعة</span></div>
        <div class="stat"><b>${fmtHours(m.hours_done)}</b><span>الساعات المنجزة${m.hours_planned ? ` (+${fmtHours(m.hours_planned)} مبرمجة)` : ''}</span></div>
        <div class="stat"><b>${fmtMoney(m.due)}</b><span>المستحق — ${esc(monthLabel(month))}</span></div>
        <div class="stat good"><b>${fmtMoney(m.paid)}</b><span>المدفوع</span></div>
        <div class="stat ${m.remaining > 0 ? 'warn' : 'good'}"><b>${fmtMoney(Math.max(m.remaining, 0))}</b><span>${m.remaining < 0 ? `الباقي (دُفع زيادة ${fmtMoney(-m.remaining)})` : 'الباقي'}</span></div>
      </div>
      ${m.hourly_rate == null ? `<p class="error">لم يُحدَّد معلوم الساعة${isAdmin ? ' — حدّده من «الحسابات ← المعلمون ← تعديل»' : ''}.</p>` : ''}
      ${isAdmin ? `<label class="round-opt"><input type="checkbox" id="tp-round" ${m.teacher.round_hours ? 'checked' : ''}>
        <span><b>⏱ حصة 1:45 تُحتسب ساعتين</b><small>بعد تأكيد الإدارة: كل حصة 1:45 في جدول هذا المدرّس تُحتسب ساعتين كاملتين. تنجم تطفيها وقت ما تحب.</small></span></label>` : ''}
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
    $('#tp-round')?.addEventListener('change', async (e) => {
      try {
        await api('PUT', `/api/payroll/${teacherId}/round-hours`, { on: e.target.checked });
        toast(e.target.checked ? 'حصص 1:45 تُحتسب ساعتين' : 'رجعت الحصص تُحتسب بمدّتها الحقيقية');
        load();
        loadYear();
      } catch (err) {
        toast(err.message, true);
        e.target.checked = !e.target.checked;
      }
    });
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
function viewWaiting(el) {
  const kids = state.user.children || [];
  el.innerHTML = `<section class="waiting-card">
      <div class="wt-ico">⏳</div>
      <h2>في انتظار تفعيل الإدارة</h2>
      <p>شكرًا ${esc(state.user.full_name)}! وصلنا تسجيل ${kids.length > 1 ? 'أبنائك' : 'ابنك'}. الإدارة تراجع التسجيل وتفعّلو في أقرب وقت، ومن بعد تنجم تتابع الدروس والغيابات والخلاص من هنا.</p>
      ${kids.length ? `<ul class="wt-kids">${kids.map((k) => `<li>${avatar(k, 'sm')}<b>${esc(k.full_name)}</b><span class="pill">${esc(levelLabel(k.level))}</span></li>`).join('')}</ul>` : ''}
      <button class="btn" id="wt-refresh">🔄 تحديث</button>
    </section>`;
  $('#wt-refresh').addEventListener('click', async () => {
    const { user } = await api('GET', '/api/me');
    state.user = user;
    if (user.waiting) return toast('مازال التسجيل في الانتظار');
    location.hash = homeFor(user);
    router();
  });
}

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
      <p class="reg-price c-price" hidden></p>
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
    box.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => showPrice(fs)));
    showPrice(fs);
  };
  // السعر الشهري يظهر وحده بعد اختيار المواد (حسب تسعيرة المركز)
  const showPrice = (fs) => {
    const ids = [...fs.querySelectorAll('.c-subjects input:checked')].map((i) => Number(i.value));
    const pack = fs.querySelector('.c-pack').checked;
    const sug = (pack || ids.length) && suggestFee(fs.querySelector('.c-level').value, pack, ids, meta);
    const p = fs.querySelector('.c-price');
    p.hidden = !sug;
    if (sug) p.innerHTML = `💰 المعلوم الشهري: <b>${fmtMoney(sug.fee)}</b> <span class="muted small">(${esc(sug.label)})</span>`;
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
        <p class="muted small center">بعد التسجيل تدخل مباشرة بحسابك (اسم المستخدم: رقم الهاتف أو رقم بطاقة التعريف). يبقى التسجيل في قائمة الانتظار حتى تفعّله الإدارة، ومعلوم التسجيل (الشهر الأول) يُضاف عند التفعيل.</p>
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
