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
  // الرئيسية: أيقونات الدخول فقط (الإحصائيات في «لوحة المشرف»)
  const tiles = [
    can('stats') && ['#/board', '📊', 'لوحة المشرف', 'الإحصائيات، الخزينة اليومية، المداخيل والمصاريف، الغيابات، الإشعارات', 'board'],
    can('school') && ['#/dashboard', '📚', 'دروس الدعم', 'التلاميذ، الجداول، الغيابات، الخلاص، المعلمون'],
    can('school') && ['#/program', '🎨', 'البرنامج التربوي', 'الأقسام حسب الأعمار، الأطفال، الخلاص الشهري'],
    can('school') && ['#/courses', '🏕️', 'الدورات والأنشطة', 'دورات العطل والصيف، الأنشطة، الرحلات والمخيمات'],
    ['#/todo', '🗂️', 'إدارة المركز', 'المهام، الاجتماعات والقرارات، التنبيهات', 'alt'],
    (can('cash') || can('expenses') || can('accounting')) &&
      [can('cash') ? '#/cash' : can('expenses') ? '#/ledger' : '#/accounting', '💰', 'المالية والمحاسبة', 'الصندوق اليومي، المداخيل والمصاريف، الوصولات، الأجور، فضاء المحاسبة', 'alt'],
  ].filter(Boolean);
  el.innerHTML = `
    ${heroBanner({ sub: 'مركز فيد: اختر الفضاء الذي تريد الدخول إليه.', art: '🌿' })}
    <div id="home-db"></div>
    <div class="home-tiles">${tiles
      .map(([h, i, t, sub, cls]) => `<a class="home-tile ${cls || ''}" href="${h}"><span class="ico">${i}</span><b>${t}</b><small>${sub}</small></a>`)
      .join('')}</div>`;
  // نقل المعطيات إلى Supabase (يظهر فقط إن كانت قاعدة Supabase فارغة والقديمة فيها معطيات)
  if (state.user.super_admin)
    api('GET', '/api/admin/db-status').then((db) => {
      if (!$('#home-db') || !db.migration_available || db.target_rows > 0 || !db.source_rows) return;
      $('#home-db').innerHTML = `<div class="card alert-card"><b>🔄 قاعدة Supabase فارغة.</b>
        <button class="btn" id="db-migrate">نقل كل المعطيات إلى Supabase</button></div>`;
      $('#db-migrate').addEventListener('click', async (e) => {
        if (!confirmAction('نقل كل المعطيات من قاعدة Netlify إلى Supabase؟')) return;
        e.target.disabled = true;
        try {
          await api('POST', '/api/admin/migrate-db', {});
          location.reload();
        } catch (err) {
          toast(err.message, true);
          e.target.disabled = false;
        }
      });
    }).catch(() => {});
}

// ---------- لوحة المشرف: صفحات الإحصائيات ----------
const BOARD_TABS = [
  ['', '📊', 'نظرة عامة'],
  ['cash', '💵', 'الخزينة اليومية'],
  ['month', '📅', 'المداخيل والمصاريف'],
  ['absences', '📉', 'الغيابات والملاحظات'],
  ['notices', '🔔', 'الإشعارات'],
];
async function viewBoardHub(el, tab = '') {
  el.innerHTML = `
    <div class="board-tabs" role="tablist">${BOARD_TABS.filter(([k]) => k !== 'cash' || can('cash'))
      .map(([k, i, l]) => `<a href="#/board${k ? '/' + k : ''}" class="${k === tab ? 'on' : ''}" role="tab"><span>${i}</span>${l}<b class="bt-badge" data-badge="${k}" hidden></b></a>`)
      .join('')}</div>
    <div id="board-page"></div>`;
  const page = $('#board-page');
  // عدد الإشعارات على التبويب
  api('GET', '/api/board/notices')
    .then((n) => {
      // الرقم يختفي بمجرد فتح تبويب الإشعارات، ولا يرجع إلا لإشعار جديد
      const keys = [...n.salaries.map((x) => 's' + x.month + x.group + x.name), ...n.unpaid.map((x) => 'u' + n.month + x.kind + x.id)];
      const store = 'noticesSeen:' + state.user.id;
      let seen = [];
      try { seen = JSON.parse(localStorage.getItem(store) || '[]'); } catch {}
      if (tab === 'notices') {
        try { localStorage.setItem(store, JSON.stringify(keys)); } catch {}
        return;
      }
      const c = keys.filter((k) => !seen.includes(k)).length;
      const b = el.querySelector('[data-badge="notices"]');
      if (b && c) (b.textContent = c), (b.hidden = false);
    })
    .catch(() => {});
  if (tab === 'cash') return viewCash(page);
  if (tab === 'month') return boardMonth(page);
  if (tab === 'absences') return boardAbsences(page);
  if (tab === 'notices') return boardNotices(page);
  return boardOverview(page);
}

// نظرة عامة: مؤشرات اليوم والشهر، ثم السنة (الرسم البياني والجداول)
async function boardOverview(el) {
  el.innerHTML = `<div id="bo-kpis"></div><div id="bo-year"></div>`;
  api('GET', '/api/kpis').then((k) => {
    if (!$('#bo-kpis')) return;
    $('#bo-kpis').innerHTML = `<div class="kpis">
      <a class="kpi" href="#/people"><b>${k.support_active + k.program_active}</b><span>تلميذ وطفل مسجّل<small>${k.support_active} دعم · ${k.program_active} تربوي</small></span></a>
      <a class="kpi" href="#/board/month"><b class="${k.net >= 0 ? 'in' : 'out'}">${k.net >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(k.net))}</b><span>صافي ${esc(monthLabel(k.month))}</span></a>
      <a class="kpi" href="#/board/notices"><b>${k.collection_rate ?? '—'}${k.collection_rate !== null ? '%' : ''}</b><span>نسبة الاستخلاص هذا الشهر</span></a>
      <a class="kpi" href="#/debts"><b class="${k.debts_total ? 'out' : ''}">${fmtMoney(k.debts_total)}</b><span>متخلّد بذمّة ${k.debtors} عائلة</span></a>
      <a class="kpi" href="#/payroll"><b>${fmtHours(k.teacher_hours)}</b><span>ساعات تدريس هذا الشهر</span></a>
      <a class="kpi" href="#/board/absences"><b>${k.absences_month}</b><span>غياب هذا الشهر</span></a>
      <a class="kpi" href="#/courses"><b>${k.events_open}</b><span>دورة ونشاط مفتوح</span></a>
      <a class="kpi" href="#/todo"><b>${k.tasks_open}</b><span>مهمة مفتوحة${k.tasks_overdue ? `<small class="out">${k.tasks_overdue} متأخرة</small>` : ''}</span></a>
    </div>`;
  });
  await viewBoard($('#bo-year'));
}

// رسم أعمدة بسيط (أفقي): [[label, value, color?]]
function hbars(rows, { money = false, max } = {}) {
  const top = max || Math.max(1, ...rows.map((r) => Math.abs(r[1])));
  return `<div class="hbars">${rows
    .map(
      ([l, v, c]) => `<div class="hb-row"><span class="hb-l">${esc(l)}</span><span class="hb-track"><i style="width:${Math.max(2, (Math.abs(v) / top) * 100)}%;${c ? `background:${c}` : ''}"></i></span><b class="hb-v">${money ? fmtMoney(v) : v}</b></div>`
    )
    .join('')}</div>`;
}
const ACT_COLORS = { support: '#7c3aed', program: '#db2777', courses: '#0ea5e9', products: '#10b981', general: '#94a3b8' };
const ACT_LABELS = { support: '📚 الدعم', program: '🎨 التربوي', courses: '🏕️ الدورات', products: '📗 المنتجات', general: '🏢 عامة' };

