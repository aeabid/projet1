'use strict';
// صفحات المشروع ككل: الرئيسية (حوصلة الشهر)، البرنامج التربوي، الدورات، المداخيل والمصاريف، الإطار، المردودية المالية
// تستعمل الأدوات المعرّفة في app.js ($، esc، api، openModal، fmtMoney، ...)

const ACTIVITY_ICONS = { support: '📚', program: '🎨', courses: '🏕️', general: '🏢' };
const COURSE_KIND_LABELS = {
  holiday: 'دورة عطلة',
  summer: 'دورة صيفية',
  other: 'مجموعة / أخرى',
  activity: 'نشاط',
  trip: 'رحلة',
  camp: 'مخيم',
};
const COURSE_KIND_ICONS = { holiday: '📘', summer: '☀️', other: '👥', activity: '🎭', trip: '🚌', camp: '⛺' };
const COURSE_STATUS_LABELS = { planned: 'مبرمج', done: 'تمّ', cancelled: 'أُلغي' };

async function financeMeta() {
  state.finMeta ||= await api('GET', '/api/finance/meta');
  return state.finMeta;
}

const financeMonth = () => sessionStorage.getItem('finMonth') || today().slice(0, 7);

// الصافي: ربح أو خسارة، بالعلامة والكلمة (لا باللون فقط)
function netBadge(net) {
  if (net > 0) return `<span class="net up">▲ ربح ${fmtMoney(net)}</span>`;
  if (net < 0) return `<span class="net down">▼ خسارة ${fmtMoney(-net)}</span>`;
  return '<span class="net zero">— متوازن</span>';
}

function monthPicker(id) {
  return `<input type="month" id="${id}" value="${financeMonth()}">`;
}

function bindMonth(id, load) {
  $(`#${id}`).addEventListener('change', () => {
    sessionStorage.setItem('finMonth', $(`#${id}`).value);
    load();
  });
}

// ---------- الرئيسية: حوصلة الشهر ثم أيقونات الدخول ----------
async function viewHome(el) {
  el.innerHTML = `
    <div class="page-head">
      <h2>حوصلة الشهر</h2>
      ${monthPicker('home-month')}
    </div>
    <div id="home-kpis"></div>
    <div id="home-alerts"></div>
    <div id="home-summary"><p class="muted">جاري التحميل…</p></div>
    <div class="home-tiles">
      <a class="home-tile" href="#/dashboard"><span class="ico">📚</span><b>دروس الدعم</b>
        <small>التلاميذ، الجداول، الحضور، الخلاص، المعلمون</small></a>
      <a class="home-tile" href="#/program"><span class="ico">🎨</span><b>البرنامج التربوي</b>
        <small>الأقسام حسب الأعمار، الأطفال، الخلاص الشهري</small></a>
      <a class="home-tile" href="#/courses"><span class="ico">🏕️</span><b>الدورات والأنشطة</b>
        <small>دورات العطل والصيف، الأنشطة، الرحلات والمخيمات</small></a>
      <a class="home-tile alt" href="#/todo"><span class="ico">🗂️</span><b>إدارة المركز</b>
        <small>المهام، الاجتماعات والقرارات، التنبيهات</small></a>
      <a class="home-tile" href="#/finance"><span class="ico">📈</span><b>تفاصيل المردودية المالية</b>
        <small>المداخيل والمصاريف والربح حسب كل نشاط</small></a>
    </div>
    <p class="quick-actions">
      <button class="btn ghost small" id="q-expense">+ مصروف</button>
      <button class="btn ghost small" id="q-income">+ مدخول آخر</button>
      <a class="btn ghost small" href="#/staff">الإطار والأجور</a>
    </p>`;

  const load = async () => {
    const s = await api('GET', '/api/finance/summary?month=' + $('#home-month').value);
    const t = s.totals;
    $('#home-summary').innerHTML = `
      <div class="stats">
        <div class="stat good"><b>${fmtMoney(t.income)}</b><span>المداخيل المقبوضة</span></div>
        <div class="stat warn"><b>${fmtMoney(t.expense)}</b><span>المصاريف المدفوعة</span></div>
        <div class="stat ${t.net >= 0 ? 'profit' : 'loss'}"><b>${t.net >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(t.net))}</b>
          <span>${t.net > 0 ? 'ربح الشهر' : t.net < 0 ? 'خسارة الشهر' : 'الصافي'}</span></div>
      </div>
      <div class="activity-cards">${s.activities
        .map(
          (a) => `<div class="card activity">
            <div class="section-head"><h3>${ACTIVITY_ICONS[a.key]} ${esc(a.label)}</h3>${netBadge(a.net)}</div>
            <div class="io">
              <div><span class="muted small">المداخيل</span><b class="in">${fmtMoney(a.income)}</b>
                ${a.income_lines.map((l) => `<div class="line"><span>${esc(l.label)}</span><span>${fmtMoney(l.amount)}</span></div>`).join('')}</div>
              <div><span class="muted small">المصاريف</span><b class="out">${fmtMoney(a.expense)}</b>
                ${a.expense_lines.map((l) => `<div class="line"><span>${esc(l.label)}</span><span>${fmtMoney(l.amount)}</span></div>`).join('')}</div>
            </div>
          </div>`
        )
        .join('')}</div>
      ${unpaidNote(s.accrual)}`;
  };
  // مؤشرات المركز والتنبيهات (للشهر الحالي)
  api('GET', '/api/kpis').then((k) => {
    $('#home-kpis').innerHTML = `<div class="kpis">
      <a class="kpi" href="#/people"><b>${k.support_active + k.program_active}</b><span>تلميذ وطفل مسجّل<small>${k.support_active} دعم · ${k.program_active} تربوي</small></span></a>
      <a class="kpi" href="#/courses"><b>${k.events_open}</b><span>دورة ونشاط مفتوح</span></a>
      <a class="kpi" href="#/finance"><b class="${k.net >= 0 ? 'in' : 'out'}">${k.net >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(k.net))}</b><span>صافي ${esc(monthLabel(k.month))}</span></a>
      <a class="kpi" href="#/debts"><b>${k.collection_rate ?? '—'}${k.collection_rate !== null ? '%' : ''}</b><span>نسبة الاستخلاص هذا الشهر</span></a>
      <a class="kpi" href="#/debts"><b class="${k.debts_total ? 'out' : ''}">${fmtMoney(k.debts_total)}</b><span>ديون ${k.debtors} عائلة</span></a>
      <a class="kpi" href="#/payroll"><b>${fmtHours(k.teacher_hours)}</b><span>ساعات تدريس هذا الشهر</span></a>
      <a class="kpi" href="#/todo"><b>${k.tasks_open}</b><span>مهمة مفتوحة${k.tasks_overdue ? `<small class="out">${k.tasks_overdue} متأخرة</small>` : ''}</span></a>
      <a class="kpi" href="#/attendance"><b>${k.absences_month}</b><span>غياب هذا الشهر</span></a>
    </div>`;
  });
  api('GET', '/api/alerts').then(({ alerts }) => {
    const top = alerts.filter((a) => a.level !== 'info');
    $('#home-alerts').innerHTML = top.length
      ? `<div class="card alerts-box"><div class="section-head"><h3>🔔 تنبيهات</h3><a href="#/alerts" class="small">كل التنبيهات ←</a></div>
          ${top.map((a) => `<a class="alert-line ${a.level}" href="${a.link}">${a.level === 'urgent' ? '⛔' : '⚠️'} ${esc(a.text)}</a>`).join('')}</div>`
      : '';
  });
  bindMonth('home-month', load);
  $('#q-expense').addEventListener('click', () => ledgerForm(null, 'expense', load));
  $('#q-income').addEventListener('click', () => ledgerForm(null, 'income', load));
  await load();
}

