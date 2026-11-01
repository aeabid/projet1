'use strict';
// بطاقة التقييم الشهرية (كالبطاقة الورقية لمركز فيد) والاستيراد من التطبيق السابق
// تستعمل الأدوات المعرّفة في app.js ($، esc، api، levelLabel، MONTHS_AR، ...)

// القسم بصيغة البطاقة الورقية
const CARD_LEVELS = {
  5: 'الخامسة ابتدائي',
  6: 'السادسة ابتدائي',
  '6-distance': 'السادسة ابتدائي (عن بعد)',
  7: 'السابعة أساسي',
  8: 'الثامنة أساسي',
  9: 'التاسعة أساسي',
};
const CARD_COLORS = { excellent: '#1F8A5B', good: '#2A8A8A', average: '#B7801A', weak: '#B8423A' };

const cardBadge = (v, words) => (v ? `<span class="rc-bd" style="--c:${CARD_COLORS[v]}">${esc(words[v])}</span>` : '');
const dots = (n) => '<div class="rc-dl"></div>'.repeat(n);
const cardMonthTitle = (m) => (m === 'all' ? 'للفترة الحالية' : `شهر ${MONTHS_AR[Number(m.slice(5, 7)) - 1]}`);

function reportSheet(r) {
  const s = r.student;
  const rows = r.subjects
    .map(
      (x) => `<tr><th scope="row">${esc(x.subject)}</th>
        <td>${x.level ? `<div class="rc-tag">المستوى: ${cardBadge(x.level, LEVEL_WORDS)}</div>` : ''}${
          x.notes.map((t) => `<p>${esc(t)}</p>`).join('') || (x.level ? '' : dots(3))
        }</td>
        <td>${x.behavior ? cardBadge(x.behavior, BEHAVIOR_WORDS) : ''}${
          x.behavior_notes.map((t) => `<p>${esc(t)}</p>`).join('') || (x.behavior ? '' : dots(3))
        }</td></tr>`
    )
    .join('');
  return `<article class="rc-sheet">
    <header class="rc-head">
      <div class="rc-title">
        <svg width="42" height="42" viewBox="0 0 48 48" fill="none" stroke="#4C2786" stroke-width="2.2" aria-hidden="true"><path d="M13 9h22v6"/><path d="M9 14h11l3 4h18v22H9z" fill="#fff"/><path d="M13 30h10M13 34h7"/></svg>
        <div><h1>تقييم التلميذ ${esc(cardMonthTitle(r.month))}</h1><small>مركز فيد التعليمي · دروس الدعم${r.month !== 'all' ? ` · ${esc(r.month.slice(0, 4))}` : ''}</small></div>
      </div>
      <img class="rc-logo" src="feed-logo.png" alt="فيد">
    </header>
    <section class="rc-id">
      <div><span>اسم التلميذ :</span> ${esc(s.full_name)}</div>
      <div><span>القسم :</span> ${esc(CARD_LEVELS[s.level] || levelLabel(s.level))}</div>
      <div class="rc-ph">${s.has_photo ? `<img src="/api/students/${s.id}/photo?v=${s.photo_version}" alt="">` : '<i></i>'}</div>
    </section>
    <section class="rc-box"><h2>تقييم إجمالي : إدارة مركز فيد</h2>
      <div class="rc-in">${r.admin_notes.map((t) => `<p>${esc(t)}</p>`).join('') || dots(3)}</div></section>
    <section class="rc-box"><h2>ملاحظات الأساتذة</h2>
      <table><thead><tr><th scope="col">المادة</th><th scope="col">الملاحظات الأكاديمية</th><th scope="col">السلوك</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3">${dots(3)}</td></tr>`}</tbody></table>
    </section>
    <footer class="rc-foot">
      <img src="feed-logo.png" alt="فيد">
      <span>📞 <span dir="ltr">93400219</span></span>
      <span>🌐 <span dir="ltr">feed.tn</span></span>
    </footer>
  </article>`;
}

function monthOptions(months, selected) {
  const cur = today().slice(0, 7);
  const list = [...new Set([cur, ...months])].sort().reverse();
  return (
    list.map((m) => `<option value="${m}" ${m === selected ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('') +
    `<option value="all" ${selected === 'all' ? 'selected' : ''}>كل الفترة</option>`
  );
}