// المداخيل والمصاريف: الشهر حسب البرنامج، ثم أسبوعًا بأسبوع
async function boardMonth(el) {
  el.innerHTML = `<div class="page-head"><h2>📅 المداخيل والمصاريف</h2><div class="actions">${monthPicker('bm-month')}
      <button class="btn ghost small" id="bm-exp">− مصروف</button><button class="btn ghost small" id="bm-inc">+ مدخول آخر</button></div></div>
    <div id="bm-body"><p class="muted">جاري التحميل…</p></div>`;
  const load = async () => {
    const month = $('#bm-month').value;
    const [s, w] = await Promise.all([api('GET', '/api/finance/summary?month=' + month), api('GET', '/api/board/weeks?month=' + month)]);
    if (!$('#bm-body')) return;
    const t = s.totals;
    const maxW = Math.max(1, ...w.weeks.map((x) => Math.max(x.income_total, x.expense_total)));
    $('#bm-body').innerHTML = `
      <div class="fb-kpis">
        <div class="fb-kpi in"><span>المداخيل المقبوضة</span><b>${fmtMoney(t.income)}</b><small>${esc(monthLabel(month))}</small></div>
        <div class="fb-kpi out"><span>المصاريف المدفوعة</span><b>${fmtMoney(t.expense)}</b><small>حسب تاريخ الدفع</small></div>
        <div class="fb-kpi net ${t.net < 0 ? 'neg' : ''}"><span>${t.net >= 0 ? 'ربح الشهر' : 'خسارة الشهر'}</span><b>${fmtMoney(Math.abs(t.net))}</b><small>المداخيل − المصاريف</small></div>
      </div>
      <section class="card"><div class="section-head"><h3>📆 أسبوعًا بأسبوع</h3><span class="legend"><span><i style="background:#16a34a"></i>مداخيل</span><span><i style="background:#db2777"></i>مصاريف</span></span></div>
        <div class="wk-chart">${w.weeks
          .map(
            (x) => `<div class="wk-col"><div class="wk-bars"><i class="in" style="height:${(x.income_total / maxW) * 100}%" title="${fmtMoney(x.income_total)}"></i><i class="out" style="height:${(x.expense_total / maxW) * 100}%" title="${fmtMoney(x.expense_total)}"></i></div>
              <b>الأسبوع ${x.week}</b><small>${Number(x.from.slice(8))}–${Number(x.to.slice(8))}</small><span class="${x.net >= 0 ? 'in' : 'out'}">${fmtMoney(x.net)}</span></div>`
          )
          .join('')}</div>
        <div class="table-wrap"><table><thead><tr><th>الأسبوع</th>${Object.keys(ACT_LABELS).map((k) => `<th>${ACT_LABELS[k]}</th>`).join('')}<th>المداخيل</th><th>المصاريف</th><th>الصافي</th></tr></thead>
          <tbody>${w.weeks
            .map(
              (x) => `<tr><td class="nowrap"><b>${x.week}</b> <span class="muted small">${Number(x.from.slice(8))}–${Number(x.to.slice(8))}</span></td>${Object.keys(ACT_LABELS)
                .map((k) => `<td class="nowrap"><span class="in">${x.income[k] ? fmtMoney(x.income[k]) : '—'}</span>${x.expense[k] ? `<div class="out small">− ${fmtMoney(x.expense[k])}</div>` : ''}</td>`)
                .join('')}<td class="in nowrap">${fmtMoney(x.income_total)}</td><td class="out nowrap">${fmtMoney(x.expense_total)}</td><td>${netBadge(x.net)}</td></tr>`
            )
            .join('')}</tbody></table></div></section>
      <section class="card"><h3>🧩 حسب البرنامج</h3>
        ${hbars(s.activities.filter((a) => a.income || a.expense).map((a) => [a.label, a.net, a.net >= 0 ? ACT_COLORS[a.key] || '#7c3aed' : '#db2777']), { money: true })}
      </section>
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
            ${a.shared_pct ? `<div class="line"><span>نصيبه من المصاريف المشتركة (${a.shared_pct}%)</span><span class="out">${fmtMoney(a.shared)}</span></div><div class="line total"><span>الصافي بعد التوزيع</span>${netBadge(a.net_after)}</div>` : ''}
          </div>`
        )
        .join('')}</div>
      ${unpaidNote(s.accrual)}`;
  };
  bindMonth('bm-month', load);
  $('#bm-exp').addEventListener('click', () => ledgerForm(null, 'expense', load));
  $('#bm-inc').addEventListener('click', () => ledgerForm(null, 'income', load));
  await load();
}

// الغيابات والملاحظات
async function boardAbsences(el) {
  el.innerHTML = `<div class="page-head"><h2>📉 الغيابات والملاحظات</h2>${monthPicker('ba-month')}</div><div id="ba-body"><p class="muted">جاري التحميل…</p></div>`;
  const load = async () => {
    const d = await api('GET', '/api/board/attendance?month=' + $('#ba-month').value);
    if (!$('#ba-body')) return;
    const maxS = Math.max(1, ...d.series.map((x) => x.support + x.program));
    const CAT = { level: 'المستوى', behavior: 'السلوك', content: 'متابعة المحتوى', general: 'عامة' };
    const RAT = { excellent: ['ممتاز', '#16a34a'], good: ['حسن', '#22c55e'], average: ['متوسط', '#f59e0b'], weak: ['ضعيف', '#db2777'] };
    $('#ba-body').innerHTML = `
      <div class="fb-kpis">
        <div class="fb-kpi out"><span>غيابات تلاميذ الدعم</span><b>${d.totals.support}</b><small>${d.totals.unjustified} غير مبرّر</small></div>
        <div class="fb-kpi net"><span>غيابات أطفال التربوي</span><b>${d.totals.program}</b><small>${esc(monthLabel(d.month))}</small></div>
        <div class="fb-kpi ${d.totals.teachers ? 'out' : 'in'}"><span>غيابات المدرّسين</span><b>${d.totals.teachers}</b><small>حصة لم تُحتسب</small></div>
        <div class="fb-kpi in"><span>الملاحظات</span><b>${d.totals.notes}</b><small>الدعم والتربوي</small></div>
      </div>
      <section class="card"><div class="section-head"><h3>📈 آخر 6 أشهر</h3><span class="legend"><span><i style="background:#7c3aed"></i>الدعم</span><span><i style="background:#db2777"></i>التربوي</span><span><i style="background:#f59e0b"></i>المدرّسون</span></span></div>
        <div class="wk-chart">${d.series
          .map(
            (x) => `<div class="wk-col"><div class="wk-bars stack"><i style="height:${(x.support / maxS) * 100}%;background:#7c3aed" title="الدعم ${x.support}"></i><i style="height:${(x.program / maxS) * 100}%;background:#db2777" title="التربوي ${x.program}"></i></div>
              <b>${esc(MONTHS_AR[Number(x.month.slice(5)) - 1])}</b><small>${x.support + x.program} غياب${x.teachers ? ` · ${x.teachers} مدرّس` : ''}</small></div>`
          )
          .join('')}</div></section>
      <div class="board-grid">
        <section class="card"><h3>📚 حسب المستوى</h3>${d.by_level.length ? hbars(d.by_level.map((x) => [levelLabel(x.level) + (x.unjustified ? ` (${x.unjustified} غير مبرّر)` : ''), x.n, '#7c3aed'])) : '<p class="muted">لا غيابات.</p>'}</section>
        <section class="card"><h3>📖 حسب المادة</h3>${d.by_subject.length ? hbars(d.by_subject.map((x) => [x.subject, x.n, '#8b5cf6'])) : '<p class="muted">لا غيابات.</p>'}</section>
        <section class="card"><h3>🎨 التربوي حسب القسم</h3>${d.by_class.length ? hbars(d.by_class.map((x) => [x.class_name, x.n, '#db2777'])) : '<p class="muted">لا غيابات.</p>'}</section>
        <section class="card"><h3>👩‍🏫 غيابات المدرّسين</h3>${d.teachers.length ? hbars(d.teachers.map((x) => [x.full_name, x.n, '#f59e0b'])) : '<p class="muted">كل المدرّسين حضروا ✓</p>'}</section>
      </div>
      <section class="card"><div class="section-head"><h3>⚠️ الأكثر غيابًا هذا الشهر</h3><a class="link small" href="#/attendance">تسجيل الغيابات ←</a></div>
        ${
          d.top_students.length
            ? `<div class="pkids">${d.top_students
                .map((x) => `<a class="pkid" href="#/students/${x.id}"><span class="pk-main"><b>${esc(x.full_name)}</b><small>${esc(levelLabel(x.level))}</small></span><span class="pk-bal ${x.unjustified ? 'due' : 'ok'}">${x.n} غياب${x.unjustified ? ` · ${x.unjustified} غير مبرّر` : ''}</span></a>`)
                .join('')}</div>`
            : '<p class="muted">لا غيابات هذا الشهر 👏</p>'
        }</section>
      <div class="board-grid">
        <section class="card"><h3>📝 الملاحظات حسب النوع</h3>${d.notes.length ? hbars(d.notes.map((x) => [CAT[x.category] || x.category, x.n, '#0ea5e9'])) : '<p class="muted">لا ملاحظات.</p>'}</section>
        <section class="card"><h3>⭐ تقييمات المعلّمين</h3>${d.ratings.length ? hbars(Object.keys(RAT).map((k) => [RAT[k][0], d.ratings.find((r) => r.rating === k)?.n || 0, RAT[k][1]])) : '<p class="muted">لا تقييمات.</p>'}</section>
      </div>`;
  };
  bindMonth('ba-month', load);
  await load();
}

// الإشعارات: أجور غير مدفوعة، تلاميذ لم يدفعوا الشهر، وبقية التنبيهات
async function boardNotices(el) {
  el.innerHTML = `<div class="page-head"><div><h2>🔔 الإشعارات</h2><p class="muted small">ما يحتاج قرارًا أو متابعة اليوم.</p></div></div><div id="bn-body"><p class="muted">جاري التحميل…</p></div>`;
  const [n, { alerts }] = await Promise.all([api('GET', '/api/board/notices'), api('GET', '/api/alerts').catch(() => ({ alerts: [] }))]);
  if (!$('#bn-body')) return;
  const other = alerts.filter((a) => a.level !== 'info');
  $('#bn-body').innerHTML = `
    <div class="fb-kpis">
      <div class="fb-kpi ${n.salaries.length ? 'out' : 'in'}"><span>💼 أجور ${esc(monthLabel(n.prev))} غير مدفوعة</span><b>${fmtMoney(n.totals.salaries)}</b><small>${n.salaries.length} شخص</small></div>
      <div class="fb-kpi ${n.unpaid.length ? 'out' : 'in'}"><span>👨‍👩‍👧 لم يدفعوا ${esc(monthLabel(n.month))}</span><b>${fmtMoney(n.totals.unpaid_month)}</b><small>${n.unpaid.length} تلميذ وطفل</small></div>
      <div class="fb-kpi net"><span>المتخلّد بذمّتهم (كل الأشهر)</span><b>${fmtMoney(n.totals.unpaid_all)}</b><small><a href="#/debts">كل الديون ←</a></small></div>
    </div>
    <section class="card"><div class="section-head"><h3>💼 أجور ${esc(monthLabel(n.prev))} لم تُدفع بعد</h3><a class="link small" href="#/salaries">الأجور ←</a></div>
      ${
        n.salaries.length
          ? `<div class="pkids">${n.salaries
              .map((x) => `<a class="pkid" href="${x.link}"><span class="pk-main"><b>${esc(x.name)}</b><small>${esc(x.group)} · مستحق ${fmtMoney(x.due)} · مدفوع ${fmtMoney(x.paid)}</small></span><span class="pk-bal due">${fmtMoney(x.rest)}</span></a>`)
              .join('')}</div>`
          : '<p class="muted">كل أجور الشهر الماضي خالصة ✓</p>'
      }</section>
    <section class="card"><div class="section-head"><h3>👨‍👩‍👧 لم يدفعوا ${esc(monthLabel(n.month))} (منذ 1 الشهر)</h3><a class="link small" href="#/students" id="bn-list">القائمة ←</a></div>
      ${
        n.unpaid.length
          ? `<div class="pkids">${n.unpaid
              .map(
                (x) => `<div class="pkid"><a class="pk-main" href="${x.link}"><b>${esc(x.full_name)}</b><small>${x.kind === 'support' ? esc(levelLabel(x.level)) : `🎨 ${esc(x.class_name || 'التربوي')}`}${x.parent ? ` · ${esc(x.parent)}` : ''}</small></a>
                  ${x.phone && waNumber(x.phone) ? waButton(x.phone, `السلام عليكم ${x.parent || ''}، نذكّركم بمعلوم ${monthLabel(n.month)} لـ ${x.full_name}: ${fmtMoney(x.month_rest)}. شكرًا — مركز فيد`) : ''}
                  <span class="pk-bal due" title="كل الأشهر: ${fmtMoney(x.balance)}">${fmtMoney(x.month_rest)}</span></div>`
              )
              .join('')}</div>`
          : '<p class="muted">الكل دفع هذا الشهر ✓</p>'
      }</section>
    ${
      other.length
        ? `<section class="card"><div class="section-head"><h3>⚠️ تنبيهات أخرى</h3><a class="link small" href="#/alerts">كل التنبيهات ←</a></div>
            ${other.map((a) => `<a class="alert-line ${a.level}" href="${a.link}">${a.level === 'urgent' ? '⛔' : '⚠️'} ${esc(a.text)}</a>`).join('')}</section>`
        : ''
    }`;
  $('#bn-list')?.addEventListener('click', () => sessionStorage.setItem('payFilter', 'due'));
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
const PAID_FROM_LABELS = { cash: 'الصندوق (نقدًا)', bank: 'بنك الشركة', owner: 'من مبلغ سحبه صاحب المشروع' };
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
     <label>البيان<input name="description" value="${esc(entry?.description || '')}" placeholder="مثال: كراء المقر لشهر أكتوبر"></label>
     <label>${dir === 'income' ? 'دخل إلى' : 'دُفع من'}<select name="paid_from">${Object.entries(dir === 'income' ? { cash: 'الصندوق (نقدًا)', bank: 'بنك الشركة' } : PAID_FROM_LABELS)
       .map(([k, v]) => `<option value="${k}" ${(entry?.paid_from || preset.paid_from || 'cash') === k ? 'selected' : ''}>${v}</option>`)
       .join('')}</select></label>`,
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
           .map(([k, v]) => `<option value="${k}" ${(x?.activity || 'general') === k ? 'selected' : ''}>${v}</option>`)
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
  if (state.user.role === 'teacher') return viewProgramTeacher(el);
  const { classes, children } = await api('GET', '/api/program');
  const [{ users: parents }, { users: teachers }, { students }] = await Promise.all([
    api('GET', '/api/users?role=parent'),
    api('GET', '/api/users?role=teacher'),
    api('GET', '/api/students'),
  ]);
  const lists = { classes, parents, teachers, students, children };
  const filter = sessionStorage.getItem('progClass') || '';
  const active = children.filter((c) => c.status === 'active');
  const monthlyExpected = active.filter((c) => !c.free).reduce((t, c) => t + (c.monthly_fee || 0), 0);
  const owed = children.reduce((t, c) => t + Math.max(c.balance || 0, 0), 0);
  el.innerHTML = `
    <div class="page-head">
      <div><a href="#/home" class="muted small">→ الرئيسية</a><h2>🎨 البرنامج التربوي</h2></div>
      <div class="actions">
        <a class="btn ghost" href="#/program/attendance">الغيابات</a>
        <button class="btn ghost" id="add-class">+ قسم</button>
        <button class="btn" id="add-child">+ طفل</button>
      </div>
    </div>
    <div class="stats compact">
      <div class="stat"><b>${active.length}</b><span>طفل مسجّل</span></div>
      <div class="stat"><b>${classes.length}</b><span>أقسام</span></div>
      <div class="stat good"><b>${fmtMoney(monthlyExpected)}</b><span>المنتظر شهريًا</span></div>
      <div class="stat warn"><b>${fmtMoney(owed)}</b><span>مبالغ غير مدفوعة</span></div>
    </div>
    <div class="filters">
      <select id="pf-class" aria-label="القسم"><option value="">كل الأقسام (${children.length})</option>${classes
        .map((k) => `<option value="${k.id}" ${filter === String(k.id) ? 'selected' : ''}>${esc(k.name)}${k.age_range ? ` — ${esc(k.age_range)}` : ''} (${k.children})</option>`)
        .join('')}</select>
      <select id="pf-status" aria-label="الحالة">${[['active', 'يدرس'], ['left', 'خرج'], ['', 'كل الحالات']]
        .map(([v, l]) => `<option value="${v}" ${(sessionStorage.getItem('progStatus') ?? 'active') === v ? 'selected' : ''}>${l}</option>`)
        .join('')}</select>
      ${payFilterSelect('pf-pay')}
      <input id="pf-q" type="search" placeholder="بحث بالاسم…">
      <button class="btn ghost small" id="pf-edit-class" hidden>✎ تعديل القسم</button>
      ${viewToggle()}
    </div>
    <p class="muted small" id="pf-class-info"></p>
    <div id="prog-list"></div>`;
  let view = studentsView('progView');
  const hueOf = (classId) => [262, 330, 200, 152, 28, 290, 175, 45][Math.max(0, classes.findIndex((k) => k.id === classId)) % 8];

  const render = () => {
    if (!$('#prog-list')) return; // الصفحة تبدّلت قبل اكتمال التحميل
    const f = $('#pf-class').value;
    const st = $('#pf-status').value;
    const q = $('#pf-q').value.trim().toLowerCase();
    sessionStorage.setItem('progClass', f);
    sessionStorage.setItem('progStatus', st);
    const k = classes.find((x) => String(x.id) === f);
    $('#pf-edit-class').hidden = !k;
    $('#pf-edit-class').dataset.editClass = k ? k.id : '';
    $('#pf-class-info').textContent = k ? [k.age_range, k.teacher_name && `المؤطّر: ${k.teacher_name}`, k.notes].filter(Boolean).join(' · ') : '';
    const list0 = children.filter(
      (c) => (!f || String(c.class_id) === f) && (!st || c.status === st) && (!q || c.full_name.toLowerCase().includes(q) || String(c.contact_name || '').toLowerCase().includes(q))
    );
    const list = applyPayFilter(list0, $('#pf-pay').value);
    const owedCell = (c) => (c.free ? '<span class="badge free">مجاني</span>' : c.balance > 0 ? `<b class="owed">${fmtMoney(c.balance)}</b>` : c.monthly_fee && !c.free ? '<span class="badge good">خالص</span>' : '—');
    const feeCell = (c) => `${c.free ? '<span class="muted">—</span>' : fmtMoney(c.monthly_fee)}${c.sibling_pct ? `<div class="muted small">إخوة −${c.sibling_pct}%</div>` : ''}`;
    const badges = (c) => `${c.status === 'left' ? ' <span class="badge status-left">خرج</span>' : ''}${c.student_id ? ' <span class="badge level">+ دروس الدعم</span>' : ''}`;
    $('#prog-list').innerHTML = payFilterSummary(list, $('#pf-pay').value) + (!list.length
      ? '<div class="card muted">لا يوجد أطفال بهذه الشروط.</div>'
      : view === 'cards'
      ? `<div class="scards">${list
          .map((c) => {
            const money =
              c.balance > 0
                ? `<div class="sc-stat owe"><b>${fmtMoney(c.balance)}</b><span>الباقي</span></div>`
                : c.monthly_fee || c.free
                ? `<div class="sc-stat ok"><b>✓</b><span>${c.free ? 'مجاني' : 'خالص'}</span></div>`
                : '<div class="sc-stat"><b>—</b><span>الخلاص</span></div>';
            return `<article class="scard" style="--lv:${hueOf(c.class_id)}">
              <a class="sc-head" href="#/program/child/${c.id}">
                ${avatar({ full_name: c.full_name }, 'md')}
                <div class="sc-id"><h3>${esc(c.full_name)}</h3>
                  <div class="sc-tags"><span class="sc-level">${esc(c.class_name || 'بدون قسم')}</span>${badges(c)}</div>
                  <div class="sc-since">${c.start_date ? `دخل المركز ${fmtDate(c.start_date)}` : '<span class="muted">تاريخ الدخول غير محدّد</span>'}</div></div>
              </a>
              <div class="sc-parent"><span class="sc-ico" aria-hidden="true">👤</span>
                <div><b>${esc(c.contact_name || 'بدون ولي')}</b>${c.contact_phone ? `<span dir="ltr" class="muted small">${esc(c.contact_phone)}</span>` : ''}</div>
                ${c.contact_phone ? waButton(c.contact_phone) : ''}</div>
              <div class="sc-stats">
                <div class="sc-stat"><b>${ageOf(c.birth_date) || '—'}</b><span>العمر</span></div>
                <div class="sc-stat"><b>${c.free ? '—' : fmtMoney(c.monthly_fee)}</b><span>${c.sibling_pct ? `شهريًا · إخوة −${c.sibling_pct}%` : 'شهريًا'}</span></div>
              </div>
              <div class="sc-actions"><a class="btn ghost small" href="#/program/child/${c.id}">الملف</a>${payButton('program', c)}</div>
            </article>`;
          })
          .join('')}</div>`
      : `<div class="table-wrap as-table"><table>
          <thead><tr><th>الاسم</th><th>القسم</th><th>تاريخ الدخول</th><th>الولي</th><th>الغيابات</th><th>الملاحظات</th><th>الخلاص</th></tr></thead>
          <tbody>${list
            .map(
              (c) => `<tr class="${c.status === 'left' ? 'planned' : ''}">
                <td><a class="who-cell" href="#/program/child/${c.id}">${avatar({ full_name: c.full_name }, 'sm')}<b>${esc(c.full_name)}</b></a>${badges(c)}</td>
                <td>${c.class_name ? `<span class="pill">${esc(c.class_name)}</span>` : '—'}</td>
                <td class="nowrap">${c.start_date ? fmtDate(c.start_date) : '<span class="muted">—</span>'}</td>
                <td>${parentCell(c.contact_name, c.contact_phone, c.family_parent_id)}</td>
                <td>${c.absence_count ?? 0}</td>
                <td>${c.note_count ?? 0}</td>
                <td>${payButton('program', c)}</td>
              </tr>`
            )
            .join('')}</tbody></table></div>`);
    bindPayButtons($('#prog-list'), reload);
  };
  const reload = () => viewProgram(el);

  bindViewToggle(el, 'progView', () => view, (v) => (view = v), render);
  $('#pf-class').addEventListener('change', render);
  $('#pf-status').addEventListener('change', render);
  $('#pf-q').addEventListener('input', render);
  $('#pf-pay').addEventListener('change', () => (sessionStorage.setItem('payFilter', $('#pf-pay').value), render()));
  const classForm = (k) =>
    openModal(
      k ? 'تعديل القسم' : 'قسم جديد',
      `<label>اسم القسم<input name="name" value="${esc(k?.name || '')}" required placeholder="مثال: قسم الصغار"></label>
       <div class="row">
         <label>الأعمار<input name="age_range" value="${esc(k?.age_range || '')}" placeholder="مثال: 4-5 سنوات"></label>
         <label>المعلوم الشهري (د.ت)<input name="default_fee" inputmode="decimal" value="${esc(k?.default_fee ?? '')}"></label>
       </div>
       <label>المؤطّر (يسجّل الغيابات والملاحظات والأنشطة)<select name="teacher_id"><option value="">—</option>${teachers
         .filter((t) => t.program_staff || t.id === k?.teacher_id)
         .map((t) => `<option value="${t.id}" ${k?.teacher_id === t.id ? 'selected' : ''}>${esc(t.full_name)}</option>`)
         .join('')}</select></label>
       <label>الصيغ والمعاليم (اختياري، صيغة في كل سطر: الاسم = المبلغ)
         <textarea name="formulas_text" rows="3" placeholder="أفلا ينظرون = 80&#10;أفلا ينظرون + لسان العرب = 120">${esc(
           (k?.formulas || []).map((f) => `${f.name} = ${f.fee}`).join('\n')
         )}</textarea></label>
       <label>ملاحظات<input name="notes" value="${esc(k?.notes || '')}"></label>
       ${k ? '<p><button type="button" class="link danger" id="del-class">حذف القسم</button></p>' : ''}`,
      async (data) => {
        data.formulas = String(data.formulas_text || '')
          .split('\n')
          .map((line) => line.split('='))
          .filter((x) => x.length === 2 && x[0].trim())
          .map(([name, fee]) => ({ name: name.trim(), fee: fee.trim() }));
        delete data.formulas_text;
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
  $('#add-child').addEventListener('click', () => childForm(null, lists, reload));
  render();
}

function childForm(c, { classes, parents, students, children }, onDone) {
  // تلاميذ الدعم غير المرتبطين بطفل آخر في البرنامج
  const taken = new Set(children.filter((x) => x.student_id && x.id !== c?.id).map((x) => x.student_id));
  openModal(
    c ? 'تعديل' : 'طفل جديد',
    `<label>يدرس أيضًا في دروس الدعم؟<select name="student_id" id="cf-student"><option value="">— لا —</option>${students
      .filter((st) => !taken.has(st.id))
      .map((st) => `<option value="${st.id}" ${c?.student_id === st.id ? 'selected' : ''}>${esc(st.full_name)} — ${esc(levelLabel(st.level))}</option>`)
      .join('')}</select></label>
     <label>الاسم واللقب<input name="full_name" id="cf-name" value="${esc(c?.full_name || '')}"></label>
     <div class="row">
       <label>تاريخ الولادة<input type="date" name="birth_date" value="${esc(c?.birth_date || '')}"></label>
       <label>القسم<select name="class_id"><option value="">—</option>${classes
         .map((k) => `<option value="${k.id}" ${c?.class_id === k.id ? 'selected' : ''}>${esc(k.name)}</option>`)
         .join('')}</select></label>
     </div>
     <label id="cf-formula-wrap" hidden>الصيغة<select name="formula" id="cf-formula"></select></label>
     <div id="cf-parent">
       <label>حساب الولي (ليتابع ابنه من التطبيق)<select name="parent_id"><option value="">— دون حساب —</option>${parents
         .map((u) => `<option value="${u.id}" ${c?.parent_id === u.id ? 'selected' : ''}>${esc(parentLabel(u))}</option>`)
         .join('')}</select></label>
       <div class="row">
         <label>اسم الولي (دون حساب)<input name="guardian_name" value="${esc(c?.guardian_name || '')}"></label>
         <label>الهاتف<input name="guardian_phone" dir="ltr" value="${esc(c?.guardian_phone || '')}"></label>
       </div>
     </div>
     <p class="muted small" id="cf-linked" hidden>الولي وحسابه ومعلوم التسجيل السنوي من ملف دروس الدعم.</p>
     <div class="row">
       <label>المبلغ الشهري (د.ت)<input name="monthly_fee" inputmode="decimal" value="${esc(c?.monthly_fee ?? '')}"></label>
       <label>تاريخ الدخول للمركز<input type="date" name="start_date" value="${esc(c?.start_date || (c ? '' : today()))}"></label>
     </div>
     <div class="row">
       <label>الحالة<select name="status"><option value="active">مسجّل</option><option value="left" ${c?.status === 'left' ? 'selected' : ''}>خرج</option></select></label>
       <label>تاريخ الخروج<input type="date" name="end_date" value="${esc(c?.end_date || '')}"></label>
     </div>
     <div class="row">
       <label>تخفيض شهري (د.ت)<input name="discount" inputmode="decimal" value="${esc(c?.discount ?? '')}"></label>
       <label>سبب التخفيض<input name="discount_reason" value="${esc(c?.discount_reason || '')}"></label>
     </div>
     ${c ? feeFromField(c.start_date) : ''}
     <label class="check"><input type="checkbox" name="free" ${c?.free ? 'checked' : ''}> مجاني</label>
     <label>ملاحظات<input name="notes" value="${esc(c?.notes || '')}"></label>
     ${c ? '<p><button type="button" class="link danger" id="del-child">حذف الطفل نهائيًا</button></p>' : ''}`,
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
  // صيغ القسم (مثلًا أثر: 80 أو 120): اختيار الصيغة يضع معلومها
  const formulaSel = $('#cf-formula');
  const fillFormulas = () => {
    const k = classes.find((x) => x.id === Number(classSel.value));
    const list = k?.formulas || [];
    $('#cf-formula-wrap').hidden = !list.length;
    formulaSel.innerHTML =
      '<option value="">—</option>' +
      list.map((f) => `<option value="${esc(f.name)}" ${c?.formula === f.name ? 'selected' : ''}>${esc(f.name)} — ${fmtMoney(f.fee)}</option>`).join('');
  };
  fillFormulas();
  formulaSel.addEventListener('change', () => {
    const k = classes.find((x) => x.id === Number(classSel.value));
    const f = (k?.formulas || []).find((x) => x.name === formulaSel.value);
    if (f) feeInput.value = f.fee;
  });
  classSel.addEventListener('change', () => {
    const k = classes.find((x) => x.id === Number(classSel.value));
    fillFormulas();
    if (k?.default_fee && !feeInput.value) feeInput.value = k.default_fee;
  });
  // طفل مرتبط بتلميذ دعم: الاسم من ملفه، والولي من هناك
  const sync = () => {
    const st = students.find((x) => x.id === Number($('#cf-student').value));
    $('#cf-parent').hidden = !!st;
    $('#cf-linked').hidden = !st;
    if (st && !$('#cf-name').value) $('#cf-name').value = st.full_name;
  };
  $('#cf-student').addEventListener('change', sync);
  sync();
  bindFeeFrom($('#modal'));
  $('#del-child')?.addEventListener('click', async () => {
    if (!confirmAction('حذف الطفل وكل دفعاته؟ (لخروجه من البرنامج استعمل الحالة «خرج»)')) return;
    await api('DELETE', `/api/program/children/${c.id}`);
    $('#modal').close();
    if (location.hash.startsWith('#/program/child/')) location.hash = '#/program';
    else onDone();
  });
}

const PROGRAM_NOTE_LABELS = { level: 'المستوى', content: 'متابعة المحتوى', behavior: 'السلوك', general: 'عامة' };

// متابعة طفل البرنامج التربوي: الملاحظات والغيابات (مع أزرار الإضافة للإدارة والمنشط)
// أنشطة وتمارين ورسائل القسم (البرنامج التربوي)
function classPostsSection(posts) {
  if (!posts?.length) return '';
  return `<section class="card"><h3>📌 أنشطة وتمارين ورسائل القسم</h3><ul class="tasks">${posts
    .map(
      (p) => `<li class="task"><div><b>${p.kind === 'message' ? '✉️' : '🧩'} ${esc(p.title)}</b>
        <span class="muted small">${fmtDate(String(p.created_at).slice(0, 10))}${p.author_name ? ' · ' + esc(p.author_name) : ''}${p.due_date ? ` · آخر أجل ${fmtDate(p.due_date)}` : ''}</span></div>
        ${p.body ? `<p>${esc(p.body)}</p>` : ''}</li>`
    )
    .join('')}</ul></section>`;
}

function childFollowUpSection(file, role) {
  const { child: c, absences, notes } = file;
  const canWrite = role !== 'parent';
  const mine = (authorId) => role === 'admin' || authorId === state.user.id;
  return `
    <section class="card">
      <div class="section-head"><h3>🎨 البرنامج التربوي${c.class_name ? ` — ${esc(c.class_name)}` : ''}</h3>
        ${canWrite ? `<div><button class="btn small" data-pnote="${c.id}">+ ملاحظة</button> <button class="btn small warn" data-pabs="${c.id}">+ غياب</button></div>` : ''}</div>
      <div class="stats compact">
        <div class="stat"><b>${absences.length}</b><span>الغيابات</span></div>
        <div class="stat"><b>${notes.filter((n) => n.category === 'level').length}</b><span>ملاحظات المستوى</span></div>
        <div class="stat"><b>${notes.filter((n) => n.category === 'content').length}</b><span>متابعة المحتوى</span></div>
      </div>
      <h4>📝 الملاحظات</h4>
      ${
        notes.length
          ? `<ul class="notes">${notes
              .map(
                (n) => `<li class="note"><div class="note-head">
                  <span class="badge ${n.category}">${PROGRAM_NOTE_LABELS[n.category]}</span>
                  ${n.rating ? `<span class="badge ${n.rating}">${RATING_LABELS[n.rating]}</span>` : ''}
                  <span class="muted small">${fmtDate(n.date)} · ${esc(n.author_name || '')}</span>
                  ${canWrite && mine(n.author_id) ? `<button class="link danger" data-del-pnote="${n.id}">حذف</button>` : ''}
                </div><p>${esc(n.content)}</p></li>`
              )
              .join('')}</ul>`
          : '<p class="muted">لا توجد ملاحظات بعد.</p>'
      }
      <h4>📅 الغيابات</h4>
      ${
        absences.length
          ? `<ul class="levels">${absences
              .map(
                (a) => `<li><span>${fmtDate(a.date)} ${a.justified ? '<span class="badge good">مبرر</span>' : '<span class="badge weak">غير مبرر</span>'}
                  ${a.reason ? `<span class="muted small">${esc(a.reason)}</span>` : ''}</span>
                  <span>${role === 'admin' ? `<button class="link" data-pjustify="${a.id}" data-j="${a.justified ? 0 : 1}">${a.justified ? 'إلغاء التبرير' : 'تبرير'}</button>` : ''}
                  ${canWrite && mine(a.recorded_by) ? `<button class="link danger" data-del-pabs="${a.id}">حذف</button>` : ''}</span></li>`
              )
              .join('')}</ul>`
          : '<p class="muted">لا توجد غيابات 👏</p>'
      }
    </section>`;
}

// قسم البرنامج التربوي في ملف تلميذ الدعم (نفس الطفل في البرنامجين)
function childProgramSections(file, role) {
  return classPostsSection(file.posts) + childFollowUpSection(file, role) +
    (file.finance ? financeSection(file.finance, role, 'program', '💰 الوضعية المالية — البرنامج التربوي') : '');
}

function bindChildFollowUp(el, file, reload) {
  const id = file.child.id;
  el.querySelector(`[data-pnote="${id}"]`)?.addEventListener('click', () =>
    openModal(
      'ملاحظة — البرنامج التربوي',
      `<div class="row">
         <label>النوع<select name="category">${Object.entries(PROGRAM_NOTE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
         <label>التقييم<select name="rating"><option value="">—</option>${Object.entries(RATING_LABELS)
           .map(([k, v]) => `<option value="${k}">${v}</option>`)
           .join('')}</select></label>
       </div>
       <label>التاريخ<input type="date" name="date" value="${today()}"></label>
       <label>الملاحظة<textarea name="content" rows="4" required placeholder="مثال: يتابع أنشطة المحتوى بانتظام ويشارك بحماس"></textarea></label>`,
      async (data) => {
        await api('POST', `/api/program/children/${id}/notes`, data);
        toast('تمت إضافة الملاحظة');
        reload();
      }
    )
  );
  el.querySelector(`[data-pabs="${id}"]`)?.addEventListener('click', () =>
    openModal(
      'تسجيل غياب',
      `<label>التاريخ<input type="date" name="date" value="${today()}"></label>
       <label>ملاحظة / سبب<input name="reason"></label>
       ${state.user.role === 'admin' ? '<label class="check"><input type="checkbox" name="justified"> غياب مبرر</label>' : ''}`,
      async (data) => {
        await api('POST', `/api/program/children/${id}/absences`, data);
        toast('تم تسجيل الغياب');
        reload();
      }
    )
  );
  const act = (sel, fn) => el.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => fn(b)));
  act('[data-del-pnote]', async (b) => {
    if (!confirmAction('حذف هذه الملاحظة؟')) return;
    await api('DELETE', `/api/program/notes/${b.dataset.delPnote}`).catch((e) => toast(e.message, true));
    reload();
  });
  act('[data-del-pabs]', async (b) => {
    if (!confirmAction('حذف هذا الغياب؟')) return;
    await api('DELETE', `/api/program/absences/${b.dataset.delPabs}`).catch((e) => toast(e.message, true));
    reload();
  });
  act('[data-pjustify]', async (b) => {
    await api('PATCH', `/api/program/absences/${b.dataset.pjustify}`, { justified: b.dataset.j === '1' }).catch((e) => toast(e.message, true));
    reload();
  });
}

