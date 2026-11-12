// ---------- 🏆 ركن التحدّي (gamification) ----------
// كل شيء هنا مستقلّ: أيقونة 🏆 في الأعلى ← #/arena. الإدارة تدخل بنك الأسئلة، التلميذ يلعب من حساب وليّه.

const GAME_KIND_LABELS = { mcq: '🔘 اختيار من متعدّد', truefalse: '✅ صحيح أم خطأ', order: '↕️ ترتيب', match: '🔗 ربط (سحب وإفلات)' };
const GAME_COLORS = ['#7c3aed', '#ef207a', '#0ea5e9', '#f59e0b', '#10b981', '#6366f1'];
const gameState = { kid: null, board: 'week', tab: 'board', adminTab: 'overview', level: null, qLevel: '', qSubject: '', qKind: '' };

// أصوات خفيفة (يمكن إيقافها)
const gameSound = (() => {
  let ctx = null;
  const muted = () => {
    try {
      return localStorage.getItem('gameMute') === '1';
    } catch {
      return false;
    }
  };
  const tone = (freq, t0, dur, type = 'sine', vol = 0.12) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + t0);
    o.stop(ctx.currentTime + t0 + dur);
  };
  const play = (notes) => {
    if (muted()) return;
    try {
      ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      notes.forEach((n) => tone(...n));
    } catch {}
  };
  return {
    muted,
    toggle() {
      try {
        localStorage.setItem('gameMute', muted() ? '0' : '1');
      } catch {}
      return muted();
    },
    good: () => play([[660, 0, 0.12], [880, 0.1, 0.18]]),
    bad: () => play([[220, 0, 0.25, 'square', 0.06]]),
    win: () => play([[523, 0, 0.15], [659, 0.12, 0.15], [784, 0.24, 0.15], [1047, 0.36, 0.35]]),
    tick: () => play([[1200, 0, 0.04, 'sine', 0.04]]),
  };
})();

