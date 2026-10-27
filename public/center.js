'use strict';
// إدارة المركز: كل التلاميذ، المتخلّد بذمتهم، الوصولات، التعريفات، المهام، الاجتماعات، التنبيهات

const PROGRAM_TYPE_LABELS = {
  support: '📚 دعم',
  program: '🎨 تربوي',
  holiday: '📘 دورة',
  summer: '☀️ دورة صيفية',
  other: '👥 مجموعة',
  activity: '🎭 نشاط',
  trip: '🚌 رحلة',
  camp: '⛺ مخيم',
};

// ---------- كل تلاميذ المركز ----------
async function viewPeople(el) {
  const { people } = await api('GET', '/api/center/people');
  const types = ['support', 'program', 'courses'];
  const count = (t) =>
    people.filter((p) => p.programs.some((x) => (t === 'courses' ? !['support', 'program'].includes(x.type) : x.type === t))).length;
  el.innerHTML = `
    <h2>👥 كل تلاميذ المركز</h2>
    <p class="muted">كل شخص مرة واحدة، مع البرامج المسجّل فيها: دروس الدعم، البرنامج التربوي، الدورات والأنشطة والرحلات.</p>
    <div class="filters">
      <input id="pp-q" type="search" placeholder="بحث بالاسم أو الهاتف…">
      <select id="pp-type">
        <option value="">الكل (${people.length})</option>
        <option value="support">دروس الدعم (${count('support')})</option>
        <option value="program">البرنامج التربوي (${count('program')})</option>
        <option value="courses">الدورات والأنشطة (${count('courses')})</option>
        <option value="multi">مسجّل في أكثر من برنامج (${people.filter((p) => new Set(p.programs.map((x) => x.type)).size > 1).length})</option>
      </select>
    </div>
    <div id="pp-list"></div>`;
  const render = () => {
    const q = $('#pp-q').value.trim().toLowerCase();
    const t = $('#pp-type').value;
    const list = people.filter((p) => {
      if (q && !`${p.full_name} ${p.parent_name || ''} ${p.phone || ''}`.toLowerCase().includes(q)) return false;
      if (t === 'multi') return new Set(p.programs.map((x) => x.type)).size > 1;
      if (t === 'courses') return p.programs.some((x) => !['support', 'program'].includes(x.type));
      return !t || p.programs.some((x) => x.type === t);
    });
    $('#pp-list').innerHTML = list.length
      ? `<p class="muted small">${list.length} شخص</p><div class="table-wrap"><table>
          <thead><tr><th>الاسم</th><th>الولي</th><th>البرامج</th></tr></thead>
          <tbody>${list
            .map(
              (p) => `<tr>
                <td><span class="who-cell">${p.student_id ? avatar(p, 'sm') : `<span class="avatar sm">${esc(p.full_name.charAt(0))}</span>`}<b>${esc(p.full_name)}</b></span></td>
                <td>${esc(p.parent_name || '—')}${p.phone ? `<div class="phone-line small"><span dir="ltr">${esc(p.phone)}</span>${waButton(p.phone)}</div>` : ''}</td>
                <td><div class="programs">${p.programs
                  .map(
                    (x) => `<a class="prog-tag ${x.status === 'left' || x.status === 'cancelled' || x.status === 'stopped' ? 'off' : ''}" href="${x.link}">
                      ${PROGRAM_TYPE_LABELS[x.type] || x.type}: ${esc(x.label || '')}</a>`
                  )
                  .join('')}</div></td>
              </tr>`
            )
            .join('')}</tbody></table></div>`
      : '<div class="card muted">لا نتائج.</div>';
  };
  let timer;
  $('#pp-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 200);
  });
  $('#pp-type').addEventListener('change', render);
  void types;
  render();
}