// ملف طفل البرنامج التربوي: الإدارة، الولي (#/kid/..)، والمنشط
async function viewProgramChild(el, id) {
  const role = state.user.role;
  const file = await api('GET', `/api/program/children/${id}`);
  const { child: c, finance } = file;
  const back = role === 'parent' ? ['#/students', 'أبنائي'] : ['#/program', 'البرنامج التربوي'];
  el.innerHTML = `
    <a href="${back[0]}" class="muted small">→ ${back[1]}</a>
    <div class="page-head">
      <div><h2>${esc(c.full_name)}</h2>
        <div class="meta">${c.class_name ? `<span class="pill">${esc(c.class_name)}</span>` : ''}
          ${c.birth_date ? `<span>${ageOf(c.birth_date)}</span>` : ''}
          ${role !== 'parent' && c.contact_name ? `<span>الولي: ${esc(c.contact_name)}</span>` : ''}
          ${role === 'admin' && c.contact_phone ? `<span class="phone-line"><span dir="ltr">${esc(c.contact_phone)}</span>${waButton(c.contact_phone)}</span>` : ''}
          ${c.status === 'left' ? `<span class="badge status-left">خرج في ${fmtDate(c.end_date)}</span>` : ''}
          ${c.student_id && role !== 'teacher' ? `<a class="badge level" href="#/students/${c.student_id}">مسجّل أيضًا في دروس الدعم ←</a>` : ''}
          ${!c.student_id && role === 'admin' && c.status === 'active' ? '<button type="button" class="badge level" id="to-support">📚 تسجيله في دروس الدعم</button>' : ''}</div>
      </div>
    </div>
    ${fileTabs([['follow', 'المتابعة'], finance ? ['pay', 'الخلاص'] : null, role === 'admin' ? ['info', 'المعلومات'] : null])}
    <div class="tab-panel" data-panel="follow">
      ${classPostsSection(file.posts)}
      ${childFollowUpSection(file, role)}
    </div>
    <div class="tab-panel" data-panel="pay">
      ${finance ? financeSection(finance, role, 'program', undefined, { registration: !c.student_id }) : ''}
    </div>
    ${
      role === 'admin'
        ? `<div class="tab-panel" data-panel="info"><section class="card info-card">
            <div class="section-head"><h3>🪪 معلومات الطفل</h3></div>
            ${infoGrid([
              { icon: 'school', label: 'القسم', value: c.class_name },
              { icon: 'calendar', label: 'تاريخ الدخول للمركز', value: c.start_date && fmtDate(c.start_date), sub: c.end_date ? `خرج في ${fmtDate(c.end_date)}` : '' },
              { icon: 'cake', label: 'تاريخ الولادة', value: c.birth_date && fmtDate(c.birth_date), sub: c.birth_date ? yearsOld(c.birth_date) : '' },
              { icon: 'user', label: 'الولي', value: c.contact_name && esc(c.contact_name), raw: true,
                sub: c.contact_phone ? `<a href="tel:${esc(c.contact_phone)}" dir="ltr">${esc(c.contact_phone)}</a>` : '' },
              finance ? { icon: 'coin', label: 'المبلغ الشهري', value: c.free ? 'مجاني' : finance.monthly_fee ? fmtMoney(finance.monthly_fee) : '', strong: true, raw: true,
                sub: finance.sibling_pct ? `تخفيض الإخوة ${finance.sibling_pct}%` : '' } : null,
              c.notes ? { icon: 'book', label: 'ملاحظات', value: c.notes, wide: true } : null,
            ])}
          </section>
          <div class="info-acts"><button class="btn" id="child-edit">✏️ تعديل المعطيات</button></div></div>`
        : ''
    }`;
  const reload = () => viewProgramChild(el, id);
  bindChildFollowUp(el, file, reload);
  if (finance) bindFinance(el, finance, { kind: 'program', id }, reload);
  $('#child-edit')?.addEventListener('click', async () => {
    const [{ classes, children }, { users: parents }, { users: teachers }, { students }] = await Promise.all([
      api('GET', '/api/program'),
      api('GET', '/api/users?role=parent'),
      api('GET', '/api/users?role=teacher'),
      api('GET', '/api/students'),
    ]);
    const full = children.find((x) => x.id === id) || c;
    childForm(full, { classes, parents, teachers, students, children }, reload);
  });
  bindFileTabs(el);
  $('#to-support')?.addEventListener('click', () => studentForm(null, () => viewProgramChild(el, id), Number(id)));
}

