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
           </select></label>
           <p class="muted small">تصل رسالتك للأستاذ(ة)، والإدارة تطّلع على كل الرسائل.</p>`
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
    <div class="page-head"><h2>📊 الرؤية الإجمالية للقسم</h2>
      <div class="actions"><select id="ov-level">${all.map((l) => `<option value="${l.code}" ${l.code === level ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select>
        <a class="btn" href="#/report-class" id="ov-print">🖨 طباعة بطاقات القسم</a></div></div>
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
  $('#ov-print').addEventListener('click', () => sessionStorage.setItem('reportLevel', level));
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
          <label>كلمة السر (6 أحرف على الأقل)<input name="password" type="password" dir="ltr" required minlength="6"></label>
          <label>تأكيد كلمة السر<input name="password2" type="password" dir="ltr" required></label>
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

// ---------- رفع صور بالجملة (مثلًا صور قسم كامل) ----------
// اسم الملف يُستعمل للتعرّف على التلميذ: رقمه في البداية (57-...) أو جزء من اسمه
const normName = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ًͯ-ْ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

function guessStudent(fileName, students) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const idMatch = base.match(/^(\d{1,5})(?:\D|$)/);
  if (idMatch) {
    const s = students.find((x) => x.id === Number(idMatch[1]));
    if (s) return s.id;
  }
  const words = normName(base).split(/[^a-z0-9ء-ي]+/).filter((w) => w.length > 1);
  if (!words.length) return '';
  let best = null;
  let bestScore = 0;
  for (const s of students) {
    const name = normName(s.full_name).split(/\s+/);
    const score = words.filter((w) => name.includes(w)).length;
    if (score > bestScore) [best, bestScore] = [s, score];
    else if (score === bestScore && score > 0) best = null; // التباس: نترك الاختيار للمستعمل
  }
  return best && bestScore ? best.id : '';
}

