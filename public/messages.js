'use strict';
// مراسلة الأولياء، إدخال بطاقات القسم، نظرة حسب القسم، وتسجيل المعلمين بأنفسهم
// تستعمل الأدوات المعرّفة في app.js و evaluation.js

// ---------- الرسائل ----------
let mailAt = 0;
async function refreshMail(force = false) {
  if (!state.user || (!force && Date.now() - mailAt < 60000)) return;
  mailAt = Date.now();
  try {
    const { count } = await api('GET', '/api/threads/unread');
    $('#mail-count').textContent = count;
    $('#mail-count').hidden = !count;
  } catch {
    /* لا شيء */
  }
}

const threadTarget = (t) => (t.target === 'admin' ? 'الإدارة' : `أستاذ(ة) ${t.subject_name || 'المادة'}`);
const fmtTime = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function viewMessages(el) {
  const filter = sessionStorage.getItem('msgFilter') || 'open';
  const { threads } = await api('GET', '/api/threads' + (filter === 'all' ? '' : `?status=${filter}`));
  const role = state.user.role;
  el.innerHTML = `
    <div class="page-head"><h2>✉️ الرسائل</h2></div>
    <div class="class-chips">${Object.entries({ open: 'مفتوحة', closed: 'مغلقة', all: 'الكل' })
      .map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${v}</button>`)
      .join('')}</div>
    <p class="muted small">${
      role === 'parent'
        ? 'لمراسلة أستاذ(ة) مادة أو الإدارة: افتح ملف ابنك واضغط «✉️ مراسلة».'
        : 'محادثات الأولياء حول أبنائهم. لبدء محادثة مع وليّ: من ملف التلميذ «✉️ مراسلة الولي».'
    }</p>
    ${
      threads.length
        ? `<div class="threads">${threads
            .map(
              (t) => `<a class="card thread ${t.unread ? 'unread' : ''} ${t.status}" href="#/messages/${t.id}">
                <div class="section-head"><b>${esc(t.student_name)}</b>
                  <span>${t.unread ? `<span class="count-badge">${t.unread}</span>` : ''} ${t.status === 'closed' ? '<span class="badge general">مغلقة</span>' : ''}</span></div>
                <div class="muted small">${role === 'parent' ? '' : `${esc(t.created_by_name || '')} ← `}${esc(threadTarget(t))} · ${fmtTime(t.updated_at)}</div>
                ${t.title ? `<div><b>${esc(t.title)}</b></div>` : ''}
                <p class="small">${esc((t.last_body || '').slice(0, 140))}</p>
              </a>`
            )
            .join('')}</div>`
        : '<div class="card muted">لا توجد محادثات.</div>'
    }`;
  el.querySelectorAll('[data-f]').forEach((b) =>
    b.addEventListener('click', () => {
      sessionStorage.setItem('msgFilter', b.dataset.f);
      viewMessages(el);
    })
  );
}

async function viewThread(el, id) {
  const { thread: t, messages } = await api('GET', `/api/threads/${id}`);
  refreshMail(true);
  const role = state.user.role;
  el.innerHTML = `
    <a href="#/messages" class="muted small">→ الرسائل</a>
    <div class="page-head">
      <div><h2>${esc(t.title || threadTarget(t))}</h2>
        <div class="meta"><a class="pill" href="#/students/${t.student_id}">${esc(t.student_name)}</a>
          <span>${esc(threadTarget(t))}</span>${t.status === 'closed' ? '<span class="badge general">مغلقة</span>' : ''}</div></div>
      ${role !== 'parent' ? `<button class="btn ghost" id="th-status">${t.status === 'open' ? '✔ إغلاق المحادثة' : 'إعادة فتح'}</button>` : ''}
    </div>
    <div class="chat">${messages
      .map(
        (m) => `<div class="bubble ${m.mine ? 'mine' : ''}"><div class="who-line">${esc(m.from)} · ${fmtTime(m.created_at)}</div>
          <p>${esc(m.body)}</p></div>`
      )
      .join('')}</div>
    <form id="th-reply" class="card">
      <label>ردّ<textarea name="body" rows="3" required placeholder="اكتب رسالتك…"></textarea></label>
      <button class="btn">إرسال</button>
    </form>`;
  el.querySelector('.chat .bubble:last-child')?.scrollIntoView({ block: 'nearest' });
  $('#th-reply').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', `/api/threads/${id}/messages`, formData(e.target));
      viewThread(el, id);
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#th-status')?.addEventListener('click', async () => {
    await api('PATCH', `/api/threads/${id}`, { status: t.status === 'open' ? 'closed' : 'open' });
    viewThread(el, id);
  });
}

// محادثة جديدة من ملف التلميذ
function newThreadForm(student, subjects) {
  const role = state.user.role;
  const mine = role === 'teacher' ? subjects.filter((x) => (state.user.subjects || []).some((s) => s.id === x.id)) : subjects;
  openModal(
    role === 'parent' ? 'مراسلة' : 'مراسلة الولي',
    `<p class="muted small">${esc(student.full_name)}</p>
     ${
       role === 'parent'
         ? `<label>إلى<select name="target_pick">
             <option value="admin">إدارة فيد</option>
             ${mine.map((x) => `<option value="${x.id}">أستاذ(ة) ${esc(x.name)}</option>`).join('')}
           </select></label>`
         : role === 'teacher'
           ? `<label>المادة<select name="target_pick">${mine.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`
           : '<input type="hidden" name="target_pick" value="admin">'
     }
     <label>الموضوع (اختياري)<input name="title" maxlength="150"></label>
     <label>الرسالة<textarea name="body" rows="4" required></textarea></label>`,
    async (data) => {
      const subjectId = data.target_pick === 'admin' ? null : Number(data.target_pick);
      const { thread } = await api('POST', '/api/threads', {
        student_id: student.id,
        target: subjectId ? 'subject' : 'admin',
        subject_id: subjectId,
        title: data.title,
        body: data.body,
      });
      location.hash = `#/messages/${thread.id}`;
    }
  );
}