// المنشط: أقسامه وأطفالها
async function viewProgramTeacher(el) {
  const { classes, children } = await api('GET', '/api/program');
  el.innerHTML = `
    <div class="page-head"><h2>🎨 البرنامج التربوي</h2><a class="btn" href="#/program/attendance">تسجيل الغيابات</a></div>
    ${
      classes.length
        ? classes
            .map(
              (k) => `<section class="card"><h3>${esc(k.name)}${k.age_range ? ` <small class="muted">(${esc(k.age_range)})</small>` : ''}</h3>
                ${(() => {
                  const list = children.filter((c) => c.class_id === k.id);
                  return list.length
                    ? `<ul class="levels">${list
                        .map(
                          (c) => `<li><a href="#/program/child/${c.id}"><b>${esc(c.full_name)}</b></a>
                            <span class="muted small">${ageOf(c.birth_date)} · غيابات ${c.absence_count} · ملاحظات ${c.note_count}</span></li>`
                        )
                        .join('')}</ul>`
                    : '<p class="muted">لا يوجد أطفال في هذا القسم.</p>';
                })()}</section>`
            )
            .join('')
        : '<div class="card muted">لم تُسند إليك أي مجموعة في البرنامج التربوي.</div>'
    }`;
}

// الحضور لقسم: الكل حاضر، اضغط على الغائب
async function viewProgramAttendance(el) {
  const { classes } = await api('GET', '/api/program');
  if (!classes.length) {
    el.innerHTML = '<h2>تسجيل الغيابات — البرنامج التربوي</h2><div class="card muted">لا توجد أقسام.</div>';
    return;
  }
  const saved = Number(sessionStorage.getItem('progAttClass'));
  el.innerHTML = `
    <a href="#/program" class="muted small">→ البرنامج التربوي</a>
    <h2>تسجيل الغيابات — البرنامج التربوي</h2>
    <div class="filters">
      <select id="pa-class">${classes.map((k) => `<option value="${k.id}" ${k.id === saved ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
      <input type="date" id="pa-date" value="${today()}">
    </div>
    <div class="card" id="pa-list"></div>`;
  const load = async () => {
    sessionStorage.setItem('progAttClass', $('#pa-class').value);
    const { children } = await api('GET', `/api/program/attendance?class_id=${$('#pa-class').value}&date=${$('#pa-date').value}`);
    const list = $('#pa-list');
    list.innerHTML = children.length
      ? `<p class="muted">اضغط على الطفل الغائب. الكل حاضر افتراضيًا.</p>
        <ul class="att">${children
          .map(
            (c) => `<li><button type="button" class="att-row ${c.absent ? 'absent' : ''}" data-id="${c.id}">
              ${avatar(c, 'sm')}<span>${esc(c.full_name)}</span><b class="att-state"></b></button></li>`
          )
          .join('')}</ul>
        <p class="att-summary"></p>
        <button class="btn" id="pa-save">حفظ الغيابات</button>`
      : '<p class="muted">لا يوجد أطفال في هذا القسم.</p>';
    const summary = () => {
      const n = list.querySelectorAll('.att-row.absent').length;
      list.querySelector('.att-summary').textContent = `الحاضرون: ${children.length - n} — الغائبون: ${n}`;
    };
    list.querySelectorAll('.att-row').forEach((b) =>
      b.addEventListener('click', () => {
        b.classList.toggle('absent');
        summary();
      })
    );
    if (children.length) summary();
    $('#pa-save')?.addEventListener('click', async () => {
      try {
        await api('POST', '/api/program/attendance', {
          class_id: Number($('#pa-class').value),
          date: $('#pa-date').value,
          absent_ids: [...list.querySelectorAll('.att-row.absent')].map((b) => Number(b.dataset.id)),
        });
        toast('تم حفظ الغيابات');
      } catch (err) {
        toast(err.message, true);
      }
    });
  };
  $('#pa-class').addEventListener('change', load);
  $('#pa-date').addEventListener('change', load);
  await load();
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
      ${sharedSplitSection(s)}
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
      <p class="muted small">الأعمدة: صافي كل نشاط قبل توزيع المشتركة (📚 دروس الدعم، 🎨 البرنامج التربوي، 🏕️ الدورات، 🏢 مصاريف مشتركة). اضغط على شهر لعرض تفاصيله.</p>`;
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
  el.addEventListener('click', (e) => {
    if (e.target.id === 'edit-split') splitForm(() => load());
  });
  await Promise.all([load(), loadYear()]);
}

// المصاريف المشتركة (كراء، كهرباء، تنظيف…) تبقى وحدها، ثم تُوزَّع بالنسب التي تحدّدها الإدارة
function sharedSplitSection(s) {
  const acts = s.activities.filter((a) => a.key !== 'general');
  return `<section class="card">
    <div class="section-head"><h3>🏢 توزيع المصاريف المشتركة</h3><button class="btn small ghost" id="edit-split">تعديل النسب</button></div>
    <p>المصاريف المشتركة هذا الشهر: <b class="out">${fmtMoney(s.shared.cost)}</b>
      ${s.shared.allocated ? '' : '<span class="muted small">— لم تُحدَّد نسب التوزيع بعد.</span>'}</p>
    ${
      s.shared.allocated
        ? `<div class="table-wrap"><table class="fin">
            <thead><tr><th>النشاط</th><th>الصافي قبل التوزيع</th><th>النسبة</th><th>نصيبه</th><th>الصافي بعد التوزيع</th></tr></thead>
            <tbody>${acts
              .map(
                (a) => `<tr><td><b>${ACTIVITY_ICONS[a.key]} ${esc(a.label)}</b></td><td>${netBadge(a.net)}</td>
                  <td>${a.shared_pct}%</td><td class="out">${fmtMoney(a.shared)}</td><td>${netBadge(a.net_after)}</td></tr>`
              )
              .join('')}</tbody></table></div>
          ${s.shared.allocated < 100 ? `<p class="muted small">${100 - s.shared.allocated}% غير موزّعة (${fmtMoney(s.shared.unallocated)}).</p>` : ''}`
        : ''
    }
  </section>`;
}

async function splitForm(onDone) {
  const { split } = await api('GET', '/api/settings/shared-split');
  const meta = await financeMeta();
  openModal(
    'نسب توزيع المصاريف المشتركة',
    `<p class="muted small">كم يتحمّل كل نشاط من الكراء والكهرباء والتنظيف والمصاريف المشتركة الأخرى؟ المجموع 100% على الأكثر.</p>
     <div class="fee-grid">${['support', 'program', 'courses']
       .map((k) => `<label>${ACTIVITY_ICONS[k]} ${esc(meta.activities[k])} (%)<input name="${k}" inputmode="decimal" value="${esc(split[k] ?? '')}" placeholder="0"></label>`)
       .join('')}</div>`,
    async (data) => {
      await api('PUT', '/api/settings/shared-split', data);
      toast('تم حفظ النسب');
      onDone();
    }
  );
}

// ---------- لوحة نشاط واحد: مداخيله ومصاريفه فقط (الدعم / التربوي) ----------
async function activityBoard(box, key) {
  const who = key === 'support' ? 'المعلمين' : 'المنشطين';
  box.innerHTML = `
    <section class="card fin-board">
      <header class="fb-head">
        <h3>💰 ${key === 'support' ? 'مالية دروس الدعم' : 'مالية البرنامج التربوي'}</h3>
        ${monthPicker(`ab-${key}`)}
      </header>
      <div id="ab-${key}-body" class="fb-body"><p class="muted">جاري التحميل…</p></div>
      <details class="fb-year"><summary>📆 السنة الدراسية شهرًا بشهر</summary><div id="ab-${key}-year"></div></details>
    </section>`;
  const row = (label, value, cls = '') => `<div class="fb-row ${cls}"><span>${label}</span><b>${value}</b></div>`;
  const load = async () => {
    const s = await api('GET', '/api/finance/summary?month=' + $(`#ab-${key}`).value);
    const x = s.activities.find((a) => a.key === key);
    const acc = s.accrual[key];
    const cost = key === 'support' ? acc.teachers_due : acc.expenses;
    const pct = acc.billed ? Math.round((acc.collected / acc.billed) * 100) : null;
    $(`#ab-${key}-body`).innerHTML = `
      <div class="fb-kpis">
        <div class="fb-kpi in"><span>المداخيل</span><b>${fmtMoney(x.income)}</b><small>دفوعات الأولياء</small></div>
        <div class="fb-kpi out"><span>المصاريف</span><b>${fmtMoney(x.expense)}</b><small>رواتب ${who}</small></div>
        <div class="fb-kpi net ${x.net < 0 ? 'neg' : ''}"><span>الصافي</span><b>${x.net < 0 ? '−' : ''}${fmtMoney(Math.abs(x.net))}</b><small>${x.net < 0 ? 'خسارة' : x.net > 0 ? 'ربح' : 'متوازن'}</small></div>
      </div>
      <div class="fb-cols">
        <div class="fb-panel">
          <h4>💵 ما دخل وما خرج فعليًا</h4>
          ${x.income_lines.map((l) => row(esc(l.label), fmtMoney(l.amount), 'in')).join('') || '<p class="muted small">لا مداخيل هذا الشهر.</p>'}
          ${x.expense_lines.map((l) => row(esc(l.label), (l.amount ? '− ' : '') + fmtMoney(l.amount), 'out')).join('') || row(`رواتب ${who}`, '—', 'muted')}
          ${x.shared ? row(`نصيبه من المصاريف العامة (${x.shared_pct}%)`, '− ' + fmtMoney(x.shared), 'out') + row('الصافي بعد التوزيع', netBadge(x.net_after), 'total') : ''}
        </div>
        <div class="fb-panel">
          <h4>📋 ما يجب أن يدخل ويخرج عن الشهر</h4>
          ${row(key === 'support' ? 'المستحق على التلاميذ' : 'المستحق على الأطفال', fmtMoney(acc.billed))}
          <div class="fb-progress" title="نسبة الاستخلاص"><i style="width:${pct ?? 0}%"></i></div>
          ${row(`مقبوض${pct !== null ? ` (${pct}%)` : ''}`, fmtMoney(acc.collected), 'in')}
          ${row('باقي على الأولياء', fmtMoney(acc.unpaid), acc.unpaid > 0 ? 'out' : '')}
          ${row(key === 'support' ? 'رواتب المعلمين المستحقة' : 'رواتب المنشطين والمصاريف', (cost ? '− ' : '') + fmtMoney(cost))}
          ${key === 'support' ? row('منها مدفوع', fmtMoney(acc.teachers_paid), 'muted') : ''}
          ${row('هامش الربح', netBadge(acc.margin), 'total')}
        </div>
      </div>`;
  };
  const loadYear = async () => {
    const y = await api('GET', '/api/finance/year');
    const tot = (k) => round2(y.months.reduce((t, m) => t + m.activities[key][k], 0));
    $(`#ab-${key}-year`).innerHTML = `<div class="table-wrap"><table class="fin">
      <thead><tr><th>الشهر</th><th>المداخيل</th><th>المصاريف</th><th>الصافي</th></tr></thead>
      <tbody>${[...y.months]
        .reverse()
        .map((m) => {
          const a = m.activities[key];
          return `<tr><td><b>${esc(monthLabel(m.month))}</b></td><td class="in">${fmtMoney(a.income)}</td><td class="out">${fmtMoney(a.expense)}</td><td>${netBadge(a.net)}</td></tr>`;
        })
        .join('')}</tbody>
      <tfoot><tr><th>المجموع</th><th>${fmtMoney(tot('income'))}</th><th>${fmtMoney(tot('expense'))}</th><th>${netBadge(tot('net'))}</th></tr></tfoot></table></div>`;
  };
  bindMonth(`ab-${key}`, load);
  box.querySelector('.fb-year').addEventListener('toggle', (e) => e.target.open && !e.target.dataset.loaded && ((e.target.dataset.loaded = 1), loadYear()));
  await load();
}
const round2 = (n) => Math.round(n * 1000) / 1000;

// ---------- المصاريف العامة للمركز ----------
async function viewGeneralExpenses(el) {
  el.innerHTML = `
    <div class="page-head">
      <div><a href="#/home" class="muted small">→ الرئيسية</a><h2>🏢 المصاريف العامة للمركز</h2>
        <p class="muted">كراء، نظافة، معدات، صيانة، طباعة، ماء وكهرباء… المصاريف التي تخصّ المركز كاملًا.</p></div>
      <div class="actions"><button class="btn warn" id="ge-add">+ مصروف</button></div>
    </div>
    <div class="filters">${monthPicker('ge-month')}</div>
    <div id="ge-body"></div>
    <section class="card"><h3>📆 السنة الدراسية</h3><div id="ge-year"></div></section>`;
  const meta = await financeMeta();
  const load = async () => {
    const month = $('#ge-month').value;
    const [g, { entries }] = await Promise.all([
      api('GET', '/api/finance/general?month=' + month),
      api('GET', `/api/ledger?month=${month}&activity=general`),
    ]);
    const exp = g.categories.filter((c) => c.direction === 'expense');
    const max = Math.max(1, ...exp.map((c) => c.total));
    $('#ge-body').innerHTML = `
      <div class="stats compact"><div class="stat warn"><b>${fmtMoney(g.expense)}</b><span>مصاريف ${esc(monthLabel(month))}</span></div>
        <div class="stat"><b>${fmtMoney(g.year.expense)}</b><span>منذ بداية السنة الدراسية</span></div></div>
      <section class="card"><h3>حسب الصنف</h3>
        ${
          exp.length
            ? exp.map((c) => `<div class="cat-row"><span>${esc(c.label)}</span><div class="cat-bar"><i style="width:${(c.total / max) * 100}%"></i></div><b>${fmtMoney(c.total)}</b></div>`).join('')
            : '<p class="muted">لا مصاريف عامة في هذا الشهر.</p>'
        }
      </section>
      <section class="card"><h3>العمليات</h3>
        ${
          entries.length
            ? `<ul class="levels">${entries
                .map(
                  (e) => `<li><span>${fmtDate(e.date)} — <b>${esc(meta.categories[e.direction][e.category] || e.category)}</b>
                    ${e.description ? `<span class="muted small">${esc(e.description)}</span>` : ''}</span>
                    <span><b class="${e.direction === 'income' ? 'in' : 'out'}">${fmtMoney(e.amount)}</b>
                    <button class="link" data-edit="${e.id}">تعديل</button> <button class="link danger" data-del="${e.id}">حذف</button></span></li>`
                )
                .join('')}</ul>`
            : '<p class="muted">لا عمليات.</p>'
        }
      </section>`;
    $('#ge-body').querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => ledgerForm(entries.find((e) => e.id === Number(b.dataset.edit)), null, load))
    );
    $('#ge-body').querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('حذف هذه العملية؟')) return;
        await api('DELETE', `/api/ledger/${b.dataset.del}`).catch((err) => toast(err.message, true));
        load();
      })
    );
    const yExp = g.year.categories.filter((c) => c.direction === 'expense');
    $('#ge-year').innerHTML = `<div class="grid2 even"><div><h4>حسب الصنف</h4>${
      yExp.map((c) => `<div class="line"><span>${esc(c.label)}</span><b>${fmtMoney(c.total)}</b></div>`).join('') || '<p class="muted small">—</p>'
    }<div class="line total"><span>المجموع</span><b>${fmtMoney(g.year.expense)}</b></div></div>
      <div><h4>حسب الشهر</h4>${g.year.months
        .filter((m) => m.month <= today().slice(0, 7))
        .reverse()
        .map((m) => `<div class="line"><span>${esc(monthLabel(m.month))}</span><b>${fmtMoney(m.expense)}</b></div>`)
        .join('')}</div></div>`;
  };
  bindMonth('ge-month', load);
  $('#ge-add').addEventListener('click', () => ledgerForm(null, 'expense', load, { activity: 'general' }));
  await load();
}