// ---------- الأولياء المتخلّد بذمتهم ----------
async function viewDebts(el) {
  const { families, total } = await api('GET', '/api/debts');
  const high = families.filter((f) => f.severity === 'high');
  el.innerHTML = `
    <h2>💸 الأولياء المتخلّد بذمتهم</h2>
    <div class="stats compact">
      <div class="stat warn"><b>${fmtMoney(total)}</b><span>مجموع الديون</span></div>
      <div class="stat"><b>${families.length}</b><span>عائلة</span></div>
      <div class="stat loss"><b>${high.length}</b><span>متأخرة شهرين أو أكثر</span></div>
    </div>
    <div class="filters">
      <select id="db-sev">
        <option value="">الكل</option>
        <option value="high">⛔ شهران أو أكثر</option>
        <option value="medium">⚠️ شهر واحد</option>
        <option value="low">الشهر الحالي فقط</option>
      </select>
      <button class="btn wa" id="db-remind-all">${WA_ICON} تذكير كل المعروضين</button>
    </div>
    <div id="db-list"></div>
    <p class="muted small">العائلة = نفس رقم الهاتف (أو نفس الاسم): ديون كل الأبناء في كل البرامج مجمّعة. الترتيب حسب الأقدم ثم الأكبر.</p>`;
  const reminder = (f) =>
    `السلام عليكم ${f.name || ''}،\nنذكّركم بأن المبالغ المتبقية لدى مركز فيد هي ${fmtMoney(f.total)}:\n${f.items
      .map((i) => `- ${i.label}: ${fmtMoney(i.amount)}`)
      .join('\n')}\nشكرًا لتفهمكم، إدارة فيد`;
  const render = () => {
    const sev = $('#db-sev').value;
    const list = families.filter((f) => !sev || f.severity === sev);
    $('#db-list').innerHTML = list.length
      ? `<div class="debts">${list
          .map(
            (f, i) => `<div class="card debt ${f.severity}">
              <div class="section-head">
                <div><b>${f.severity === 'high' ? '⛔' : f.severity === 'medium' ? '⚠️' : '🕓'} ${esc(f.name || `ولي ${f.items[0].student}`)}</b>
                  ${f.phone ? `<span class="phone-line small"><span dir="ltr">${esc(f.phone)}</span></span>` : ''}
                  <div class="muted small">${f.months_late ? `متأخر منذ ${f.months_late} شهر (منذ ${esc(monthLabel(f.oldest))})` : 'الشهر الحالي'}</div></div>
                <div class="debt-total"><b class="owed">${fmtMoney(f.total)}</b>
                  ${waNumber(f.phone) ? `<a class="btn wa small" target="_blank" rel="noopener" data-i="${i}" href="${esc(waUrl(f.phone, reminder(f)))}">${WA_ICON} تذكير</a>` : ''}</div>
              </div>
              <ul class="debt-items">${f.items
                .map((x) => `<li><a href="${x.link}">${esc(x.label)}</a><span>${fmtMoney(x.amount)}</span></li>`)
                .join('')}</ul>
            </div>`
          )
          .join('')}</div>`
      : '<div class="card muted">لا توجد ديون 🎉</div>';
    $('#db-list').querySelectorAll('a.wa').forEach((a) => a.addEventListener('click', () => a.classList.add('sent')));
  };
  $('#db-sev').addEventListener('change', render);
  $('#db-remind-all').addEventListener('click', () => {
    const links = [...$('#db-list').querySelectorAll('a.btn.wa:not(.sent)')];
    if (!links.length) return toast('تم فتح كل التذكيرات');
    links[0].click();
    window.open(links[0].href, '_blank', 'noopener');
    toast(`بقي ${links.length - 1} تذكير — اضغط مرة أخرى للتالي`);
  });
  render();
}

// ---------- الوصولات ----------
async function viewReceipts(el) {
  el.innerHTML = `
    <div class="page-head"><h2>🧾 الوصولات</h2>${monthPicker('rc-month')}</div>
    <div id="rc-list"></div>
    <p class="muted small">كل دفعة تُسجَّل (دروس الدعم، البرنامج التربوي، الدورات والأنشطة) تأخذ رقم وصل تسلسليًا واحدًا للمركز.</p>`;
  const load = async () => {
    const { receipts } = await api('GET', '/api/receipts?month=' + $('#rc-month').value);
    const total = receipts.reduce((t, r) => t + r.amount, 0);
    $('#rc-list').innerHTML = receipts.length
      ? `<div class="stats compact"><div class="stat good"><b>${fmtMoney(total)}</b><span>${receipts.length} وصل</span></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>رقم</th><th>التاريخ</th><th>المستفيد</th><th>البرنامج</th><th>الطريقة</th><th>المبلغ</th><th></th></tr></thead>
          <tbody>${receipts
            .map(
              (r) => `<tr><td><b>${r.receipt_no}</b></td><td>${fmtDate(r.paid_on)}</td><td>${esc(r.beneficiary)}</td>
                <td>${esc(r.program)}</td><td>${esc(PAYMENT_LABELS[r.method] || r.method || '—')}</td><td><b>${fmtMoney(r.amount)}</b></td>
                <td><a class="btn ghost small" href="#/receipt/${r.kind}/${r.id}">🧾 الوصل</a></td></tr>`
            )
            .join('')}</tbody></table></div>`
      : '<div class="card muted">لا توجد وصولات في هذا الشهر.</div>';
  };
  bindMonth('rc-month', load);
  await load();
}