// ---------- إدخال بطاقات التقييم لقسم كامل (من البطاقات الورقية) ----------
// المستويات والمواد المتاحة: المعلم في موادّه ومستوياته فقط
function cardChoices() {
  const subjects = state.user.role === 'teacher' ? state.user.subjects || [] : state.meta.subjects;
  const levels = state.meta.levels.filter((l) => subjects.some((x) => subjectLevels(x).some((y) => y.code === l.code)));
  return { subjects, levels };
}

async function viewEvaluations(el) {
  const { subjects, levels } = cardChoices();
  if (!levels.length) {
    el.innerHTML = '<h2>📝 إدخال بطاقات التقييم</h2><div class="card muted">لا توجد مواد مسندة إليك.</div>';
    return;
  }
  const level = levels.some((l) => l.code === sessionStorage.getItem('cardLevel')) ? sessionStorage.getItem('cardLevel') : levels[0].code;
  const levelSubjects = subjects.filter((x) => subjectLevels(x).some((y) => y.code === level));
  const subjectId = levelSubjects.some((x) => String(x.id) === sessionStorage.getItem('cardSubject'))
    ? Number(sessionStorage.getItem('cardSubject'))
    : levelSubjects[0].id;
  const month = sessionStorage.getItem('cardMonth') || today().slice(0, 7);
  const data = await api('GET', `/api/evaluations?level=${encodeURIComponent(level)}&subject_id=${subjectId}&month=${month}`);
  const sel = (name, words, v) =>
    `<select name="${name}"><option value="">—</option>${Object.entries(words)
      .map(([k, w]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${w}</option>`)
      .join('')}</select>`;
  el.innerHTML = `
    <div class="page-head"><h2>📝 إدخال بطاقات التقييم</h2></div>
    <p class="muted small">قسم كامل في مادة واحدة لشهر واحد، كما في البطاقة الورقية. ما تكتبه هنا يظهر في بطاقة التقييم وفي ملف التلميذ (ويراه الولي).</p>
    <div class="filters">
      <select id="cv-level">${levels.map((l) => `<option value="${l.code}" ${l.code === level ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select>
      <select id="cv-subject">${levelSubjects.map((x) => `<option value="${x.id}" ${x.id === subjectId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <input type="month" id="cv-month" value="${month}">
    </div>
    ${
      data.students.length
        ? `<form id="cv-form">
            ${data.students
              .map(
                (st) => `<div class="card cv-row" data-id="${st.id}">
                  <div class="cv-name">${avatar(st, 'sm')} <b>${esc(st.full_name)}</b></div>
                  <div class="row">
                    <label>المستوى${sel('rating', LEVEL_WORDS, st.card?.rating)}</label>
                    <label>السلوك${sel('behavior', BEHAVIOR_WORDS, st.card?.behavior)}</label>
                  </div>
                  <label>الملاحظة<textarea name="content" rows="2">${esc(st.card?.content || '')}</textarea></label>
                </div>`
              )
              .join('')}
            <div class="sticky-save"><button class="btn">حفظ بطاقات ${data.students.length} تلميذ</button></div>
          </form>`
        : '<div class="card muted">لا يوجد تلاميذ يدرسون هذه المادة في هذا المستوى.</div>'
    }`;
  const reload = () => {
    sessionStorage.setItem('cardLevel', $('#cv-level').value);
    sessionStorage.setItem('cardSubject', $('#cv-subject').value);
    sessionStorage.setItem('cardMonth', $('#cv-month').value);
    viewEvaluations(el);
  };
  $('#cv-level').addEventListener('change', () => {
    sessionStorage.removeItem('cardSubject');
    reload();
  });
  $('#cv-subject').addEventListener('change', reload);
  $('#cv-month').addEventListener('change', reload);
  $('#cv-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entries = [...el.querySelectorAll('.cv-row')].map((r) => ({
      student_id: Number(r.dataset.id),
      rating: r.querySelector('[name=rating]').value,
      behavior: r.querySelector('[name=behavior]').value,
      content: r.querySelector('[name=content]').value,
    }));
    try {
      const { saved } = await api('POST', '/api/evaluations', { level, subject_id: subjectId, month, entries });
      toast(`تم حفظ ${saved} بطاقة`);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- نظرة حسب القسم: التلاميذ × المواد ----------
async function viewOverview(el) {
  const { levels } = cardChoices();
  const all = state.user.role === 'admin' ? state.meta.levels : levels;
  if (!all.length) {
    el.innerHTML = '<h2>📊 نظرة حسب القسم</h2><div class="card muted">لا توجد مواد مسندة إليك.</div>';
    return;
  }
  const level = all.some((l) => l.code === sessionStorage.getItem('ovLevel')) ? sessionStorage.getItem('ovLevel') : all[0].code;
  const ov = await api('GET', `/api/overview?level=${encodeURIComponent(level)}`);
  const cell = (c) =>
    c === null
      ? '<td class="na">—</td>'
      : `<td>${c.level ? `<span class="rc-bd" style="--c:${CARD_COLORS[c.level]}">${LEVEL_WORDS[c.level]}</span>` : '<span class="muted">·</span>'}
          ${c.behavior ? `<div class="small" style="color:${CARD_COLORS[c.behavior]}">${BEHAVIOR_WORDS[c.behavior]}</div>` : ''}
          ${c.date ? `<div class="muted tiny">${fmtDate(c.date)}</div>` : ''}</td>`;
  el.innerHTML = `
    <div class="page-head"><h2>📊 نظرة حسب القسم</h2>
      <select id="ov-level">${all.map((l) => `<option value="${l.code}" ${l.code === level ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></div>
    <div class="stats compact">${Object.entries(LEVEL_WORDS)
      .map(([k, w]) => `<div class="stat"><b style="color:${CARD_COLORS[k]}">${ov.counts[k]}</b><span>${w}</span></div>`)
      .join('')}</div>
    ${
      ov.students.length
        ? `<div class="table-wrap"><table class="overview">
            <thead><tr><th>التلميذ</th>${ov.subjects.map((x) => `<th>${esc(x.name)}</th>`).join('')}</tr></thead>
            <tbody>${ov.students
              .map((st) => `<tr><th><a href="#/students/${st.id}">${esc(st.full_name)}</a></th>${st.cells.map(cell).join('')}</tr>`)
              .join('')}</tbody></table></div>
          <p class="muted small">في كل خانة: آخر مستوى، آخر سلوك، وتاريخ آخر ملاحظة. «—» = لا يدرس هذه المادة.</p>`
        : '<div class="card muted">لا يوجد تلاميذ في هذا المستوى.</div>'
    }`;
  $('#ov-level').addEventListener('change', () => {
    sessionStorage.setItem('ovLevel', $('#ov-level').value);
    viewOverview(el);
  });
}

// ---------- المعلم يسجّل نفسه (تفعّله الإدارة) ----------
async function viewRegisterTeacher(el) {
  const meta = await api('GET', '/api/public/meta');
  el.innerHTML = `
    <div class="register">
      <div class="login-hero">
        <img src="feed-logo-white.png" alt="فيد">
        <span class="tag">حساب مدرّس</span>
        <h1>انضمّ إلى فريق <em>فيد</em></h1>
      </div>
      <form id="treg-form" class="card" novalidate>
        <label>الاسم واللقب<input name="full_name" required></label>
        <div class="row">
          <label>الهاتف<input name="phone" required dir="ltr" inputmode="tel" placeholder="22 123 456"></label>
          <label>البريد الإلكتروني (اختياري)<input name="email" type="email" dir="ltr"></label>
        </div>
        <div class="row">
          <label>كلمة السر (6 أحرف على الأقل)<input name="password" type="password" required minlength="6"></label>
          <label>تأكيد كلمة السر<input name="password2" type="password" required></label>
        </div>
        <fieldset><legend>المواد التي أدرّسها</legend><div class="checks">${meta.subjects
          .map((x) => `<label class="check"><input type="checkbox" name="subject_ids[]" value="${x.id}"> ${esc(x.name)}</label>`)
          .join('')}</div></fieldset>
        <input name="website" class="hp" tabindex="-1" autocomplete="off">
        <p class="error" id="treg-error" hidden></p>
        <button class="btn block" id="treg-submit">إرسال الطلب</button>
        <p class="muted small center">تراجع الإدارة طلبك وتحدّد موادّك ومستوياتك، ثم تدخل برقم هاتفك وكلمة سرّك.</p>
        <p class="center"><a href="#/login">عندي حساب، الدخول</a></p>
      </form>
    </div>`;
  $('#treg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    const err = $('#treg-error');
    try {
      if (data.password !== data.password2) throw new Error('كلمتا السر غير متطابقتين');
      $('#treg-submit').disabled = true;
      const { username } = await api('POST', '/api/register', { role: 'teacher', website: data.website, teacher: data });
      e.target.innerHTML = `<h3>✅ وصل طلبك</h3>
        <p>حسابك في انتظار موافقة إدارة فيد. بعد التفعيل ادخل باسم المستخدم <b dir="ltr">${esc(username)}</b> وكلمة سرّك.</p>
        <p class="center"><a class="btn" href="#/login">صفحة الدخول</a></p>`;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      $('#treg-submit').disabled = false;
    }
  });
}
