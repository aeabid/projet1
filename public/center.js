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
  const parent = state.user.role === 'parent';
  const back = state.user.role === 'admin' ? ['#/receipts', 'الوصولات'] : ['#/my-receipts', 'وصولاتي'];
  const lines = r.lines?.length ? r.lines : [{ month: r.month, amount: r.amount, beneficiary: r.beneficiary, program: r.program }];
  const multi = lines.length > 1;
  const oneKid = new Set(lines.map((l) => `${l.beneficiary}|${l.program}`)).size === 1;
  const months = [...new Set(lines.map((l) => l.month).filter(Boolean))];
  const total = r.total ?? r.amount;
  const wa = receiptWaText({ ...r, kind, id, total, months, beneficiary: [...new Set(lines.map((l) => l.beneficiary))].join(' و') });
  el.innerHTML = `
    <div class="page-head no-print">
      <a href="${back[0]}" class="muted small">→ ${back[1]}</a>
      <div class="actions">
        ${!parent && waNumber(r.phone) ? `<a class="btn wa" target="_blank" rel="noopener" href="${esc(waUrl(r.phone, wa))}">${WA_ICON} إرسال للولي</a>` : ''}
        <button class="btn" id="rc-print">🖨 طباعة / PDF</button>
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
        ${
          multi && !oneKid
            ? ''
            : `<dt>لفائدة</dt><dd><b>${esc(r.beneficiary)}</b>${r.level ? ` — ${esc(levelLabel(r.level))}` : ''}</dd>
               <dt>البرنامج</dt><dd>${esc(r.program)}${r.month && !multi ? ` — شهر ${esc(monthLabel(r.month))}` : ''}</dd>`
        }
        <dt>طريقة الدفع</dt><dd>${esc(PAYMENT_LABELS[r.method] || r.method || '—')}</dd>
        ${r.note ? `<dt>ملاحظة</dt><dd>${esc(r.note)}</dd>` : ''}
        ${r.edited_at ? `<dt>ملاحظة</dt><dd class="muted">وصل معدّل في ${fmtDate(r.edited_at)}</dd>` : ''}
      </dl>
      ${
        multi
          ? `<table class="receipt-lines"><thead><tr>${oneKid ? '' : '<th>لفائدة</th><th>البرنامج</th>'}<th>الشهر</th><th>المبلغ</th></tr></thead>
             <tbody>${lines
               .map((l) => `<tr>${oneKid ? '' : `<td>${esc(l.beneficiary)}</td><td>${esc(l.program)}</td>`}<td>${l.month ? esc(monthLabel(l.month)) : '—'}</td><td><b>${fmtMoney(l.amount)}</b></td></tr>`)
               .join('')}</tbody></table>`
          : ''
      }
      <div class="receipt-amount">${multi ? `المجموع (${lines.length} أشهر)` : 'المبلغ'}: <b>${fmtMoney(total)}</b></div>
      <div class="receipt-sign"><span>الإمضاء والختم</span></div>
    </div>`;
  $('#rc-print').addEventListener('click', () => window.print());
}

// الولي: كل وصولات أبنائه
async function viewMyReceipts(el) {
  const { receipts } = await api('GET', '/api/my-receipts');
  const total = receipts.reduce((t, r) => t + r.total, 0);
  el.innerHTML = `
    <div class="page-head"><div><h2>🧾 وصولاتي</h2><p class="muted">كل وصل خلاص لأبنائك يظهر هنا وحدو. اضغط عليه باش تشوفو ولا تطبعو.</p></div></div>
    ${
      receipts.length
        ? `<div class="stats compact"><div class="stat good"><b>${fmtMoney(total)}</b><span>${receipts.length} وصل</span></div></div>
          <div class="rcpts">${receipts
            .map(
              (r) => `<a class="rcpt" href="#/receipt/${r.kind}/${r.id}">
                <span class="rcpt-no">🧾<b>${r.receipt_no ?? '—'}</b></span>
                <span class="rcpt-main"><b>${esc(r.children.join(' و'))}</b><small>${r.months.map((m) => esc(monthLabel(m))).join('، ')} · ${fmtDate(r.paid_on)}</small></span>
                <b class="rcpt-amt">${fmtMoney(r.total)}</b></a>`
            )
            .join('')}</div>`
        : '<div class="card muted">لا توجد وصولات بعد.</div>'
    }`;
}

