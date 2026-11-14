// ---------- 🗳️ تصويت مباشر للأولياء ----------
// الإدارة: #/polls (إنشاء) و #/polls/:id (شاشة العرض: QR + نتائج حيّة)
// الأولياء: #/vote/:code — دون حساب، مجهول الهوية

const POLL_COLORS = { excellent: '#0f9d58', very_good: '#7cb342', average: '#f4b400', below: '#f57c00', weak: '#db4437' };
const POLL_EMOJI = { excellent: '🤩', very_good: '🙂', average: '😐', below: '🙁', weak: '😞' };
const voteUrl = (code) => `${location.origin}/vote/${code}`;
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
      <p class="muted">للاجتماعات: اعرض رمز QR على الشاشة، يمسحه الأولياء ويقيّمون من هواتفهم دون حساب وبصفة مجهولة، والنتائج تظهر مباشرة.</p></div>
      <button class="btn" id="pl-new">+ تصويت جديد</button></div>
    ${
      polls.length
        ? `<div class="pl-list">${polls
            .map(
              (p) => `<a class="card pl-item" href="#/polls/${p.id}">
                <div><b>${esc(p.title)}</b><div class="muted small">${fmtDate(String(p.created_at).slice(0, 10))} · ${p.criteria.length} محاور · رمز ${p.code}</div></div>
                <div class="pl-meta"><span class="pl-votes">${p.votes}<small>صوت</small></span>
                  <span class="badge ${p.active ? 'excellent' : 'general'}">${p.active ? '🟢 مفتوح' : '⏹ مغلق'}</span></div></a>`
            )
            .join('')}</div>`
        : '<div class="card empty-state"><span>🗳️</span><p>لا يوجد تصويت بعد. أنشئ أوّل تصويت لاجتماعك!</p></div>'
    }`;
  $('#pl-new').addEventListener('click', () =>
    openModal(
      '🗳️ تصويت جديد',
      `<label>العنوان<input name="title" required maxlength="150" value="اجتماع أولياء الإعدادي — تقييم فيد"></label>
       <label>محاور التقييم (محور في كل سطر)<textarea name="criteria" rows="10" required>${esc(defaults.join('\n'))}</textarea></label>
       <p class="muted small">سلّم التقييم من 1 إلى 5: 5 ممتاز · 4 جيد · 3 متوسط · 2 دون المتوسط · 1 ضعيف. التصويت مجهول الهوية تمامًا.</p>
       <label class="check"><input type="checkbox" name="allow_comment" checked> السماح بملاحظة مكتوبة (اختيارية)</label>`,
      async (d) => {
        const { poll } = await api('POST', '/api/polls', { title: d.title, criteria: d.criteria, allow_comment: !!d.allow_comment });
        location.hash = `#/polls/${poll.id}`;
      }
    )
  );
}

