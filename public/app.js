'use strict';

const state = { user: null, meta: null };

const ROLE_LABELS = { admin: 'الإدارة', teacher: 'معلم', parent: 'ولي' };
const CATEGORY_LABELS = { behavior: 'السلوك', level: 'المستوى', general: 'عامة' };
const RATING_LABELS = { excellent: 'ممتاز', good: 'حسن', average: 'متوسط', weak: 'ضعيف' };

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
  [/^#\/teachers$/, (el) => viewUsers(el, 'teacher')],
  [/^#\/parents$/, (el) => viewUsers(el, 'parent')],
  [/^#\/admins$/, (el) => viewUsers(el, 'admin')],
  [/^#\/subjects$/, viewSubjects],
  [/^#\/account$/, viewAccount],
  [/^#\/dashboard$/, viewDashboard],
];

function homeFor(user) {
  return user.role === 'admin' ? '#/dashboard' : '#/students';
}

async function router() {
  const hash = location.hash || '#/';
  if (!state.user && hash !== '#/login') {
    try {
      const { user } = await api('GET', '/api/me');
      state.user = user;
      state.meta = await api('GET', '/api/meta');
    } catch {
      location.hash = '#/login';
      return;
    }
  }
  renderTopbar();
  if (state.user && (hash === '#/' || hash === '#/login')) {
    location.hash = homeFor(state.user);
    return;
  }
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (m) {
      const el = $('#view');
      el.innerHTML = '<p class="muted">جاري التحميل…</p>';
      try {
        await view(el, ...m.slice(1));
      } catch (err) {
        el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
      }
      return;
    }
  }
  location.hash = state.user ? homeFor(state.user) : '#/login';
}

function renderTopbar() {
  const bar = $('#topbar');
  if (!state.user) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const links = {
    admin: [
      ['#/dashboard', 'لوحة القيادة'],
      ['#/students', 'التلاميذ'],
      ['#/teachers', 'المعلمون'],
      ['#/parents', 'الأولياء'],
      ['#/subjects', 'المواد'],
      ['#/admins', 'الإدارة'],
    ],
    teacher: [['#/students', 'التلاميذ']],
    parent: [['#/students', 'أبنائي']],
  }[state.user.role];
  links.push(['#/account', 'حسابي']);
  const current = location.hash;
  $('#nav').innerHTML = links
    .map(([href, label]) => `<a href="${href}" class="${current.startsWith(href) ? 'active' : ''}">${label}</a>`)
    .join('');
  $('#who-name').textContent = `${state.user.full_name} · ${ROLE_LABELS[state.user.role]}`;
}

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
        <h1>📘 متابعة التلاميذ</h1>
        <p class="muted">فضاء الأولياء والمعلمين والإدارة</p>
        <form id="login-form">
          <label>اسم المستخدم<input name="username" autocomplete="username" required></label>
          <label>كلمة السر<input name="password" type="password" autocomplete="current-password" required></label>
          <p class="error" id="login-error" hidden></p>
          <button class="btn block">دخول</button>
        </form>
      </div>
    </div>`;
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
    <h2>لوحة القيادة</h2>
    <div class="stats">
      <div class="stat"><b>${s.students}</b><span>تلميذ</span></div>
      <div class="stat"><b>${s.teachers}</b><span>معلم</span></div>
      <div class="stat"><b>${s.parents}</b><span>ولي</span></div>
      <div class="stat warn"><b>${s.absences_month}</b><span>غياب (30 يومًا)</span></div>
    </div>
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
}

// ---------- قائمة التلاميذ ----------
async function viewStudents(el) {
  const role = state.user.role;
  if (role === 'parent') return viewMyChildren(el);

  const level = sessionStorage.getItem('levelFilter') || '';
  el.innerHTML = `
    <div class="page-head">
      <h2>التلاميذ</h2>
      ${role === 'admin' ? '<button class="btn" id="add-student">+ تلميذ جديد</button>' : ''}
    </div>
    <div class="filters">
      <select id="f-level">${levelOptions(level, true)}</select>
      <input id="f-q" type="search" placeholder="بحث بالاسم…">
    </div>
    <div id="students-list"></div>`;

  const load = async () => {
    const params = new URLSearchParams();
    const lvl = $('#f-level').value;
    sessionStorage.setItem('levelFilter', lvl);
    if (lvl) params.set('level', lvl);
    if ($('#f-q').value.trim()) params.set('q', $('#f-q').value.trim());
    const { students } = await api('GET', '/api/students?' + params);
    $('#students-list').innerHTML = students.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>الاسم</th><th>المستوى</th><th>الفوج</th><th>الولي</th><th>الغيابات</th><th>الملاحظات</th>${
            role === 'admin' ? '<th></th>' : ''
          }</tr></thead>
          <tbody>${students
            .map(
              (s) => `<tr>
                <td><a href="#/students/${s.id}"><b>${esc(s.full_name)}</b></a></td>
                <td><span class="pill">${esc(levelLabel(s.level))}</span></td>
                <td>${esc(s.group_name || '—')}</td>
                <td>${esc(s.parent_name || '—')}${s.parent_phone ? `<div class="muted small" dir="ltr">${esc(s.parent_phone)}</div>` : ''}</td>
                <td>${s.absence_count}${s.unjustified_count ? ` <span class="badge weak">${s.unjustified_count} غير مبرر</span>` : ''}</td>
                <td>${s.note_count}</td>
                ${
                  role === 'admin'
                    ? `<td class="row-actions"><button class="btn ghost small" data-edit="${s.id}">تعديل</button>
                       <button class="btn danger small" data-del="${s.id}">حذف</button></td>`
                    : ''
                }
              </tr>`
            )
            .join('')}</tbody></table></div>`
      : '<div class="card muted">لا يوجد تلاميذ.</div>';

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

  $('#f-level').addEventListener('change', load);
  let timer;
  $('#f-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });
  $('#add-student')?.addEventListener('click', () => studentForm(null, load));
  await load();
}

async function studentForm(student, onDone) {
  const { users: parents } = await api('GET', '/api/users?role=parent');
  const s = student || {};
  openModal(
    student ? 'تعديل تلميذ' : 'تلميذ جديد',
    `<label>الاسم واللقب<input name="full_name" value="${esc(s.full_name)}" required></label>
     <div class="row">
       <label>المستوى<select name="level">${levelOptions(s.level || sessionStorage.getItem('levelFilter') || '5')}</select></label>
       <label>الفوج<input name="group_name" value="${esc(s.group_name)}" placeholder="مثال: أ"></label>
     </div>
     <label>تاريخ الولادة<input name="birth_date" type="date" value="${esc(s.birth_date)}"></label>
     <label>الولي
       <select name="parent_id">
         <option value="">— بدون —</option>
         ${parents
           .map((p) => `<option value="${p.id}" ${p.id === s.parent_id ? 'selected' : ''}>${esc(p.full_name)} (${esc(p.username)})</option>`)
           .join('')}
       </select>
     </label>
     <p class="muted small">أضف حساب الولي من صفحة «الأولياء» إن لم يكن موجودًا.</p>`,
    async (data) => {
      if (student) await api('PUT', `/api/students/${student.id}`, data);
      else await api('POST', '/api/students', data);
      toast('تم الحفظ');
      onDone();
    }
  );
}

// ---------- فضاء الولي ----------
async function viewMyChildren(el) {
  const { students } = await api('GET', '/api/students');
  if (students.length === 1) {
    location.hash = `#/students/${students[0].id}`;
    return;
  }
  el.innerHTML = `
    <h2>أبنائي</h2>
    ${
      students.length
        ? `<div class="cards">${students
            .map(
              (s) => `<a class="card child" href="#/students/${s.id}">
                <h3>${esc(s.full_name)}</h3>
                <span class="pill">${esc(levelLabel(s.level))}</span>
                <div class="mini-stats">
                  <span>الغيابات: <b>${s.absence_count}</b></span>
                  <span>الملاحظات: <b>${s.note_count}</b></span>
                </div>
              </a>`
            )
            .join('')}</div>`
        : '<div class="card muted">لم يتم ربط أي تلميذ بحسابك بعد. اتصل بالإدارة.</div>'
    }`;
}

// ---------- ملف التلميذ ----------
async function viewStudent(el, id) {
  const role = state.user.role;
  const { student, absences, notes } = await api('GET', `/api/students/${id}`);
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
        ${n.rating ? `<span class="badge ${n.rating}">${RATING_LABELS[n.rating]}</span>` : ''}
        <span class="muted small">${fmtDate(n.date)} · ${esc(n.author_name || '')}</span>
        ${role !== 'parent' && canDelete(n.author_id) ? `<button class="link danger" data-del-note="${n.id}">حذف</button>` : ''}
      </div>
      <p>${esc(n.content)}</p>
    </li>`;

  el.innerHTML = `
    <div class="page-head">
      <div>
        ${role !== 'parent' ? `<a href="#/students" class="muted small">→ الرجوع إلى القائمة</a>` : ''}
        <h2>${esc(student.full_name)}</h2>
        <div class="meta">
          <span class="pill">${esc(levelLabel(student.level))}</span>
          ${student.group_name ? `<span>الفوج: ${esc(student.group_name)}</span>` : ''}
          ${student.parent_name ? `<span>الولي: ${esc(student.parent_name)}</span>` : ''}
          ${student.parent_phone ? `<span dir="ltr">${esc(student.parent_phone)}</span>` : ''}
        </div>
      </div>
      ${
        role !== 'parent'
          ? `<div class="actions"><button class="btn" id="add-note">+ ملاحظة</button>
             <button class="btn warn" id="add-absence">+ غياب</button></div>`
          : ''
      }
    </div>

    <div class="stats">
      <div class="stat"><b>${absences.length}</b><span>مجموع الغيابات</span></div>
      <div class="stat warn"><b>${unjustified}</b><span>غيابات غير مبررة</span></div>
      <div class="stat"><b>${teacherNotes.length}</b><span>ملاحظات المعلمين</span></div>
      <div class="stat"><b>${adminNotes.length}</b><span>ملاحظات الإدارة</span></div>
    </div>

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

  // المواد المتاحة: المعلم يرى مواده فقط
  const mySubjects = (role === 'teacher' ? state.user.subjects || [] : state.meta.subjects).filter(
    (s) => !s.levels || s.levels.includes(student.level)
  );

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
         <label>التقييم<select name="rating">
           <option value="">—</option>
           ${Object.entries(RATING_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
         </select></label>
       </div>
       <label>التاريخ<input type="date" name="date" value="${today()}"></label>
       <label>الملاحظة<textarea name="content" rows="4" required></textarea></label>`,
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

// ---------- المستخدمون ----------
async function viewUsers(el, role) {
  const titles = { teacher: 'المعلمون', parent: 'الأولياء', admin: 'حسابات الإدارة' };
  const addLabels = { teacher: '+ معلم جديد', parent: '+ ولي جديد', admin: '+ حساب إدارة' };
  const { users } = await api('GET', `/api/users?role=${role}`);
  el.innerHTML = `
    <div class="page-head">
      <h2>${titles[role]}</h2>
      <button class="btn" id="add-user">${addLabels[role]}</button>
    </div>
    ${
      users.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الهاتف</th>
              ${role === 'teacher' ? '<th>المواد</th>' : ''}${role === 'parent' ? '<th>الأبناء</th>' : ''}<th></th></tr></thead>
            <tbody>${users
              .map(
                (u) => `<tr>
                  <td><b>${esc(u.full_name)}</b></td>
                  <td dir="ltr">${esc(u.username)}</td>
                  <td dir="ltr">${esc(u.phone || '—')}</td>
                  ${role === 'teacher' ? `<td>${u.subjects.map((s) => `<span class="pill">${esc(s.name)}</span>`).join(' ') || '—'}</td>` : ''}
                  ${
                    role === 'parent'
                      ? `<td>${u.children.map((c) => `<a href="#/students/${c.id}">${esc(c.full_name)}</a>`).join('، ') || '—'}</td>`
                      : ''
                  }
                  <td class="row-actions">
                    <button class="btn ghost small" data-edit="${u.id}">تعديل</button>
                    ${u.id !== state.user.id ? `<button class="btn danger small" data-del="${u.id}">حذف</button>` : ''}
                  </td>
                </tr>`
              )
              .join('')}</tbody></table></div>`
        : '<div class="card muted">لا توجد حسابات.</div>'
    }`;

  const reload = () => viewUsers(el, role);
  const form = (user) => {
    const u = user || {};
    const ids = new Set((u.subjects || []).map((s) => s.id));
    openModal(
      user ? 'تعديل الحساب' : addLabels[role].slice(2),
      `<label>الاسم واللقب<input name="full_name" value="${esc(u.full_name)}" required></label>
       <div class="row">
         <label>اسم المستخدم<input name="username" value="${esc(u.username)}" dir="ltr" required></label>
         <label>الهاتف<input name="phone" value="${esc(u.phone)}" dir="ltr"></label>
       </div>
       <label>${user ? 'كلمة سر جديدة (اتركها فارغة للإبقاء على القديمة)' : 'كلمة السر'}
         <input name="password" type="text" dir="ltr" ${user ? '' : 'required'} minlength="6"></label>
       ${
         role === 'teacher'
           ? `<fieldset><legend>المواد التي يدرّسها</legend><div class="checks">${state.meta.subjects
               .map(
                 (s) => `<label class="check"><input type="checkbox" name="subject_ids[]" value="${s.id}" ${ids.has(s.id) ? 'checked' : ''}> ${esc(s.name)}${s.levels ? ` <span class="muted small">(${esc(levelsText(s.levels))})</span>` : ''}</label>`
               )
               .join('')}</div></fieldset>`
           : ''
       }`,
      async (data) => {
        if (user) await api('PUT', `/api/users/${user.id}`, data);
        else await api('POST', '/api/users', { ...data, role });
        toast('تم الحفظ');
        reload();
      }
    );
  };

  $('#add-user').addEventListener('click', () => form(null));
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
  return levels ? levels.map(levelLabel).join('، ') : 'كل المستويات';
}

function subjectForm(subject, onDone) {
  const sel = new Set(subject?.levels || []);
  openModal(
    subject ? 'تعديل المادة' : 'مادة جديدة',
    `<label>اسم المادة<input name="name" value="${esc(subject?.name)}" required></label>
     <fieldset><legend>المستويات (لا تختر شيئًا = كل المستويات)</legend><div class="checks">${state.meta.levels
       .map(
         (l) => `<label class="check"><input type="checkbox" name="levels[]" value="${esc(l.code)}" ${sel.has(l.code) ? 'checked' : ''}> ${esc(l.label)}</label>`
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
          (s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(levelsText(s.levels))}</td>
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