async function viewBulkPhotos(el) {
  const { students: all } = await api('GET', '/api/students');
  const students = all.filter((s) => s.status !== 'left');
  const options = (sel) =>
    `<option value="">— اختر التلميذ —</option>` +
    students
      .slice()
      .sort((a, b) => String(a.level).localeCompare(String(b.level)) || a.full_name.localeCompare(b.full_name))
      .map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(levelLabel(s.level))} · ${esc(s.full_name)}${s.has_photo ? ' 📷' : ''}</option>`)
      .join('');
  el.innerHTML = `
    <div class="page-head"><div><h2>📷 رفع صور بالجملة</h2>
      <p class="muted">اختر عدة صور مرة واحدة، ثم حدّد لكل صورة تلميذها (يُقترح تلقائيًا حسب اسم الملف)، ثم «رفع الكل».</p></div>
      <a class="btn ghost small" href="#/students">← التلاميذ</a></div>
    <section class="card">
      <label class="btn">اختيار الصور<input id="bp-files" type="file" accept="image/*,.heic,.heif" multiple hidden></label>
      <div id="bp-list" class="bp-list"></div>
      <p><button class="btn" id="bp-go" hidden>رفع الكل</button> <span id="bp-status" class="muted small"></span></p>
    </section>`;
  let items = [];
  $('#bp-files').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    $('#bp-status').textContent = 'جاري تجهيز الصور…';
    for (const file of files) {
      const item = { file, photo: null, error: null, studentId: guessStudent(file.name, students), done: false };
      try {
        item.photo = await resizeImage(file);
      } catch (err) {
        item.error = err.message;
      }
      items.push(item);
    }
    $('#bp-status').textContent = '';
    render();
  });
  const render = () => {
    $('#bp-list').innerHTML = items
      .map(
        (it, i) => `<div class="bp-item ${it.done ? 'done' : ''}" data-i="${i}">
          ${it.photo ? `<img class="avatar lg" src="${it.photo}" alt="">` : '<span class="avatar lg">!</span>'}
          <div class="bp-body">
            <bdi class="muted small" dir="ltr">${esc(it.file.name)}</bdi>
            ${it.error ? `<span class="out small">${esc(it.error)}</span>` : it.done ? '<span class="badge good">✓ تم الرفع</span>' : `<select class="bp-sel">${options(it.studentId)}</select>`}
          </div>
          ${it.done ? '' : '<button class="btn small ghost bp-del" title="إزالة">✕</button>'}
        </div>`
      )
      .join('');
    $('#bp-go').hidden = !items.some((it) => !it.done && it.photo);
    el.querySelectorAll('.bp-sel').forEach((s) =>
      s.addEventListener('change', () => (items[Number(s.closest('.bp-item').dataset.i)].studentId = Number(s.value) || ''))
    );
    el.querySelectorAll('.bp-del').forEach((b) =>
      b.addEventListener('click', () => {
        items.splice(Number(b.closest('.bp-item').dataset.i), 1);
        render();
      })
    );
  };
  $('#bp-go').addEventListener('click', async () => {
    const todo = items.filter((it) => !it.done && it.photo);
    const ids = todo.map((it) => it.studentId).filter(Boolean);
    if (todo.some((it) => !it.studentId)) return toast('حدّد التلميذ لكل صورة أو أزل الصورة', true);
    if (new Set(ids).size !== ids.length) return toast('نفس التلميذ مختار لأكثر من صورة', true);
    const replacing = todo.filter((it) => students.find((s) => s.id === it.studentId)?.has_photo).length;
    if (replacing && !confirmAction(`${replacing} تلميذ عنده صورة من قبل، تعويضها؟`)) return;
    $('#bp-go').disabled = true;
    let ok = 0;
    for (const it of todo) {
      $('#bp-status').textContent = `جاري الرفع… ${ok + 1}/${todo.length}`;
      try {
        await api('PUT', `/api/students/${it.studentId}/photo`, { photo: it.photo });
        it.done = true;
        ok++;
      } catch (err) {
        it.error = err.message;
      }
    }
    $('#bp-go').disabled = false;
    $('#bp-status').textContent = '';
    toast(`تم رفع ${ok} صورة`);
    render();
  });
}

// ---------- رسالة لكامل القسم بضغطة زر ----------
async function viewGroupMessage(el) {
  const role = state.user.role;
  const subjects = workSubjects();
  const programClasses = role === 'admin' || state.user.program_classes ? (await api('GET', '/api/program').catch(() => ({ classes: [] }))).classes : [];
  const canSupport = role === 'admin' || subjects.length;
  el.innerHTML = `
    <div class="page-head"><div><h2>✉️ رسالة لكامل القسم</h2>
      <p class="muted">تصل الرسالة لكل أولياء القسم في نفس الوقت.</p></div></div>
    <div class="seg" id="gm-tabs">
      ${canSupport ? '<button class="chip on" data-tab="support">📚 دروس الدعم</button>' : ''}
      ${programClasses.length ? `<button class="chip ${canSupport ? '' : 'on'}" data-tab="program">🎨 البرنامج التربوي</button>` : ''}
    </div>
    <form id="gm-form" class="card">
      <div class="row" id="gm-support">
        <label>المادة<select name="subject_id" id="gm-subject">${role === 'admin' ? '<option value="">— الإدارة (كل المواد) —</option>' : ''}${subjectOptions(role === 'admin' ? state.meta.subjects : subjects)}</select></label>
        <label>المستوى<select name="level" id="gm-level"></select></label>
      </div>
      <label id="gm-program" hidden>القسم<select name="class_id">${programClasses.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('')}</select></label>
      <label>الموضوع<input name="title" placeholder="مثال: تذكير بالامتحان" required></label>
      <label>الرسالة<textarea name="body" rows="5" required></textarea></label>
      <p class="muted small" id="gm-hint"></p>
      <button class="btn">إرسال لكل أولياء القسم</button>
    </form>`;
  if (!canSupport && !programClasses.length) {
    el.querySelector('#gm-form').outerHTML = '<div class="card muted">لا يوجد قسم مسند إليك بعد.</div>';
    return;
  }
  let tab = canSupport ? 'support' : 'program';
  const levelSel = $('#gm-level');
  const fillLevels = () => {
    const sub = (role === 'admin' ? state.meta.subjects : subjects).find((s) => s.id === Number($('#gm-subject').value));
    const levels = state.meta.levels.filter((l) => {
      if (!sub) return true;
      const subjectLevels = sub.teach_levels?.length ? sub.teach_levels : sub.levels;
      return !subjectLevels || subjectLevels.includes(l.code);
    });
    levelSel.innerHTML = levels.map((l) => `<option value="${esc(l.code)}">${esc(l.label)}</option>`).join('');
  };
  $('#gm-subject').addEventListener('change', fillLevels);
  fillLevels();
  const syncTab = () => {
    $('#gm-support').hidden = tab !== 'support';
    $('#gm-program').hidden = tab !== 'program';
    $('#gm-hint').textContent =
      tab === 'support'
        ? 'تُفتح محادثة مع ولي كل تلميذ في المستوى والمادة، ويمكن لكل ولي أن يردّ عليك في «الرسائل».'
        : 'تظهر الرسالة في ملف كل طفل من أطفال القسم (أنشطة ورسائل القسم).';
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  };
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => ((tab = b.dataset.tab), syncTab())));
  syncTab();
  $('#gm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const btn = e.target.querySelector('button.btn');
    btn.disabled = true;
    try {
      if (tab === 'support') {
        const r = await api('POST', '/api/threads/group', { level: d.level, subject_id: d.subject_id || null, title: d.title, body: d.body });
        toast(`تم الإرسال إلى ${r.sent} ولي`);
      } else {
        const r = await api('POST', '/api/program/posts', { class_id: d.class_id, kind: 'message', title: d.title, body: d.body });
        toast(`تم الإرسال لأولياء القسم (${r.parents})`);
      }
      e.target.reset();
      fillLevels();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- أنشطة وتمارين ورسائل أقسام البرنامج التربوي ----------
async function viewProgramPosts(el) {
  const [{ classes }, { posts }] = await Promise.all([api('GET', '/api/program'), api('GET', '/api/program/posts')]);
  el.innerHTML = `
    <div class="page-head"><div><h2>🧩 أنشطة وتمارين ورسائل الأقسام</h2>
      <p class="muted">ما تنشره هنا يظهر لأولياء كل أطفال القسم في ملف أبنائهم.</p></div></div>
    ${
      classes.length
        ? `<form id="pp-form" class="card">
            <div class="row">
              <label>القسم<select name="class_id">${classes.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('')}</select></label>
              <label>النوع<select name="kind"><option value="activity">🧩 نشاط / تمرين</option><option value="message">✉️ رسالة</option></select></label>
            </div>
            <label>العنوان<input name="title" required placeholder="مثال: حفظ سورة الملك"></label>
            <label>التفاصيل<textarea name="body" rows="4"></textarea></label>
            <label>آخر أجل (اختياري)<input type="date" name="due_date"></label>
            ${attachFields('pp')}
            <button class="btn" id="pp-submit">نشر لكامل القسم</button>
          </form>`
        : '<div class="card muted">لا يوجد قسم مسند إليك.</div>'
    }
    <section class="card"><h3>المنشورات</h3>${
      posts.length
        ? `<ul class="tasks">${posts
            .map(
              (p) => `<li class="task"><div><b>${p.kind === 'message' ? '✉️' : '🧩'} ${esc(p.title)}</b>
                <span class="muted small">${esc(p.class_name)} · ${fmtDate(String(p.created_at).slice(0, 10))}${p.author_name ? ' · ' + esc(p.author_name) : ''}${p.due_date ? ` · آخر أجل ${fmtDate(p.due_date)}` : ''}</span>
                ${state.user.role === 'admin' || p.author_id === state.user.id ? `<button class="link danger small" data-del="${p.id}">حذف</button>` : ''}</div>
                ${p.body ? `<p>${esc(p.body)}</p>` : ''}${contentBlock(p.video_url, p.files, '/api/program-post-files/')}</li>`
            )
            .join('')}</ul>`
        : '<p class="muted">لا توجد منشورات بعد.</p>'
    }</section>`;
  const files = $('#pp-form') ? bindAttach('pp') : () => [];
  $('#pp-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#pp-submit');
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/program/posts', formData(e.target));
      for (const [i, f] of files().entries()) {
        btn.textContent = `رفع الملفات ${i + 1}/${files().length}…`;
        await api('POST', `/api/program/posts/${r.id}/files`, { filename: f.name, data: await readFileData(f) });
      }
      toast(`تم النشر لأولياء القسم (${r.parents})`);
      viewProgramPosts(el);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = 'نشر لكامل القسم';
    }
  });
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذا المنشور؟')) return;
      await api('DELETE', `/api/program/posts/${b.dataset.del}`).catch((err) => toast(err.message, true));
      viewProgramPosts(el);
    })
  );
}