// بطاقة تلميذ: الإدارة، معلمه (موادّه فقط)، ووليّه
async function viewReport(el, id) {
  const month = sessionStorage.getItem('reportMonth') || today().slice(0, 7);
  const r = await api('GET', `/api/students/${id}/report?month=${month}`);
  el.innerHTML = `
    <div class="page-head no-print">
      <div><a href="#/students/${id}" class="muted small">→ ملف التلميذ</a><h2>📄 بطاقة التقييم</h2></div>
      <div class="actions">
        <select id="rc-month">${monthOptions(r.months, month)}</select>
        <button class="btn" id="rc-print">🖨 طباعة / حفظ PDF</button>
      </div>
    </div>
    <p class="muted small no-print">تظهر فقط الملاحظات التي يراها الولي.${state.user.role === 'teacher' ? ' (موادّك فقط، دون ملاحظات الإدارة)' : ''}</p>
    <div class="print-area rc-wrap">${reportSheet(r)}</div>`;
  $('#rc-month').addEventListener('change', () => {
    sessionStorage.setItem('reportMonth', $('#rc-month').value);
    viewReport(el, id);
  });
  $('#rc-print').addEventListener('click', () => window.print());
}

// بطاقات كل تلاميذ مستوى في ملف واحد (كل بطاقة في صفحة)
async function viewClassReports(el) {
  const level = sessionStorage.getItem('reportLevel') || state.meta.levels[0].code;
  const month = sessionStorage.getItem('reportMonth') || today().slice(0, 7);
  const { reports } = await api('GET', `/api/reports/class?level=${encodeURIComponent(level)}&month=${month}`);
  el.innerHTML = `
    <div class="page-head no-print">
      <div><a href="#/students" class="muted small">→ التلاميذ</a><h2>🖨 بطاقات التقييم للقسم</h2></div>
      <div class="actions">
        <select id="rc-level">${levelOptions(level)}</select>
        <select id="rc-month">${monthOptions([], month)}</select>
        <button class="btn" id="rc-print" ${reports.length ? '' : 'disabled'}>🖨 طباعة ${reports.length} بطاقة</button>
      </div>
    </div>
    ${reports.length ? `<div class="print-area rc-wrap">${reports.map(reportSheet).join('')}</div>` : '<div class="card muted">لا يوجد تلاميذ يدرسون في هذا المستوى.</div>'}`;
  const reload = () => {
    sessionStorage.setItem('reportLevel', $('#rc-level').value);
    sessionStorage.setItem('reportMonth', $('#rc-month').value);
    viewClassReports(el);
  };
  $('#rc-level').addEventListener('change', reload);
  $('#rc-month').addEventListener('change', reload);
  $('#rc-print').addEventListener('click', () => window.print());
}

// ---------- الاستيراد من التطبيق السابق (ملف zip: data/*.json و photos/*.jpg) ----------
function loadJsZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/jszip.min.js';
    sc.onload = () => resolve(window.JSZip);
    sc.onerror = () => reject(new Error('تعذّر تحميل قارئ ملفات zip'));
    document.head.appendChild(sc);
  });
}

function legacyImportSection() {
  return `<div class="card">
    <h3>📦 الاستيراد من التطبيق السابق</h3>
    <p>اختر ملف <b>feed-suivi-handoff.zip</b>: يُضاف التلاميذ والصور وملاحظات الأساتذة (المستوى والسلوك) والمدرّسون بموادّهم ومستوياتهم.</p>
    <ul class="muted small">
      <li>التلميذ الموجود (نفس الاسم) لا يُكرَّر: تُضاف له ملاحظاته، وصورته إن لم تكن له صورة، وموادّه إن لم تُحدَّد.</li>
      <li>يمكن إعادة الاستيراد بلا تكرار.</li>
      <li>المدرّس الجديد يأخذ حسابًا بكلمة سر تظهر مرة واحدة.</li>
    </ul>
    <input type="file" id="legacy-file" accept=".zip,application/zip">
    <div id="legacy-result"></div>
  </div>`;
}