// ---------- البرنامج التربوي: اللوحة، الجدول، الملاحظات، خلاص المنشطين ----------
async function viewProgramBoard(el) {
  const { classes, children } = await api('GET', '/api/program');
  const active = children.filter((c) => c.status === 'active');
  const owed = children.reduce((t, c) => t + Math.max(c.balance || 0, 0), 0);
  el.innerHTML = `
    <div class="page-head"><div><a href="#/home" class="muted small">→ الرئيسية</a><h2>🎨 لوحة البرنامج التربوي</h2></div></div>
    <div class="stats compact">
      <div class="stat"><b>${active.length}</b><span>طفل مسجّل</span></div>
      <div class="stat"><b>${classes.length}</b><span>أقسام</span></div>
      <div class="stat"><b>${new Set(active.map((c) => c.family_parent_id || c.parent_id).filter(Boolean)).size}</b><span>ولي</span></div>
      <div class="stat warn"><b>${fmtMoney(owed)}</b><span>مبالغ غير مدفوعة</span></div>
    </div>
    <div id="program-board"></div>
    <section class="card"><h3>الأقسام</h3><ul class="levels">${classes
      .map((k) => `<li><a href="#/program" data-class="${k.id}">${esc(k.name)}${k.age_range ? ` <span class="muted small">${esc(k.age_range)}</span>` : ''}</a>
        <b>${active.filter((c) => c.class_id === k.id).length}</b></li>`)
      .join('')}</ul></section>
    ${
      children.some((c) => c.balance > 0)
        ? `<section class="card"><h3>أطفال عليهم مبالغ</h3><ul class="levels">${children
            .filter((c) => c.balance > 0)
            .sort((a, b) => b.balance - a.balance)
            .map((c) => `<li><a href="#/program/child/${c.id}">${esc(c.full_name)} <span class="muted small">${esc(c.class_name || '')}</span></a><b class="owed">${fmtMoney(c.balance)}</b></li>`)
            .join('')}</ul></section>`
        : ''
    }`;
  el.querySelectorAll('[data-class]').forEach((a) => a.addEventListener('click', () => sessionStorage.setItem('progClass', a.dataset.class)));
  await activityBoard($('#program-board'), 'program');
}

async function viewProgramTimetable(el) {
  const [{ slots }, { classes }, { users: teachers }] = await Promise.all([
    api('GET', '/api/program/slots'),
    api('GET', '/api/program'),
    api('GET', '/api/users?role=teacher'),
  ]);
  const admin = state.user.role === 'admin';
  const filter = sessionStorage.getItem('progTtClass') || '';
  const shown = slots.filter((s) => !filter || String(s.class_id) === filter);
  el.innerHTML = `
    <div class="page-head"><div><a href="#/home" class="muted small">→ الرئيسية</a><h2>🗓 جدول أوقات البرنامج التربوي</h2></div>
      ${admin ? '<div class="actions"><button class="btn" id="slot-add">+ حصة</button></div>' : ''}</div>
    <div class="filters"><select id="tt-class"><option value="">كل الأقسام</option>${classes
      .map((k) => `<option value="${k.id}" ${filter === String(k.id) ? 'selected' : ''}>${esc(k.name)}</option>`)
      .join('')}</select></div>
    ${
      shown.length
        ? DAYS_AR.map((d, i) => {
            const day = shown.filter((s) => s.day === i + 1);
            return day.length
              ? `<section class="card"><h3>${d}</h3><ul class="levels">${day
                  .map(
                    (s) => `<li><span><b>${esc(s.start_time)} – ${esc(s.end_time)}</b> ${esc(s.title || '')}
                      <span class="muted small">${esc(s.class_name)}${s.teacher_name ? ' · ' + esc(s.teacher_name) : ''}${s.room ? ' · ' + esc(s.room) : ''}</span></span>
                      ${admin ? `<span><button class="link" data-edit="${s.id}">تعديل</button> <button class="link danger" data-del="${s.id}">حذف</button></span>` : ''}</li>`
                  )
                  .join('')}</ul></section>`
              : '';
          }).join('')
        : '<div class="card muted">لا توجد حصص بعد.</div>'
    }`;
  const form = (s) =>
    openModal(
      s ? 'تعديل حصة' : 'حصة جديدة',
      `<label>القسم<select name="class_id">${classes.map((k) => `<option value="${k.id}" ${(s?.class_id ?? Number(filter)) === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
       <label>اليوم<select name="day">${DAYS_AR.map((d, i) => `<option value="${i + 1}" ${s?.day === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
       <div class="row"><label>من<input type="time" name="start_time" value="${esc(s?.start_time || '')}" required></label>
         <label>إلى<input type="time" name="end_time" value="${esc(s?.end_time || '')}" required></label></div>
       <label>النشاط / المحتوى<input name="title" value="${esc(s?.title || '')}" placeholder="مثال: أفلا ينظرون"></label>
       <label>المؤطّر<select name="teacher_id"><option value="">—</option>${teachers.filter((t) => t.program_staff || t.program_classes).map((t) => `<option value="${t.id}" ${s?.teacher_id === t.id ? 'selected' : ''}>${esc(t.full_name)}</option>`).join('')}</select></label>
       <label>القاعة<input name="room" value="${esc(s?.room || '')}"></label>`,
      async (data) => {
        if (s) await api('PUT', `/api/program/slots/${s.id}`, data);
        else await api('POST', '/api/program/slots', data);
        toast('تم الحفظ');
        viewProgramTimetable(el);
      }
    );
  $('#tt-class').addEventListener('change', (e) => {
    sessionStorage.setItem('progTtClass', e.target.value);
    viewProgramTimetable(el);
  });
  $('#slot-add')?.addEventListener('click', () => form(null));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(slots.find((s) => s.id === Number(b.dataset.edit)))));
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف الحصة؟')) return;
      await api('DELETE', `/api/program/slots/${b.dataset.del}`).catch((err) => toast(err.message, true));
      viewProgramTimetable(el);
    })
  );
}