// ---------- التعريفات والتخفيضات ----------
async function viewFees(el) {
  const { support, classes, family, pricing } = await api('GET', '/api/settings/fees');
  const units = pricing?.units || {};
  const steps = pricing?.steps || {};
  const { courses } = await api('GET', '/api/courses');
  el.innerHTML = `
    <h2>🏷️ التعريفات والتخفيضات</h2>
    <form id="fees-form">
      <section class="card">
        <h3>📚 دروس الدعم — سعر الباقة (كل المواد) لكل مستوى</h3>
        <p class="muted small">الباقة = كل مواد المستوى، أو 5 حصص فأكثر في الأسبوع.</p>
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
        <h3>🧮 دروس الدعم — السعر حسب عدد الحصص في الأسبوع</h3>
        <p class="muted small">عند تسجيل تلميذ جديد يُحسب سعره وحده حسب المواد التي يختارها (يمكن تغييره). 5 حصص فأكثر = سعر الباقة.</p>
        <div class="fee-grid">${['1', '2', '3', '4']
          .map((n) => `<label>${n === '1' ? 'حصة واحدة' : n === '2' ? 'حصتان' : `${n} حصص`} في الأسبوع<input name="st_${n}" inputmode="decimal" value="${esc(steps[n] ?? '')}" placeholder="د.ت"></label>`)
          .join('')}</div>
        <h4>عدد حصص كل مادة في الأسبوع</h4>
        <div class="fee-grid">${state.meta.subjects
          .map((s) => `<label>${esc(s.name)} <small class="muted">(${esc(levelsText(s.levels))})</small>
            <select name="u_${s.id}">${[1, 2, 3].map((n) => `<option value="${n}" ${Number(units[s.id] || 1) === n ? 'selected' : ''}>${n === 1 ? 'حصة' : n === 2 ? 'حصتان' : '3 حصص'}</option>`).join('')}</select></label>`)
          .join('')}</div>
        <p class="muted small">مثال: الرياضيات (7، 8، 9) والعلوم (5، 6) بحصتين = 140 د.ت.</p>
      </section>
      <section class="card">
        <h3>🪪 معلوم التسجيل</h3>
        <p class="muted small">لم يعد منفصلًا: أضف 40 د.ت إلى أول شهر يدخل فيه التلميذ، من ملفه ← «✂️ تعديل» على الشهر ← «إضافة مبلغ لهذا الشهر».</p>
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
        pricing: {
          steps: Object.fromEntries(['1', '2', '3', '4'].map((n) => [n, data[`st_${n}`]])),
          units: Object.fromEntries(state.meta.subjects.map((s) => [s.id, data[`u_${s.id}`]])),
        },
      });
      toast('تم حفظ التعريفات');
      state.meta = await api('GET', '/api/meta');
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

// ---------- الصلاحيات (للمشرف العام) ----------
const PERM_PRESETS = {
  'إداري': { school: true, expenses: true },
  'محاسبة': { accounting: true, stats: true },
};
async function viewPermissions(el) {
  if (!state.user.super_admin) {
    el.innerHTML = '<div class="card muted">هذه الصفحة للمشرف العام فقط.</div>';
    return;
  }
  const { permissions, admins } = await api('GET', '/api/permissions');
  el.innerHTML = `
    <div class="page-head"><div><h2>🔐 الصلاحيات</h2>
      <p class="muted">حدّد ما يراه ويفعله كل حساب إداري. المشرف العام له كل الصلاحيات دائمًا، ونصيب الشركاء لا يراه غيره.
      لإضافة حساب جديد (مثلًا للمحاسبة): <a href="#/admins">الإدارة ← + حساب</a>، ثم ارجع هنا.</p></div></div>
    ${admins
      .map((a) =>
        a.super_admin
          ? `<section class="card perm-card"><div class="perm-head"><div><b>${esc(a.full_name)}</b><span class="muted small" dir="ltr">${esc(a.google_email || a.email || a.username)}</span></div>
              <span class="badge pack">المشرف العام · كل الصلاحيات</span></div></section>`
          : `<section class="card perm-card" data-id="${a.id}">
              <div class="perm-head"><div><b>${esc(a.full_name)}</b><span class="muted small" dir="ltr">${esc(a.email || a.username)}${
                a.google_email ? ' · Google ✓' : a.email ? ' · يدخل بـ Google بهذا البريد' : ''
              }</span></div>
                <div class="perm-presets">${Object.keys(PERM_PRESETS).map((n) => `<button type="button" class="chip" data-preset="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>
              <div class="perm-list">${Object.entries(permissions)
                .map(
                  ([k, l]) => `<label class="perm-row"><span>${esc(l)}</span>
                    <span class="switch"><input type="checkbox" data-perm="${k}" ${a.perms[k] ? 'checked' : ''}><i></i></span></label>`
                )
                .join('')}</div>
              <div class="perm-foot"><button class="btn small" data-save>حفظ الصلاحيات</button></div>
            </section>`
      )
      .join('')}`;
  el.querySelectorAll('.perm-card[data-id]').forEach((card) => {
    card.querySelectorAll('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = PERM_PRESETS[b.dataset.preset];
        card.querySelectorAll('[data-perm]').forEach((c) => (c.checked = !!p[c.dataset.perm]));
      })
    );
    card.querySelector('[data-save]').addEventListener('click', async () => {
      const perms = Object.fromEntries([...card.querySelectorAll('[data-perm]')].map((c) => [c.dataset.perm, c.checked]));
      try {
        await api('PUT', `/api/users/${card.dataset.id}/permissions`, { perms });
        toast('تم حفظ الصلاحيات');
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

// ---------- فضاء المحاسبة: مداخيل البنك، مصاريف المحاسبة، الوصولات والملفات ----------
const readFileData = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
async function uploadDocs(files, extra) {
  for (const f of files) {
    if (f.size > 4 * 1024 * 1024) {
      toast(`${f.name}: أكبر من 4 ميغا`, true);
      continue;
    }
    await api('POST', '/api/documents', { ...extra, filename: f.name, data: await readFileData(f) });
  }
}
const docLink = (d) =>
  `<a class="doc" href="/api/documents/${d.id}/file" target="_blank" rel="noopener">${/pdf/.test(d.mime) ? '📄' : /image/.test(d.mime) ? '🖼️' : '📎'} ${esc(d.title || d.filename)}</a>`;

async function viewAccounting(el) {
  el.innerHTML = `
    <div class="page-head"><div><h2>🏦 فضاء المحاسبة</h2>
      <p class="muted">كل شهر: المداخيل عبر بنك الشركة، مصاريف المحاسبة، ووصولات كل معاملة. وملفات المركز الدائمة في الأسفل.</p></div>
      <div class="actions">${monthPicker('ac-month')}<button class="btn ghost" id="ac-csv">⬇ تصدير البنك (Excel)</button></div></div>
    <div id="ac-body"><p class="muted">جاري التحميل…</p></div>
    <section class="card"><div class="section-head"><h3>🗂 ملفات المركز</h3>
      <label class="btn small ghost">+ إضافة ملف<input type="file" id="ac-center-file" multiple hidden></label></div>
      <p class="muted small">وثائق دائمة: السجل التجاري، العقود، الشهادات، التصاريح…</p>
      <div id="ac-center" class="docs"></div></section>`;
  let data;
  const loadCenter = async () => {
    const { documents } = await api('GET', '/api/documents?folder=center');
    $('#ac-center').innerHTML = documents.length
      ? documents.map((d) => `<span class="doc-row">${docLink(d)}<span class="muted small">${fmtDate(d.created)}</span><button class="link danger small" data-del-doc="${d.id}">✕</button></span>`).join('')
      : '<p class="muted">لا ملفات بعد.</p>';
  };
  const load = async () => {
    const month = $('#ac-month').value;
    data = await api('GET', '/api/accounting?month=' + month);
    const docsFor = (pred) => data.documents.filter(pred);
    const cats = { ...data.expense_categories };
    $('#ac-body').innerHTML = `
      <div class="fb-kpis">
        <div class="fb-kpi in"><span>🏦 عبر بنك الشركة</span><b>${fmtMoney(data.bank_total)}</b><small>${data.bank.length} معاملة · ${esc(monthLabel(month))}</small></div>
        <div class="fb-kpi net"><span>💵 نقدًا</span><b>${fmtMoney(data.by_method.cash || 0)}</b><small>لا يدخل البنك</small></div>
        <div class="fb-kpi out"><span>كل المداخيل</span><b>${fmtMoney(data.total)}</b><small>${Object.entries(data.by_method).map(([k, v]) => `${PAYMENT_LABELS[k] || k}: ${fmtMoney(v)}`).join(' · ')}</small></div>
      </div>
      <section class="card"><div class="section-head"><h3>🏦 المداخيل عبر البنك</h3><span class="muted small">بنك الشركة، تحويل، صك</span></div>
        ${
          data.bank.length
            ? `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>وصل</th><th>المستفيد</th><th>البرنامج</th><th>الطريقة</th><th>المبلغ</th><th>المرفقات</th></tr></thead><tbody>${data.bank
                .map((l) => {
                  const docs = docsFor((d) => d.receipt_no === l.receipt_no);
                  return `<tr><td class="nowrap">${fmtDate(l.paid_on)}</td><td><a href="#/receipt/${l.kind}/${l.id}">🧾 ${l.receipt_no ?? ''}</a></td>
                    <td>${esc(l.beneficiary)}</td><td class="muted small">${esc(l.program)}</td><td>${esc(PAYMENT_LABELS[l.method] || l.method)}</td>
                    <td><b>${fmtMoney(l.amount)}</b></td>
                    <td><div class="docs inline">${docs.map(docLink).join('')}<label class="link small attach">📎<input type="file" data-attach-receipt="${l.receipt_no}" multiple hidden></label></div></td></tr>`;
                })
                .join('')}</tbody></table></div>`
            : '<p class="muted">لا مداخيل عبر البنك في هذا الشهر. (اختر «بنك الشركة» كطريقة دفع عند تسجيل الدفعة.)</p>'
        }
      </section>
      <section class="card"><div class="section-head"><h3>🧾 مصاريف المحاسبة</h3></div>
        <form class="acc-form" id="ac-exp">
          <select name="category" aria-label="النوع">${Object.entries(cats).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
          <input name="description" placeholder="البيان (إجباري لـ«أخرى»)">
          <input name="amount" inputmode="decimal" placeholder="المبلغ" required>
          <input type="date" name="date" value="${month === today().slice(0, 7) ? today() : month + '-01'}">
          <label class="btn small ghost">📎 وصل<input type="file" name="file" hidden></label>
          <button class="btn small">+ إضافة</button>
        </form>
        ${
          data.expenses.length
            ? `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المبلغ</th><th>الوصولات</th><th></th></tr></thead><tbody>${data.expenses
                .map(
                  (x) => `<tr><td class="nowrap">${fmtDate(x.date)}</td><td>${esc(cats[x.category] || x.category)}</td><td>${esc(x.description || '—')}</td>
                    <td><b>${fmtMoney(x.amount)}</b></td>
                    <td><div class="docs inline">${docsFor((d) => d.ledger_id === x.id).map(docLink).join('')}<label class="link small attach">📎<input type="file" data-attach-ledger="${x.id}" multiple hidden></label></div></td>
                    <td><button class="link danger small" data-del-exp="${x.id}">حذف</button></td></tr>`
                )
                .join('')}</tbody></table></div>
              <p class="muted small">المجموع: <b>${fmtMoney(data.expenses.reduce((t, x) => t + x.amount, 0))}</b></p>`
            : '<p class="muted">لا مصاريف محاسبة في هذا الشهر.</p>'
        }
      </section>
      <section class="card"><div class="section-head"><h3>📁 وصولات ووثائق ${esc(monthLabel(month))}</h3>
        <label class="btn small ghost">+ إضافة ملفات<input type="file" id="ac-month-file" multiple hidden></label></div>
        <div class="docs">${
          docsFor((d) => !d.ledger_id && !d.receipt_no).length
            ? docsFor((d) => !d.ledger_id && !d.receipt_no)
                .map((d) => `<span class="doc-row">${docLink(d)}<span class="muted small">${fmtDate(d.created)}</span><button class="link danger small" data-del-doc="${d.id}">✕</button></span>`)
                .join('')
            : '<p class="muted">لا وثائق لهذا الشهر.</p>'
        }</div>
      </section>`;
    const up = async (files, extra) => {
      if (!files.length) return;
      try {
        await uploadDocs(files, { folder: 'month', month, ...extra });
        toast('تم رفع الملف');
      } catch (err) {
        toast(err.message, true);
      }
      load();
    };
    $('#ac-month-file').addEventListener('change', (e) => up([...e.target.files], {}));
    el.querySelectorAll('[data-attach-receipt]').forEach((i) => i.addEventListener('change', () => up([...i.files], { receipt_no: i.dataset.attachReceipt })));
    el.querySelectorAll('[data-attach-ledger]').forEach((i) => i.addEventListener('change', () => up([...i.files], { ledger_id: i.dataset.attachLedger })));
    $('#ac-exp').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const file = e.target.querySelector('input[type=file]').files[0];
      try {
        const { id } = await api('POST', '/api/accounting/expenses', { category: f.category, description: f.description, amount: f.amount, date: f.date });
        if (file) await uploadDocs([file], { folder: 'month', month, ledger_id: id });
        toast('تمت الإضافة');
        load();
      } catch (err) {
        toast(err.message, true);
      }
    });
    el.querySelectorAll('[data-del-exp]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('حذف هذا المصروف؟')) return;
        await api('DELETE', `/api/accounting/expenses/${b.dataset.delExp}`).catch((err) => toast(err.message, true));
        load();
      })
    );
  };
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-doc]');
    if (!b) return;
    if (!confirmAction('حذف هذا الملف؟')) return;
    await api('DELETE', `/api/documents/${b.dataset.delDoc}`).catch((err) => toast(err.message, true));
    load();
    loadCenter();
  });
  $('#ac-center-file').addEventListener('change', async (e) => {
    try {
      await uploadDocs([...e.target.files], { folder: 'center' });
      toast('تم رفع الملف');
    } catch (err) {
      toast(err.message, true);
    }
    loadCenter();
  });
  $('#ac-csv').addEventListener('click', () => {
    if (!data) return;
    const rows = [['التاريخ', 'رقم الوصل', 'المستفيد', 'البرنامج', 'الطريقة', 'المبلغ'], ...data.bank.map((l) => [l.paid_on, l.receipt_no ?? '', l.beneficiary, l.program, PAYMENT_LABELS[l.method] || l.method, l.amount])];
    rows.push([], ['المجموع عبر البنك', '', '', '', '', data.bank_total]);
    const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `bank-${data.month}.csv`;
    a.click();
  });
  bindMonth('ac-month', load);
  await Promise.all([load(), loadCenter()]);
}
