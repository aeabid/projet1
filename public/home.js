'use strict';
// الصفحة الرئيسية لكل دور: المعلم (تلاميذه، ملاحظاته، غياباته، أجرته) والولي (الملاحظات، الدفعات، الغيابات)
// الإدارة: viewHome في business.js

const NOTE_KIND = { level: 'المستوى', behavior: 'السلوك', general: 'عامة', content: 'متابعة المحتوى' };

function noteBadges(n) {
  const lv = n.rating ? `<span class="badge ${n.rating}">${n.category === 'behavior' ? BEHAVIOR_WORDS[n.rating] : LEVEL_WORDS[n.rating]}</span>` : '';
  const bh = n.behavior ? `<span class="badge ${n.behavior}">السلوك: ${BEHAVIOR_WORDS[n.behavior]}</span>` : '';
  return `<span class="badge ${n.category}">${NOTE_KIND[n.category] || ''}</span> ${lv} ${bh}`;
}

async function viewTeacherHome(el) {
  const h = await api('GET', '/api/home/teacher');
  const p = h.pay;
  el.innerHTML = `
    ${heroBanner({ sub: `لوحة متابعة تلاميذك لشهر ${esc(monthLabel(h.month))}: الحصص، الملاحظات، الغيابات وأجرتك.`, art: '👩‍🏫',
      actions: '<a class="btn" href="#/attendance">تسجيل الحضور</a><a class="btn ghost" href="#/evaluations">بطاقات التقييم</a>' })}
    <div class="kpis">
      <a class="kpi" href="#/students"><b>${h.students}</b><span>تلميذ أدرّسه</span></a>
      <a class="kpi" href="#/my-pay"><b>${fmtHours(p.hours_done)}</b><span>ساعات منجزة${p.hours_planned ? `<small>+ ${fmtHours(p.hours_planned)} مبرمجة</small>` : ''}</span></a>
      <a class="kpi" href="#/my-pay"><b class="in">${fmtMoney(p.due)}</b><span>أجرة الشهر حتى اليوم${p.hourly_rate ? `<small>${fmtMoney(p.hourly_rate)} للساعة</small>` : ''}</span></a>
      <a class="kpi" href="#/my-pay"><b>${fmtMoney(p.paid)}</b><span>قبضت${p.remaining > 0 ? `<small class="out">الباقي ${fmtMoney(p.remaining)}</small>` : ''}</span></a>
      <a class="kpi" href="#/evaluations"><b>${h.notes_month}</b><span>ملاحظة هذا الشهر</span></a>
      <a class="kpi" href="#/attendance"><b>${h.absences_month}</b><span>غياب سجّلته هذا الشهر</span></a>
    </div>
    <div class="grid2">
      <section class="card">
        <div class="section-head"><h3>🗓 حصص اليوم</h3><a class="btn small" href="#/attendance">تسجيل الحضور</a></div>
        ${
          h.today.length
            ? `<ul class="levels">${h.today
                .map((s) => `<li><span><b>${esc(s.start_time)} – ${esc(s.end_time)}</b> ${esc(s.subject_name || '')}</span>
                  <span class="pill">${esc(levelLabel(s.level))}${s.group_name ? ` · ${esc(s.group_name)}` : ''}</span></li>`)
                .join('')}</ul>`
            : '<p class="muted">لا توجد حصص اليوم.</p>'
        }
      </section>
      <section class="card">
        <div class="section-head"><h3>💰 أجرتي</h3><a class="small" href="#/my-pay">التفاصيل ←</a></div>
        <div class="line"><span>الساعات المنجزة</span><b>${fmtHours(p.hours_done)}</b></div>
        <div class="line"><span>المستحق</span><b>${fmtMoney(p.due)}</b></div>
        <div class="line"><span>المقبوض</span><b class="in">${fmtMoney(p.paid)}</b></div>
        <div class="line total"><span>الباقي</span><b class="${p.remaining > 0 ? 'out' : ''}">${fmtMoney(Math.max(p.remaining, 0))}</b></div>
        ${p.payments.map((x) => `<div class="muted small">${fmtDate(x.paid_on)} · ${fmtMoney(x.amount)}${x.note ? ` · ${esc(x.note)}` : ''}</div>`).join('')}
      </section>
    </div>
    <section class="card">
      <div class="section-head"><h3>📝 آخر ملاحظاتي</h3><a class="btn small ghost" href="#/evaluations">إدخال بطاقات القسم</a></div>
      ${
        h.notes.length
          ? `<ul class="notes">${h.notes
              .map(
                (n) => `<li class="note"><div class="note-head">${noteBadges(n)}
                  ${n.visible_to_parent ? '<span class="muted small" title="يراها الولي">👁 يراها الولي</span>' : '<span class="badge general">🔒 داخلية</span>'}
                  <span class="muted small">${fmtDate(n.date)} · <a href="#/students/${n.student_id}">${esc(n.student_name)}</a> · ${esc(n.subject_name || '')}</span></div>
                  ${n.content ? `<p>${esc(n.content)}</p>` : ''}</li>`
              )
              .join('')}</ul>`
          : '<p class="muted">لم تكتب أي ملاحظة بعد. افتح ملف تلميذ أو «إدخال بطاقات القسم».</p>'
      }
    </section>
    <section class="card">
      <div class="section-head"><h3>📅 آخر الغيابات التي سجّلتها</h3><a class="small" href="#/attendance">الحضور ←</a></div>
      ${
        h.absences.length
          ? `<ul class="levels">${h.absences
              .map((a) => `<li><span>${fmtDate(a.date)} — <a href="#/students/${a.student_id}">${esc(a.student_name)}</a></span>
                <span class="muted small">${esc(a.subject_name || '')} ${a.justified ? '· مبرر' : ''}</span></li>`)
              .join('')}</ul>`
          : '<p class="muted">لا توجد غيابات.</p>'
      }
    </section>
    <p class="quick-actions"><a class="btn ghost small" href="#/students">تلاميذي</a> <a class="btn ghost small" href="#/overview">نظرة القسم</a>
      <a class="btn ghost small" href="#/timetable">جدولي</a> <a class="btn ghost small" href="#/messages">الرسائل</a></p>`;
}