// شاشة العرض: QR + النتائج تتحدّث كل 3 ثوانٍ
async function viewPollLive(el, id) {
  let data = await api('GET', `/api/polls/${id}/results`);
  const url = voteUrl(data.poll.code);
  el.innerHTML = `
    <div class="pl-live">
      <div class="pl-top">
        <a href="#/polls" class="muted small">→ كل التصويتات</a>
        <div class="pl-actions">
          <button class="btn small ghost" id="pl-full">⛶ ملء الشاشة</button>
          <button class="btn small ghost" id="pl-toggle"></button>
          <button class="btn small ghost danger" id="pl-del">🗑</button>
        </div>
      </div>
      <h2 class="pl-title">${esc(data.poll.title)}</h2>
      <div class="pl-grid">
        <aside class="pl-qr card">
          <div class="pl-qr-img">${qrSvg(url)}</div>
          <p class="pl-scan">📱 امسح الرمز وقيّم</p>
          <p class="pl-url" dir="ltr">${esc(url.replace(/^https?:\/\//, ''))}</p>
          <div class="pl-count"><b id="pl-n">0</b><span>صوت</span></div>
          <div class="pl-overall" id="pl-overall"></div>
          <p class="muted small">🔒 مجهول الهوية · تحديث مباشر</p>
        </aside>
        <section class="pl-results card">
          <div class="pl-legend">${data.scale.map((s) => `<span><i style="background:${POLL_COLORS[s.key]}"></i>${s.score} ${s.label}</span>`).join('')}</div>
          <div id="pl-rows"></div>
          <div id="pl-comments"></div>
        </section>
      </div>
    </div>`;
  const draw = () => {
    $('#pl-n').textContent = data.votes;
    $('#pl-toggle').textContent = data.poll.active ? '⏹ إغلاق التصويت' : '▶ إعادة فتح التصويت';
    $('#pl-overall').innerHTML = data.overall
      ? `<span>المعدّل العام</span><b>${data.overall.toFixed(2)}<small>/5</small></b>`
      : '';
    $('#pl-rows').innerHTML = data.criteria
      .map((c) => {
        const bars = c.n
          ? data.scale
              .filter((s) => c.counts[s.key])
              .map((s) => {
                const pct = (c.counts[s.key] / c.n) * 100;
                return `<i style="width:${pct}%;background:${POLL_COLORS[s.key]}" title="${s.label}: ${c.counts[s.key]}">${pct >= 9 ? Math.round(pct) + '%' : ''}</i>`;
              })
              .join('')
          : '<em>بانتظار الأصوات…</em>';
        return `<div class="pl-row"><div class="pl-row-head"><b>${esc(c.name)}</b>
            ${c.n ? `<span class="pl-sat" style="--c:${c.satisfied >= 70 ? '#0f9d58' : c.satisfied >= 50 ? '#f4b400' : '#db4437'}">${c.satisfied}% راضون</span><span class="muted small">${c.avg.toFixed(1)}/5 · ${c.n} صوت</span>` : ''}</div>
          <div class="pl-bar">${bars}</div></div>`;
      })
      .join('');
    $('#pl-comments').innerHTML = data.comments.length
      ? `<h4>💬 ملاحظات الأولياء (${data.comments.length})</h4><ul class="pl-cm">${data.comments.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul>`
      : '';
  };
  draw();
  const timer = setInterval(async () => {
    if (!location.hash.startsWith(`#/polls/${id}`)) return clearInterval(timer);
    try {
      data = await api('GET', `/api/polls/${id}/results`);
      draw();
    } catch {}
  }, 3000);
  $('#pl-full').addEventListener('click', () => {
    const box = el.querySelector('.pl-live');
    document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen?.().catch(() => {});
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
        <div class="vote-big">🙏</div><h2>شكرًا على تقييمك!</h2>
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
          <p>قيّم كل محور من 1 إلى 5 · 🔒 مجهول الهوية</p>
          <div class="vote-progress"><i id="v-prog"></i></div><small id="v-count"></small></header>
        <div class="vote-list">${poll.criteria
          .map(
            (c, i) => `<section class="vote-card vote-q" data-i="${i}"><h3><span>${i + 1}</span>${esc(c)}</h3>
              <div class="vote-scale">${scale
                .map((s) => `<button type="button" data-k="${s.key}" style="--c:${POLL_COLORS[s.key]}" class="${answers[i] === s.key ? 'on' : ''}"><b>${s.score}</b><em>${POLL_EMOJI[s.key]}</em><small>${s.label}</small></button>`)
                .join('')}</div></section>`
          )
          .join('')}
          ${poll.allow_comment ? `<section class="vote-card"><h3>💬 ملاحظة أو اقتراح (اختياري)</h3><textarea id="v-comment" rows="3" maxlength="500" placeholder="اكتب ما تريد…">${esc(saved?.comment || '')}</textarea></section>` : ''}
        </div>
        <div class="vote-send"><button class="vote-btn" id="v-send">إرسال تقييمي ✓</button></div>
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
  saved ? done() : form();
}