async function viewReceipt(el, kind, id) {
  const { receipt: r } = await api('GET', `/api/receipts/${kind}/${id}`);
  const back = state.user.role === 'admin' ? '#/receipts' : '#/students';
  const waText = `وصل خلاص رقم ${r.receipt_no} — مركز فيد\nالتاريخ: ${fmtDate(r.paid_on)}\nالمستفيد: ${r.beneficiary}\n${r.program}${
    r.month ? ` — شهر ${monthLabel(r.month)}` : ''
  }\nالمبلغ: ${fmtMoney(r.amount)}\nشكرًا لكم.`;
  el.innerHTML = `
    <div class="page-head no-print">
      <a href="${back}" class="muted small">→ رجوع</a>
      <div class="actions">
        ${waNumber(r.phone) && state.user.role === 'admin' ? `<a class="btn wa" target="_blank" rel="noopener" href="${esc(waUrl(r.phone, waText))}">${WA_ICON} إرسال للولي</a>` : ''}
        <button class="btn" id="rc-print">🖨 طباعة</button>
      </div>
    </div>
    <div class="receipt print-area">
      <div class="receipt-head">
        <img src="feed-logo.png" alt="فيد">
        <div><h2>وصل خلاص</h2><p class="muted">مركز فيد التربوي</p></div>
        <div class="receipt-no">رقم<b>${r.receipt_no}</b></div>
      </div>
      <dl class="receipt-body">
        <dt>التاريخ</dt><dd>${fmtDate(r.paid_on)}</dd>
        <dt>تسلّمنا من</dt><dd>${esc(r.payer || '—')}</dd>
        <dt>لفائدة</dt><dd><b>${esc(r.beneficiary)}</b>${r.level ? ` — ${esc(levelLabel(r.level))}` : ''}</dd>
        <dt>البرنامج</dt><dd>${esc(r.program)}${r.month ? ` — شهر ${esc(monthLabel(r.month))}` : ''}</dd>
        <dt>طريقة الدفع</dt><dd>${esc(PAYMENT_LABELS[r.method] || r.method || '—')}</dd>
        ${r.note ? `<dt>ملاحظة</dt><dd>${esc(r.note)}</dd>` : ''}
      </dl>
      <div class="receipt-amount">المبلغ: <b>${fmtMoney(r.amount)}</b></div>
      <div class="receipt-sign"><span>الإمضاء والختم</span></div>
    </div>`;
  $('#rc-print').addEventListener('click', () => window.print());
}

