// ---------- 📝 امتحانات للعموم ----------
// الإدارة: #/exams — صفحة واحدة: الامتحانات، الرابط وQR، التعديل، وفي الأسفل محاولات المترشّحين
// العموم: #/exam/:code — دون حساب: الاسم واللقب والعمر ثمّ الأسئلة

const examUrl = (code) => `${location.origin}/exam/${code}`;
const examState = { id: null, editing: null, open: null };

async function viewExams(el) {
  const { exams } = await api('GET', '/api/exams');
  try {
    examState.id ??= Number(sessionStorage.getItem('examId')) || null;
  } catch {}
  if (!exams.some((x) => x.id === examState.id)) examState.id = exams[0]?.id || null;
  const ex = exams.find((x) => x.id === examState.id);
  el.innerHTML = `
    <div class="page-head"><div><h2>📝 الامتحانات</h2>
      <p class="muted">أنشئ امتحانًا وأرسل رابطه لأيّ شخص (خارج التطبيقة): يكتب اسمه ولقبه وعمره ويجيب، والنتائج تصلك هنا في أسفل الصفحة.</p></div>
      <div class="actions"><button class="btn ghost" id="ex-tpl">📥 قالب: امتحان المبتدئين</button><button class="btn" id="ex-new">+ امتحان جديد</button></div></div>
    ${exams.length ? `<div class="ex-tabs">${exams.map((x) => `<button class="ex-tab ${x.id === examState.id ? 'on' : ''}" data-ex="${x.id}">${esc(x.title)} <small>${x.attempts}</small></button>`).join('')}</div>` : ''}
    <div id="ex-main"></div>`;
  const main = $('#ex-main');
  el.querySelectorAll('[data-ex]').forEach((b) =>
    b.addEventListener('click', () => {
      examState.id = Number(b.dataset.ex);
      examState.editing = null;
      examState.open = null;
      try {
        sessionStorage.setItem('examId', examState.id);
      } catch {}
      viewExams(el);
    })
  );
  const edit = (data) => {
    examState.editing = data;
    examEditor(main, data, async (saved) => {
      examState.editing = null;
      examState.id = saved.id;
      try {
        sessionStorage.setItem('examId', saved.id);
      } catch {}
      viewExams(el);
    }, () => {
      examState.editing = null;
      viewExams(el);
    });
  };
  $('#ex-new').addEventListener('click', () =>
    edit({ title: '', intro: '', show_feedback: true, sections: [{ title: 'المحور 1', passage: '', tip: '', advice: '' }], questions: [{ sec: 0, prompt: '', word: '', sentence: '', options: ['', '', ''], answer: 0, why: '' }] })
  );
  $('#ex-tpl').addEventListener('click', () => edit(JSON.parse(JSON.stringify(EXAM_TEMPLATE_BEGINNERS))));
  if (examState.editing) return edit(examState.editing);
  if (!ex) {
    main.innerHTML = '<div class="card empty-state"><span>📝</span><p>لا يوجد امتحان بعد. أنشئ امتحانًا جديدًا أو ابدأ من قالب «امتحان المبتدئين» (50 سؤالًا جاهزًا).</p></div>';
    return;
  }
  const url = examUrl(ex.code);
  main.innerHTML = `
    <section class="card ex-share">
      <div class="ex-share-qr">${qrSvg(url, 5)}</div>
      <div class="ex-share-info">
        <h3>${esc(ex.title)} ${ex.active ? '<span class="badge excellent">🟢 مفتوح</span>' : '<span class="badge general">⏹ مغلق</span>'}</h3>
        <p class="muted small">${ex.questions.length} سؤالًا · ${ex.sections.length} محاور · ${ex.show_feedback ? 'تصحيح فوريّ بعد كلّ سؤال' : 'دون تصحيح فوريّ'}</p>
        <div class="ex-link"><input readonly dir="ltr" value="${esc(url)}" id="ex-url"><button class="btn small" id="ex-copy">📋 نسخ الرابط</button></div>
        <div class="ex-actions">
          <a class="btn small ghost" href="${esc(url)}" target="_blank" rel="noopener">👁 فتح الامتحان</a>
          <a class="btn small ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`📝 ${ex.title}\n${url}`)}">واتساب</a>
          <button class="btn small ghost" id="ex-edit">✏️ تعديل الأسئلة</button>
          <button class="btn small ghost" id="ex-toggle">${ex.active ? '⏹ إغلاق الامتحان' : '▶ إعادة فتح'}</button>
          <button class="btn small ghost danger" id="ex-del">🗑</button>
        </div>
      </div>
    </section>
    <section class="card"><div id="ex-attempts"><p class="muted">جاري التحميل…</p></div></section>`;
  $('#ex-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      $('#ex-url').select();
      document.execCommand('copy');
    }
    toast('تمّ نسخ الرابط ✓');
  });
  $('#ex-edit').addEventListener('click', () => {
    if (ex.attempts && !confirmAction(`أجاب ${ex.attempts} مترشّح عن هذا الامتحان. تعديل الأسئلة لا يغيّر نتائجهم السابقة. متابعة؟`)) return;
    edit(ex);
  });
  $('#ex-toggle').addEventListener('click', async () => {
    await api('PATCH', `/api/exams/${ex.id}`, { active: !ex.active });
    viewExams(el);
  });
  $('#ex-del').addEventListener('click', async () => {
    if (!confirmAction(`حذف «${ex.title}» وكلّ محاولات المترشّحين (${ex.attempts}) نهائيًا؟`)) return;
    await api('DELETE', `/api/exams/${ex.id}`);
    examState.id = null;
    viewExams(el);
  });
  examAttempts($('#ex-attempts'), ex);
}