function bindLegacyImport() {
  $('#legacy-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const out = $('#legacy-result');
    const step = (t) => (out.innerHTML = `<p class="muted">${esc(t)}</p>`);
    try {
      step('جاري قراءة الملف…');
      const zip = await (await loadJsZip()).loadAsync(file);
      const find = (re) => Object.values(zip.files).filter((f) => !f.dir && re.test(f.name));
      const json = async (name) => {
        const f = find(new RegExp(`(^|/)data/${name}\\.json$`))[0];
        return f ? JSON.parse(await f.async('string')) : null;
      };
      const payload = { students: (await json('students')) || {}, notes: (await json('notes')) || [], teachers: (await json('teachers')) || [] };
      if (!Object.keys(payload.students).length && !payload.notes.length) throw new Error('لم أجد data/students.json في الملف');
      step(`استيراد ${Object.keys(payload.students).length} تلميذ و${payload.notes.length} ملاحظة…`);
      const res = await api('POST', '/api/import/legacy', payload);
      // الصور: photos/s01.jpg → التلميذ s01 (فقط من ليست له صورة)
      const photos = find(/(^|\/)photos\/[\w-]+\.(jpe?g|png|webp)$/i);
      let uploaded = 0;
      for (const f of photos) {
        const legacyId = f.name.split('/').pop().replace(/\.\w+$/, '');
        const studentId = res.photo_targets[legacyId];
        if (!studentId) continue;
        step(`رفع الصور… ${uploaded + 1}`);
        const blob = await f.async('blob');
        await api('PUT', `/api/students/${studentId}/photo`, { photo: await resizeImage(new File([blob], f.name, { type: 'image/jpeg' })) });
        uploaded++;
      }
      showLegacyResult(out, res, uploaded);
    } catch (err) {
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
    e.target.value = '';
  });
}

function showLegacyResult(el, res, photos) {
  const newTeachers = res.teachers.filter((t) => t.password);
  el.innerHTML = `
    <h4>✅ تمّ الاستيراد</h4>
    <ul>
      <li>تلاميذ موجودون رُبطوا: <b>${res.students_matched}</b> — تلاميذ جدد: <b>${res.students_created}</b></li>
      <li>ملاحظات أُضيفت: <b>${res.notes_added}</b>${res.notes_skipped ? ` <span class="muted">(${res.notes_skipped} موجودة أو ناقصة)</span>` : ''}</li>
      <li>صور: <b>${photos}</b></li>
      <li>مدرّسون: <b>${res.teachers.length}</b> (${newTeachers.length} حساب جديد)</li>
    </ul>
    ${
      newTeachers.length || res.parents.length
        ? `<p class="error"><b>مهم:</b> كلمات السر تظهر هنا مرة واحدة فقط. اطبعها أو انسخها الآن.</p>
          <div class="table-wrap print-area"><table>
            <thead><tr><th>الحساب</th><th>الاسم</th><th>اسم المستخدم</th><th>كلمة السر</th></tr></thead>
            <tbody>${[
              ...newTeachers.map((t) => ['معلم', t.full_name, t.username, t.password]),
              ...res.parents.map((p) => [`ولي (${p.children.join('، ')})`, p.full_name, p.username, p.password]),
            ]
              .map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td dir="ltr"><b>${esc(r[2])}</b></td><td dir="ltr"><b>${esc(r[3])}</b></td></tr>`)
              .join('')}</tbody></table></div>
          <p><button class="btn ghost" id="legacy-print">🖨 طباعة</button></p>`
        : ''
    }
    <p><a href="#/students" class="btn ghost">عرض التلاميذ</a> <a href="#/report-class" class="btn ghost">بطاقات التقييم للقسم</a></p>`;
  $('#legacy-print')?.addEventListener('click', () => window.print());
}