// ---------- التعريفات والتخفيضات ----------
async function viewFees(el) {
  const { support, classes, family, school_year, registration_fee } = await api('GET', '/api/settings/fees');
  const { courses } = await api('GET', '/api/courses');
  el.innerHTML = `
    <h2>🏷️ التعريفات والتخفيضات</h2>
    <form id="fees-form">
      <section class="card">
        <h3>📚 دروس الدعم — المعلوم الشهري لكل مستوى</h3>
        <p class="muted small">يُقترح تلقائيًا عند إضافة تلميذ جديد، ويمكن تغييره لكل تلميذ.</p>
        <div class="fee-grid">${state.meta.levels
          .map((l) => `<label>${esc(l.label)}<input name="s_${esc(l.code)}" inputmode="decimal" value="${esc(support[l.code] ?? '')}" placeholder="د.ت"></label>`)
          .join('')}</div>
      </section>
      <section class="card">
        <h3>🎨 البرنامج التربوي — المعلوم الشهري لكل قسم</h3>
        ${
          classes.length
            ? `<div class="fee-grid">${classes
                .map((k) => `<label>${esc(k.name)}${k.age_range ? ` <small class="muted">(${esc(k.age_range)})</small>` : ''}
                  <input name="c_${k.id}" inputmode="decimal" value="${esc(k.default_fee ?? '')}" placeholder="د.ت"></label>`)
                .join('')}</div>`
            : '<p class="muted">لا توجد أقسام بعد — أضفها من صفحة البرنامج التربوي.</p>'
        }
      </section>
      <section class="card">
        <h3>🪪 معلوم التسجيل السنوي — ${esc(school_year)}</h3>
        <p class="muted small">يُدفع مرة واحدة لكل طفل في السنة الدراسية، حتى لو كان في دروس الدعم والبرنامج التربوي معًا. اتركه فارغًا إن لم يكن هناك معلوم تسجيل.</p>
        <div class="fee-grid"><label>المبلغ (د.ت)<input name="registration_fee" inputmode="decimal" value="${esc(registration_fee ?? '')}" placeholder="د.ت"></label></div>
      </section>
      <section class="card">
        <h3>👨‍👩‍👧 تخفيض الإخوة</h3>
        <p class="muted small">نسبة تُخصم من المعلوم الشهري لكل طفل في العائلة (نفس حساب الولي)، حسب عدد الأبناء المسجّلين في ذلك الشهر في دروس الدعم أو البرنامج التربوي.
          الطفل المسجّل في البرنامجين يُحسب مرة واحدة، والمجاني لا يُحسب.</p>
        <div class="fee-grid">
          <label>أخوان (%)<input name="family_two" inputmode="decimal" value="${esc(family.two ?? '')}" placeholder="مثال: 10"></label>
          <label>ثلاثة إخوة أو أكثر (%)<input name="family_three" inputmode="decimal" value="${esc(family.three ?? '')}" placeholder="مثال: 15"></label>
        </div>
      </section>
      <button class="btn">حفظ التعريفات</button>
    </form>
    <section class="card">
      <h3>🏕️ الدورات والأنشطة — معلوم كل واحدة</h3>
      ${
        courses.length
          ? `<ul class="levels">${courses
              .map((c) => `<li><a href="#/courses/${c.id}">${COURSE_KIND_ICONS[c.kind]} ${esc(c.name)}</a><b>${c.price ? fmtMoney(c.price) : '—'}</b></li>`)
              .join('')}</ul>`
          : '<p class="muted">لا توجد دورات بعد.</p>'
      }
    </section>
    <section class="card">
      <h3>ℹ️ التخفيضات والتسبقة والأقساط</h3>
      <ul class="help">
        <li><b>التخفيض:</b> في بطاقة كل تلميذ أو طفل (تخفيض شهري بالدينار وسببه، مثل منحة)، وفي كل مشارك في دورة. خانة «مجاني» للإعفاء الكامل.
          تخفيض الإخوة يُحسب وحده بالنسب أعلاه.</li>
        <li><b>التسبقة:</b> سجّل دفعة لشهر قادم (أو مبلغًا أكبر من المستحق): يظهر «رصيد مسبق» ويُخصم تلقائيًا.</li>
        <li><b>الأقساط:</b> معلوم الدورة أو الرحلة يُدفع على عدّة دفعات؛ كل دفعة بوصل، والباقي يظهر حتى الخلاص الكامل.</li>
      </ul>
    </section>`;
  $('#fees-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    try {
      await api('PUT', '/api/settings/fees', {
        support: Object.fromEntries(state.meta.levels.map((l) => [l.code, data[`s_${l.code}`]])),
        classes: classes.map((k) => ({ id: k.id, default_fee: data[`c_${k.id}`] })),
        family: { two: data.family_two, three: data.family_three },
        registration_fee: data.registration_fee,
      });
      toast('تم حفظ التعريفات');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- المهام والمشاكل ----------
const PRIORITY_LABELS = { urgent: ['عاجل', 'weak'], high: ['مهم', 'average'], normal: ['عادي', 'general'] };
const TODO_STATUS = { todo: 'للإنجاز', doing: 'بصدد الإنجاز', done: 'أُنجزت' };

async function viewTodo(el) {
  const isAdmin = state.user.role === 'admin';
  const showDone = sessionStorage.getItem('todoDone') === '1';
  const { tasks } = await api('GET', '/api/todo' + (showDone ? '?done=1' : ''));
  const staffUsers = isAdmin
    ? [...(await api('GET', '/api/users?role=admin')).users, ...(await api('GET', '/api/users?role=teacher')).users]
    : [];
  const now = today();
  const late = (t) => t.status !== 'done' && t.due_date && t.due_date < now;
  const columns = isAdmin ? ['todo', 'doing', 'done'] : ['todo', 'doing', 'done'];
  el.innerHTML = `
    <div class="page-head">
      <h2>${isAdmin ? '🗂️ المهام والمشاكل' : '🗂️ مهامي'}</h2>
      <div class="actions">
        <label class="check small"><input type="checkbox" id="td-done" ${showDone ? 'checked' : ''}> عرض المنجزة</label>
        ${isAdmin ? '<button class="btn warn" id="add-problem">+ مشكلة عاجلة</button><button class="btn" id="add-task">+ مهمة</button>' : ''}
      </div>
    </div>
    <div class="board">${columns
      .filter((c) => c !== 'done' || showDone)
      .map(
        (col) => `<div class="board-col"><h4>${TODO_STATUS[col]} <span class="muted">(${tasks.filter((t) => t.status === col).length})</span></h4>
          ${tasks
            .filter((t) => t.status === col)
            .map(
              (t) => `<div class="task-card ${t.kind} ${late(t) ? 'late' : ''}">
                <div class="note-head">
                  ${t.kind === 'problem' ? '<span class="badge weak">⚠️ مشكلة</span>' : ''}
                  <span class="badge ${PRIORITY_LABELS[t.priority][1]}">${PRIORITY_LABELS[t.priority][0]}</span>
                  ${t.due_date ? `<span class="small ${late(t) ? 'out' : 'muted'}">📅 ${fmtDate(t.due_date)}${late(t) ? ' — متأخرة' : ''}</span>` : ''}
                </div>
                <b>${esc(t.title)}</b>
                ${t.description ? `<p class="small">${esc(t.description)}</p>` : ''}
                <div class="muted small">👤 ${esc(t.assignee || 'غير مُسند')}${t.decision_id ? ' · 📌 من قرار' : ''}</div>
                <div class="task-actions">
                  ${col !== 'doing' && col !== 'done' ? `<button class="link" data-st="doing" data-id="${t.id}">بدأت</button>` : ''}
                  ${col !== 'done' ? `<button class="link" data-st="done" data-id="${t.id}">✔ أُنجزت</button>` : `<button class="link" data-st="todo" data-id="${t.id}">إعادة فتح</button>`}
                  ${isAdmin ? `<button class="link" data-edit="${t.id}">تعديل</button><button class="link danger" data-del="${t.id}">حذف</button>` : ''}
                </div>
              </div>`
            )
            .join('') || '<p class="muted small">—</p>'}
        </div>`
      )
      .join('')}</div>`;
  const reload = () => viewTodo(el);
  $('#td-done').addEventListener('change', (e) => {
    sessionStorage.setItem('todoDone', e.target.checked ? '1' : '');
    reload();
  });
  const form = (t, kind = 'task') =>
    openModal(
      t ? 'تعديل' : kind === 'problem' ? 'مشكلة عاجلة' : 'مهمة جديدة',
      `<input type="hidden" name="kind" value="${t?.kind || kind}">
       <label>${(t?.kind || kind) === 'problem' ? 'المشكلة' : 'المهمة'}<input name="title" value="${esc(t?.title || '')}" required></label>
       <label>التفاصيل<textarea name="description" rows="3">${esc(t?.description || '')}</textarea></label>
       <div class="row">
         <label>المسؤول<select name="assignee_user_id"><option value="">— آخر (اكتب الاسم) —</option>${staffUsers
           .map((u) => `<option value="${u.id}" ${t?.assignee_user_id === u.id ? 'selected' : ''}>${esc(u.full_name)} (${ROLE_LABELS[u.role]})</option>`)
           .join('')}</select></label>
         <label>أو اسم المسؤول<input name="assignee_name" value="${esc(t?.assignee_name || '')}" placeholder="مثال: المربية نادية"></label>
       </div>
       <div class="row">
         <label>الأولوية<select name="priority">${Object.entries(PRIORITY_LABELS)
           .map(([k, [v]]) => `<option value="${k}" ${(t?.priority || (kind === 'problem' ? 'urgent' : 'normal')) === k ? 'selected' : ''}>${v}</option>`)
           .join('')}</select></label>
         <label>آجال الإنجاز<input type="date" name="due_date" value="${esc(t?.due_date || '')}"></label>
       </div>
       <label>الحالة<select name="status">${Object.entries(TODO_STATUS)
         .map(([k, v]) => `<option value="${k}" ${(t?.status || 'todo') === k ? 'selected' : ''}>${v}</option>`)
         .join('')}</select></label>`,
      async (data) => {
        if (t) await api('PUT', `/api/todo/${t.id}`, data);
        else await api('POST', '/api/todo', data);
        toast('تم الحفظ');
        bellAt = 0;
        reload();
      }
    );
  $('#add-task')?.addEventListener('click', () => form(null, 'task'));
  $('#add-problem')?.addEventListener('click', () => form(null, 'problem'));
  el.querySelectorAll('[data-st]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('PATCH', `/api/todo/${b.dataset.id}`, { status: b.dataset.st }).catch((err) => toast(err.message, true));
      bellAt = 0;
      reload();
    })
  );
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(tasks.find((t) => t.id === Number(b.dataset.edit)))));
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذه المهمة؟')) return;
      await api('DELETE', `/api/todo/${b.dataset.del}`).catch((err) => toast(err.message, true));
      reload();
    })
  );
}