// محاولات المترشّحين: جدول، تفاصيل، تنزيل وحذف
async function examAttempts(box, ex) {
  const { attempts } = await api('GET', `/api/exams/${ex.id}/attempts`);
  const avg = attempts.length ? Math.round(attempts.reduce((t, a) => t + a.total, 0) / attempts.length) : null;
  const byGrade = ['ممتاز', 'جيّد جدًّا', 'جيّد', 'يحتاج إلى دعم'].map((g) => [g, attempts.filter((a) => a.grade === g).length]);
  box.innerHTML = `
    <div class="section-head"><h3>👩‍🎓 محاولات المترشّحين <span class="badge">${attempts.length}</span></h3>
      <div><button class="btn small ghost" id="ea-refresh">🔄 تحديث</button> ${attempts.length ? '<button class="btn small ghost" id="ea-csv">⬇️ Excel (CSV)</button>' : ''}</div></div>
    ${
      attempts.length
        ? `<div class="ea-stats"><div><b>${avg}</b><span>المعدّل / 100</span></div>${byGrade.map(([g, n]) => `<div><b>${n}</b><span>${g}</span></div>`).join('')}</div>
           <div class="ea-list">${attempts
             .map(
               (a) => `<div class="ea-row ${examState.open === a.id ? 'open' : ''}" data-at="${a.id}">
                 <button class="ea-head" data-open="${a.id}"><span class="ea-name">${esc(a.first_name)} ${esc(a.last_name)} <small>· ${a.age ?? '—'} سنة</small></span>
                   <span class="muted small">${fmtTime(a.created_at)}</span><span class="ea-grade g-${a.total >= 85 ? 'a' : a.total >= 70 ? 'b' : a.total >= 50 ? 'c' : 'd'}">${esc(a.grade || '')}</span>
                   <b class="ea-total" dir="ltr">${a.total}<small> / 100</small></b></button>
                 ${examState.open === a.id ? attemptDetail(a) : ''}</div>`
             )
             .join('')}</div>`
        : `<p class="muted">لم يُجب أيّ مترشّح بعد. أرسل الرابط ثمّ اضغط «تحديث».</p>`
    }`;
  $('#ea-refresh').addEventListener('click', () => examAttempts(box, ex));
  $('#ea-csv')?.addEventListener('click', () => {
    const rows = [['التاريخ', 'الاسم', 'اللقب', 'العمر', 'العلامة', 'التقدير', 'الصحيح', 'عدد الأسئلة', ...ex.sections.map((s) => s.title)]];
    attempts.forEach((a) =>
      rows.push([fmtTime(a.created_at), a.first_name, a.last_name, a.age, a.total, a.grade, a.correct, a.q_count,
        ...ex.sections.map((s) => (a.skills.find((k) => k.t === s.title)?.pct ?? '') + '%')])
    );
    const t = '﻿' + rows.map((r) => r.map((v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([t], { type: 'text/csv;charset=utf-8' }));
    link.download = `natayij-${ex.code}.csv`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => (URL.revokeObjectURL(link.href), link.remove()), 500);
  });
  box.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = Number(b.dataset.open);
      examState.open = examState.open === id ? null : id;
      examAttempts(box, ex);
    })
  );
  box.querySelectorAll('[data-del-at]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirmAction('حذف هذه المحاولة نهائيًا؟')) return;
      await api('DELETE', `/api/exam-attempts/${b.dataset.delAt}`);
      examState.open = null;
      examAttempts(box, ex);
    })
  );
  box.querySelectorAll('[data-print-at]').forEach((b) => b.addEventListener('click', () => window.print()));
}