async function viewProgramNotes(el) {
  const { classes } = await api('GET', '/api/program');
  const filter = sessionStorage.getItem('progNotesClass') || '';
  const { notes } = await api('GET', '/api/program/notes' + (filter ? `?class_id=${filter}` : ''));
  el.innerHTML = `
    <div class="page-head"><div><a href="#/home" class="muted small">→ الرئيسية</a><h2>📝 ملاحظات المنشطين</h2>
      <p class="muted">لإضافة ملاحظة: افتح ملف الطفل من «الأطفال والأقسام».</p></div></div>
    <div class="filters"><select id="pn-class"><option value="">كل الأقسام</option>${classes
      .map((k) => `<option value="${k.id}" ${filter === String(k.id) ? 'selected' : ''}>${esc(k.name)}</option>`)
      .join('')}</select></div>
    ${
      notes.length
        ? `<ul class="notes">${notes
            .map(
              (n) => `<li class="note"><div class="note-head"><span class="badge ${n.category}">${PROGRAM_NOTE_LABELS[n.category] || ''}</span>
                ${n.rating ? `<span class="badge ${n.rating}">${LEVEL_WORDS[n.rating] || n.rating}</span>` : ''}
                <span class="muted small">${fmtDate(n.date)} · <a href="#/program/child/${n.child_id}">${esc(n.child_name)}</a> · ${esc(n.class_name || '')} · ${esc(n.author_name || '')}</span></div>
                ${n.content ? `<p>${esc(n.content)}</p>` : ''}</li>`
            )
            .join('')}</ul>`
        : '<div class="card muted">لا توجد ملاحظات بعد.</div>'
    }`;
  $('#pn-class').addEventListener('change', (e) => {
    sessionStorage.setItem('progNotesClass', e.target.value);
    viewProgramNotes(el);
  });
}

// خلاص المؤطّرين: أجرة شهرية لكل مؤطّر + بقية مصاريف البرنامج التربوي
async function viewProgramPay(el) {
  if (state.user.role === 'teacher') return viewMyProgramPay(el);
  el.innerHTML = `
    <div class="page-head"><div><a href="#/home" class="muted small">→ الرئيسية</a><h2>💸 خلاص المؤطّرين</h2>
      <p class="muted">أجرة شهرية لكل مؤطّر. حدّد الأجرة من «قائمة المؤطّرين».</p></div>${monthPicker('sp-month')}</div>
    <div id="sp-body"></div>
    <div id="sp-ledger"></div>`;
  const load = async () => {
    const month = $('#sp-month').value;
    const r = await api('GET', '/api/program/staff-pay?month=' + month);
    $('#sp-body').innerHTML = `
      <div class="stats compact">
        <div class="stat"><b>${fmtMoney(r.total_due)}</b><span>مجموع الأجور الشهرية</span></div>
        <div class="stat good"><b>${fmtMoney(r.total_paid)}</b><span>مدفوع في ${esc(monthLabel(month))}</span></div>
        <div class="stat warn"><b>${fmtMoney(Math.max(r.total_due - r.total_paid, 0))}</b><span>باقي</span></div>
      </div>
      <section class="card">${
        r.staff.length
          ? `<ul class="levels">${r.staff
              .map(
                (s) => `<li><span><b>${esc(s.full_name)}</b> <span class="muted small">${esc(s.classes || 'دون قسم')}</span>
                    <div class="muted small">${
                      s.pay_per_child
                        ? `${fmtMoney(s.pay_per_child)} عن كل طفل × ${s.children_count}${s.monthly_salary ? ` + ${fmtMoney(s.monthly_salary)}` : ''} = <b>${fmtMoney(s.expected)}</b>`
                        : `الأجرة: ${s.monthly_salary ? fmtMoney(s.monthly_salary) : 'غير محدّدة'}`
                    }</div></span>
                  <span>${
                    s.payment
                      ? `<span class="badge good">✓ ${fmtMoney(s.payment.amount)} · ${fmtDate(s.payment.date)}</span> <button class="link danger small" data-undo="${s.payment.id}">إلغاء</button>`
                      : `<button class="btn small" data-pay="${s.id}">خلاص ${esc(monthLabel(month))}</button>`
                  }</span></li>`
              )
              .join('')}</ul>`
          : '<p class="muted">لا يوجد مؤطّرون. أضفهم من «قائمة المؤطّرين».</p>'
      }</section>`;
    $('#sp-body').querySelectorAll('[data-pay]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = r.staff.find((x) => x.id === Number(b.dataset.pay));
        openModal(
          `خلاص ${s.full_name} — ${monthLabel(month)}`,
          `<div class="row"><label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${esc(s.expected || s.monthly_salary || '')}" required></label>
             <label>تاريخ الدفع<input type="date" name="date" value="${today()}"></label></div>`,
          async (data) => {
            await api('POST', `/api/program/staff/${s.id}/pay`, { ...data, month });
            toast('تم تسجيل الخلاص');
            load();
          }
        );
      })
    );
    $('#sp-body').querySelectorAll('[data-undo]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('إلغاء هذا الخلاص؟')) return;
        await api('DELETE', `/api/ledger/${b.dataset.undo}`).catch((err) => toast(err.message, true));
        load();
      })
    );
  };
  bindMonth('sp-month', load);
  await load();
}

// المؤطّر: أجرته الشهرية وما قبضه
async function viewMyProgramPay(el) {
  const r = await api('GET', '/api/program/staff-pay');
  const me = r.staff[0];
  el.innerHTML = `
    <div class="page-head"><h2>💸 أجرتي</h2></div>
    ${
      me
        ? `<div class="stats compact"><div class="stat"><b>${me.expected ? fmtMoney(me.expected) : '—'}</b><span>أجرة ${esc(monthLabel(r.month))}${me.pay_per_child ? ` (${fmtMoney(me.pay_per_child)} × ${me.children_count} طفل)` : ''}</span></div>
            <div class="stat ${me.payment ? 'good' : 'warn'}"><b>${me.payment ? fmtMoney(me.payment.amount) : '—'}</b><span>${esc(monthLabel(r.month))}</span></div></div>
          <section class="card"><h3>ما قبضته</h3>${
            me.history.length
              ? `<ul class="levels">${me.history.map((p) => `<li><span>${esc(monthLabel(p.salary_month))}</span><span>${fmtMoney(p.amount)} · ${fmtDate(p.date)}</span></li>`).join('')}</ul>`
              : '<p class="muted">لا شيء بعد.</p>'
          }</section>`
        : '<div class="card muted">لا توجد معطيات.</div>'
    }`;
}

// ---------- الشركاء والمرابيح (المشرف العام فقط) ----------
async function viewPartners(el) {
  const d = await api('GET', '/api/partners');
  const names = [...d.partners.map((p) => p.name), d.owner];
  el.innerHTML = `
    <div class="page-head"><div><a href="#/home" class="muted small">→ الرئيسية</a><h2>🤝 الشركاء والمرابيح</h2>
      <p class="muted">مرابيح كل شهر = مداخيله − مصاريفه، وكل مبلغ يُحتسب في الشهر الذي يخصّه (دفعة متأخرة تُضاف إلى شهرها فيتحدّث نصيب الشريك).
        ما يُعطى للشريك يُسجَّل «تسبقة»، والباقي = المتخلّد الإجمالي − التسبقات.</p></div>
      <div class="actions"><button class="btn ghost" id="pt-settings">⚙️ النسب</button><button class="btn" id="pt-pay">+ تسبقة للشريك</button></div></div>
    <div class="fb-kpis">${d.summary
      .map(
        (s) => `<div class="fb-kpi net"><span>${esc(s.name)} — ${s.share}% منذ ${esc(monthLabel(s.from))}</span>
          <b>${fmtMoney(s.balance)}</b><small>${s.balance >= 0 ? `الباقي بذمّة ${esc(d.owner)} لـ ${esc(s.name)}` : `${esc(s.name)} أخذ أكثر من مستحقاته`}</small></div>
        <div class="fb-kpi out"><span>المتخلّد الإجمالي لـ ${esc(s.name)}</span><b>${fmtMoney(round2(s.opening + s.due))}</b>
          <small>الحساب القديم ${fmtMoney(s.opening)} + ${s.share}% من مرابيح ${esc(monthLabel(s.from))} إلى اليوم ${fmtMoney(s.due)}</small></div>
        <div class="fb-kpi in"><span>التسبقات المدفوعة</span><b>${fmtMoney(s.paid)}</b><small>منذ ${esc(monthLabel(s.from))}</small></div>`
      )
      .join('')}</div>
    ${
      d.owner_summary
        ? `<section class="card owner-card"><div class="section-head"><h3>👤 حساب ${esc(d.owner)} (صاحب المشروع)</h3><a class="link small" href="#/cash">الصندوق ←</a></div>
            <div class="owner-grid">
              <div><small>نصيبك من المرابيح</small><b>${fmtMoney(d.owner_summary.due)}</b></div>
              <div><small>سحبت من الصندوق</small><b>${fmtMoney(d.owner_summary.withdrawn)}</b></div>
              <div><small>صرفت منه على المركز</small><b class="in">− ${fmtMoney(d.owner_summary.spent)}</b></div>
              <div><small>أخذت فعلًا</small><b>${fmtMoney(d.owner_summary.taken)}</b></div>
              <div class="${d.owner_summary.balance >= 0 ? 'ok' : 'neg'}"><small>${d.owner_summary.balance >= 0 ? 'الباقي لك' : 'أخذت أكثر من نصيبك'}</small><b>${fmtMoney(Math.abs(d.owner_summary.balance))}</b></div>
            </div>
            <p class="muted small">السحب من الصندوق ليس مصروفًا: يُحسب مما أخذته من نصيبك. وما تصرفه منه على المركز (تسجّله مصروفًا «من مبلغ سحبته») يُطرح منه.</p></section>`
        : ''
    }
    <section class="card"><h3>📆 المرابيح شهرًا بشهر</h3>
      <div class="table-wrap"><table class="fin">
        <thead><tr><th>الشهر</th><th>المداخيل</th><th>المصاريف</th><th>المرابيح</th>${names.map((n) => `<th>${esc(n)}</th>`).join('')}</tr></thead>
        <tbody>${d.months
          .map(
            (m) => `<tr><td><b>${esc(monthLabel(m.month))}</b>${m.late ? `<div class="muted tiny">منها متأخرات ${fmtMoney(m.late)}</div>` : ''}</td><td class="in">${fmtMoney(m.income)}</td><td class="out">${fmtMoney(m.expense)}</td>
              <td>${netBadge(m.net)}</td>${names.map((n) => `<td>${fmtMoney(m.shares[n] ?? 0)}</td>`).join('')}</tr>`
          )
          .join('')}</tbody>
        <tfoot><tr><th>المجموع</th><th>${fmtMoney(round2(d.months.reduce((t, m) => t + m.income, 0)))}</th><th>${fmtMoney(round2(d.months.reduce((t, m) => t + m.expense, 0)))}</th>
          <th>${netBadge(round2(d.months.reduce((t, m) => t + m.net, 0)))}</th>${names
            .map((n) => `<th>${fmtMoney(round2(d.months.reduce((t, m) => t + (m.shares[n] || 0), 0)))}</th>`)
            .join('')}</tr></tfoot>
      </table></div></section>
    ${
      d.history.length
        ? `<details class="card"><summary><b>🗂 السجلّ القديم (قبل ${esc(monthLabel(d.partners[0]?.from || ''))})</b></summary>
            <div class="table-wrap"><table class="fin">
              <thead><tr><th>الشهر</th><th>الربح الصافي</th><th>نصيب ${esc(d.partners[0]?.name || '')}</th><th>المسلّم</th><th>المتخلّد</th><th>ملاحظات</th></tr></thead>
              <tbody>${[...d.history]
                .reverse()
                .map(
                  (h) => `<tr><td><b>${esc(monthLabel(h.month))}</b></td><td class="${h.net < 0 ? 'out' : ''}">${h.net === null ? '—' : fmtMoney(h.net)}</td>
                    <td>${h.share === null ? '—' : fmtMoney(h.share)}</td><td>${h.paid ? fmtMoney(h.paid) : '—'}</td><td><b>${h.balance ? fmtMoney(h.balance) : '—'}</b></td>
                    <td class="muted small">${esc(h.note || '')}</td></tr>`
                )
                .join('')}</tbody></table></div></details>`
        : ''
    }
    <section class="card"><h3>💵 التسبقات المدفوعة للشركاء</h3>${
      d.payments.length
        ? `<ul class="levels">${d.payments
            .map(
              (p) => `<li><span>${fmtDate(p.paid_on)} — <b>${esc(p.partner)}</b>${p.note ? ` <span class="muted small">${esc(p.note)}</span>` : ''}</span>
                <span><b>${fmtMoney(p.amount)}</b> <button class="link danger small" data-del="${p.id}">حذف</button></span></li>`
            )
            .join('')}</ul>`
        : '<p class="muted">لا دفعات بعد. الدفعات قبل شهر البداية تظهر منفصلة في البطاقة.</p>'
    }</section>`;
  $('#pt-pay').addEventListener('click', () =>
    openModal(
      'تسبقة للشريك',
      `<div class="row"><label>الشريك<select name="partner">${d.partners.map((p) => `<option>${esc(p.name)}</option>`).join('')}</select></label>
         <label>المبلغ (د.ت)<input name="amount" inputmode="decimal" required></label></div>
       <label>تاريخ الدفع<input type="date" name="paid_on" value="${today()}"></label>
       <label>ملاحظة<input name="note" placeholder="مثال: نصيب أكتوبر"></label>`,
      async (data) => {
        await api('POST', '/api/partners/payments', data);
        toast('تم التسجيل');
        viewPartners(el);
      }
    )
  );
  $('#pt-settings').addEventListener('click', () =>
    openModal(
      'نسب الشركاء',
      `<label>صاحب المركز (يأخذ الباقي)<input name="owner" value="${esc(d.owner)}"></label>
       ${d.partners
         .map(
           (p, i) => `<div class="row"><label>الشريك<input name="name_${i}" value="${esc(p.name)}"></label>
             <label>النسبة %<input name="share_${i}" inputmode="decimal" value="${esc(p.share)}"></label>
             <label>ابتداءً من<input type="month" name="from_${i}" value="${esc(p.from)}"></label>
             <label>الباقي له قبل هذا الشهر<input name="opening_${i}" inputmode="decimal" value="${esc(p.opening ?? 0)}"></label></div>`
         )
         .join('')}`,
      async (data) => {
        const partners = d.partners.map((_, i) => ({ name: data[`name_${i}`], share: data[`share_${i}`], from: data[`from_${i}`], opening: data[`opening_${i}`] }));
        await api('PUT', '/api/partners/settings', { owner: data.owner, partners });
        toast('تم الحفظ');
        viewPartners(el);
      }
    )
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذه الدفعة؟')) return;
      await api('DELETE', `/api/partners/payments/${b.dataset.del}`).catch((err) => toast(err.message, true));
      viewPartners(el);
    })
  );
}


