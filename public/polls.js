// ---------- 🗳️ تصويت مباشر للأولياء ----------
// الإدارة: #/polls (إنشاء) و #/polls/:id (شاشة العرض: QR + نتائج حيّة)
// الأولياء: #/vote/:code — دون حساب، مجهول الهوية

const POLL_COLORS = { excellent: '#0f9d58', very_good: '#7cb342', average: '#f4b400', below: '#f57c00', weak: '#db4437' };
const POLL_EMOJI = { excellent: '🤩', very_good: '🙂', average: '😐', below: '🙁', weak: '😞' };
const CHOICE_COLORS = ['#7c3aed', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444'];
const CHOICE_MARKS = ['أ', 'ب', 'ج', 'د', 'هـ'];
const voteUrl = (code) => `${publicBase()}/vote/${code}`;
const qrSvg = (textValue, cell = 8) => {
  const q = qrcode(0, 'M');
  q.addData(textValue);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
};

async function viewPolls(el) {
  const { polls, defaults } = await api('GET', '/api/polls');
  el.innerHTML = `
    <div class="page-head"><div><h2>🗳️ تصويت مباشر للأولياء</h2>
      <p class="muted">للاجتماعات: اعرض رمز QR على الشاشة، يمسحه الأولياء ويقيّمون من هواتفهم دون حساب وبصفة مجهولة، والنتائج تظهر مباشرة وتُحفظ للإحصائيات.</p></div>
      <button class="btn" id="pl-new">+ تصويت جديد</button></div>
    ${
      polls.length
        ? `<div class="pl-list">${polls
            .map(
              (p) => `<a class="card pl-item" href="#/polls/${p.id}">
                <div><b>${esc(p.title)}</b><div class="muted small">${fmtDate(String(p.created_at).slice(0, 10))} · ${p.criteria.length} أسئلة · ${p.kind === 'choice' ? '🗳️ سبر آراء' : '⭐ تقييم'} · ${p.mode === 'step' ? '👆 سؤال بسؤال' : '📋 كل الأسئلة معًا'} · رمز ${p.code}</div></div>
                <div class="pl-meta"><span class="pl-votes">${p.votes}<small>مشارك</small></span>
                  <span class="badge ${p.active ? 'excellent' : 'general'}">${p.active ? '🟢 مفتوح' : '⏹ مغلق'}</span></div></a>`
            )
            .join('')}</div>`
        : '<div class="card empty-state"><span>🗳️</span><p>لا يوجد تصويت بعد. أنشئ أوّل تصويت لاجتماعك!</p></div>'
    }`;
  $('#pl-new').addEventListener('click', () => {
    openModal(
      '🗳️ تصويت جديد',
      `<label>العنوان<input name="title" required maxlength="150" value="اجتماع أولياء الإعدادي — تقييم فيد"></label>
       <p class="pl-mode-title">نوع التصويت</p>
       <div class="pl-modes">
         <label class="pl-mode"><input type="radio" name="kind" value="rating" checked><span><b>⭐ تقييم</b><small>كل سؤال يُقيَّم من 1 إلى 5 (ممتاز… ضعيف)</small></span></label>
         <label class="pl-mode"><input type="radio" name="kind" value="choice"><span><b>🗳️ سبر آراء</b><small>أنت تضع الاختيارات لكل سؤال (حتى 5) والوليّ يختار</small></span></label>
       </div>
       <div id="pl-rating"><label>محاور التقييم (محور في كل سطر)<textarea name="criteria" rows="8">${esc(defaults.join('\n'))}</textarea></label>
         <p class="muted small">سلّم التقييم من 1 إلى 5: 5 ممتاز · 4 جيد · 3 متوسط · 2 دون المتوسط · 1 ضعيف.</p></div>
       <div id="pl-choice" hidden><div id="pl-qs"></div><button type="button" class="btn small ghost" id="pl-addq">+ سؤال</button></div>
       <p class="pl-mode-title">طريقة العرض</p>
       <div class="pl-modes">
         <label class="pl-mode"><input type="radio" name="mode" value="all" checked><span><b>📋 كل الأسئلة دفعة واحدة</b><small>يجيب الوليّ عن كل الأسئلة ثمّ نرى النتائج</small></span></label>
         <label class="pl-mode"><input type="radio" name="mode" value="step"><span><b>👆 سؤال بسؤال</b><small>أعرض سؤالًا، يصوّتون، نناقش النتيجة، ثمّ أنتقل إلى الموالي</small></span></label>
       </div>
       <p class="muted small">🔒 مجهول الهوية تمامًا، والنتائج تُحفظ عندك للإحصائيات.</p>
       <label class="check"><input type="checkbox" name="allow_comment" checked> السماح بملاحظة مكتوبة (اختيارية)</label>`,
      async (d) => {
        const body = { title: d.title, allow_comment: !!d.allow_comment, mode: d.mode, kind: d.kind };
        if (d.kind === 'choice') {
          body.questions = [...document.querySelectorAll('.pl-qb')].map((b) => ({
            q: b.querySelector('.pl-qq').value.trim(),
            options: [...b.querySelectorAll('.pl-qo')].map((i) => i.value.trim()).filter(Boolean),
          }));
        } else body.criteria = d.criteria;
        const { poll } = await api('POST', '/api/polls', body);
        location.hash = `#/polls/${poll.id}`;
      }
    );
    // سبر آراء: سؤال + من 2 إلى 5 اختيارات
    const qBlock = (q = '', opts = ['', '', '']) => `<div class="pl-qb card"><div class="pl-qb-head"><input class="pl-qq" maxlength="150" placeholder="السؤال (مثال: أهمّ جانب تربوي بالنسبة إليك؟)" value="${esc(q)}">
        <button type="button" class="btn small ghost pl-qrm" title="حذف السؤال">✕</button></div>
      <div class="pl-qopts">${opts.map((o, k) => `<div class="pl-qo-row"><span style="--c:${CHOICE_COLORS[k]}">${CHOICE_MARKS[k]}</span><input class="pl-qo" maxlength="80" placeholder="اختيار ${k + 1}" value="${esc(o)}"></div>`).join('')}</div>
      <button type="button" class="btn small ghost pl-qadd">+ اختيار</button></div>`;
    const qs = $('#pl-qs');
    qs.innerHTML = qBlock('أهمّ جانب تربوي بالنسبة إليك؟', ['الصلاة', 'الأخلاق', 'المسؤولية']);
    const renumber = (b) => b.querySelectorAll('.pl-qo-row').forEach((r, k) => {
      r.querySelector('span').textContent = CHOICE_MARKS[k];
      r.querySelector('span').style.setProperty('--c', CHOICE_COLORS[k]);
    });
    $('#pl-addq').addEventListener('click', () => qs.insertAdjacentHTML('beforeend', qBlock('', ['', ''])));
    qs.addEventListener('click', (e) => {
      const b = e.target.closest('.pl-qb');
      if (e.target.closest('.pl-qrm')) {
        if (qs.children.length > 1) b.remove();
        return;
      }
      if (e.target.closest('.pl-qadd')) {
        const n = b.querySelectorAll('.pl-qo-row').length;
        if (n >= 5) return toast('5 اختيارات على الأقصى', true);
        b.querySelector('.pl-qopts').insertAdjacentHTML('beforeend', `<div class="pl-qo-row"><span>${CHOICE_MARKS[n]}</span><input class="pl-qo" maxlength="80" placeholder="اختيار ${n + 1}"></div>`);
        renumber(b);
      }
    });
    document.querySelectorAll('input[name=kind]').forEach((r) =>
      r.addEventListener('change', () => {
        const choice = document.querySelector('input[name=kind]:checked').value === 'choice';
        $('#pl-choice').hidden = !choice;
        $('#pl-rating').hidden = choice;
        const t = document.querySelector('#modal-body input[name=title]');
        if (choice && /تقييم/.test(t.value)) t.value = 'سبر آراء الأولياء';
      })
    );
  });
}

// نتائج سؤال: نسبة كل اختيار بوضوح (من الذين أجابوا فقط)
function pollOptions(c, scale, big = false) {
  if (!c.n) return '<p class="pl-wait">⏳ بانتظار الأصوات…</p>';
  if (c.options) {
    const top = Math.max(...c.counts);
    return `<div class="pl-opts choice ${big ? 'big' : ''}">${c.options
      .map(
        (o, k) => `<div class="pl-opt ${c.counts[k] === top && top ? 'top' : ''}" style="--c:${CHOICE_COLORS[k]}">
          <span class="pl-ol"><i class="pl-mark">${CHOICE_MARKS[k]}</i>${esc(o)}</span>
          <span class="pl-ob"><i style="width:${c.pct[k]}%"></i></span>
          <b class="pl-op">${c.pct[k]}%</b><small class="pl-oc">${c.counts[k]}</small></div>`
      )
      .join('')}</div>
      <div class="pl-qfoot"><span>👥 ${c.n} ${c.n > 1 ? 'إجابات' : 'إجابة'}</span>${top ? `<span>🏆 الأكثر اختيارًا: <b>${esc(c.options[c.counts.indexOf(top)])}</b></span>` : ''}</div>`;
  }
  const top = Math.max(...scale.map((s) => c.counts[s.key]));
  return `<div class="pl-opts ${big ? 'big' : ''}">${scale
    .map(
      (s) => `<div class="pl-opt ${c.counts[s.key] === top && top ? 'top' : ''}" style="--c:${POLL_COLORS[s.key]}">
        <span class="pl-ol">${POLL_EMOJI[s.key]} ${esc(s.label)}</span>
        <span class="pl-ob"><i style="width:${c.pct[s.key]}%"></i></span>
        <b class="pl-op">${c.pct[s.key]}%</b><small class="pl-oc">${c.counts[s.key]}</small></div>`
    )
    .join('')}</div>
    <div class="pl-qfoot"><span>👥 ${c.n} ${c.n > 1 ? 'إجابات' : 'إجابة'}</span><span>⭐ ${c.avg.toFixed(1)}/5</span>
      <span class="pl-sat" style="--c:${c.satisfied >= 70 ? '#0f9d58' : c.satisfied >= 50 ? '#f4b400' : '#db4437'}">${c.satisfied}% راضون</span></div>`;
}

// شاشة العرض: QR + النتائج تتحدّث كل ثانيتين
async function viewPollLive(el, id) {
  let data = await api('GET', `/api/polls/${id}/results`);
  const url = voteUrl(data.poll.code);
  const step = () => data.poll.mode === 'step';
  el.innerHTML = `
    <div class="pl-live">
      <div class="pl-top">
        <a href="#/polls" class="muted small">→ كل التصويتات</a>
        <div class="pl-actions">
          <button class="btn small ghost" id="pl-csv">📥 تصدير النتائج</button>
          <button class="btn small ghost" id="pl-full">⛶ ملء الشاشة</button>
          <button class="btn small ghost" id="pl-toggle"></button>
          <button class="btn small ghost danger" id="pl-del">🗑</button>
        </div>
      </div>
      <h2 class="pl-title">${esc(data.poll.title)}</h2>
      <div class="pl-grid">
        <aside class="pl-qr card">
          <div class="pl-qr-img">${qrSvg(url)}</div>
          <p class="pl-scan">📱 امسح الرمز وصوّت</p>
          <p class="pl-url" dir="ltr">${esc(url.replace(/^https?:\/\//, ''))}</p>
          <div class="pl-count"><b id="pl-n">0</b><span>مشارك</span></div>
          <div class="pl-overall" id="pl-overall"></div>
          <p class="muted small">🔒 مجهول الهوية · تحديث مباشر</p>
        </aside>
        <section class="pl-results" id="pl-main"></section>
      </div>
      <div id="pl-comments"></div>
    </div>`;
  const draw = () => {
    $('#pl-n').textContent = data.votes;
    $('#pl-toggle').textContent = data.poll.active ? '⏹ إغلاق التصويت' : '▶ إعادة فتح التصويت';
    $('#pl-overall').innerHTML = data.overall ? `<span>المعدّل العام</span><b>${data.overall.toFixed(2)}<small>/5</small></b>` : '';
    const main = $('#pl-main');
    if (step()) {
      const cur = data.poll.current;
      const total = data.criteria.length;
      const c = cur === null ? null : data.criteria[cur];
      main.innerHTML = `
        <div class="pl-ctrl card">
          <button class="btn ghost" data-go="prev" ${cur === null || cur === 0 ? 'disabled' : ''}>→ السابق</button>
          <div class="pl-steps">${data.criteria.map((x, k) => `<button class="pl-dot ${k === cur ? 'on' : ''} ${x.n ? 'done' : ''}" data-go="${k}" title="${esc(x.name)}">${k + 1}</button>`).join('')}</div>
          ${cur === null ? '<button class="btn" data-go="0">▶ ابدأ بالسؤال 1</button>' : cur < total - 1 ? '<button class="btn" data-go="next">السؤال الموالي ←</button>' : '<button class="btn" data-go="end">🏁 إنهاء الأسئلة</button>'}
        </div>
        ${
          c
            ? `<div class="card pl-now"><div class="pl-now-head"><span class="pl-now-n">السؤال ${cur + 1} / ${total}</span><span class="pl-live-dot">● مباشر</span></div>
                <h3>${esc(c.name)}</h3>${pollOptions(c, data.scale, true)}</div>`
            : `<div class="card pl-now pl-idle"><div class="pl-big">${data.criteria.some((x) => x.n) ? '🏁' : '⏳'}</div>
                <h3>${data.criteria.some((x) => x.n) ? 'انتهت الأسئلة: ملخّص النتائج تحت' : 'الأولياء في الانتظار: اضغط «ابدأ» لعرض السؤال الأوّل'}</h3></div>`
        }
        <h4 class="pl-sum-title">📊 ملخّص كل الأسئلة</h4>
        <div class="pl-cards small">${data.criteria.map((x, k) => `<div class="card pl-card ${k === cur ? 'now' : ''}"><h4><span>${k + 1}</span>${esc(x.name)}</h4>${pollOptions(x, data.scale)}</div>`).join('')}</div>`;
      main.querySelectorAll('[data-go]').forEach((b) =>
        b.addEventListener('click', async () => {
          const g = b.dataset.go;
          const nextCur = g === 'prev' ? cur - 1 : g === 'next' ? cur + 1 : g === 'end' ? null : Number(g);
          try {
            await api('PATCH', `/api/polls/${id}`, { current: nextCur });
            data.poll.current = nextCur;
            draw();
          } catch (err) {
            toast(err.message, true);
          }
        })
      );
    } else {
      main.innerHTML = `<div class="pl-cards">${data.criteria.map((x, k) => `<div class="card pl-card"><h4><span>${k + 1}</span>${esc(x.name)}</h4>${pollOptions(x, data.scale)}</div>`).join('')}</div>`;
    }
    $('#pl-comments').innerHTML = data.comments.length
      ? `<div class="card"><h4>💬 ملاحظات الأولياء (${data.comments.length})</h4><ul class="pl-cm">${data.comments.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul></div>`
      : '';
  };
  draw();
  const timer = setInterval(async () => {
    if (!location.hash.startsWith(`#/polls/${id}`)) return clearInterval(timer);
    try {
      data = await api('GET', `/api/polls/${id}/results`);
      draw();
    } catch {}
  }, 2000);
  $('#pl-full').addEventListener('click', () => {
    const box = el.querySelector('.pl-live');
    document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen?.().catch(() => {});
  });
  // تصدير النتائج (Excel يفتح CSV) للإحصائيات واتّخاذ القرار
  $('#pl-csv').addEventListener('click', () => {
    const choice = data.poll.kind === 'choice';
    const head = choice ? ['السؤال', 'عدد الإجابات', 'الاختيار', 'العدد', '%'] : ['السؤال', 'عدد الإجابات', 'المعدّل /5', 'نسبة الرضا %', ...data.scale.flatMap((s) => [`${s.label} (عدد)`, `${s.label} %`])];
    const rows = choice
      ? data.criteria.flatMap((c) => c.options.map((o, k) => [k ? '' : c.name, k ? '' : c.n, o, c.counts[k], c.pct[k]]))
      : data.criteria.map((c) => [c.name, c.n, c.avg ?? '', c.satisfied ?? '', ...data.scale.flatMap((s) => [c.counts[s.key], c.pct[s.key]])]);
    const csv = [head, ...rows, [], ['المشاركون', data.votes], ['المعدّل العام', data.overall ?? ''], [], ['الملاحظات'], ...data.comments.map((c) => [c.text])]
      .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `تصويت-${data.poll.code}.csv`;
    a.click();
  });
  $('#pl-toggle').addEventListener('click', async () => {
    await api('PATCH', `/api/polls/${id}`, { active: !data.poll.active });
    data.poll.active = !data.poll.active;
    draw();
    toast(data.poll.active ? 'التصويت مفتوح' : 'تمّ إغلاق التصويت');
  });
  $('#pl-del').addEventListener('click', async () => {
    if (!confirmAction('حذف هذا التصويت وكل أصواته نهائيًا؟')) return;
    await api('DELETE', `/api/polls/${id}`);
    location.hash = '#/polls';
  });
}

// أزرار الإجابة للوليّ: سلّم التقييم أو اختيارات سبر الآراء
function voteButtons(poll, scale, i, mine) {
  if (poll.kind === 'choice')
    return `<div class="vote-choices">${(poll.options?.[i] || [])
      .map((o, k) => `<button type="button" data-k="${k}" style="--c:${CHOICE_COLORS[k]}" class="${String(mine) === String(k) ? 'on' : ''}"><i>${CHOICE_MARKS[k]}</i><span>${esc(o)}</span></button>`)
      .join('')}</div>`;
  return `<div class="vote-scale">${scale
    .map((s) => `<button type="button" data-k="${s.key}" style="--c:${POLL_COLORS[s.key]}" class="${mine === s.key ? 'on' : ''}"><b>${s.score}</b><em>${POLL_EMOJI[s.key]}</em><small>${s.label}</small></button>`)
    .join('')}</div>`;
}

// ---------- صفحة الولي (دون حساب) ----------
function voteDevice() {
  try {
    let d = localStorage.getItem('feedVoteDevice');
    if (!d) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      d = [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('feedVoteDevice', d);
    }
    return d;
  } catch {
    return [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
}
const voteMemo = {
  get(code) {
    try {
      return JSON.parse(localStorage.getItem(`feedVote:${code}`) || 'null');
    } catch {
      return null;
    }
  },
  set(code, v) {
    try {
      localStorage.setItem(`feedVote:${code}`, JSON.stringify(v));
    } catch {}
  },
};

async function viewVote(el, code) {
  el.innerHTML = '<div class="vote-page"><p class="muted">جاري التحميل…</p></div>';
  let poll;
  let scale;
  try {
    ({ poll, scale } = await api('GET', `/api/public/polls/${code}`));
  } catch (err) {
    el.innerHTML = `<div class="vote-page"><div class="vote-card"><h2>🗳️</h2><p>${esc(err.message)}</p></div></div>`;
    return;
  }
  const saved = voteMemo.get(code);
  const answers = { ...(saved?.answers || {}) };
  const done = () => {
    el.innerHTML = `<div class="vote-page"><div class="vote-card vote-thanks">
        <div class="vote-big">🙏</div><h2>${poll.kind === 'choice' ? 'شكرًا على مشاركتك!' : 'شكرًا على تقييمك!'}</h2>
        <p>رأيك يساعدنا على التحسّن. تقييمك مجهول الهوية تمامًا.</p>
        ${poll.active ? '<button class="vote-btn ghost" id="v-edit">✏️ تعديل تقييمي</button>' : ''}
        <img src="feed-logo.png" alt="فيد" class="vote-logo"></div></div>`;
    $('#v-edit')?.addEventListener('click', form);
  };
  const form = () => {
    if (!poll.active) {
      el.innerHTML = `<div class="vote-page"><div class="vote-card"><div class="vote-big">⏹</div><h2>${esc(poll.title)}</h2><p>التصويت مغلق حاليًا. شكرًا لكم.</p></div></div>`;
      return;
    }
    el.innerHTML = `
      <div class="vote-page">
        <header class="vote-head"><img src="feed-logo-white.png" alt="فيد"><h1>${esc(poll.title)}</h1>
          <p>${poll.kind === 'choice' ? 'اختر إجابتك لكل سؤال' : 'قيّم كل محور من 1 إلى 5'} · 🔒 مجهول الهوية</p>
          <div class="vote-progress"><i id="v-prog"></i></div><small id="v-count"></small></header>
        <div class="vote-list">${poll.criteria
          .map(
            (c, i) => `<section class="vote-card vote-q" data-i="${i}"><h3><span>${i + 1}</span>${esc(c)}</h3>
              ${voteButtons(poll, scale, i, answers[i])}</section>`
          )
          .join('')}
          ${poll.allow_comment ? `<section class="vote-card"><h3>💬 ملاحظة أو اقتراح (اختياري)</h3><textarea id="v-comment" rows="3" maxlength="500" placeholder="اكتب ما تريد…">${esc(saved?.comment || '')}</textarea></section>` : ''}
        </div>
        <div class="vote-send"><button class="vote-btn" id="v-send">${poll.kind === 'choice' ? 'إرسال إجاباتي ✓' : 'إرسال تقييمي ✓'}</button></div>
      </div>`;
    const progress = () => {
      const n = Object.keys(answers).length;
      $('#v-prog').style.width = `${(n / poll.criteria.length) * 100}%`;
      $('#v-count').textContent = `${n} / ${poll.criteria.length}`;
    };
    progress();
    el.querySelectorAll('.vote-q').forEach((q) =>
      q.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-k]');
        if (!b) return;
        answers[q.dataset.i] = b.dataset.k;
        q.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        q.classList.add('answered');
        progress();
        // الانتقال تلقائيًا إلى المحور التالي غير المقيَّم
        const next = [...el.querySelectorAll('.vote-q')].find((x) => !answers[x.dataset.i]);
        if (next) setTimeout(() => next.scrollIntoView({ behavior: 'smooth', block: 'center' }), 180);
      })
    );
    $('#v-send').addEventListener('click', async (e) => {
      const missing = poll.criteria.length - Object.keys(answers).length;
      if (!Object.keys(answers).length) return toast('قيّم محورًا واحدًا على الأقل', true);
      if (missing && !confirmAction(`لم تقيّم ${missing} محور(ا). إرسال التقييم كما هو؟`)) return;
      e.currentTarget.disabled = true;
      try {
        const comment = $('#v-comment')?.value || '';
        await api('POST', `/api/public/polls/${code}/vote`, { device: voteDevice(), answers, comment });
        voteMemo.set(code, { answers, comment });
        done();
        window.scrollTo(0, 0);
      } catch (err) {
        toast(err.message, true);
        e.currentTarget.disabled = false;
      }
    });
  };
  if (poll.mode === 'step') return voteStep(el, code, poll, scale);
  saved ? done() : form();
}