function attemptDetail(a) {
  const wrong = a.answers.filter((x) => !x.ok).length;
  return `<div class="ea-detail">
    <div class="ea-skills">${a.skills
      .map((k) => `<div class="ea-skill"><div><b>${esc(k.t)}</b><span>${k.pct}% · ${esc(k.detail)}</span></div><div class="ea-bar"><i style="width:${k.pct}%;background:${k.pct >= 70 ? 'var(--good)' : k.pct >= 50 ? '#f4b400' : 'var(--danger)'}"></i></div></div>`)
      .join('')}</div>
    <h4>تفاصيل الإجابات <small class="muted">(${a.correct} صحيحة · ${wrong} خاطئة)</small></h4>
    <div class="tw"><table class="ea-table"><thead><tr><th>المحور</th><th>السؤال</th><th>جوابه</th><th>الصحيح</th><th></th></tr></thead><tbody>
      ${a.answers.map((x) => `<tr class="${x.ok ? '' : 'bad'}"><td>${esc(x.s)}</td><td>${esc(x.q)}</td><td>${esc(x.c)}</td><td>${esc(x.a)}</td><td>${x.ok ? '✓' : '✗'}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="ea-actions"><button class="btn small ghost" data-print-at="${a.id}">🖨 طباعة</button><button class="btn small ghost danger" data-del-at="${a.id}">🗑 حذف المحاولة</button></div>
  </div>`;
}

// ---------- محرّر الامتحان ----------
function examEditor(box, exam, onSaved, onCancel) {
  const x = JSON.parse(JSON.stringify(exam));
  const draw = () => {
    box.innerHTML = `
      <section class="card ex-editor">
        <div class="section-head"><h3>${x.id ? '✏️ تعديل الامتحان' : '+ امتحان جديد'}</h3>
          <div><button class="btn ghost small" id="ee-cancel">إلغاء</button> <button class="btn small" id="ee-save">💾 حفظ الامتحان</button></div></div>
        <label>عنوان الامتحان<input id="ee-title" maxlength="150" value="${esc(x.title)}" placeholder="مثال: امتحان المبتدئين — العربية"></label>
        <label>تقديم قصير (اختياري)<input id="ee-intro" maxlength="600" value="${esc(x.intro || '')}" placeholder="مثال: 50 سؤالًا · اقرأ كلّ سؤال بهدوء ثمّ اختر الجواب"></label>
        <label class="check"><input type="checkbox" id="ee-fb" ${x.show_feedback ? 'checked' : ''}> تصحيح فوريّ: يرى المترشّح الجواب الصحيح بعد كلّ سؤال</label>
        <h4>📚 المحاور <small class="muted">(تُحسب العلامة لكلّ محور)</small></h4>
        <div class="ee-secs">${x.sections
          .map(
            (s, i) => `<div class="ee-sec" data-s="${i}">
              <div class="ee-row"><b class="ee-n">${i + 1}</b><input data-f="title" value="${esc(s.title)}" placeholder="عنوان المحور" maxlength="120">
                <button type="button" class="btn small ghost danger" data-rm-sec="${i}" title="حذف المحور">✕</button></div>
              <details ${s.passage || s.tip || s.advice ? 'open' : ''}><summary class="small muted">نصّ قراءة، تذكير، نصيحة (اختياري)</summary>
                <label class="small">نصّ قراءة يظهر فوق أسئلة هذا المحور<textarea data-f="passage" rows="3" maxlength="4000">${esc(s.passage || '')}</textarea></label>
                <label class="small">تذكير بالقاعدة (يراه المترشّح، سطر لكلّ فكرة)<textarea data-f="tip" rows="2" maxlength="1000">${esc(s.tip || '')}</textarea></label>
                <label class="small">نصيحة تظهر في النتيجة إذا كانت العلامة أقلّ من 70%<input data-f="advice" maxlength="400" value="${esc(s.advice || '')}"></label>
              </details></div>`
          )
          .join('')}</div>
        <button type="button" class="btn small ghost" id="ee-add-sec">+ محور</button>
        <h4>❓ الأسئلة <span class="badge">${x.questions.length}</span></h4>
        <p class="muted small">كلّ سؤال: نصّ السؤال، وكلمة بارزة أو جملة فيها فراغ ___ (اختياري)، ثمّ الاختيارات (اختيار في كلّ سطر) واضغط ⦿ أمام الجواب الصحيح. صحيح/خطأ = اختياران.</p>
        <div class="ee-qs">${x.questions
          .map(
            (q, i) => `<div class="ee-q" data-q="${i}">
              <div class="ee-row"><b class="ee-n">${i + 1}</b>
                <select data-f="sec">${x.sections.map((s, j) => `<option value="${j}" ${j === q.sec ? 'selected' : ''}>${esc(s.title || `المحور ${j + 1}`)}</option>`).join('')}</select>
                <span class="ee-tools"><button type="button" class="btn small ghost" data-up="${i}" title="فوق">▲</button><button type="button" class="btn small ghost" data-down="${i}" title="تحت">▼</button>
                <button type="button" class="btn small ghost" data-dup="${i}" title="نسخ">⧉</button><button type="button" class="btn small ghost danger" data-rm-q="${i}" title="حذف">✕</button></span></div>
              <input data-f="prompt" value="${esc(q.prompt)}" placeholder="نصّ السؤال (مثال: ما نوع هذه الكلمة؟)" maxlength="300">
              <div class="ee-row2"><input data-f="word" value="${esc(q.word || '')}" placeholder="كلمة بارزة (اختياري)" maxlength="200">
                <input data-f="sentence" value="${esc(q.sentence || '')}" placeholder="جملة فيها فراغ ___ (اختياري)" maxlength="300"></div>
              <div class="ee-opts">${q.options
                .map((o, k) => `<div class="ee-opt"><input type="radio" name="ans-${i}" data-ans="${k}" ${k === q.answer ? 'checked' : ''} title="الجواب الصحيح"><input data-opt="${k}" value="${esc(o)}" placeholder="اختيار ${k + 1}" maxlength="200"><button type="button" class="link danger" data-rm-opt="${k}">✕</button></div>`)
                .join('')}<button type="button" class="btn small ghost" data-add-opt>+ اختيار</button></div>
              <input data-f="why" value="${esc(q.why || '')}" placeholder="شرح يظهر بعد الإجابة (اختياري)" maxlength="400">
            </div>`
          )
          .join('')}</div>
        <div class="ee-bottom"><button type="button" class="btn ghost" id="ee-add-q">+ سؤال</button><button class="btn" id="ee-save2">💾 حفظ الامتحان</button></div>
      </section>`;
    bind();
  };
  // نقرأ الحقول قبل كلّ تغيير في البنية حتى لا يضيع ما كُتب
  const collect = () => {
    x.title = $('#ee-title').value;
    x.intro = $('#ee-intro').value;
    x.show_feedback = $('#ee-fb').checked;
    box.querySelectorAll('.ee-sec').forEach((d) => {
      const s = x.sections[d.dataset.s];
      d.querySelectorAll('[data-f]').forEach((f) => (s[f.dataset.f] = f.value));
    });
    box.querySelectorAll('.ee-q').forEach((d) => {
      const q = x.questions[d.dataset.q];
      d.querySelectorAll(':scope > [data-f], .ee-row [data-f], .ee-row2 [data-f]').forEach((f) => (q[f.dataset.f] = f.dataset.f === 'sec' ? Number(f.value) : f.value));
      q.options = [...d.querySelectorAll('[data-opt]')].map((f) => f.value);
      const r = d.querySelector('[data-ans]:checked');
      q.answer = r ? Number(r.dataset.ans) : 0;
    });
  };
  const change = (fn) => {
    collect();
    fn();
    draw();
  };
  const bind = () => {
    $('#ee-cancel').addEventListener('click', () => confirmAction('إلغاء التعديلات؟') && onCancel());
    $('#ee-add-sec').addEventListener('click', () => change(() => x.sections.push({ title: `المحور ${x.sections.length + 1}`, passage: '', tip: '', advice: '' })));
    $('#ee-add-q').addEventListener('click', () => {
      change(() => {
        const last = x.questions[x.questions.length - 1];
        x.questions.push({ sec: last?.sec ?? 0, prompt: '', word: '', sentence: '', options: ['', '', ''], answer: 0, why: '' });
      });
      box.querySelector('.ee-q:last-child [data-f=prompt]')?.focus();
    });
    box.querySelectorAll('[data-rm-sec]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.rmSec);
        if (x.sections.length === 1) return toast('محور واحد على الأقلّ', true);
        collect();
        const used = x.questions.filter((q) => q.sec === i).length;
        if (used && !confirmAction(`في هذا المحور ${used} سؤالًا: تُنقل إلى المحور الأوّل. متابعة؟`)) return;
        x.sections.splice(i, 1);
        x.questions.forEach((q) => (q.sec = q.sec === i ? 0 : q.sec > i ? q.sec - 1 : q.sec));
        draw();
      })
    );
    box.querySelectorAll('.ee-q').forEach((d) => {
      const i = Number(d.dataset.q);
      d.querySelector('[data-up]').addEventListener('click', () => i > 0 && change(() => x.questions.splice(i - 1, 0, x.questions.splice(i, 1)[0])));
      d.querySelector('[data-down]').addEventListener('click', () => i < x.questions.length - 1 && change(() => x.questions.splice(i + 1, 0, x.questions.splice(i, 1)[0])));
      d.querySelector('[data-dup]').addEventListener('click', () => change(() => x.questions.splice(i + 1, 0, JSON.parse(JSON.stringify(x.questions[i])))));
      d.querySelector('[data-rm-q]').addEventListener('click', () => (x.questions.length === 1 ? toast('سؤال واحد على الأقلّ', true) : change(() => x.questions.splice(i, 1))));
      d.querySelector('[data-add-opt]').addEventListener('click', () => (x.questions[i].options.length >= 6 ? toast('6 اختيارات على الأقصى', true) : change(() => (collect(), x.questions[i].options.push('')))));
      d.querySelectorAll('[data-rm-opt]').forEach((b) =>
        b.addEventListener('click', () => {
          collect();
          const q = x.questions[i];
          if (q.options.length <= 2) return toast('اختياران على الأقلّ', true);
          const k = Number(b.dataset.rmOpt);
          q.options.splice(k, 1);
          if (q.answer === k) q.answer = 0;
          else if (q.answer > k) q.answer--;
          draw();
        })
      );
    });
    const save = async (e) => {
      collect();
      e.currentTarget.disabled = true;
      const body = { ...x, questions: x.questions.map((q) => ({ ...q, options: q.options.map((o) => o.trim()).filter(Boolean) })) };
      try {
        const r = x.id ? await api('PUT', `/api/exams/${x.id}`, body) : await api('POST', '/api/exams', body);
        toast('تمّ حفظ الامتحان ✓');
        onSaved(r.exam);
      } catch (err) {
        toast(err.message, true);
        e.currentTarget.disabled = false;
      }
    };
    $('#ee-save').addEventListener('click', save);
    $('#ee-save2').addEventListener('click', save);
  };
  draw();
}

// ---------- صفحة الامتحان للعموم ----------
async function viewPublicExam(el, code) {
  el.innerHTML = '<div class="xm"><p class="muted">جاري التحميل…</p></div>';
  let exam;
  try {
    ({ exam } = await api('GET', `/api/public/exams/${code}`));
  } catch (err) {
    el.innerHTML = `<div class="xm"><div class="xm-card"><h2>📝</h2><p>${esc(err.message)}</p></div></div>`;
    return;
  }
  const brand = `<div class="xm-brand"><img src="feed-logo.png" alt="فيد"><span class="xm-pill">امتحان تقييميّ</span></div>`;
  if (!exam.active) {
    el.innerHTML = `<div class="xm">${brand}<div class="xm-card"><h2>${esc(exam.title)}</h2><p>الامتحان مغلق حاليًا.</p></div></div>`;
    return;
  }
  const start = () => {
    el.innerHTML = `<div class="xm">${brand}
      <div class="xm-hero"><h1>${esc(exam.title)}</h1><p>${exam.intro ? esc(exam.intro) : `${exam.questions.length} سؤالًا`}</p></div>
      <div class="xm-skills">${exam.sections.map((s, i) => `<div class="xm-skill"><b>${i + 1}</b>${esc(s.title)}</div>`).join('')}</div>
      <div class="xm-form">
        <label>الاسم *<input id="xm-first" maxlength="40" autocomplete="off"></label>
        <label>اللقب *<input id="xm-last" maxlength="40" autocomplete="off"></label>
        <label>العمر *<input id="xm-age" type="number" min="3" max="99" inputmode="numeric"></label>
      </div>
      <p class="xm-err" id="xm-err" role="alert"></p>
      <div class="xm-center"><button class="xm-big" id="xm-go">ابدأ الامتحان</button></div>
      <p class="xm-foot">www.feed.tn · مركز فيد التعليمي</p></div>`;
    $('#xm-go').addEventListener('click', () => {
      const first = $('#xm-first').value.trim();
      const last = $('#xm-last').value.trim();
      const age = parseInt($('#xm-age').value, 10);
      const err = $('#xm-err');
      if (!first) return (err.textContent = 'اكتب اسمك.'), $('#xm-first').focus();
      if (!last) return (err.textContent = 'اكتب لقبك.'), $('#xm-last').focus();
      if (!age || age < 3 || age > 99) return (err.textContent = 'اكتب عمرك (رقم).'), $('#xm-age').focus();
      run({ first, last, age });
    });
  };
  const shuffle = (a) => {
    a = [...a];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const run = (who) => {
    // ترتيب عشوائيّ داخل كلّ محور، والمحاور بترتيبها
    const order = exam.sections.flatMap((_, s) => shuffle(exam.questions.map((q, i) => ({ q, i })).filter((x) => x.q.sec === s)));
    const answers = {};
    let k = 0;
    const render = () => {
      const { q, i } = order[k];
      const sec = exam.sections[q.sec];
      const parts = (q.sentence || '').split('___');
      el.innerHTML = `<div class="xm">${brand}
        <div class="xm-top"><h2>${esc(sec.title)}</h2><span class="xm-badge">السؤال ${k + 1} من ${order.length}</span></div>
        <div class="xm-bar"><i style="width:${Math.round((k / order.length) * 100)}%"></i></div>
        ${sec.tip ? `<details class="xm-tip"><summary>💡 تذكير بالقاعدة</summary><ul>${sec.tip.split('\n').filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}
        ${sec.passage ? `<p class="xm-prompt">اقرأ النصّ جيّدًا ثمّ أجب عن السؤال.</p><div class="xm-text">${esc(sec.passage)}</div>` : ''}
        <div class="xm-card">
          ${q.prompt ? `<div class="xm-prompt">${esc(q.prompt)}</div>` : ''}
          ${q.word ? `<div class="xm-word">${esc(q.word)}</div>` : ''}
          ${q.sentence ? `<div class="xm-sent">${esc(parts[0])}${parts.length > 1 ? `<span class="xm-gap"></span>${esc(parts.slice(1).join('___'))}` : ''}</div>` : ''}
          <div class="xm-opts">${shuffle(q.options.map((o, j) => ({ o, j }))).map(({ o, j }) => `<button class="xm-opt" data-j="${j}">${esc(o)}</button>`).join('')}</div>
          <div class="xm-fb" role="status" aria-live="polite"></div>
        </div></div>`;
      window.scrollTo(0, 0);
      const fb = el.querySelector('.xm-fb');
      el.querySelectorAll('.xm-opt').forEach((b) =>
        b.addEventListener('click', () => {
          if (answers[i] !== undefined) return;
          const j = Number(b.dataset.j);
          answers[i] = j;
          el.querySelectorAll('.xm-opt').forEach((x) => (x.disabled = true));
          if (exam.show_feedback) {
            const ok = j === q.answer;
            el.querySelector(`.xm-opt[data-j="${q.answer}"]`).classList.add('ok');
            if (!ok) b.classList.add('no', 'shake');
            fb.innerHTML = ok ? '<span class="ok">أحسنت! ✓</span> ' : `<span class="no">الجواب الصحيح: ${esc(q.options[q.answer])}.</span> `;
            if (q.why) fb.insertAdjacentText('beforeend', q.why);
          } else b.classList.add('picked');
          const nx = document.createElement('button');
          nx.className = 'xm-big xm-next';
          nx.textContent = k + 1 < order.length ? 'السؤال التالي' : 'عرض النتيجة';
          nx.addEventListener('click', () => (k + 1 < order.length ? (k++, render()) : finish()));
          fb.appendChild(document.createElement('div')).appendChild(nx);
          nx.focus();
        })
      );
    };
    const finish = async () => {
      el.innerHTML = `<div class="xm">${brand}<div class="xm-card"><p class="xm-prompt">جارٍ إرسال النتيجة…</p></div></div>`;
      const send = async () => {
        try {
          const r = await api('POST', `/api/public/exams/${code}/submit`, { first_name: who.first, last_name: who.last, age: who.age, answers });
          result(r);
        } catch (err) {
          el.innerHTML = `<div class="xm">${brand}<div class="xm-card"><p class="xm-err">تعذّر إرسال النتيجة: ${esc(err.message)}</p><button class="xm-big" id="xm-retry">إعادة الإرسال</button></div></div>`;
          $('#xm-retry').addEventListener('click', send);
        }
      };
      send();
    };
    const result = (r) => {
      const st = r.total >= 85 ? 3 : r.total >= 60 ? 2 : 1;
      el.innerHTML = `<div class="xm">${brand}<div class="xm-card">
        <div class="xm-prompt">نتيجة ${esc(who.first)} ${esc(who.last)} · ${who.age} سنة</div>
        <div class="xm-score" dir="ltr">${r.total}<small> / 100</small></div>
        <div class="xm-stars">${[0, 1, 2].map((i) => `<span class="${i < st ? '' : 'off'}">★</span>`).join('')}</div>
        <div class="xm-grade">${esc(r.grade)}</div>
        <p class="xm-prompt">الإجابات الصحيحة: ${r.correct} من ${r.count}</p>
        <div class="xm-rows">${r.skills
          .map((s) => `<div class="xm-row"><div class="xm-h"><span>${esc(s.t)}</span><span>${s.pct}% · ${esc(s.detail)}</span></div><div class="xm-bar"><i style="width:${s.pct}%"></i></div>${s.pct < 70 && s.advice ? `<small>نصيحة: ${esc(s.advice)}</small>` : ''}</div>`)
          .join('')}</div>
        <p class="xm-sent-ok">✓ أُرسلت النتيجة إلى مركز فيد.</p>
        <div class="xm-center"><button class="xm-big" id="xm-new">مترشّح جديد</button> <button class="xm-ghost" onclick="window.print()">طباعة النتيجة</button></div>
      </div></div>`;
      $('#xm-new').addEventListener('click', start);
    };
    render();
  };
  start();
}