const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`);
const starRow = (n, max = 3) => `<span class="g-stars">${'★'.repeat(n)}<i>${'★'.repeat(Math.max(0, max - n))}</i></span>`;

function boardList(rows, empty = 'لا أحد بعد — كن الأوّل! 🚀') {
  if (!rows?.length) return `<p class="muted g-empty">${empty}</p>`;
  return `<ol class="g-board">${rows
    .map(
      (r) => `<li class="${r.me ? 'me' : ''} ${r.rank <= 3 ? 'top' : ''}"><span class="g-rank">${medal(r.rank)}</span>
        <span class="g-ini">${esc((r.name || '?')[0])}</span><b>${esc(r.name)}${r.me ? ' <small>(أنت)</small>' : ''}</b>
        <span class="g-pts">${r.points} <small>نقطة</small></span></li>`
    )
    .join('')}</ol>`;
}

async function viewArena(el) {
  const kid = gameState.kid ? `?student_id=${gameState.kid}` : '';
  const isAdmin = state.user.role === 'admin';
  const hub = await api('GET', '/api/game/hub' + (isAdmin ? `?level=${encodeURIComponent(gameState.level || '')}` : kid));
  if (isAdmin) return arenaAdmin(el, hub);
  if (!hub.kids.length) {
    el.innerHTML = `<div class="arena"><div class="g-hero"><h2>🏆 ركن التحدّي</h2><p>ركن التحدّي متاح لتلاميذ دروس الدعم.</p></div></div>`;
    return;
  }
  const s = hub.stats;
  gameState.kid = hub.student.id;
  const earned = hub.badges.filter((b) => b.earned).length;
  el.innerHTML = `
    <div class="arena">
      <div class="g-hero">
        <div class="g-hero-top">
          <div><small>🏆 ركن التحدّي</small><h2>${esc(hub.student.full_name)}</h2><span class="g-level">${esc(hub.level_label)}</span></div>
          <button class="g-icon-btn" id="g-mute" title="الصوت">${gameSound.muted() ? '🔇' : '🔊'}</button>
        </div>
        ${hub.kids.length > 1 ? `<div class="g-kids">${hub.kids.map((k) => `<button class="g-kid ${k.id === hub.student.id ? 'on' : ''}" data-kid="${k.id}">${esc(k.full_name.split(' ')[0])}</button>`).join('')}</div>` : ''}
        <div class="g-tiles">
          <div class="g-tile"><b>${s.points}</b><span>⭐ نقاطي</span></div>
          <div class="g-tile"><b>${s.rank_week ? medal(s.rank_week) : '—'}</b><span>🏆 ترتيبي هذا الأسبوع</span></div>
          <div class="g-tile"><b>${s.stars}</b><span>🌟 النجوم</span></div>
          <div class="g-tile"><b>${s.best_streak}</b><span>🔥 أطول سلسلة</span></div>
        </div>
      </div>
      <div class="g-play-card">
        ${
          hub.total_questions
            ? `<p class="g-play-title">جاهز للتحدّي؟ ${Math.min(10, hub.total_questions)} أسئلة، أسرع = نقاط أكثر ⚡</p>
               <div class="g-subjects"><button class="g-subj on" data-subj="">🎲 كل المواد</button>${hub.subjects
                 .map((x) => `<button class="g-subj" data-subj="${x.id}">${esc(x.name)} <small>${x.count}</small></button>`)
                 .join('')}</div>
               <button class="g-play-btn" id="g-start">▶ ابدأ الجولة</button>`
            : '<p class="g-play-title">⏳ الأسئلة في الطريق… الإدارة تحضّر تحدّيات قسمك قريبًا.</p>'
        }
      </div>
      <div class="g-tabs">
        <button data-tab="board" class="${gameState.tab === 'board' ? 'on' : ''}">🏆 الترتيب</button>
        <button data-tab="badges" class="${gameState.tab === 'badges' ? 'on' : ''}">🎖️ الشارات <small>${earned}/${hub.badges.length}</small></button>
        <button data-tab="recent" class="${gameState.tab === 'recent' ? 'on' : ''}">🕘 جولاتي</button>
      </div>
      <div class="g-panel" id="g-panel"></div>
    </div>`;
  const panel = () => {
    const p = $('#g-panel');
    if (gameState.tab === 'board') {
      p.innerHTML = `<div class="g-seg"><button data-b="week" class="${gameState.board === 'week' ? 'on' : ''}">هذا الأسبوع</button><button data-b="all" class="${gameState.board === 'all' ? 'on' : ''}">منذ البداية</button></div>
        ${boardList(hub.leaderboard[gameState.board])}
        <p class="muted small">ترتيب ${esc(hub.level_label)} · يتجدّد ترتيب الأسبوع كل اثنين.</p>`;
      p.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => ((gameState.board = b.dataset.b), panel())));
    } else if (gameState.tab === 'badges') {
      p.innerHTML = `<div class="g-badges">${hub.badges
        .map((b) => `<div class="g-badge ${b.earned ? 'on' : ''}"><span>${b.earned ? b.icon : '🔒'}</span><b>${esc(b.label)}</b><small>${esc(b.desc)}</small></div>`)
        .join('')}</div>`;
    } else {
      p.innerHTML = hub.recent.length
        ? `<ul class="g-recent">${hub.recent
            .map((r) => `<li>${starRow(r.stars || 0)}<b>${r.score} نقطة</b><span>${r.correct_count}/${r.total} صحيحة · 🔥 ${r.best_streak}</span><small>${fmtTime(r.finished_at)}</small></li>`)
            .join('')}</ul>`
        : '<p class="muted g-empty">لم تلعب أي جولة بعد.</p>';
    }
  };
  panel();
  el.querySelectorAll('.g-tabs [data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      gameState.tab = b.dataset.tab;
      el.querySelectorAll('.g-tabs [data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      panel();
    })
  );
  el.querySelectorAll('[data-kid]').forEach((b) => b.addEventListener('click', () => ((gameState.kid = Number(b.dataset.kid)), viewArena(el))));
  let subj = '';
  el.querySelectorAll('[data-subj]').forEach((b) =>
    b.addEventListener('click', () => {
      subj = b.dataset.subj;
      el.querySelectorAll('[data-subj]').forEach((x) => x.classList.toggle('on', x === b));
    })
  );
  $('#g-mute').addEventListener('click', (e) => (e.currentTarget.textContent = gameSound.toggle() ? '🔇' : '🔊'));
  $('#g-start')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api('POST', '/api/game/sessions', { student_id: hub.student.id, subject_id: subj || null });
      location.hash = `#/arena/play/${r.id}`;
    } catch (err) {
      toast(err.message, true);
      e.currentTarget.disabled = false;
    }
  });
}