function unpaidNote(acc) {
  const items = [];
  if (acc.support.unpaid > 0) items.push(`تلاميذ دروس الدعم لم يدفعوا <b>${fmtMoney(acc.support.unpaid)}</b> عن هذا الشهر`);
  if (acc.program.unpaid > 0) items.push(`أطفال البرنامج التربوي لم يدفعوا <b>${fmtMoney(acc.program.unpaid)}</b>`);
  if (acc.support.teachers_unpaid > 0) items.push(`باقي خلاص المعلمين عن الساعات المنجزة: <b>${fmtMoney(acc.support.teachers_unpaid)}</b>`);
  return items.length
    ? `<div class="card alert-card"><b>⚠ مبالغ لم تُقبض / لم تُدفع بعد</b><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`
    : '';
}

// ---------- المداخيل والمصاريف ----------
async function ledgerForm(entry, direction, onDone, preset = {}) {
  const meta = await financeMeta();
  const dir = entry?.direction || direction;
  const { courses } = await api('GET', '/api/courses');
  openModal(
    entry ? 'تعديل العملية' : dir === 'income' ? 'مدخول جديد' : 'مصروف جديد',
    `<input type="hidden" name="direction" value="${dir}">
     <div class="row">
       <label>النشاط<select name="activity" id="lf-activity">${Object.entries(meta.activities)
         .map(([k, v]) => `<option value="${k}" ${(entry?.activity || preset.activity || 'general') === k ? 'selected' : ''}>${v}</option>`)
         .join('')}</select></label>
       <label>الصنف<select name="category">${Object.entries(meta.categories[dir])
         .map(([k, v]) => `<option value="${k}" ${entry?.category === k ? 'selected' : ''}>${v}</option>`)
         .join('')}</select></label>
     </div>
     <label id="lf-course" hidden>الدورة<select name="course_id"><option value="">—</option>${courses
       .map((c) => `<option value="${c.id}" ${(entry?.course_id || preset.course_id) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
       .join('')}</select></label>
     <div class="row">
       <label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${esc(entry?.amount ?? '')}" required></label>
       <label>التاريخ<input type="date" name="date" value="${esc(entry?.date || today())}"></label>
     </div>
     <label>البيان<input name="description" value="${esc(entry?.description || '')}" placeholder="مثال: كراء المقر لشهر أكتوبر"></label>`,
    async (data) => {
      if (entry) await api('PUT', `/api/ledger/${entry.id}`, data);
      else await api('POST', '/api/ledger', data);
      toast('تم الحفظ');
      onDone();
    }
  );
  const sync = () => ($('#lf-course').hidden = $('#lf-activity').value !== 'courses');
  $('#lf-activity').addEventListener('change', sync);
  sync();
}

async function viewLedger(el) {
  const meta = await financeMeta();
  el.innerHTML = `
    <div class="page-head">
      <h2>المداخيل والمصاريف</h2>
      <div class="actions">
        <button class="btn warn" id="add-expense">+ مصروف</button>
        <button class="btn" id="add-income">+ مدخول آخر</button>
      </div>
    </div>
    <div class="filters">
      ${monthPicker('lg-month')}
      <select id="lg-activity"><option value="">كل الأنشطة</option>${Object.entries(meta.activities)
        .map(([k, v]) => `<option value="${k}">${v}</option>`)
        .join('')}</select>
    </div>
    <div id="lg-list"></div>
    <p class="muted small">خلاص التلاميذ والأطفال والمشاركين وخلاص المعلمين بالساعة يُحتسب تلقائيًا من صفحاته، ولا حاجة لإدخاله هنا.
      هنا: الكراء، الأجور، المصاريف الأخرى، والمداخيل الأخرى.</p>`;
  const load = async () => {
    const params = new URLSearchParams({ month: $('#lg-month').value });
    if ($('#lg-activity').value) params.set('activity', $('#lg-activity').value);
    const { entries } = await api('GET', '/api/ledger?' + params);
    const total = (d) => entries.filter((e) => e.direction === d).reduce((t, e) => t + e.amount, 0);
    $('#lg-list').innerHTML = entries.length
      ? `<div class="stats compact">
          <div class="stat good"><b>${fmtMoney(total('income'))}</b><span>مداخيل أخرى</span></div>
          <div class="stat warn"><b>${fmtMoney(total('expense'))}</b><span>مصاريف</span></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>التاريخ</th><th>النشاط</th><th>الصنف</th><th>البيان</th><th>المبلغ</th><th></th></tr></thead>
          <tbody>${entries
            .map(
              (e) => `<tr>
                <td>${fmtDate(e.date)}</td>
                <td>${ACTIVITY_ICONS[e.activity]} ${esc(meta.activities[e.activity])}${e.course_name ? `<div class="muted small">${esc(e.course_name)}</div>` : ''}</td>
                <td>${esc(meta.categories[e.direction][e.category] || e.category)}</td>
                <td>${esc(e.description || '')}</td>
                <td><b class="${e.direction === 'income' ? 'in' : 'out'}">${e.direction === 'income' ? '+' : '−'} ${fmtMoney(e.amount)}</b></td>
                <td class="row-actions"><button class="link" data-edit="${e.id}">تعديل</button>
                  <button class="link danger" data-del="${e.id}">حذف</button></td>
              </tr>`
            )
            .join('')}</tbody></table></div>`
      : '<div class="card muted">لا توجد عمليات في هذا الشهر.</div>';
    $('#lg-list').querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => ledgerForm(entries.find((e) => e.id === Number(b.dataset.edit)), null, load))
    );
    $('#lg-list').querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('حذف هذه العملية؟')) return;
        await api('DELETE', `/api/ledger/${b.dataset.del}`).catch((err) => toast(err.message, true));
        load();
      })
    );
  };
  bindMonth('lg-month', load);
  $('#lg-activity').addEventListener('change', load);
  $('#add-expense').addEventListener('click', () => ledgerForm(null, 'expense', load, { activity: $('#lg-activity').value || 'general' }));
  $('#add-income').addEventListener('click', () => ledgerForm(null, 'income', load, { activity: $('#lg-activity').value || 'general' }));
  await load();
}

// ---------- الإطار والأجور ----------
async function viewStaff(el) {
  const meta = await financeMeta();
  const { staff } = await api('GET', '/api/staff');
  const monthly = staff.filter((x) => x.active).reduce((t, x) => t + (x.monthly_salary || 0), 0);
  el.innerHTML = `
    <div class="page-head">
      <h2>الإطار والأجور</h2>
      <div class="actions">
        <button class="btn ghost" id="pay-salaries">تسجيل أجور الشهر</button>
        <button class="btn" id="add-staff">+ شخص</button>
      </div>
    </div>
    <p class="muted">المربّون، العملة، المنشطون… بأجرة شهرية ثابتة. معلمو دروس الدعم يُخلَّصون بالساعة من «ساعات وخلاص المعلمين».
      مجموع الأجور الشهرية للإطار النشط: <b>${fmtMoney(monthly)}</b></p>
    ${
      staff.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>الاسم</th><th>النشاط</th><th>الخطة</th><th>الأجرة الشهرية</th><th>الهاتف</th><th></th></tr></thead>
            <tbody>${staff
              .map(
                (x) => `<tr class="${x.active ? '' : 'planned'}">
                  <td><b>${esc(x.full_name)}</b>${x.active ? '' : ' <span class="badge general">غير نشط</span>'}</td>
                  <td>${ACTIVITY_ICONS[x.activity]} ${esc(meta.activities[x.activity])}</td>
                  <td>${esc(x.role || '—')}</td>
                  <td>${fmtMoney(x.monthly_salary)}</td>
                  <td><span class="phone-line"><span dir="ltr">${esc(x.phone || '—')}</span>${waButton(x.phone)}</span></td>
                  <td class="row-actions"><button class="btn ghost small" data-edit="${x.id}">تعديل</button>
                    <button class="btn danger small" data-del="${x.id}">حذف</button></td>
                </tr>`
              )
              .join('')}</tbody></table></div>`
        : '<div class="card muted">لم تتم إضافة أي شخص بعد.</div>'
    }`;
  const reload = () => viewStaff(el);
  const form = (x) =>
    openModal(
      x ? 'تعديل' : 'إضافة للإطار',
      `<label>الاسم واللقب<input name="full_name" value="${esc(x?.full_name || '')}" required></label>
       <div class="row">
         <label>النشاط<select name="activity">${Object.entries(meta.activities)
           .map(([k, v]) => `<option value="${k}" ${(x?.activity || 'program') === k ? 'selected' : ''}>${v}</option>`)
           .join('')}</select></label>
         <label>الخطة<input name="role" value="${esc(x?.role || '')}" placeholder="مثال: مربية، منشط، عامل نظافة"></label>
       </div>
       <div class="row">
         <label>الأجرة الشهرية (د.ت)<input name="monthly_salary" inputmode="decimal" value="${esc(x?.monthly_salary ?? '')}"></label>
         <label>الهاتف<input name="phone" dir="ltr" value="${esc(x?.phone || '')}"></label>
       </div>
       <label class="check"><input type="checkbox" name="active" ${x?.active === false ? '' : 'checked'}> نشط</label>`,
      async (data) => {
        if (x) await api('PUT', `/api/staff/${x.id}`, data);
        else await api('POST', '/api/staff', data);
        toast('تم الحفظ');
        reload();
      }
    );
  $('#add-staff').addEventListener('click', () => form(null));
  $('#pay-salaries').addEventListener('click', () =>
    openModal(
      'تسجيل أجور الشهر',
      `<p>تُسجَّل الأجرة الشهرية لكل الإطار النشط كمصروف (مرة واحدة لكل شهر). يمكنك تعديل أو حذف أي أجرة بعدها من «المداخيل والمصاريف».</p>
       <div class="row">
         <label>الشهر<input type="month" name="month" value="${today().slice(0, 7)}"></label>
         <label>تاريخ الدفع<input type="date" name="date" value="${today()}"></label>
       </div>`,
      async (data) => {
        const { created } = await api('POST', '/api/staff/salaries', data);
        toast(created ? `تم تسجيل ${created} أجرة` : 'أجور هذا الشهر مسجّلة مسبقًا');
      }
    )
  );
  el.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => form(staff.find((x) => x.id === Number(b.dataset.edit))))
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذا الشخص؟ (الأجور المسجّلة سابقًا تبقى في المصاريف)')) return;
      await api('DELETE', `/api/staff/${b.dataset.del}`).catch((err) => toast(err.message, true));
      reload();
    })
  );
}