// ---------- الاجتماعات والقرارات ----------
const DECISION_STATUS = { open: ['مفتوح', 'average'], done: ['نُفّذ', 'good'], cancelled: ['أُلغي', 'general'] };

async function viewMeetings(el) {
  const { meetings, open_decisions } = await api('GET', '/api/meetings');
  const now = today();
  el.innerHTML = `
    <div class="page-head"><h2>📝 الاجتماعات والقرارات</h2><button class="btn" id="add-meeting">+ اجتماع</button></div>
    ${
      open_decisions.length
        ? `<section class="card"><h3>📌 قرارات بصدد التنفيذ (${open_decisions.length})</h3><ul class="levels">${open_decisions
            .map(
              (d) => `<li><span>${esc(d.text)} <span class="muted small">${esc(d.owner || '')}</span></span>
                <span class="small ${d.due_date && d.due_date < now ? 'out' : 'muted'}">${d.due_date ? `📅 ${fmtDate(d.due_date)}` : ''}</span></li>`
            )
            .join('')}</ul></section>`
        : ''
    }
    ${
      meetings.length
        ? meetings
            .map(
              (m) => `<section class="card meeting">
                <div class="section-head">
                  <div><h3>${esc(m.title)}</h3><span class="muted small">📅 ${fmtDate(m.date)}${m.attendees ? ` · 👥 ${esc(m.attendees)}` : ''}</span></div>
                  <div class="actions"><button class="btn ghost small" data-edit="${m.id}">تعديل</button>
                    <button class="btn ghost small" data-print="${m.id}">🖨</button>
                    <button class="btn danger small" data-del="${m.id}">حذف</button></div>
                </div>
                ${m.agenda ? `<h4>جدول الأعمال</h4><p class="pre">${esc(m.agenda)}</p>` : ''}
                ${m.minutes ? `<details ${m.minutes.length < 400 ? 'open' : ''}><summary><b>المحضر</b></summary><p class="pre">${esc(m.minutes)}</p></details>` : ''}
                <h4>القرارات</h4>
                ${
                  m.decisions.length
                    ? `<ul class="decisions">${m.decisions
                        .map(
                          (d) => `<li><span class="badge ${DECISION_STATUS[d.status][1]}">${DECISION_STATUS[d.status][0]}</span>
                            <span>${esc(d.text)}${d.owner ? ` <span class="muted small">— ${esc(d.owner)}</span>` : ''}
                              ${d.due_date ? ` <span class="small ${d.status === 'open' && d.due_date < now ? 'out' : 'muted'}">📅 ${fmtDate(d.due_date)}</span>` : ''}</span>
                            <span class="task-actions">
                              ${d.status === 'open' ? `<button class="link" data-dst="done" data-d="${d.id}">✔ نُفّذ</button>` : `<button class="link" data-dst="open" data-d="${d.id}">إعادة فتح</button>`}
                              ${d.task_id ? '<a class="small" href="#/todo">🗂️ مهمة</a>' : `<button class="link" data-totask="${d.id}">→ مهمة</button>`}
                              <button class="link danger" data-ddel="${d.id}">حذف</button>
                            </span></li>`
                        )
                        .join('')}</ul>`
                    : '<p class="muted small">لا قرارات.</p>'
                }
                <button class="btn ghost small" data-add-dec="${m.id}">+ قرار</button>
              </section>`
            )
            .join('')
        : '<div class="card muted">لا توجد اجتماعات مسجّلة.</div>'
    }`;
  const reload = () => viewMeetings(el);
  const form = (m) =>
    openModal(
      m ? 'تعديل الاجتماع' : 'اجتماع جديد',
      `<div class="row">
         <label>العنوان<input name="title" value="${esc(m?.title || '')}" required placeholder="مثال: اجتماع الإطار التربوي"></label>
         <label>التاريخ<input type="date" name="date" value="${esc(m?.date || today())}"></label>
       </div>
       <label>الحاضرون<input name="attendees" value="${esc(m?.attendees || '')}"></label>
       <label>جدول الأعمال<textarea name="agenda" rows="3">${esc(m?.agenda || '')}</textarea></label>
       <label>المحضر<textarea name="minutes" rows="8">${esc(m?.minutes || '')}</textarea></label>`,
      async (data) => {
        if (m) await api('PUT', `/api/meetings/${m.id}`, data);
        else await api('POST', '/api/meetings', data);
        toast('تم الحفظ');
        reload();
      }
    );
  $('#add-meeting').addEventListener('click', () => form(null));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(meetings.find((m) => m.id === Number(b.dataset.edit)))));
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف الاجتماع وقراراته؟')) return;
      await api('DELETE', `/api/meetings/${b.dataset.del}`);
      reload();
    })
  );
  el.querySelectorAll('[data-print]').forEach((b) =>
    b.addEventListener('click', () => {
      const card = b.closest('.meeting');
      card.classList.add('print-area');
      window.print();
      card.classList.remove('print-area');
    })
  );
  el.querySelectorAll('[data-add-dec]').forEach((b) =>
    b.addEventListener('click', () =>
      openModal(
        'قرار جديد',
        `<label>القرار<textarea name="text" rows="3" required></textarea></label>
         <div class="row"><label>المسؤول عن التنفيذ<input name="owner"></label>
           <label>الأجل<input type="date" name="due_date"></label></div>
         <label class="check"><input type="checkbox" name="as_task" checked> إضافته أيضًا إلى قائمة المهام</label>`,
        async (data) => {
          const { decision } = await api('POST', `/api/meetings/${b.dataset.addDec}/decisions`, data);
          if (data.as_task) await api('POST', `/api/decisions/${decision.id}/task`);
          toast('تمت إضافة القرار');
          reload();
        }
      )
    )
  );
  el.querySelectorAll('[data-dst]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('PATCH', `/api/decisions/${b.dataset.d}`, { status: b.dataset.dst });
      reload();
    })
  );
  el.querySelectorAll('[data-totask]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('POST', `/api/decisions/${b.dataset.totask}/task`);
      toast('أُضيف إلى قائمة المهام');
      reload();
    })
  );
  el.querySelectorAll('[data-ddel]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف القرار؟')) return;
      await api('DELETE', `/api/decisions/${b.dataset.ddel}`);
      reload();
    })
  );
}

// ---------- التنبيهات ----------
async function viewAlerts(el) {
  const { alerts } = await api('GET', '/api/alerts');
  bellAt = 0;
  refreshBell(true);
  const icon = { urgent: '⛔', warning: '⚠️', info: 'ℹ️' };
  el.innerHTML = `
    <h2>🔔 التنبيهات</h2>
    ${
      alerts.length
        ? alerts
            .map(
              (a) => `<a class="card alert ${a.level}" href="${a.link}">
                <b>${icon[a.level]} ${esc(a.text)}</b>
                ${a.items.length ? `<ul>${a.items.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join('')}${a.items.length > 8 ? `<li>… و${a.items.length - 8} أخرى</li>` : ''}</ul>` : ''}
              </a>`
            )
            .join('')
        : '<div class="card"><b>✅ لا توجد تنبيهات. كل شيء على ما يرام.</b></div>'
    }
    <p class="muted small">التنبيهات: المهام المتأخرة والعاجلة، القرارات المتأخرة، العائلات المتخلّدة، التسجيلات الجديدة، الغيابات المتكرّرة، خلاص المعلمين، والأنشطة القريبة.</p>`;
}