// ---------- اللعب ----------
async function viewArenaPlay(el, id) {
  el.innerHTML = '<div class="g-stage"><div class="g-loading">🎮</div></div>';
  const stage = el.querySelector('.g-stage');
  document.body.classList.add('g-playing');
  const leave = () => {
    document.body.classList.remove('g-playing');
    window.removeEventListener('hashchange', onHash);
  };
  const onHash = () => leave();
  window.addEventListener('hashchange', onHash);
  let timer = null;
  let total = 0;

  const header = (n) => `
    <div class="g-top">
      <a href="#/arena" class="g-icon-btn" title="خروج">✕</a>
      <div class="g-progress">${Array.from({ length: n.total }, (_, i) => `<i class="${i < n.index ? 'done' : i === n.index ? 'now' : ''}"></i>`).join('')}</div>
      <div class="g-score"><span class="g-flame ${n.streak >= 2 ? 'hot' : ''}">🔥 ${n.streak}</span><b id="g-score">${n.score}</b></div>
    </div>
    <div class="g-timer"><i id="g-bar"></i></div>`;

  async function next() {
    clearInterval(timer);
    const n = await api('GET', `/api/game/sessions/${id}/next`);
    if (n.done) return finish(n);
    total = n.total;
    const q = n.question;
    stage.innerHTML = `${header(n)}
      <div class="g-qcard g-pop">
        <div class="g-qmeta"><span>${n.index + 1} / ${n.total}</span><span>${GAME_KIND_LABELS[q.kind]}</span><span>+${q.points}</span></div>
        <h3 class="g-prompt">${esc(q.prompt)}</h3>
        <div id="g-answer"></div>
      </div>`;
    const area = $('#g-answer');
    let sent = false;
    const send = async (answer, timeout = false) => {
      if (sent) return;
      sent = true;
      clearInterval(timer);
      stage.querySelectorAll('button, .g-drag').forEach((b) => b.classList.add('locked'));
      try {
        const r = await api('POST', `/api/game/sessions/${id}/answer`, { answer, timeout });
        feedback(q, r, answer);
      } catch (err) {
        toast(err.message, true);
        next();
      }
    };
    // العدّاد: الوقت الحقيقي يحسبه الخادم، هذا للعرض فقط
    const limit = q.time_limit * 1000;
    const end = Date.now() + n.remaining_ms;
    const bar = $('#g-bar');
    const draw = () => {
      const left = Math.max(0, end - Date.now());
      bar.style.width = `${(left / limit) * 100}%`;
      bar.classList.toggle('low', left < 5000);
      if (left <= 0) send(null, true);
    };
    draw();
    timer = setInterval(draw, 100);

    if (q.kind === 'mcq') {
      area.innerHTML = `<div class="g-options">${q.options
        .map((o, k) => `<button class="g-opt" style="--c:${GAME_COLORS[k % GAME_COLORS.length]}" data-i="${o.i}"><span>${'أبجدهو'[k]}</span>${esc(o.text)}</button>`)
        .join('')}</div>`;
      area.querySelectorAll('.g-opt').forEach((b) => b.addEventListener('click', () => (b.classList.add('picked'), send(Number(b.dataset.i)))));
    } else if (q.kind === 'truefalse') {
      area.innerHTML = `<div class="g-options two"><button class="g-opt" style="--c:#10b981" data-v="1"><span>✔</span>صحيح</button>
        <button class="g-opt" style="--c:#ef4444" data-v="0"><span>✘</span>خطأ</button></div>`;
      area.querySelectorAll('.g-opt').forEach((b) => b.addEventListener('click', () => (b.classList.add('picked'), send(b.dataset.v === '1'))));
    } else if (q.kind === 'order') {
      area.innerHTML = `<p class="g-hint">اسحب البطاقات لترتيبها (من الأعلى إلى الأسفل)</p>
        <ul class="g-order">${q.items.map((o) => `<li class="g-drag" data-i="${o.i}"><span class="g-grip">⋮⋮</span><b>${esc(o.text)}</b>
          <span class="g-arrows"><button type="button" data-up>▲</button><button type="button" data-down>▼</button></span></li>`).join('')}</ul>
        <button class="g-confirm" id="g-ok">تأكيد الترتيب ✓</button>`;
      const list = area.querySelector('.g-order');
      sortable(list);
      list.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (e.target.closest('[data-up]') && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
        if (e.target.closest('[data-down]') && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
      });
      $('#g-ok').addEventListener('click', () => send([...list.children].map((li) => Number(li.dataset.i))));
    } else {
      area.innerHTML = `<p class="g-hint">اسحب كل بطاقة إلى مكانها (أو اضغط على البطاقة ثم على الخانة)</p>
        <div class="g-match">${q.left.map((l) => `<div class="g-row"><span class="g-left">${esc(l.text)}</span><span class="g-slot" data-slot="${l.i}"></span></div>`).join('')}</div>
        <div class="g-pool">${q.right.map((r) => `<span class="g-chip g-drag" data-i="${r.i}">${esc(r.text)}</span>`).join('')}</div>
        <button class="g-confirm" id="g-ok" disabled>تأكيد ✓</button>`;
      matcher(area, () => ($('#g-ok').disabled = !!area.querySelector('.g-pool .g-chip')));
      $('#g-ok').addEventListener('click', () =>
        send(q.left.map((l) => Number(area.querySelector(`[data-slot="${l.i}"] .g-chip`)?.dataset.i ?? -1)))
      );
    }
  }

  function feedback(q, r, answer) {
    (r.correct ? gameSound.good : gameSound.bad)();
    const sc = $('#g-score');
    if (sc) sc.textContent = r.score;
    // إظهار الإجابة الصحيحة
    if (q.kind === 'mcq') {
      stage.querySelectorAll('.g-opt').forEach((b) => {
        const i = Number(b.dataset.i);
        b.classList.add(i === r.reveal.answer ? 'right' : i === answer ? 'wrong' : 'dim');
      });
    } else if (q.kind === 'truefalse') {
      stage.querySelectorAll('.g-opt').forEach((b) => {
        const v = b.dataset.v === '1';
        b.classList.add(v === r.reveal.answer ? 'right' : v === answer ? 'wrong' : 'dim');
      });
    }
    const solution =
      !r.correct && q.kind === 'order'
        ? `<ol class="g-solution">${r.reveal.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`
        : !r.correct && q.kind === 'match'
          ? `<ul class="g-solution">${r.reveal.pairs.map((p) => `<li>${esc(p[0])} ← ${esc(p[1])}</li>`).join('')}</ul>`
          : '';
    const tags = [
      r.bonus?.speed ? `<span>⚡ سرعة +${r.bonus.speed}</span>` : '',
      r.bonus?.streak ? `<span>🔥 سلسلة +${r.bonus.streak}</span>` : '',
      r.bonus?.repeat ? '<span>🔁 أجبت عنه سابقًا: ربع النقاط</span>' : '',
      r.partial ? `<span>✳️ ${Math.round(r.partial * 100)}% صحيح</span>` : '',
    ].join('');
    const box = document.createElement('div');
    box.className = `g-feedback ${r.correct ? 'ok' : 'ko'}`;
    box.innerHTML = `
      <div class="g-fb-head">${r.correct ? '🎉 أحسنت!' : r.timed_out ? '⏰ انتهى الوقت' : '😕 ليست الإجابة الصحيحة'}
        ${r.points ? `<b class="g-plus">+${r.points}</b>` : ''}</div>
      ${tags ? `<div class="g-tags">${tags}</div>` : ''}
      ${solution}
      ${r.explanation ? `<p class="g-expl">💡 ${esc(r.explanation)}</p>` : ''}
      <button class="g-next">${r.done ? 'النتيجة 🏁' : 'التالي ←'}</button>`;
    stage.appendChild(box);
    box.querySelector('.g-next').addEventListener('click', () => (r.done ? finish(r.summary) : next()));
    box.querySelector('.g-next').focus();
  }

  function finish(s) {
    clearInterval(timer);
    gameSound.win();
    stage.innerHTML = `
      <div class="g-end g-pop">
        ${s.stars === 3 ? confetti() : ''}
        <div class="g-end-stars">${[1, 2, 3].map((k) => `<span class="${k <= s.stars ? 'on' : ''}" style="--d:${k * 0.25}s">★</span>`).join('')}</div>
        <h2>${s.stars === 3 ? 'مذهل! جولة كاملة 💯' : s.stars === 2 ? 'رائع جدًا! 👏' : s.stars === 1 ? 'جيّد، واصل! 💪' : 'لا بأس، حاول من جديد 🌱'}</h2>
        <div class="g-end-score">${s.score}<small>نقطة</small></div>
        <div class="g-end-stats">
          <span>✅ ${s.correct}/${s.total || total}</span><span>🔥 ${s.best_streak}</span>${s.rank_week ? `<span>🏆 ${medal(s.rank_week)} هذا الأسبوع</span>` : ''}
        </div>
        ${s.preview ? '<p class="g-expl">جولة تجريبية للإدارة: لا تُحتسب في الترتيب.</p>' : ''}
        ${
          s.new_badges?.length
            ? `<div class="g-new-badges"><p>🎖️ شارات جديدة!</p>${s.new_badges.map((b) => `<div class="g-badge on g-pop"><span>${b.icon}</span><b>${esc(b.label)}</b></div>`).join('')}</div>`
            : ''
        }
        <div class="g-end-actions"><button class="g-play-btn" id="g-again">🔄 جولة جديدة</button><a class="g-back" href="#/arena">رجوع إلى ركن التحدّي</a></div>
      </div>`;
    $('#g-again').addEventListener('click', async () => {
      try {
        const body = state.user.role === 'admin' ? { level: gameState.level } : { student_id: gameState.kid };
        const r = await api('POST', '/api/game/sessions', body);
        location.hash = `#/arena/play/${r.id}`;
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  try {
    await next();
  } catch (err) {
    leave();
    throw err;
  }
}

function confetti() {
  return `<div class="g-confetti">${Array.from({ length: 40 }, (_, i) =>
    `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 1.2).toFixed(2)}s;--c:${GAME_COLORS[i % GAME_COLORS.length]};--r:${Math.round(Math.random() * 360)}deg"></i>`
  ).join('')}</div>`;
}

// ترتيب بالسحب (فأرة ولمس) — الأسهم بديل للوصول
function sortable(list) {
  let drag = null;
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li');
    if (!li || e.target.closest('button') || li.classList.contains('locked')) return;
    drag = li;
    li.classList.add('dragging');
    li.setPointerCapture(e.pointerId);
  });
  list.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const over = [...list.children].find((x) => {
      if (x === drag) return false;
      const r = x.getBoundingClientRect();
      return e.clientY > r.top && e.clientY < r.bottom;
    });
    if (!over) return;
    const r = over.getBoundingClientRect();
    list.insertBefore(drag, e.clientY < r.top + r.height / 2 ? over : over.nextSibling);
  });
  const stop = () => {
    drag?.classList.remove('dragging');
    drag = null;
  };
  list.addEventListener('pointerup', stop);
  list.addEventListener('pointercancel', stop);
}

// ربط: سحب البطاقة إلى الخانة، أو ضغطة على البطاقة ثم على الخانة
function matcher(area, changed) {
  const pool = area.querySelector('.g-pool');
  let picked = null;
  let ghost = null;
  let from = null;
  const place = (chip, slot) => {
    if (!slot) return pool.appendChild(chip);
    const old = slot.querySelector('.g-chip');
    if (old && old !== chip) pool.appendChild(old);
    slot.appendChild(chip);
  };
  const pick = (chip) => {
    area.querySelectorAll('.g-chip.sel').forEach((c) => c.classList.remove('sel'));
    picked = chip;
    chip?.classList.add('sel');
  };
  area.addEventListener('click', (e) => {
    if (area.querySelector('.locked')) return;
    const chip = e.target.closest('.g-chip');
    const slot = e.target.closest('.g-slot');
    if (chip && !moved) return pick(picked === chip ? null : chip);
    if (slot && picked) {
      place(picked, slot);
      pick(null);
      changed();
    }
  });
  let moved = false;
  area.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.g-chip');
    if (!chip || chip.classList.contains('locked')) return;
    from = { chip, x: e.clientX, y: e.clientY };
    moved = false;
  });
  area.addEventListener('pointermove', (e) => {
    if (!from) return;
    if (!moved && Math.hypot(e.clientX - from.x, e.clientY - from.y) < 8) return;
    if (!moved) {
      moved = true;
      ghost = from.chip.cloneNode(true);
      ghost.className = 'g-chip g-ghost';
      document.body.appendChild(ghost);
      from.chip.classList.add('dragging');
    }
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    area.querySelectorAll('.g-slot').forEach((s) => s.classList.remove('hover'));
    document.elementFromPoint(e.clientX, e.clientY)?.closest('.g-slot')?.classList.add('hover');
  });
  const up = (e) => {
    if (!from) return;
    if (moved) {
      ghost?.remove();
      from.chip.classList.remove('dragging');
      area.querySelectorAll('.g-slot').forEach((s) => s.classList.remove('hover'));
      const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest('.g-slot');
      const back = document.elementFromPoint(e.clientX, e.clientY)?.closest('.g-pool');
      if (slot || back) place(from.chip, slot);
      changed();
      setTimeout(() => (moved = false), 0);
    }
    from = null;
  };
  window.addEventListener('pointerup', up);
  area.addEventListener('pointercancel', () => (ghost?.remove(), (from = null)));
  // منع تمرير الصفحة أثناء سحب البطاقة على اللمس
  area.querySelectorAll('.g-chip').forEach((c) => (c.style.touchAction = 'none'));
}

// ---------- الإدارة: نظرة عامة، الترتيب، بنك الأسئلة ----------
async function arenaAdmin(el, hub) {
  gameState.level ||= hub.level;
  const tabs = [['overview', '📊 نظرة عامة'], ['board', '🏆 الترتيب'], ['bank', '📚 بنك الأسئلة']];
  el.innerHTML = `
    <div class="arena">
      <div class="g-hero">
        <div class="g-hero-top"><div><small>🏆 ركن التحدّي</small><h2>لوحة الإدارة</h2>
          <span class="g-level">بنك الأسئلة تدخله الإدارة فقط · ${hub.rounds_week} جولة هذا الأسبوع</span></div>
          <button class="g-icon-btn" id="g-mute">${gameSound.muted() ? '🔇' : '🔊'}</button></div>
      </div>
      <div class="g-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${gameState.adminTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="g-panel" id="g-panel"></div>
    </div>`;
  $('#g-mute').addEventListener('click', (e) => (e.currentTarget.textContent = gameSound.toggle() ? '🔇' : '🔊'));
  el.querySelectorAll('.g-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => ((gameState.adminTab = b.dataset.tab), arenaAdmin(el, hub))));
  const p = $('#g-panel');
  const levelSelect = (id, val, all) =>
    `<select id="${id}">${all ? '<option value="">— كل الأقسام —</option>' : ''}${state.meta.levels.map((l) => `<option value="${esc(l.code)}" ${l.code === val ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select>`;
  const tryRound = async (level) => {
    try {
      gameState.level = level;
      const r = await api('POST', '/api/game/sessions', { level });
      location.hash = `#/arena/play/${r.id}`;
    } catch (err) {
      toast(err.message, true);
    }
  };

  if (gameState.adminTab === 'overview') {
    p.innerHTML = `<div class="g-levels">${hub.levels
      .map(
        (l) => `<div class="g-lvl"><h4>${esc(l.label)}</h4>
          <div class="g-lvl-n"><span><b>${l.questions}</b> سؤال</span><span><b>${l.players}</b> لاعب</span></div>
          ${l.week.length ? `<div class="g-top3">${l.week.map((r) => `<span>${medal(r.rank)} ${esc(r.name)} <small>${r.points}</small></span>`).join('')}</div>` : '<p class="muted small">لا لاعبين هذا الأسبوع</p>'}
          <div class="g-lvl-actions"><button class="btn small ghost" data-add="${esc(l.code)}">+ سؤال</button>
            ${l.questions ? `<button class="btn small" data-try="${esc(l.code)}">▶ جرّب جولة</button>` : ''}</div></div>`
      )
      .join('')}</div>
      <div class="card g-help"><h4>كيف يعمل؟</h4><ul>
        <li>تدخل الإدارة الأسئلة لكل قسم (أو لكل الأقسام): اختيار من متعدّد، صحيح/خطأ، ترتيب بالسحب، ربط بالسحب والإفلات.</li>
        <li>التلميذ يدخل من حساب وليّه عبر أيقونة 🏆: جولات من 10 أسئلة، عدّاد وقت، نقاط أكثر للأسرع، مكافأة للإجابات الصحيحة المتتالية 🔥.</li>
        <li>نجوم لكل جولة، شارات، وترتيب أسبوعي وعام داخل القسم. سؤال سبق حلّه يعطي ربع النقاط فقط (لا تضخيم بالإعادة).</li>
        <li>التصحيح والتوقيت يتمّان في الخادم: لا يمكن الغشّ. تفعيل/إيقاف الركن للأولياء من «الصلاحيات».</li></ul></div>`;
    p.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => tryRound(b.dataset.try)));
    p.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => questionForm({ level: b.dataset.add }, () => arenaAdmin(el, hub))));
  } else if (gameState.adminTab === 'board') {
    p.innerHTML = `<div class="filters">${levelSelect('g-blevel', gameState.level)}</div>
      <div class="g-seg"><button data-b="week" class="${gameState.board === 'week' ? 'on' : ''}">هذا الأسبوع</button><button data-b="all" class="${gameState.board === 'all' ? 'on' : ''}">منذ البداية</button></div>
      ${boardList(hub.leaderboard?.[gameState.board], 'لا لاعبين بعد في هذا القسم')}`;
    $('#g-blevel').addEventListener('change', (e) => ((gameState.level = e.target.value), viewArena(el)));
    p.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => ((gameState.board = b.dataset.b), arenaAdmin(el, hub))));
  } else {
    const qs = new URLSearchParams();
    if (gameState.qLevel) qs.set('level', gameState.qLevel);
    if (gameState.qSubject) qs.set('subject_id', gameState.qSubject);
    if (gameState.qKind) qs.set('kind', gameState.qKind);
    const { questions } = await api('GET', '/api/game/questions?' + qs);
    const lvl = (c) => (c ? state.meta.levels.find((l) => l.code === c)?.label || c : 'كل الأقسام');
    const answerOf = (q) =>
      q.kind === 'mcq' ? q.data.options.map((o, i) => (i === q.data.answer ? `<b class="ok">✓ ${esc(o)}</b>` : esc(o))).join(' · ')
      : q.kind === 'truefalse' ? `<b class="ok">${q.data.answer ? '✓ صحيح' : '✘ خطأ'}</b>`
      : q.kind === 'order' ? q.data.items.map((x, i) => `${i + 1}. ${esc(x)}`).join(' ← ')
      : q.data.pairs.map((x) => `${esc(x[0])} ↔ ${esc(x[1])}`).join(' · ');
    p.innerHTML = `
      <div class="g-bank-head">
        <div class="filters">${levelSelect('g-ql', gameState.qLevel, true)}
          <select id="g-qs"><option value="">— كل المواد —</option>${state.meta.subjects.map((x) => `<option value="${x.id}" ${String(x.id) === gameState.qSubject ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <select id="g-qk"><option value="">— كل الأنواع —</option>${Object.entries(GAME_KIND_LABELS).map(([k, v]) => `<option value="${k}" ${k === gameState.qKind ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <button class="btn" id="g-qadd">+ سؤال جديد</button>
      </div>
      <p class="muted small">${questions.length} سؤال${questions.filter((q) => !q.active).length ? ` · ${questions.filter((q) => !q.active).length} موقوف/مؤرشف` : ''}</p>
      ${
        questions.length
          ? `<div class="g-qlist">${questions
              .map(
                (q) => `<div class="g-q ${q.active ? '' : 'off'}">
                  <div class="g-q-tags"><span class="g-kind">${GAME_KIND_LABELS[q.kind]}</span><span>${esc(lvl(q.level))}</span>${q.subject_name ? `<span>${esc(q.subject_name)}</span>` : ''}<span>+${q.points} · ⏱ ${q.time_limit}ث</span>
                    ${q.attempts ? `<span title="نسبة النجاح">🎯 ${Math.round((q.correct / q.attempts) * 100)}% من ${q.attempts}</span>` : ''}${q.active ? '' : '<span class="off-tag">موقوف</span>'}</div>
                  <p class="g-q-prompt">${esc(q.prompt)}</p>
                  <p class="g-q-ans small">${answerOf(q)}</p>
                  <div class="g-q-actions"><button class="btn small ghost" data-edit="${q.id}">✏️ تعديل</button>
                    <button class="btn small ghost" data-toggle="${q.id}">${q.active ? '⏸ إيقاف' : '▶ تفعيل'}</button>
                    <button class="btn small ghost danger" data-del="${q.id}">🗑</button></div>
                </div>`
              )
              .join('')}</div>`
          : '<div class="card empty-state"><span>📚</span><p>لا أسئلة بعد. ابدأ بإضافة أوّل سؤال!</p></div>'
      }`;
    const reload = () => arenaAdmin(el, hub);
    $('#g-ql').addEventListener('change', (e) => ((gameState.qLevel = e.target.value), reload()));
    $('#g-qs').addEventListener('change', (e) => ((gameState.qSubject = e.target.value), reload()));
    $('#g-qk').addEventListener('change', (e) => ((gameState.qKind = e.target.value), reload()));
    $('#g-qadd').addEventListener('click', () => questionForm({ level: gameState.qLevel, subject_id: gameState.qSubject }, reload));
    p.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => questionForm(questions.find((q) => q.id === Number(b.dataset.edit)), reload)));
    p.querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', async () => {
        const q = questions.find((x) => x.id === Number(b.dataset.toggle));
        await api('PUT', `/api/game/questions/${q.id}`, { ...q, active: !q.active }).catch((e) => toast(e.message, true));
        reload();
      })
    );
    p.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirmAction('حذف هذا السؤال؟ (إن سبق أن أُجيب عنه يُؤرشف فقط وتبقى نقاط التلاميذ)')) return;
        const r = await api('DELETE', `/api/game/questions/${b.dataset.del}`).catch((e) => toast(e.message, true));
        if (r?.archived) toast('السؤال أُجيب عنه سابقًا: تمّ إيقافه وأرشفته');
        reload();
      })
    );
  }
}