// ---------- البرنامج التربوي ----------
const ageOf = (birth) => {
  if (!birth) return '';
  const b = new Date(birth);
  const n = new Date();
  let years = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) years--;
  return `${years} سنة`;
};

async function viewProgram(el) {
  const { classes, children } = await api('GET', '/api/program');
  const filter = sessionStorage.getItem('progClass') || '';
  const active = children.filter((c) => c.status === 'active');
  const monthlyExpected = active.filter((c) => !c.free).reduce((t, c) => t + (c.monthly_fee || 0), 0);
  const owed = children.reduce((t, c) => t + Math.max(c.balance || 0, 0), 0);
  el.innerHTML = `
    <div class="page-head">
      <div><a href="#/home" class="muted small">→ الرئيسية</a><h2>🎨 البرنامج التربوي</h2></div>
      <div class="actions">
        <button class="btn ghost" id="add-class">+ قسم</button>
        <button class="btn" id="add-child">+ طفل</button>
      </div>
    </div>
    <p class="muted">برنامج سنوي من 1 سبتمبر إلى موفى ماي (جوان-أوت لا تُحتسب). تديره الإدارة فقط، دون حسابات للأولياء.</p>
    <div class="stats compact">
      <div class="stat"><b>${active.length}</b><span>طفل مسجّل</span></div>
      <div class="stat"><b>${classes.length}</b><span>أقسام</span></div>
      <div class="stat good"><b>${fmtMoney(monthlyExpected)}</b><span>المنتظر شهريًا</span></div>
      <div class="stat warn"><b>${fmtMoney(owed)}</b><span>مبالغ غير مدفوعة</span></div>
    </div>
    <div class="class-chips">
      <button class="chip ${filter ? '' : 'on'}" data-class="">كل الأقسام</button>
      ${classes
        .map(
          (k) => `<span class="chip-wrap"><button class="chip ${filter === String(k.id) ? 'on' : ''}" data-class="${k.id}">
            ${esc(k.name)}${k.age_range ? ` <small>(${esc(k.age_range)})</small>` : ''} <b>${k.children}</b></button>
            <button class="link small" data-edit-class="${k.id}" title="تعديل القسم">✎</button></span>`
        )
        .join('')}
    </div>
    <div id="prog-list"></div>
    <section class="card"><h3>المصاريف والأجور</h3>
      <p class="muted">أجور المربّين تُسجَّل من <a href="#/staff">الإطار والأجور</a>، والمصاريف الأخرى من <a href="#/ledger">المداخيل والمصاريف</a> (النشاط: البرنامج التربوي).</p>
    </section>`;

  const render = () => {
    const f = sessionStorage.getItem('progClass') || '';
    const list = children.filter((c) => !f || String(c.class_id) === f);
    $('#prog-list').innerHTML = list.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>الطفل</th><th>العمر</th><th>القسم</th><th>الولي</th><th>المبلغ الشهري</th><th>الباقي</th><th></th></tr></thead>
          <tbody>${list
            .map(
              (c) => `<tr class="${c.status === 'left' ? 'planned' : ''}">
                <td><a href="#/program/child/${c.id}"><b>${esc(c.full_name)}</b></a>${c.status === 'left' ? ' <span class="badge status-left">خرج</span>' : ''}</td>
                <td>${ageOf(c.birth_date)}</td>
                <td>${esc(c.class_name || '—')}</td>
                <td>${esc(c.guardian_name || '—')}${c.guardian_phone ? `<div class="phone-line small"><span dir="ltr">${esc(c.guardian_phone)}</span>${waButton(c.guardian_phone)}</div>` : ''}</td>
                <td>${c.free ? '<span class="badge free">مجاني</span>' : fmtMoney(c.monthly_fee)}</td>
                <td>${c.balance > 0 ? `<b class="owed">${fmtMoney(c.balance)}</b>` : c.monthly_fee && !c.free ? '<span class="badge good">خالص</span>' : '—'}</td>
                <td class="row-actions"><button class="btn ghost small" data-edit="${c.id}">تعديل</button></td>
              </tr>`
            )
            .join('')}</tbody></table></div>`
      : '<div class="card muted">لا يوجد أطفال في هذا القسم.</div>';
    $('#prog-list').querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => childForm(children.find((c) => c.id === Number(b.dataset.edit)), classes, reload))
    );
  };
  const reload = () => viewProgram(el);

  el.querySelectorAll('[data-class]').forEach((b) =>
    b.addEventListener('click', () => {
      sessionStorage.setItem('progClass', b.dataset.class);
      el.querySelectorAll('[data-class]').forEach((x) => x.classList.toggle('on', x === b));
      render();
    })
  );
  const classForm = (k) =>
    openModal(
      k ? 'تعديل القسم' : 'قسم جديد',
      `<label>اسم القسم<input name="name" value="${esc(k?.name || '')}" required placeholder="مثال: قسم الصغار"></label>
       <div class="row">
         <label>الأعمار<input name="age_range" value="${esc(k?.age_range || '')}" placeholder="مثال: 4-5 سنوات"></label>
         <label>المعلوم الشهري (د.ت)<input name="default_fee" inputmode="decimal" value="${esc(k?.default_fee ?? '')}"></label>
       </div>
       <label>ملاحظات<input name="notes" value="${esc(k?.notes || '')}"></label>
       ${k ? '<p><button type="button" class="link danger" id="del-class">حذف القسم</button></p>' : ''}`,
      async (data) => {
        if (k) await api('PUT', `/api/program/classes/${k.id}`, data);
        else await api('POST', '/api/program/classes', data);
        toast('تم الحفظ');
        reload();
      }
    );
  $('#add-class').addEventListener('click', () => classForm(null));
  el.querySelectorAll('[data-edit-class]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = classes.find((x) => x.id === Number(b.dataset.editClass));
      classForm(k);
      $('#del-class').addEventListener('click', async () => {
        if (!confirmAction('حذف القسم؟ الأطفال يبقون دون قسم.')) return;
        await api('DELETE', `/api/program/classes/${k.id}`);
        $('#modal').close();
        reload();
      });
    })
  );
  $('#add-child').addEventListener('click', () => childForm(null, classes, reload));
  render();
}

function childForm(c, classes, onDone) {
  openModal(
    c ? 'تعديل' : 'طفل جديد',
    `<label>الاسم واللقب<input name="full_name" value="${esc(c?.full_name || '')}" required></label>
     <div class="row">
       <label>تاريخ الولادة<input type="date" name="birth_date" value="${esc(c?.birth_date || '')}"></label>
       <label>القسم<select name="class_id"><option value="">—</option>${classes
         .map((k) => `<option value="${k.id}" ${c?.class_id === k.id ? 'selected' : ''}>${esc(k.name)}</option>`)
         .join('')}</select></label>
     </div>
     <div class="row">
       <label>اسم الولي<input name="guardian_name" value="${esc(c?.guardian_name || '')}"></label>
       <label>الهاتف<input name="guardian_phone" dir="ltr" value="${esc(c?.guardian_phone || '')}"></label>
     </div>
     <div class="row">
       <label>المبلغ الشهري (د.ت)<input name="monthly_fee" inputmode="decimal" value="${esc(c?.monthly_fee ?? '')}"></label>
       <label>تاريخ البداية<input type="date" name="start_date" value="${esc(c?.start_date || '')}"></label>
     </div>
     <div class="row">
       <label>الحالة<select name="status"><option value="active">مسجّل</option><option value="left" ${c?.status === 'left' ? 'selected' : ''}>خرج</option></select></label>
       <label>تاريخ الخروج<input type="date" name="end_date" value="${esc(c?.end_date || '')}"></label>
     </div>
     <div class="row">
       <label>تخفيض شهري (د.ت)<input name="discount" inputmode="decimal" value="${esc(c?.discount ?? '')}"></label>
       <label>سبب التخفيض<input name="discount_reason" value="${esc(c?.discount_reason || '')}"></label>
     </div>
     <label class="check"><input type="checkbox" name="free" ${c?.free ? 'checked' : ''}> مجاني</label>
     <label>ملاحظات<input name="notes" value="${esc(c?.notes || '')}"></label>
     <p class="muted small">الشهر الأول بالـ prorata حسب تاريخ البداية. ${c ? '<button type="button" class="link danger" id="del-child">حذف الطفل نهائيًا</button>' : ''}</p>`,
    async (data) => {
      if (c) await api('PUT', `/api/program/children/${c.id}`, data);
      else await api('POST', '/api/program/children', data);
      toast('تم الحفظ');
      onDone();
    }
  );
  // المعلوم الافتراضي للقسم
  const classSel = $('#modal select[name=class_id]');
  const feeInput = $('#modal input[name=monthly_fee]');
  classSel.addEventListener('change', () => {
    const k = classes.find((x) => x.id === Number(classSel.value));
    if (k?.default_fee && !feeInput.value) feeInput.value = k.default_fee;
  });
  $('#del-child')?.addEventListener('click', async () => {
    if (!confirmAction('حذف الطفل وكل دفعاته؟ (لخروجه من البرنامج استعمل الحالة «خرج»)')) return;
    await api('DELETE', `/api/program/children/${c.id}`);
    $('#modal').close();
    onDone();
  });
}

async function viewProgramChild(el, id) {
  const { child: c, finance } = await api('GET', `/api/program/children/${id}`);
  el.innerHTML = `
    <a href="#/program" class="muted small">→ البرنامج التربوي</a>
    <div class="page-head">
      <div><h2>${esc(c.full_name)}</h2>
        <div class="meta">${c.class_name ? `<span class="pill">${esc(c.class_name)}</span>` : ''}
          ${c.birth_date ? `<span>${ageOf(c.birth_date)}</span>` : ''}
          ${c.guardian_name ? `<span>الولي: ${esc(c.guardian_name)}</span>` : ''}
          ${c.guardian_phone ? `<span class="phone-line"><span dir="ltr">${esc(c.guardian_phone)}</span>${waButton(c.guardian_phone)}</span>` : ''}
          ${c.status === 'left' ? `<span class="badge status-left">خرج في ${fmtDate(c.end_date)}</span>` : ''}</div>
        ${c.notes ? `<p class="remarks">📝 ${esc(c.notes)}</p>` : ''}
      </div>
    </div>
    ${financeSection(finance, 'admin', 'program')}`;
  const reload = () => viewProgramChild(el, id);
  $('#add-payment').addEventListener('click', () => {
    const current = finance.months.find((m) => m.remaining > 0) || { month: today().slice(0, 7), remaining: finance.monthly_fee || '' };
    openModal(
      'تسجيل دفعة',
      `<div class="row">
         <label>الشهر<input type="month" name="month" value="${esc(current.month)}" required></label>
         <label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${esc(current.remaining || '')}" required></label>
       </div>
       <div class="row">
         <label>تاريخ الدفع<input type="date" name="paid_on" value="${today()}"></label>
         <label>طريقة الدفع<select name="method">${Object.entries(PAYMENT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
       </div>
       <label>ملاحظة<input name="note"></label>`,
      async (data) => {
        const { payment } = await api('POST', `/api/program/children/${id}/payments`, data);
        toast('تم تسجيل الدفعة');
        if (confirmAction(`تم تسجيل الدفعة (وصل رقم ${payment.receipt_no}). فتح الوصل للطباعة؟`)) location.hash = `#/receipt/program/${payment.id}`;
        else reload();
      }
    );
  });
  el.querySelectorAll('[data-del-pay]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذه الدفعة؟')) return;
      await api('DELETE', `/api/program/payments/${b.dataset.delPay}`).catch((err) => toast(err.message, true));
      reload();
    })
  );
}