// ---------- ديون المركز (Crédits) ----------
async function viewCenterDebts(el) {
  const d = await api('GET', '/api/center-debts');
  el.innerHTML = `
    <div class="page-head"><div><a href="#/home" class="muted small">→ الرئيسية</a><h2>📕 ديون المركز</h2>
      <p class="muted">مكان لحفظ ديون المركز فقط: تضيف دينًا أو تحذفه، وكل تسديد ينقص من الباقي. لا علاقة لها بالمداخيل والمصاريف ولا بالمرابيح.</p></div>
      <div class="actions"><button class="btn" id="cd-add">+ دين</button></div></div>
    <div class="fb-kpis">
      <div class="fb-kpi out"><span>الباقي</span><b>${fmtMoney(d.remaining)}</b><small>من أصل ${fmtMoney(d.total)}</small></div>
      <div class="fb-kpi in"><span>المسدَّد</span><b>${fmtMoney(d.paid)}</b><small>${d.total ? Math.round((d.paid / d.total) * 100) : 0}%</small></div>
      <div class="fb-kpi net"><span>الجهات</span><b>${d.debts.filter((x) => x.remaining > 0).length}</b><small>لم تُسدَّد كاملة</small></div>
    </div>
    <section class="card">${
      d.debts.length
        ? d.debts
            .map(
              (x) => `<div class="debt ${x.remaining <= 0 ? 'done' : ''}">
                <div class="debt-head"><div><b>${esc(x.creditor)}</b>${x.description ? ` <span class="muted small">${esc(x.description)}</span>` : ''}</div>
                  <div class="debt-amt">${x.remaining > 0 ? `<b class="out">${fmtMoney(x.remaining)}</b>` : '<span class="badge good">مسدَّد ✓</span>'}
                    <span class="muted small">من ${fmtMoney(x.amount)}</span></div></div>
                <div class="fb-progress"><i style="width:${Math.min(100, (x.paid / x.amount) * 100)}%"></i></div>
                ${x.payments
                  .map((p) => `<div class="muted small">✓ ${fmtMoney(p.amount)} · ${fmtDate(p.paid_on)}${p.note ? ' · ' + esc(p.note) : ''} <button class="link danger small" data-del-pay="${p.id}">إلغاء</button></div>`)
                  .join('')}
                <div class="debt-actions">${x.remaining > 0 ? `<button class="btn small" data-pay="${x.id}">تسديد</button>` : ''}
                  <button class="link small" data-edit="${x.id}">تعديل</button> <button class="link danger small" data-del="${x.id}">حذف</button></div>
              </div>`
            )
            .join('')
        : '<p class="muted">لا ديون مسجّلة.</p>'
    }</section>`;
  const reload = () => viewCenterDebts(el);
  const form = (x) =>
    openModal(
      x ? 'تعديل الدين' : 'دين جديد',
      `<label>الجهة الدائنة<input name="creditor" value="${esc(x?.creditor || '')}" required></label>
       <label>البيان<input name="description" value="${esc(x?.description || '')}"></label>
       <div class="row"><label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${esc(x?.amount ?? '')}" required></label>
         <label>منذ<input type="date" name="since" value="${esc(x?.since || '')}"></label></div>`,
      async (data) => {
        if (x) await api('PUT', `/api/center-debts/${x.id}`, data);
        else await api('POST', '/api/center-debts', data);
        toast('تم الحفظ');
        reload();
      }
    );
  $('#cd-add').addEventListener('click', () => form(null));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(d.debts.find((x) => x.id === Number(b.dataset.edit)))));
  el.querySelectorAll('[data-pay]').forEach((b) =>
    b.addEventListener('click', () => {
      const x = d.debts.find((y) => y.id === Number(b.dataset.pay));
      openModal(
        `تسديد — ${x.creditor}`,
        `<div class="row"><label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${esc(x.remaining)}" required></label>
           <label>تاريخ الدفع<input type="date" name="paid_on" value="${today()}"></label></div>
         <label>ملاحظة<input name="note"></label>`,
        async (data) => {
          await api('POST', `/api/center-debts/${x.id}/payments`, data);
          toast('تم التسديد');
          reload();
        }
      );
    })
  );
  el.querySelectorAll('[data-del-pay]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('إلغاء هذا التسديد؟')) return;
      await api('DELETE', `/api/center-debts/payments/${b.dataset.delPay}`).catch((err) => toast(err.message, true));
      reload();
    })
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذا الدين وكل تسديداته؟')) return;
      await api('DELETE', `/api/center-debts/${b.dataset.del}`).catch((err) => toast(err.message, true));
      reload();
    })
  );
}

// ---------- المنتجات: بيع يُحتسب مدخولًا في شهره ----------
// نافذة البيع: تُفتح من صفحة المنتجات أو من ملف التلميذ (buyer = {student_id} أو {child_id})
async function sellProductModal(onDone, buyer = null, data = null) {
  data ??= await api('GET', '/api/products');
  const products = data.products.filter((p) => p.active);
  if (!products.length) return toast('أضف منتجًا أولًا من صفحة «المنتجات»', true);
  const priced = products.filter((p) => p.price != null);
  if (!priced.length) return toast('حدّد سعر المنتج أولًا من صفحة «المنتجات»', true);
  openModal(
    '📗 بيع منتج',
    `<label>المنتج<select name="product_id">${priced.map((p) => `<option value="${p.id}" data-price="${p.price}">${esc(p.name)} — ${fmtMoney(p.price)}</option>`).join('')}</select></label>
     ${
       buyer
         ? `<input type="hidden" name="${buyer.student_id ? 'student_id' : 'child_id'}" value="${buyer.student_id || buyer.child_id}">`
         : `<label>المشتري<select name="buyer">
             <optgroup label="تلاميذ الدعم">${data.students.map((s) => `<option value="s:${s.id}">${esc(s.full_name)} · ${esc(levelLabel(s.level))}</option>`).join('')}</optgroup>
             <optgroup label="البرنامج التربوي">${data.children.map((c) => `<option value="c:${c.id}">${esc(c.full_name)}</option>`).join('')}</optgroup>
             <option value="other">شخص آخر…</option></select></label>
           <label id="ps-other" hidden>اسم المشتري<input name="buyer_name"></label>`
     }
     <div class="row"><label>الكمية<input name="qty" type="number" min="1" value="1"></label>
       <label>التاريخ<input type="date" name="sold_on" value="${today()}"></label></div>
     <p class="ps-total">المبلغ: <b id="ps-total"></b></p>
     <label>ملاحظة<input name="note"></label>`,
    async (f) => {
      if (f.buyer) {
        const [k, id] = f.buyer.split(':');
        if (k === 's') f.student_id = id;
        else if (k === 'c') f.child_id = id;
        delete f.buyer;
      }
      await api('POST', '/api/product-sales', f);
      toast('تم البيع وأُضيف إلى المداخيل');
      onDone?.();
    }
  );
  const m = $('#modal');
  const total = () => {
    const price = Number(m.querySelector('[name=product_id]').selectedOptions[0].dataset.price);
    $('#ps-total').textContent = fmtMoney(price * Math.max(1, Number(m.querySelector('[name=qty]').value) || 1));
  };
  m.querySelector('[name=product_id]').addEventListener('change', total);
  m.querySelector('[name=qty]').addEventListener('input', total);
  m.querySelector('[name=buyer]')?.addEventListener('change', (e) => ($('#ps-other').hidden = e.target.value !== 'other'));
  total();
}

async function viewProducts(el) {
  el.innerHTML = `
    <div class="page-head"><div><a href="#/home" class="muted small">→ الرئيسية</a><h2>📗 المنتجات</h2>
      <p class="muted">كتب ومراجع وغيرها: تحدّد السعر مرة واحدة، وكل بيع يُضاف إلى المداخيل في شهر تاريخه.</p></div>
      <div class="actions">${monthPicker('pr-month')}<button class="btn ghost" id="pr-add">+ منتج</button><button class="btn" id="pr-sell">بيع</button></div></div>
    <div id="pr-body"><p class="muted">جاري التحميل…</p></div>`;
  let data;
  const load = async () => {
    const month = $('#pr-month').value;
    data = await api('GET', '/api/products?month=' + month);
    $('#pr-body').innerHTML = `
      <div class="prods">${
        data.products.length
          ? data.products
              .map(
                (p) => `<article class="prod ${p.active ? '' : 'off'}">
                  <div class="prod-ico">📗</div>
                  <div class="prod-main"><h3>${esc(p.name)}</h3>
                    <div class="prod-price">${p.price != null ? fmtMoney(p.price) : '<span class="badge average">حدّد السعر</span>'}${p.active ? '' : ' <span class="badge status-left">موقوف</span>'}</div></div>
                  <div class="prod-stats"><div><b>${p.sold}</b><span>نسخة مباعة</span></div><div><b>${fmtMoney(p.revenue)}</b><span>المجموع</span></div></div>
                  <div class="prod-acts"><button class="btn ghost small" data-pedit="${p.id}">تعديل</button>
                    ${p.sold ? '' : `<button class="link danger small" data-pdel="${p.id}">حذف</button>`}</div>
                </article>`
              )
              .join('')
          : '<div class="card muted">لا منتجات بعد. أضف «+ منتج».</div>'
      }</div>
      <section class="card">
        <div class="section-head"><h3>مبيعات ${esc(monthLabel(month))}</h3><b class="in">${fmtMoney(data.total)}</b></div>
        ${
          data.sales.length
            ? `<div class="table-wrap"><table><thead><tr><th>المشتري</th><th>المنتج</th><th>الكمية</th><th>المبلغ</th><th>التاريخ</th><th></th></tr></thead><tbody>${data.sales
                .map(
                  (s) => `<tr><td>${s.student_id ? `<a href="#/students/${s.student_id}">${esc(s.buyer)}</a>` : s.child_id ? `<a href="#/program/child/${s.child_id}">${esc(s.buyer)}</a>` : esc(s.buyer || '—')}${s.note ? `<div class="muted small">${esc(s.note)}</div>` : ''}</td>
                    <td>${esc(s.product_name)}</td><td>${s.qty}</td><td><b>${fmtMoney(s.amount)}</b></td><td>${fmtDate(s.sold_on)}</td>
                    <td><button class="link danger small" data-sdel="${s.id}">إلغاء</button></td></tr>`
                )
                .join('')}</tbody></table></div>`
            : '<p class="muted">لا مبيعات في هذا الشهر.</p>'
        }
      </section>`;
    el.querySelectorAll('[data-pedit]').forEach((b) => b.addEventListener('click', () => form(data.products.find((p) => p.id === Number(b.dataset.pedit)))));
    el.querySelectorAll('[data-pdel]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('حذف هذا المنتج؟')) return;
        await api('DELETE', `/api/products/${b.dataset.pdel}`).catch((err) => toast(err.message, true));
        load();
      })
    );
    el.querySelectorAll('[data-sdel]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('إلغاء هذا البيع؟ يُنقص من المداخيل.')) return;
        await api('DELETE', `/api/product-sales/${b.dataset.sdel}`).catch((err) => toast(err.message, true));
        load();
      })
    );
  };
  const form = (p) =>
    openModal(
      p ? 'تعديل المنتج' : 'منتج جديد',
      `<label>اسم المنتج<input name="name" value="${esc(p?.name || '')}" required placeholder="مثال: المرجع في العربية"></label>
       <label>السعر (د.ت)<input name="price" inputmode="decimal" value="${esc(p?.price ?? '')}" required></label>
       ${p ? `<label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> متوفّر للبيع</label>` : ''}`,
      async (f) => {
        if (p) await api('PUT', `/api/products/${p.id}`, { ...f, active: !!f.active });
        else await api('POST', '/api/products', f);
        toast('تم الحفظ');
        load();
      }
    );
  $('#pr-add').addEventListener('click', () => form(null));
  $('#pr-sell').addEventListener('click', () => sellProductModal(load, null, data));
  bindMonth('pr-month', load);
  await load();
}