async function viewParentHome(el) {
  const h = await api('GET', '/api/home/parent');
  const kidCard = (s) => `<a class="card child" href="${s.link}">
      <div class="child-head">${s.type === 'student' ? avatar(s, 'md') : avatar({ full_name: s.full_name }, 'md')}<div>
        <h3>${esc(s.full_name)}</h3>
        ${s.level ? `<span class="pill">${esc(levelLabel(s.level))}</span>` : ''}
        ${s.program ? `<span class="pill">🎨 ${esc(s.program.class_name || 'البرنامج التربوي')}</span>` : ''}
      </div></div>
      <div class="mini-stats">
        <span>الغيابات: <b>${s.absence_count}</b></span>
        <span>الملاحظات: <b>${s.note_count}</b></span>
        ${s.balance > 0 ? `<span>الباقي: <b class="owed">${fmtMoney(s.balance)}</b></span>` : '<span class="badge good">خالص</span>'}
      </div>
    </a>`;
  el.innerHTML = `
    ${heroBanner({
      sub: h.balance > 0 ? `الباقي للخلاص: <b>${fmtMoney(h.balance)}</b>. تابع ملاحظات المعلمين وغيابات أبنائك ودفوعاتك من هنا.` : 'كل الحسابات خالصة ✓ تابع ملاحظات المعلمين وغيابات أبنائك من هنا.',
      art: '👨‍👩‍👧',
      actions: '<a class="btn" href="#/messages">مراسلة المعلمين</a>',
    })}
    ${h.kids.length ? `<div class="cards">${h.kids.map(kidCard).join('')}</div>` : '<div class="card muted">لم يتم ربط أي ابن بحسابك بعد. اتصل بالإدارة.</div>'}
    <section class="card">
      <h3>📝 آخر ملاحظات المعلمين</h3>
      ${
        h.notes.length
          ? `<ul class="notes">${h.notes
              .map(
                (n) => `<li class="note"><div class="note-head">${noteBadges(n)}
                  <span class="muted small">${fmtDate(n.date)} · <a href="${n.link}">${esc(n.child)}</a> · ${esc(n.from)}</span></div>
                  ${n.content ? `<p>${esc(n.content)}</p>` : ''}</li>`
              )
              .join('')}</ul>`
          : '<p class="muted">لا توجد ملاحظات بعد.</p>'
      }
    </section>
    <section class="card">
      <h3>💳 الدفعات</h3>
      ${
        h.payments.length
          ? `<ul class="levels">${h.payments
              .map(
                (x) => `<li><span>${fmtDate(x.paid_on)} — <b>${esc(x.child)}</b>
                    <span class="muted small">${esc(x.program)}${x.month ? ` · ${esc(monthLabel(x.month))}` : ''}</span></span>
                  <span><b>${fmtMoney(x.amount)}</b> <a class="receipt-link" href="#/receipt/${x.kind}/${x.id}">🧾 ${x.receipt_no ?? ''}</a></span></li>`
              )
              .join('')}</ul>`
          : '<p class="muted">لا توجد دفعات مسجّلة.</p>'
      }
    </section>
    <section class="card">
      <h3>📅 آخر الغيابات</h3>
      ${
        h.absences.length
          ? `<ul class="levels">${h.absences
              .map((a) => `<li><span>${fmtDate(a.date)} — ${esc(a.child)}</span>
                <span class="muted small">${esc(a.subject_name || '')} ${a.justified ? '<span class="badge good">مبرر</span>' : ''}</span></li>`)
              .join('')}</ul>`
          : '<p class="muted">لا توجد غيابات 👏</p>'
      }
    </section>
    <p class="muted small">لمراسلة أستاذ(ة) مادة أو الإدارة: افتح ملف ابنك واضغط «✉️ مراسلة».</p>`;
}