// ---------- الدورات ----------
const COURSE_FILTERS = {
  '': 'الكل',
  courses: 'الدورات',
  activity: 'الأنشطة',
  trip: 'الرحلات',
  camp: 'المخيمات',
};
const courseMatches = (c, f) =>
  !f || (f === 'courses' ? ['holiday', 'summer', 'other'].includes(c.kind) : c.kind === f);

async function viewCourses(el) {
  const { courses } = await api('GET', '/api/courses');
  const filter = sessionStorage.getItem('courseFilter') || '';
  el.innerHTML = `
    <div class="page-head">
      <div><a href="#/home" class="muted small">→ الرئيسية</a><h2>🏕️ الدورات والأنشطة</h2></div>
      <button class="btn" id="add-course">+ جديد</button>
    </div>
    <div class="class-chips">${Object.entries(COURSE_FILTERS)
      .map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${v} <b>${courses.filter((c) => courseMatches(c, k)).length}</b></button>`)
      .join('')}</div>
    <div id="course-list"></div>`;
  const render = () => {
    const f = sessionStorage.getItem('courseFilter') || '';
    const list = courses.filter((c) => courseMatches(c, f));
    $('#course-list').innerHTML = list.length
      ? `<div class="cards">${list
          .map(
            (c) => `<a class="card course ${c.status === 'cancelled' ? 'cancelled' : ''}" href="#/courses/${c.id}">
              <div class="section-head"><h3>${COURSE_KIND_ICONS[c.kind]} ${esc(c.name)}</h3><span class="badge level">${COURSE_KIND_LABELS[c.kind]}</span></div>
              <p class="muted small">${c.start_date ? `من ${fmtDate(c.start_date)}` : ''} ${c.end_date ? `إلى ${fmtDate(c.end_date)}` : ''}
                ${c.place ? `· 📍 ${esc(c.place)}` : ''} ${c.status !== 'planned' ? `· <b>${COURSE_STATUS_LABELS[c.status]}</b>` : ''}</p>
              <div class="line"><span>المشاركون</span><b>${c.participants}${c.capacity ? ` / ${c.capacity}` : ''}</b></div>
              <div class="line"><span>المقبوض</span><b class="in">${fmtMoney(c.received + c.other_income)}</b></div>
              <div class="line"><span>المصاريف</span><b class="out">${fmtMoney(c.expenses)}</b></div>
              <div class="line"><span>الصافي</span>${netBadge(c.net)}</div>
              ${c.expected > c.received ? `<div class="line muted small"><span>باقي معاليم لم تُقبض</span><span>${fmtMoney(c.expected - c.received)}</span></div>` : ''}
            </a>`
          )
          .join('')}</div>`
      : '<div class="card muted">لا يوجد شيء في هذا الصنف بعد.</div>';
  };
  el.querySelectorAll('[data-f]').forEach((b) =>
    b.addEventListener('click', () => {
      sessionStorage.setItem('courseFilter', b.dataset.f);
      el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
      render();
    })
  );
  $('#add-course').addEventListener('click', () => courseForm(null, () => viewCourses(el)));
  render();
}

function courseForm(c, onDone) {
  openModal(
    c ? 'تعديل' : 'دورة / نشاط / رحلة / مخيم جديد',
    `<label>الاسم<input name="name" value="${esc(c?.name || '')}" required placeholder="مثال: رحلة إلى عين دراهم، دورة عطلة الشتاء…"></label>
     <div class="row">
       <label>النوع<select name="kind">${Object.entries(COURSE_KIND_LABELS)
         .map(([k, v]) => `<option value="${k}" ${c?.kind === k ? 'selected' : ''}>${v}</option>`)
         .join('')}</select></label>
       <label>معلوم المشاركة (د.ت)<input name="price" inputmode="decimal" value="${esc(c?.price ?? '')}"></label>
     </div>
     <div class="row">
       <label>المكان<input name="place" value="${esc(c?.place || '')}"></label>
       <label>عدد الأماكن<input name="capacity" type="number" min="0" value="${esc(c?.capacity ?? '')}"></label>
     </div>
     <label>الحالة<select name="status">${Object.entries(COURSE_STATUS_LABELS)
       .map(([k, v]) => `<option value="${k}" ${(c?.status || 'planned') === k ? 'selected' : ''}>${v}</option>`)
       .join('')}</select></label>
     <div class="row">
       <label>من<input type="date" name="start_date" value="${esc(c?.start_date || '')}"></label>
       <label>إلى<input type="date" name="end_date" value="${esc(c?.end_date || '')}"></label>
     </div>
     <label>ملاحظات<input name="notes" value="${esc(c?.notes || '')}"></label>`,
    async (data) => {
      if (c) await api('PUT', `/api/courses/${c.id}`, data);
      else await api('POST', '/api/courses', data);
      toast('تم الحفظ');
      onDone();
    }
  );
}

async function viewCourse(el, id) {
  const { course: c, participants, entries } = await api('GET', `/api/courses/${id}`);
  const meta = await financeMeta();
  el.innerHTML = `
    <a href="#/courses" class="muted small">→ الدورات</a>
    <div class="page-head">
      <div><h2>${esc(c.name)}</h2>
        <div class="meta"><span class="badge level">${COURSE_KIND_ICONS[c.kind]} ${COURSE_KIND_LABELS[c.kind]}</span>
          <span class="badge general">${COURSE_STATUS_LABELS[c.status]}</span>
          ${c.place ? `<span>📍 ${esc(c.place)}</span>` : ''}
          ${c.start_date ? `<span>من ${fmtDate(c.start_date)}</span>` : ''}${c.end_date ? `<span>إلى ${fmtDate(c.end_date)}</span>` : ''}
          ${c.price ? `<span>المعلوم: ${fmtMoney(c.price)}</span>` : ''}</div></div>
      <div class="actions">
        <button class="btn ghost" id="edit-course">تعديل</button>
        <button class="btn danger" id="del-course">حذف</button>
      </div>
    </div>
    <div class="stats compact">
      <div class="stat"><b>${c.participants}${c.capacity ? ` / ${c.capacity}` : ''}</b><span>مشارك${c.capacity && c.participants >= c.capacity ? ' — مكتمل' : ''}</span></div>
      <div class="stat good"><b>${fmtMoney(c.received + c.other_income)}</b><span>المقبوض</span></div>
      <div class="stat warn"><b>${fmtMoney(c.expenses)}</b><span>المصاريف</span></div>
      <div class="stat ${c.net >= 0 ? 'profit' : 'loss'}"><b>${c.net >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(c.net))}</b><span>${c.net >= 0 ? 'ربح' : 'خسارة'}</span></div>
    </div>
    <section class="card">
      <div class="section-head"><h3>👥 المشاركون</h3><button class="btn small" id="add-part">+ مشارك</button></div>
      ${
        participants.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>الاسم</th><th>الهاتف</th><th>المعلوم</th><th>المدفوع</th><th>الباقي</th><th></th></tr></thead>
              <tbody>${participants
                .map(
                  (p) => `<tr>
                    <td><b>${esc(p.full_name)}</b>${p.student_id ? ' <span class="badge level">تلميذ دعم</span>' : ''}</td>
                    <td><span class="phone-line"><span dir="ltr">${esc(p.phone || '—')}</span>${waButton(p.phone)}</span></td>
                    <td>${fmtMoney(p.due)}${p.discount ? `<div class="muted small">بعد تخفيض ${fmtMoney(p.discount)}</div>` : ''}</td>
                    <td>${fmtMoney(p.paid)}${p.payments.map((x) => `<div class="small"><a class="receipt-link" href="#/receipt/course/${x.id}">🧾 ${x.receipt_no} · ${fmtMoney(x.amount)}</a></div>`).join('')}</td>
                    <td>${p.remaining > 0 ? `<b class="owed">${fmtMoney(p.remaining)}</b>` : '<span class="badge good">خالص</span>'}</td>
                    <td class="row-actions">${p.remaining > 0 ? `<button class="btn small" data-pay="${p.id}">+ دفعة</button>` : ''}
                      <button class="link danger" data-del-part="${p.id}">حذف</button></td>
                  </tr>`
                )
                .join('')}</tbody></table></div>`
          : '<p class="muted">لا يوجد مشاركون بعد.</p>'
      }
    </section>
    <section class="card">
      <div class="section-head"><h3>🧾 مصاريف ومداخيل الدورة</h3>
        <div><button class="btn small warn" id="add-exp">+ مصروف</button> <button class="btn small ghost" id="add-inc">+ مدخول</button></div></div>
      ${
        entries.length
          ? `<ul class="levels">${entries
              .map(
                (e) => `<li><span>${fmtDate(e.date)} — ${esc(meta.categories[e.direction][e.category] || e.category)}
                  ${e.description ? `<span class="muted small">${esc(e.description)}</span>` : ''}</span>
                  <span><b class="${e.direction === 'income' ? 'in' : 'out'}">${e.direction === 'income' ? '+' : '−'} ${fmtMoney(e.amount)}</b>
                  <button class="link danger" data-del-entry="${e.id}">حذف</button></span></li>`
              )
              .join('')}</ul>`
          : '<p class="muted">لا توجد مصاريف مسجّلة (أجور المؤطرين، الأدوات، النقل…).</p>'
      }
    </section>`;
  const reload = () => viewCourse(el, id);
  $('#edit-course').addEventListener('click', () => courseForm(c, reload));
  $('#del-course').addEventListener('click', async () => {
    if (!confirmAction('حذف الدورة مع مشاركيها ودفعاتهم؟')) return;
    await api('DELETE', `/api/courses/${id}`);
    location.hash = '#/courses';
  });
  $('#add-exp').addEventListener('click', () => ledgerForm(null, 'expense', reload, { activity: 'courses', course_id: id }));
  $('#add-inc').addEventListener('click', () => ledgerForm(null, 'income', reload, { activity: 'courses', course_id: id }));
  $('#add-part').addEventListener('click', async () => {
    const { students } = await api('GET', '/api/students?status=studying');
    openModal(
      'مشارك جديد',
      `<label>من تلاميذ دروس الدعم (اختياري)<select id="part-student"><option value="">— مشارك جديد —</option>${students
        .map((st) => `<option value="${st.id}">${esc(st.full_name)} — ${esc(levelLabel(st.level))}</option>`)
        .join('')}</select></label>
       <input type="hidden" name="student_id" id="part-student-id">
       <div class="row">
         <label>الاسم واللقب<input name="full_name" id="part-name" required></label>
         <label>الهاتف<input name="phone" id="part-phone" dir="ltr"></label>
       </div>
       <div class="row">
         <label>المعلوم (د.ت)<input name="fee" inputmode="decimal" value="${esc(c.price ?? '')}"></label>
         <label>تخفيض (د.ت)<input name="discount" inputmode="decimal" placeholder="0"></label>
       </div>
       <label>مدفوع الآن (د.ت)<input name="paid_now" inputmode="decimal" placeholder="0"></label>
       <label>ملاحظات<input name="notes"></label>`,
      async (data) => {
        await api('POST', `/api/courses/${id}/participants`, data);
        toast('تمت الإضافة');
        reload();
      }
    );
    $('#part-student').addEventListener('change', () => {
      const st = students.find((x) => x.id === Number($('#part-student').value));
      $('#part-student-id').value = st ? st.id : '';
      if (st) {
        $('#part-name').value = st.full_name;
        $('#part-phone').value = st.parent_phone || '';
      }
    });
  });
  el.querySelectorAll('[data-pay]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = participants.find((x) => x.id === Number(b.dataset.pay));
      openModal(
        `دفعة — ${p.full_name}`,
        `<div class="row">
           <label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${p.remaining}" required></label>
           <label>التاريخ<input type="date" name="paid_on" value="${today()}"></label>
         </div>
         <label>طريقة الدفع<select name="method">${Object.entries(PAYMENT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>`,
        async (data) => {
          const { payment } = await api('POST', `/api/courses/participants/${p.id}/payments`, data);
          toast('تم تسجيل الدفعة');
          if (confirmAction(`تم تسجيل الدفعة (وصل رقم ${payment.receipt_no}). فتح الوصل للطباعة؟`)) location.hash = `#/receipt/course/${payment.id}`;
          else reload();
        }
      );
    })
  );
  el.querySelectorAll('[data-del-part]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف المشارك ودفعاته؟')) return;
      await api('DELETE', `/api/courses/participants/${b.dataset.delPart}`).catch((err) => toast(err.message, true));
      reload();
    })
  );
  el.querySelectorAll('[data-del-entry]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذه العملية؟')) return;
      await api('DELETE', `/api/ledger/${b.dataset.delEntry}`).catch((err) => toast(err.message, true));
      reload();
    })
  );
}