// ---------- الأجور: نظرة عامة على كل الإطار ----------
async function viewSalaries(el) {
  el.innerHTML = `
    <div class="page-head"><div><a href="#/home" class="muted small">→ الرئيسية</a><h2>💼 الأجور</h2>
      <p class="muted">كل أجور الشهر في مكان واحد: مدرّسو دروس الدعم، مؤطّرو البرنامج التربوي، الإدارة والنظافة.</p></div>
      ${monthPicker('sal-month')}</div>
    <div id="sal-body"><p class="muted">جاري التحميل…</p></div>`;
  const ICONS = { support: '📚', program: '🎨', admin: '🏢' };
  const LINKS = {
    support: '<a class="btn ghost small" href="#/payroll">خلاص المدرّسين ←</a>',
    program: '<a class="btn ghost small" href="#/program/staff">قائمة المؤطّرين ←</a>',
    admin: '<a class="btn ghost small" href="#/staff">إدارة القائمة (+ شخص) ←</a>',
  };
  const load = async () => {
    const month = $('#sal-month').value;
    const r = await api('GET', '/api/salaries?month=' + month);
    const rest = Math.max(r.due - r.paid, 0);
    $('#sal-body').innerHTML = `
      <div class="fb-kpis">
        <div class="fb-kpi out"><span>مجموع الأجور المستحقة</span><b>${fmtMoney(r.due)}</b><small>${esc(monthLabel(month))}</small></div>
        <div class="fb-kpi in"><span>مدفوع</span><b>${fmtMoney(r.paid)}</b><small>${r.due ? Math.round((r.paid / r.due) * 100) : 0}%</small></div>
        <div class="fb-kpi net ${rest > 0 ? 'neg' : ''}"><span>باقي للخلاص</span><b>${fmtMoney(rest)}</b><small>${rest > 0 ? 'لم يُخلَّص بعد' : 'كل الأجور خالصة'}</small></div>
      </div>
      <div class="sal-split">${r.groups
        .map((g) => `<div class="sal-bar"><span>${ICONS[g.key]} ${esc(g.label)}</span><b>${fmtMoney(g.due)}</b>
          <i style="width:${r.due ? (g.due / r.due) * 100 : 0}%"></i></div>`)
        .join('')}</div>
      ${r.groups
        .map(
          (g) => `<section class="card">
            <div class="section-head"><h3>${ICONS[g.key]} ${esc(g.label)}</h3>
              <span class="muted small">مستحق <b>${fmtMoney(g.due)}</b> · مدفوع <b class="in">${fmtMoney(g.paid)}</b></span>${LINKS[g.key]}</div>
            ${
              g.people.length
                ? `<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الحساب</th><th>المستحق</th><th>المدفوع</th><th></th></tr></thead><tbody>${g.people
                    .map(
                      (p) => `<tr><td><b>${esc(p.name)}</b></td><td class="muted small">${esc(p.basis)}</td><td>${fmtMoney(p.due)}</td>
                        <td>${p.paid ? `<b class="in">${fmtMoney(p.paid)}</b>` : '—'}</td>
                        <td class="row-actions">${
                          p.link
                            ? `<a class="btn ghost small" href="${p.link}">التفاصيل</a>`
                            : p.payment_id
                              ? `<span class="badge good">✓ خالص</span> <button class="link danger small" data-undo="${p.payment_id}">إلغاء</button>`
                              : `<button class="btn small" data-pay="${esc(p.pay)}" data-name="${esc(p.name)}" data-due="${p.due}">خلاص</button>`
                        }</td></tr>`
                    )
                    .join('')}</tbody></table></div>`
                : '<p class="muted">لا أحد في هذا الصنف هذا الشهر.</p>'
            }</section>`
        )
        .join('')}
      <p class="muted small">مدرّسو الدعم يُخلَّصون بالساعة من «خلاص المدرّسين» (ساعات جدول الأوقات). كل أجرة تُسجَّل مصروفًا في نشاطها: الدعم، التربوي، أو المصاريف العامة للمركز.</p>`;
    $('#sal-body').querySelectorAll('[data-pay]').forEach((b) =>
      b.addEventListener('click', () =>
        openModal(
          `خلاص ${b.dataset.name} — ${monthLabel(month)}`,
          `<div class="row"><label>المبلغ (د.ت)<input name="amount" inputmode="decimal" value="${esc(b.dataset.due || '')}" required></label>
             <label>تاريخ الدفع<input type="date" name="date" value="${today()}"></label></div>`,
          async (data) => {
            await api('POST', b.dataset.pay, { ...data, month });
            toast('تم تسجيل الخلاص');
            load();
          }
        )
      )
    );
    $('#sal-body').querySelectorAll('[data-undo]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('إلغاء هذا الخلاص؟')) return;
        await api('DELETE', `/api/ledger/${b.dataset.undo}`).catch((err) => toast(err.message, true));
        load();
      })
    );
  };
  bindMonth('sal-month', load);
  await load();
}

// ---------- لوحة المشرف العام: السنة كاملة ----------
const BOARD_IN = { support: ['📚 دروس الدعم', '#6d28d9'], program: ['🎨 البرنامج التربوي', '#db2777'], courses: ['🏕️ الدورات والعطل', '#0ea5e9'], products: ['📗 المنتجات', '#10b981'], other: ['➕ مداخيل أخرى', '#94a3b8'] };
const BOARD_EX = {
  salaries_support: ['أجور مدرّسي الدعم', '#6d28d9'], salaries_program: ['أجور مؤطّري التربوي', '#db2777'], salaries_admin: ['أجور الإدارة والنظافة', '#f59e0b'],
  salaries_courses: ['أجور الدورات', '#0ea5e9'], rent: ['الكراء', '#64748b'], other: ['مصاريف أخرى', '#cbd5e1'],
};
async function viewBoard(el) {
  const mode = sessionStorage.getItem('boardMode') || 'school';
  const year = sessionStorage.getItem('boardYear') || '';
  el.innerHTML = `<div id="board-body"><p class="muted">جاري التحميل…</p></div>`;
  const d = await api('GET', `/api/dashboard/year?mode=${mode}${year ? `&year=${year}` : ''}`);
  const T = d.totals;
  const short = (m) => MONTHS_AR[Number(m.slice(5)) - 1];
  const label = mode === 'calendar' ? `السنة الإدارية ${d.year}` : `السنة الدراسية ${d.year}–${d.year + 1}`;
  const past = d.months.filter((m) => !m.future);
  const maxIn = Math.max(1, ...d.months.map((m) => Math.max(m.income_total, m.expense_total)));
  const coll = d.collection;
  const partner = Object.keys(T.shares).find((n) => n !== 'Alaa');
  el.innerHTML = `
    <section class="hero"><div>
      <small>لوحة المشرف العام</small>
      <h2>📊 ${esc(label)}</h2>
      <p>مداخيل ومصاريف ومرابيح مركز فيد شهرًا بشهر، لكل برنامج وللمجموع.</p>
      <div class="hero-actions">
        <div class="seg on-dark"><button class="chip ${mode === 'school' ? 'on' : ''}" data-mode="school">سنة دراسية (سبتمبر–أوت)</button>
          <button class="chip ${mode === 'calendar' ? 'on' : ''}" data-mode="calendar">سنة إدارية (جانفي–ديسمبر)</button></div>
        <div class="seg on-dark"><button class="chip" data-year="${d.year - 1}">‹ ${d.year - 1}</button><button class="chip" data-year="${d.year + 1}">${d.year + 1} ›</button></div>
      </div></div><div class="hero-art" aria-hidden="true">📈</div></section>

    <div class="kpis">
      <div class="kpi"><span>المداخيل</span><b class="in">${fmtMoney(T.income_total)}</b><small>منها متأخرات مستخلصة ${fmtMoney(T.late_collected)}</small></div>
      <div class="kpi"><span>المصاريف</span><b class="out">${fmtMoney(T.expense_total)}</b><small>منها أجور ${fmtMoney(T.expense.salaries_support + T.expense.salaries_program + T.expense.salaries_admin + T.expense.salaries_courses)}</small></div>
      <div class="kpi"><span>المرابيح</span><b>${T.net < 0 ? '−' : ''}${fmtMoney(Math.abs(T.net))}</b><small>${past.length} شهر محسوب</small></div>
      ${partner ? `<div class="kpi"><span>نصيب ${esc(partner)}</span><b>${fmtMoney(T.shares[partner])}</b><small><a href="#/partners">الحساب مع الشريك ←</a></small></div>` : ''}
      <div class="kpi"><span>التلاميذ</span><b>${d.counts.support + d.counts.program}</b><small>دعم ${d.counts.support} · تربوي ${d.counts.program}${d.counts.waiting ? ` · انتظار ${d.counts.waiting}` : ''}</small></div>
      ${coll ? `<div class="kpi"><span>استخلاص ${esc(monthLabel(coll.month))}</span><b>${coll.billed ? Math.round((coll.collected / coll.billed) * 100) : 0}%</b><small>${fmtMoney(coll.collected)} من ${fmtMoney(coll.billed)}</small></div>` : ''}
      <div class="kpi"><span>على الأولياء</span><b class="out">${fmtMoney(d.parents_owe)}</b><small><a href="#/debts">المتخلّد بذمتهم ←</a></small></div>
    </div>

    <section class="card">
      <div class="section-head"><h3>المداخيل والمصاريف شهرًا بشهر</h3>
        <div class="legend">${Object.values(BOARD_IN).map(([l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}<span><i class="ex"></i>المصاريف</span></div></div>
      <div class="bchart">${d.months
        .map((m) => {
          const stack = Object.keys(BOARD_IN).map((k) => `<i style="height:${(m.income[k] / maxIn) * 100}%;background:${BOARD_IN[k][1]}" title="${BOARD_IN[k][0]}: ${fmtMoney(m.income[k])}"></i>`).join('');
          return `<div class="bcol ${m.future ? 'future' : ''}" tabindex="0">
            <div class="btip"><b>${esc(monthLabel(m.month))}</b><br>مداخيل ${fmtMoney(m.income_total)}<br>مصاريف ${fmtMoney(m.expense_total)}<br>${m.net >= 0 ? 'ربح' : 'خسارة'} ${fmtMoney(Math.abs(m.net))}</div>
            <div class="bbars"><div class="bstack">${stack}</div><div class="bex" style="height:${(m.expense_total / maxIn) * 100}%"></div></div>
            <span class="bnet ${m.net < 0 ? 'neg' : ''}">${m.future ? '' : (m.net >= 0 ? '+' : '−') + Math.round(Math.abs(m.net))}</span>
            <span class="blab">${short(m.month)}</span></div>`;
        })
        .join('')}</div>
    </section>

    <div class="grid2 even">
      <section class="card"><h3>مصادر المداخيل</h3>${Object.entries(BOARD_IN)
        .map(([k, [l, c]]) => `<div class="cat-row"><span>${l}</span><div class="cat-bar"><i style="width:${T.income_total ? (T.income[k] / T.income_total) * 100 : 0}%;background:${c}"></i></div><b>${fmtMoney(T.income[k])}</b></div>`)
        .join('')}</section>
      <section class="card"><h3>أين تذهب المصاريف</h3>${Object.entries(BOARD_EX)
        .map(([k, [l, c]]) => `<div class="cat-row"><span>${l}</span><div class="cat-bar"><i style="width:${T.expense_total ? (T.expense[k] / T.expense_total) * 100 : 0}%;background:${c}"></i></div><b>${fmtMoney(T.expense[k])}</b></div>`)
        .join('')}</section>
    </div>

    <section class="card"><div class="section-head"><h3>الجدول التفصيلي</h3><span class="muted small">كل مبلغ في الشهر الذي يخصّه</span></div>
      <div class="table-wrap"><table class="fin">
        <thead><tr><th>الشهر</th>${Object.values(BOARD_IN).map(([l]) => `<th>${l}</th>`).join('')}<th>المداخيل</th>
          <th>أجور الدعم</th><th>أجور التربوي</th><th>إدارة ونظافة</th><th>أخرى</th><th>المصاريف</th><th>المرابيح</th>${partner ? `<th>${esc(partner)}</th>` : ''}</tr></thead>
        <tbody>${d.months
          .filter((m) => !m.future)
          .map(
            (m) => `<tr><td><b>${esc(monthLabel(m.month))}</b>${m.late_collected ? `<div class="muted tiny">متأخرات ${fmtMoney(m.late_collected)}</div>` : ''}</td>
              ${Object.keys(BOARD_IN).map((k) => `<td>${fmtMoney(m.income[k])}</td>`).join('')}<td class="in"><b>${fmtMoney(m.income_total)}</b></td>
              <td>${fmtMoney(m.expense.salaries_support)}</td><td>${fmtMoney(m.expense.salaries_program)}</td><td>${fmtMoney(m.expense.salaries_admin)}</td>
              <td>${fmtMoney(m.expense.rent + m.expense.other + m.expense.salaries_courses)}</td><td class="out"><b>${fmtMoney(m.expense_total)}</b></td>
              <td>${netBadge(m.net)}</td>${partner ? `<td>${fmtMoney(m.shares[partner] || 0)}</td>` : ''}
              </tr>`
          )
          .join('')}</tbody>
        <tfoot><tr><th>المجموع</th>${Object.keys(BOARD_IN).map((k) => `<th>${fmtMoney(T.income[k])}</th>`).join('')}<th>${fmtMoney(T.income_total)}</th>
          <th>${fmtMoney(T.expense.salaries_support)}</th><th>${fmtMoney(T.expense.salaries_program)}</th><th>${fmtMoney(T.expense.salaries_admin)}</th>
          <th>${fmtMoney(T.expense.rent + T.expense.other + T.expense.salaries_courses)}</th><th>${fmtMoney(T.expense_total)}</th><th>${netBadge(T.net)}</th>${partner ? `<th>${fmtMoney(T.shares[partner])}</th>` : ''}</tr></tfoot>
      </table></div>
      <p class="muted small">كل مبلغ يُحتسب في الشهر الذي يخصّه: دفعة جانفي التي تصل في مارس تُضاف إلى جانفي (وتظهر في «متأخرات»)، فتتحدّث أرقام جانفي ونصيب الشريك منه. الأجور حسب شهر الأجرة، وبقية المصاريف حسب تاريخها.</p>
    </section>`;
  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    sessionStorage.setItem('boardMode', b.dataset.mode);
    sessionStorage.removeItem('boardYear');
    viewBoard(el);
  }));
  el.querySelectorAll('[data-year]').forEach((b) => b.addEventListener('click', () => {
    sessionStorage.setItem('boardYear', b.dataset.year);
    viewBoard(el);
  }));
}