// سؤال بسؤال: يظهر للوليّ السؤال الذي يعرضه المدير الآن، ويتجدّد وحده
async function voteStep(el, code, poll, scale) {
  const memo = voteMemo.get(code) || { answers: {} };
  memo.answers ||= {};
  let shown = undefined;
  let commentSent = !!memo.comment;
  const render = () => {
    if (!poll.active) {
      el.innerHTML = `<div class="vote-page"><div class="vote-card vote-thanks"><div class="vote-big">🙏</div><h2>${esc(poll.title)}</h2><p>انتهى التصويت. شكرًا على مشاركتكم!</p><img src="feed-logo.png" alt="فيد" class="vote-logo"></div></div>`;
      return;
    }
    const i = poll.current;
    if (i === null || i === undefined) {
      const answered = Object.keys(memo.answers).length;
      el.innerHTML = `<div class="vote-page"><header class="vote-head"><img src="feed-logo-white.png" alt="فيد"><h1>${esc(poll.title)}</h1><p>🔒 مجهول الهوية</p></header>
        <div class="vote-card vote-wait"><div class="vote-big pulse">⏳</div><h2>${answered ? 'شكرًا! انتظر السؤال الموالي' : 'انتظر، سيظهر السؤال على هاتفك'}</h2>
          <p class="muted">لا تغلق هذه الصفحة: الأسئلة تظهر هنا وحدها.</p></div>
        ${poll.allow_comment ? `<div class="vote-card"><h3>💬 ملاحظة أو اقتراح (اختياري)</h3><textarea id="v-comment" rows="3" maxlength="500" placeholder="اكتب ما تريد…">${esc(memo.comment || '')}</textarea>
          <button class="vote-btn" id="v-csend">${commentSent ? '✓ أُرسلت · تعديل' : 'إرسال الملاحظة'}</button></div>` : ''}</div>`;
      $('#v-csend')?.addEventListener('click', async () => {
        const comment = $('#v-comment').value.trim();
        if (!comment) return toast('اكتب ملاحظتك', true);
        try {
          await api('POST', `/api/public/polls/${code}/vote`, { device: voteDevice(), answers: {}, comment });
          memo.comment = comment;
          commentSent = true;
          voteMemo.set(code, memo);
          toast('✓ شكرًا، أُرسلت ملاحظتك');
          render();
        } catch (err) {
          toast(err.message, true);
        }
      });
      return;
    }
    const mine = memo.answers[i];
    el.innerHTML = `<div class="vote-page"><header class="vote-head"><img src="feed-logo-white.png" alt="فيد"><h1>${esc(poll.title)}</h1>
        <p>السؤال ${i + 1} من ${poll.criteria.length} · 🔒 مجهول الهوية</p></header>
      <section class="vote-card vote-q vote-one ${mine ? 'answered' : ''}"><h3><span>${i + 1}</span>${esc(poll.criteria[i])}</h3>
        ${voteButtons(poll, scale, i, mine)}
        ${mine ? '<p class="vote-ok">✓ تمّ تسجيل رأيك · يمكنك تغييره ما دام السؤال معروضًا</p>' : ''}</section></div>`;
    el.querySelectorAll('[data-k]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await api('POST', `/api/public/polls/${code}/vote`, { device: voteDevice(), answers: { [i]: b.dataset.k } });
          memo.answers[i] = b.dataset.k;
          voteMemo.set(code, memo);
          try {
            navigator.vibrate?.(20);
          } catch {}
          render();
        } catch (err) {
          toast(err.message, true);
        }
      })
    );
  };
  render();
  shown = poll.current;
  const timer = setInterval(async () => {
    if (!document.body.contains(el) || !location.pathname.includes(code) && !location.hash.includes(code)) return clearInterval(timer);
    try {
      const r = await api('GET', `/api/public/polls/${code}`);
      const changed = r.poll.current !== shown || r.poll.active !== poll.active;
      poll = r.poll;
      if (changed && !(document.activeElement && document.activeElement.id === 'v-comment')) {
        shown = poll.current;
        render();
        window.scrollTo(0, 0);
      }
    } catch {}
  }, 2500);
}