// استمارة السؤال: الحقول تتغيّر حسب النوع
function questionForm(q, done) {
  const editing = !!q?.id;
  const d = q?.data || {};
  let kind = q?.kind || 'mcq';
  const row = (cls, inner) => `<div class="g-frow ${cls}">${inner}<button type="button" class="btn small ghost g-frm" title="حذف">✕</button></div>`;
  const optRow = (v = '', checked = false) => row('opt', `<input type="radio" name="g-correct" ${checked ? 'checked' : ''} title="الإجابة الصحيحة"><input class="g-in" value="${esc(v)}" placeholder="اختيار" maxlength="200">`);
  const itemRow = (v = '') => row('item', `<span class="g-num"></span><input class="g-in" value="${esc(v)}" placeholder="عنصر" maxlength="200">`);
  const pairRow = (a = '', b = '') => row('pair', `<input class="g-in" value="${esc(a)}" placeholder="العمود الأول" maxlength="200"><span>↔</span><input class="g-in2" value="${esc(b)}" placeholder="ما يقابله" maxlength="200">`);
  const fields = () => {
    if (kind === 'mcq') {
      const opts = d.options?.length ? d.options : ['', '', '', ''];
      return `<p class="small muted">اكتب الاختيارات واختر ⦿ الإجابة الصحيحة (2 إلى 6)</p><div class="g-rows">${opts.map((o, i) => optRow(o, kind === q?.kind ? i === d.answer : i === 0)).join('')}</div><button type="button" class="btn small ghost" data-addrow>+ اختيار</button>`;
    }
    if (kind === 'truefalse') {
      return `<div class="g-tf"><label class="check"><input type="radio" name="g-tf" value="1" ${d.answer !== false ? 'checked' : ''}> ✔ صحيح</label>
        <label class="check"><input type="radio" name="g-tf" value="0" ${d.answer === false ? 'checked' : ''}> ✘ خطأ</label></div>`;
    }
    if (kind === 'order') {
      const items = d.items?.length ? d.items : ['', '', ''];
      return `<p class="small muted">اكتب العناصر <b>بالترتيب الصحيح</b> (3 إلى 8) — تُخلط تلقائيًا للتلميذ</p><div class="g-rows">${items.map((x) => itemRow(x)).join('')}</div><button type="button" class="btn small ghost" data-addrow>+ عنصر</button>`;
    }
    const pairs = d.pairs?.length ? d.pairs : [['', ''], ['', ''], ['', '']];
    return `<p class="small muted">كل سطر = زوج صحيح (2 إلى 6) — العمود الثاني يُخلط ويسحبه التلميذ إلى مكانه</p><div class="g-rows">${pairs.map((x) => pairRow(x[0], x[1])).join('')}</div><button type="button" class="btn small ghost" data-addrow>+ زوج</button>`;
  };
  openModal(
    editing ? '✏️ تعديل سؤال' : '+ سؤال جديد — ركن التحدّي',
    `<div class="row">
       <label>القسم<select name="level"><option value="">— كل الأقسام —</option>${state.meta.levels.map((l) => `<option value="${esc(l.code)}" ${l.code === (q?.level || '') ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>
       <label>المادة<select name="subject_id"><option value="">—</option>${state.meta.subjects.map((x) => `<option value="${x.id}" ${String(x.id) === String(q?.subject_id || '') ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
     </div>
     <label>نوع السؤال<select name="kind" id="g-fkind">${Object.entries(GAME_KIND_LABELS).map(([k, v]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
     <label>السؤال<textarea name="prompt" rows="2" maxlength="500" required placeholder="مثال: ما هو ناتج 7 × 8 ؟">${esc(q?.prompt || '')}</textarea></label>
     <div id="g-ffields" class="g-ffields"></div>
     <label>شرح يظهر بعد الإجابة (اختياري)<input name="explanation" maxlength="500" value="${esc(q?.explanation || '')}"></label>
     <div class="row">
       <label>النقاط<input type="number" name="points" min="1" max="100" value="${q?.points || 10}"></label>
       <label>الوقت (ثانية)<input type="number" name="time_limit" min="5" max="300" value="${q?.time_limit || 30}"></label>
     </div>
     <label class="check"><input type="checkbox" name="active" ${q?.active === false ? '' : 'checked'}> مفعّل (يظهر في الجولات)</label>`,
    async (data) => {
      const box = $('#g-ffields');
      const vals = (sel) => [...box.querySelectorAll(sel)].map((i) => i.value.trim());
      let payload;
      if (kind === 'mcq') {
        const rows = [...box.querySelectorAll('.g-frow')];
        payload = { options: rows.map((r) => r.querySelector('.g-in').value.trim()), answer: rows.findIndex((r) => r.querySelector('input[type=radio]').checked) };
      } else if (kind === 'truefalse') payload = { answer: box.querySelector('input[name=g-tf]:checked')?.value === '1' };
      else if (kind === 'order') payload = { items: vals('.g-in') };
      else payload = { pairs: [...box.querySelectorAll('.g-frow')].map((r) => [r.querySelector('.g-in').value.trim(), r.querySelector('.g-in2').value.trim()]) };
      const body = { ...data, kind, data: payload, active: !!data.active, subject_id: data.subject_id || null, level: data.level || null };
      await api(editing ? 'PUT' : 'POST', editing ? `/api/game/questions/${q.id}` : '/api/game/questions', body);
      toast(editing ? 'تمّ تعديل السؤال' : 'تمّت إضافة السؤال ✓');
      done?.();
    }
  );
  const box = $('#g-ffields');
  const draw = () => {
    box.innerHTML = fields();
    box.querySelector('[data-addrow]')?.addEventListener('click', () => {
      const rows = box.querySelector('.g-rows');
      const max = kind === 'order' ? 8 : 6;
      if (rows.children.length >= max) return toast(`${max} على الأقصى`, true);
      rows.insertAdjacentHTML('beforeend', kind === 'mcq' ? optRow() : kind === 'order' ? itemRow() : pairRow());
    });
  };
  box.addEventListener('click', (e) => {
    const rm = e.target.closest('.g-frm');
    if (!rm) return;
    const rows = box.querySelector('.g-rows');
    const min = kind === 'order' ? 3 : 2;
    if (rows.children.length <= min) return toast(`${min} على الأقل`, true);
    rm.closest('.g-frow').remove();
  });
  $('#g-fkind').addEventListener('change', (e) => {
    kind = e.target.value;
    draw();
  });
  draw();
}