// ---------- المردودية المالية ----------
async function viewFinance(el) {
  el.innerHTML = `
    <div class="page-head">
      <div><a href="#/home" class="muted small">→ الرئيسية</a><h2>📈 المردودية المالية</h2></div>
      ${monthPicker('fin-month')}
    </div>
    <div id="fin-month-body"></div>
    <section class="card">
      <h3>📆 السنة الدراسية — الصافي الشهري</h3>
      <div id="fin-year"></div>
    </section>`;

  const load = async () => {
    const s = await api('GET', '/api/finance/summary?month=' + $('#fin-month').value);
    const a = s.accrual;
    $('#fin-month-body').innerHTML = `
      <section class="card">
        <h3>💵 نقدًا: ما دخل وما خرج فعليًا في ${esc(monthLabel(s.month))}</h3>
        <div class="table-wrap"><table class="fin">
          <thead><tr><th>النشاط</th><th>المداخيل</th><th>المصاريف</th><th>الصافي</th></tr></thead>
          <tbody>${s.activities
            .map(
              (x) => `<tr>
                <td><b>${ACTIVITY_ICONS[x.key]} ${esc(x.label)}</b></td>
                <td><b class="in">${fmtMoney(x.income)}</b>${x.income_lines.map((l) => `<div class="muted small">${esc(l.label)}: ${fmtMoney(l.amount)}</div>`).join('')}</td>
                <td><b class="out">${fmtMoney(x.expense)}</b>${x.expense_lines.map((l) => `<div class="muted small">${esc(l.label)}: ${fmtMoney(l.amount)}</div>`).join('')}</td>
                <td>${netBadge(x.net)}</td>
              </tr>`
            )
            .join('')}</tbody>
          <tfoot><tr><th>المجموع</th><th>${fmtMoney(s.totals.income)}</th><th>${fmtMoney(s.totals.expense)}</th><th>${netBadge(s.totals.net)}</th></tr></tfoot>
        </table></div>
      </section>
      <section class="card">
        <h3>📋 حسب الاستحقاق: ما يجب أن يدخل ويخرج عن الشهر</h3>
        <p class="muted small">يُبيّن مردودية النشاط الحقيقية حتى لو تأخّر الخلاص.</p>
        <div class="grid2 even">
          <div>
            <h4>📚 دروس الدعم</h4>
            <div class="line"><span>المستحق على التلاميذ</span><b>${fmtMoney(a.support.billed)}</b></div>
            <div class="line"><span>منه مقبوض</span><span>${fmtMoney(a.support.collected)}</span></div>
            <div class="line"><span>مستحق المعلمين (الساعات المنجزة)</span><b>${fmtMoney(a.support.teachers_due)}</b></div>
            <div class="line"><span>منه مدفوع</span><span>${fmtMoney(a.support.teachers_paid)}</span></div>
            <div class="line total"><span>هامش الربح</span>${netBadge(a.support.margin)}</div>
          </div>
          <div>
            <h4>🎨 البرنامج التربوي</h4>
            <div class="line"><span>المستحق على الأطفال</span><b>${fmtMoney(a.program.billed)}</b></div>
            <div class="line"><span>منه مقبوض</span><span>${fmtMoney(a.program.collected)}</span></div>
            <div class="line"><span>الأجور والمصاريف</span><b>${fmtMoney(a.program.expenses)}</b></div>
            <div class="line total"><span>هامش الربح</span>${netBadge(a.program.margin)}</div>
          </div>
        </div>
      </section>`;
  };

  const loadYear = async () => {
    const y = await api('GET', '/api/finance/year');
    const max = Math.max(1, ...y.months.map((m) => Math.abs(m.totals.net)));
    const short = (m) => MONTHS_AR[Number(m.slice(5)) - 1];
    // عمود لكل شهر حول خط الصفر: الربح فوق (أزرق) والخسارة تحت (أحمر)، مع العلامة في التلميح والجدول
    $('#fin-year').innerHTML = `
      <div class="netchart" role="img" aria-label="الصافي الشهري للسنة الدراسية">
        ${y.months
          .map((m) => {
            const v = m.totals.net;
            const h = Math.max((Math.abs(v) / max) * 100, v ? 2 : 0);
            return `<div class="nc-col" tabindex="0">
              <div class="nc-tip"><b>${esc(monthLabel(m.month))}</b><br>مداخيل ${fmtMoney(m.totals.income)}<br>مصاريف ${fmtMoney(m.totals.expense)}<br>${v >= 0 ? 'ربح' : 'خسارة'} ${fmtMoney(Math.abs(v))}</div>
              <div class="nc-half up">${v > 0 ? `<div class="nc-bar pos" style="height:${h}%"></div>` : ''}</div>
              <div class="nc-half down">${v < 0 ? `<div class="nc-bar neg" style="height:${h}%"></div>` : ''}</div>
              <span class="nc-label">${short(m.month)}</span>
            </div>`;
          })
          .join('')}
      </div>
      <div class="table-wrap"><table class="fin">
        <thead><tr><th>الشهر</th>${Object.keys(ACTIVITY_ICONS).map((k) => `<th>${ACTIVITY_ICONS[k]}</th>`).join('')}<th>المداخيل</th><th>المصاريف</th><th>الصافي</th></tr></thead>
        <tbody>${[...y.months]
          .reverse()
          .map(
            (m) => `<tr class="clickable" data-month="${m.month}"><td><b>${esc(monthLabel(m.month))}</b></td>
              ${Object.keys(ACTIVITY_ICONS).map((k) => `<td class="${m.activities[k].net < 0 ? 'out' : ''}">${fmtMoney(m.activities[k].net)}</td>`).join('')}
              <td>${fmtMoney(m.totals.income)}</td><td>${fmtMoney(m.totals.expense)}</td><td>${netBadge(m.totals.net)}</td></tr>`
          )
          .join('')}</tbody>
        <tfoot><tr><th>المجموع</th><th colspan="4"></th><th>${fmtMoney(y.totals.income)}</th><th>${fmtMoney(y.totals.expense)}</th><th>${netBadge(y.totals.net)}</th></tr></tfoot>
      </table></div>
      <p class="muted small">الأعمدة: صافي كل نشاط (📚 دروس الدعم، 🎨 البرنامج التربوي، 🏕️ الدورات، 🏢 مصاريف عامة). اضغط على شهر لعرض تفاصيله.</p>`;
    $('#fin-year').querySelectorAll('[data-month]').forEach((tr) =>
      tr.addEventListener('click', () => {
        $('#fin-month').value = tr.dataset.month;
        sessionStorage.setItem('finMonth', tr.dataset.month);
        load();
        el.scrollIntoView({ behavior: 'smooth' });
      })
    );
  };
  bindMonth('fin-month', load);
  await Promise.all([load(), loadYear()]);
}
