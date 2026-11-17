// ---------- 🏆 ركن التحدّي (gamification) ----------
// كل شيء هنا مستقلّ: أيقونة 🏆 في الأعلى ← #/arena. المعلّمون والإدارة يدخلون الأسئلة (حسب المحور)،
// التلميذ يلعب من حساب وليّه: كل مادّة (أو فرع: حساب / إيقاظ) تحدّيها وترتيبها.

const GAME_KIND_LABELS = {
  mcq: '🔘 اختيار من متعدّد',
  truefalse: '✅ صحيح أم خطأ',
  order: '↕️ ترتيب',
  match: '🧲 سحب وإفلات',
  connect: '🏹 اربط بسهم',
  categorize: '🗂️ صنّف في مجموعات',
  type: '⌨️ إجابة مكتوبة',
};
const GAME_KIND_TIPS = {
  mcq: 'نصّ أو صور: أضف 🖼️ لكل اختيار ليصبح «اختر الصورة الصحيحة»',
  truefalse: 'جملة يحكم عليها التلميذ',
  order: 'عناصر (نصّ أو صور) بالترتيب الصحيح: تُخلط للتلميذ ويرتّبها بالسحب',
  match: 'أزواج: التلميذ يسحب كل بطاقة إلى مكانها',
  connect: 'أزواج: التلميذ يربط بين العمودين بسهم',
  categorize: 'مجموعات وعناصر: التلميذ يسحب كل عنصر إلى مجموعته',
  type: 'التلميذ يكتب الإجابة (عدد أو كلمة)؛ التشكيل والهمزات لا تُحتسب',
};
// ألوان وأشكال على طريقة المسابقات العالمية
const GAME_COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#864cbf', '#0aa3a3'];
const GAME_SHAPES = ['▲', '◆', '●', '■', '⬟', '★'];
const gameState = {
  kid: null, board: 'week', tab: 'board', bSubj: null, subj: '', topic: '', adminTab: 'overview', level: null,
  qLevel: '', qTrack: '', qTopic: '', qKind: '', sTrack: '', sTopic: '', last: null,
};

// فروع المادّة من اسمها: «علوم(حساب+إيقاظ)» ← حساب، إيقاظ
const gameBranches = (name) => {
  const m = String(name || '').match(/\(([^)]+)\)/);
  return m && m[1].includes('+') ? m[1].split('+').map((x) => x.trim()).filter(Boolean) : [];
};
// خيارات «المادّة / الفرع» في القوائم: 6 أو 6:حساب
const gameTrackOptions = (subjects, selected, withEmpty = '') =>
  (withEmpty ? `<option value="">${withEmpty}</option>` : '') +
  subjects
    .flatMap((x) => {
      const br = gameBranches(x.name);
      return br.length ? br.map((b) => [`${x.id}:${b}`, `${x.name.replace(/\(.*\)/, '').trim()} · ${b}`]) : [[String(x.id), x.name]];
    })
    .map(([v, l]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(l)}</option>`)
    .join('');
const splitTrack = (key) => {
  const [id, ...b] = String(key || '').split(':');
  return { subject_id: Number(id) || null, branch: b.join(':') || null };
};
const trackParams = (key, qs) => {
  const t = splitTrack(key);
  if (t.subject_id) qs.set('subject_id', t.subject_id);
  if (t.branch) qs.set('branch', t.branch);
  return qs;
};

// خانة: نصّ أو صورة
const gImg = (id) => `/api/game/images/${id}`;
const cellHTML = (c) =>
  c?.img
    ? `<span class="g-cell pic"><img src="${esc(c.img)}" alt="" draggable="false" loading="lazy">${c.text ? `<small>${esc(c.text)}</small>` : ''}</span>`
    : `<span class="g-cell">${esc(c?.text ?? '')}</span>`;
const cellStored = (c) => (typeof c === 'string' ? { text: c } : { text: c?.t || '', img: gImg(c?.img) });
const cellShort = (c) => (typeof c === 'string' ? esc(c) : `🖼️${c?.t ? ' ' + esc(c.t) : ''}`);

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
    pop: () => play([[520, 0, 0.06, 'triangle', 0.07]]),
  };
})();
const buzz = (p) => {
  try {
    navigator.vibrate?.(p);
  } catch {}
};

const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`);
const starRow = (n, max = 3) => `<span class="g-stars">${'★'.repeat(n)}<i>${'★'.repeat(Math.max(0, max - n))}</i></span>`;

// الترتيب: عامّ (كل المواد) أو حسب المادّة/الفرع
const pickBoard = (lb, key) => (key && lb?.by_subject?.[key]) || lb;
function boardSubjects(tracks, lb, current) {
  if (!tracks?.length) return '';
  return `<div class="g-subjects g-bsubj"><button class="g-subj ${!current ? 'on' : ''}" data-bs="">🌐 الترتيب العام</button>${tracks
    .map((x) => `<button class="g-subj ${x.key === current ? 'on' : ''}" data-bs="${esc(x.key)}">${esc(x.name)}</button>`)
    .join('')}</div>`;
}

function boardList(rows, empty = 'لا أحد بعد — كن الأوّل! 🚀') {
  if (!rows?.length) return `<p class="muted g-empty">${empty}</p>`;
  const podium = rows.filter((r) => r.rank <= 3);
  return `${
    podium.length >= 2
      ? `<div class="g-podium">${[podium[1], podium[0], podium[2]]
          .filter(Boolean)
          .map((r) => `<div class="g-pod p${r.rank} ${r.me ? 'me' : ''}"><span class="g-pod-ini">${esc((r.name || '?')[0])}</span><b>${esc(r.name)}</b><small>${r.points}</small><div class="g-pod-bar">${medal(r.rank)}</div></div>`)
          .join('')}</div>`
      : ''
  }<ol class="g-board">${rows
    .filter((r) => podium.length < 2 || r.rank > 3)
    .map(
      (r) => `<li class="${r.me ? 'me' : ''} ${r.rank <= 3 ? 'top' : ''}"><span class="g-rank">${medal(r.rank)}</span>
        <span class="g-ini">${esc((r.name || '?')[0])}</span><b>${esc(r.name)}${r.me ? ' <small>(أنت)</small>' : ''}</b>
        <span class="g-pts">${r.points} <small>نقطة</small></span></li>`
    )
    .join('')}</ol>`;
}

// ---------- الوليّ / التلميذ ----------
async function viewArena(el) {
  const kid = gameState.kid ? `?student_id=${gameState.kid}` : '';
  const isAdmin = state.user.role === 'admin' || state.user.role === 'teacher';
  const hub = await api('GET', '/api/game/hub' + (isAdmin ? `?level=${encodeURIComponent(gameState.level || '')}` : kid));
  if (isAdmin) return arenaAdmin(el, hub);
  if (!hub.kids.length) {
    el.innerHTML = `<div class="arena"><div class="g-hero"><h2>🏆 ركن التحدّي</h2><p>ركن التحدّي متاح لتلاميذ دروس الدعم.</p></div></div>`;
    return;
  }
  const s = hub.stats;
  gameState.kid = hub.student.id;
  const earned = hub.badges.filter((b) => b.earned).length;
  const tracks = hub.subjects;
  // المسار المختار: آخر اختيار إن بقي فيه أسئلة، وإلا أوّل مسار فيه أسئلة متبقّية
  if (!tracks.some((x) => x.key === gameState.subj && x.total)) {
    gameState.subj = tracks.find((x) => x.remaining)?.key ?? tracks.find((x) => x.total)?.key ?? '';
    gameState.topic = '';
  }
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
      <div class="g-play-card" id="g-playcard"></div>
      <div class="g-tabs">
        <button data-tab="board" class="${gameState.tab === 'board' ? 'on' : ''}">🏆 الترتيب</button>
        <button data-tab="badges" class="${gameState.tab === 'badges' ? 'on' : ''}">🎖️ الشارات <small>${earned}/${hub.badges.length}</small></button>
        <button data-tab="recent" class="${gameState.tab === 'recent' ? 'on' : ''}">🕘 جولاتي</button>
      </div>
      <div class="g-panel" id="g-panel"></div>
    </div>`;

  const playCard = () => {
    const box = $('#g-playcard');
    if (!hub.total_questions) {
      box.innerHTML = '<p class="g-play-title">⏳ الأسئلة في الطريق… المعلّمون يحضّرون تحدّيات قسمك قريبًا.</p>';
      return;
    }
    const t = tracks.find((x) => x.key === gameState.subj);
    const parts = t ? [['', '🎲 كل المحاور', t], ...t.topics.map((x) => [x.name, x.name, x]), ...(t.comprehensive && t.topics.length ? [['*', '🧩 أسئلة شاملة', t.comprehensive]] : [])] : [];
    if (!parts.some((p) => p[0] === gameState.topic)) gameState.topic = '';
    const cur = parts.find((p) => p[0] === gameState.topic)?.[2];
    const pct = (x) => (x.total ? Math.round((100 * x.done) / x.total) : 0);
    box.innerHTML = `
      <p class="g-play-title">1️⃣ اختر المادّة</p>
      <div class="g-tracks">${tracks
        .map(
          (x) => `<button class="g-track ${x.key === gameState.subj ? 'on' : ''} ${x.total && !x.remaining ? 'done' : ''}" data-track="${esc(x.key)}" ${x.total ? '' : 'disabled'}>
            <b>${esc(x.name)}${x.total && !x.remaining ? ' ✅' : ''}</b>${x.branch ? `<small>${esc(x.subject_name.replace(/\(.*\)/, '').trim())}</small>` : ''}
            <span class="g-tbar"><i style="width:${pct(x)}%"></i></span><em dir="ltr">${x.done}/${x.total}</em></button>`
        )
        .join('')}</div>
      ${
        parts.length > 1
          ? `<p class="g-play-title">2️⃣ اختر المحور</p><div class="g-topics">${parts
              .map(([v, l, x]) => `<button class="g-topic ${v === gameState.topic ? 'on' : ''} ${x.total && !x.remaining ? 'done' : ''}" data-topic="${esc(v)}">${esc(l)} <small dir="ltr">${x.done}/${x.total}</small></button>`)
              .join('')}</div>`
          : ''
      }
      ${t?.pending ? `<p class="g-pending">🔁 ${t.pending} ${t.pending > 1 ? 'أسئلة أخطأت فيها تعود' : 'سؤال أخطأت فيه يعود'} في جولتك القادمة: صحّحه لتربح نصف نقاطه!</p>` : ''}
      <button class="g-play-btn" id="g-start" ${cur?.remaining ? '' : 'disabled'}>${cur && !cur.remaining && cur.total ? '✅ أكملت هذا التحدّي' : '▶ ابدأ الجولة'}</button>
      <details class="g-rules"><summary>كيف تُحتسب النقاط؟</summary>
        <p>✔️ صحيح من أوّل مرّة: كل النقاط + ⚡ مكافأة السرعة + 🔥 مكافأة السلسلة، ولا يعود السؤال.<br>
        ✘ خطأ (أو انتهى الوقت): يعود السؤال في الجولة الموالية بترتيب جديد للإجابات. صحيح في المرّة الثانية = نصف النقاط، وبعدها دون نقاط.</p></details>`;
    box.querySelectorAll('[data-track]').forEach((b) =>
      b.addEventListener('click', () => {
        gameState.subj = b.dataset.track;
        gameState.topic = '';
        gameSound.pop();
        playCard();
        if (gameState.tab === 'board' && gameState.bSubj === null) panel();
      })
    );
    box.querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('click', () => ((gameState.topic = b.dataset.topic), gameSound.pop(), playCard())));
    $('#g-start')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const tt = splitTrack(gameState.subj);
      const body = { student_id: hub.student.id, subject_id: tt.subject_id, branch: tt.branch, topic: gameState.topic || null };
      try {
        const r = await api('POST', '/api/game/sessions', body);
        gameState.last = body;
        location.hash = `#/arena/play/${r.id}`;
      } catch (err) {
        toast(err.message, true);
        e.currentTarget.disabled = false;
      }
    });
  };

  const panel = () => {
    const p = $('#g-panel');
    if (gameState.tab === 'board') {
      // الترتيب حسب المادّة المختارة (أو العامّ)
      const key = gameState.bSubj ?? gameState.subj;
      p.innerHTML = `${boardSubjects(tracks, hub.leaderboard, key)}<div class="g-seg"><button data-b="week" class="${gameState.board === 'week' ? 'on' : ''}">هذا الأسبوع</button><button data-b="all" class="${gameState.board === 'all' ? 'on' : ''}">منذ البداية</button></div>
        ${boardList(pickBoard(hub.leaderboard, key)?.[gameState.board])}
        <p class="muted small">ترتيب ${esc(hub.level_label)}${key ? ' في ' + esc(tracks.find((x) => x.key === key)?.name || '') : ' (كل المواد)'} · يتجدّد ترتيب الأسبوع كل اثنين.</p>`;
      p.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => ((gameState.board = b.dataset.b), panel())));
      p.querySelectorAll('[data-bs]').forEach((b) => b.addEventListener('click', () => ((gameState.bSubj = b.dataset.bs), panel())));
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
  playCard();
  panel();
  el.querySelectorAll('.g-tabs [data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      gameState.tab = b.dataset.tab;
      el.querySelectorAll('.g-tabs [data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      panel();
    })
  );
  el.querySelectorAll('[data-kid]').forEach((b) => b.addEventListener('click', () => ((gameState.kid = Number(b.dataset.kid)), (gameState.subj = ''), viewArena(el))));
  $('#g-mute').addEventListener('click', (e) => (e.currentTarget.textContent = gameSound.toggle() ? '🔇' : '🔊'));
}

// ---------- اللعب ----------
async function viewArenaPlay(el, id) {
  el.innerHTML = '<div class="g-stage"><div class="g-blobs"><i></i><i></i><i></i></div><div class="g-loading">🎮</div></div>';
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
  const RING = 2 * Math.PI * 20;

  const header = (n) => `
    <div class="g-blobs"><i></i><i></i><i></i></div>
    <div class="g-top">
      <a href="#/arena" class="g-icon-btn" title="خروج">✕</a>
      <div class="g-progress">${Array.from({ length: n.total }, (_, i) => `<i class="${i < n.index ? 'done' : i === n.index ? 'now' : ''}"></i>`).join('')}</div>
      <div class="g-score"><span class="g-flame ${n.streak >= 2 ? 'hot' : ''}">🔥 ${n.streak}</span><b id="g-score">${n.score}</b></div>
    </div>`;

  async function next() {
    clearInterval(timer);
    const n = await api('GET', `/api/game/sessions/${id}/next`);
    if (n.done) return finish(n);
    total = n.total;
    const q = n.question;
    stage.innerHTML = `${header(n)}
      <div class="g-qcard g-pop">
        <div class="g-qhead">
          <div class="g-ring" id="g-ring"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" class="bg"/><circle cx="24" cy="24" r="20" class="fg" id="g-ring-fg" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg><b id="g-sec"></b></div>
          <div class="g-qmeta"><span class="g-qnum">${n.index + 1} / ${n.total}</span><span>${GAME_KIND_LABELS[q.kind]}</span>${q.topic ? `<span class="g-qtopic">📌 ${esc(q.topic)}</span>` : ''}</div>
          <span class="g-qpts">+${q.retry === 1 ? Math.ceil(q.points / 2) : q.retry > 1 ? 0 : q.points}</span>
        </div>
        ${q.retry ? `<div class="g-retry">🔁 ${q.retry === 1 ? 'سؤال أخطأت فيه سابقًا: صحّحه وخذ نصف النقاط' : 'محاولة إضافيّة: دون نقاط، لكن صحّحه!'}</div>` : ''}
        ${q.image ? `<div class="g-qimg"><img src="${esc(q.image)}" alt="" data-zoom></div>` : ''}
        <h3 class="g-prompt">${esc(q.prompt)}</h3>
        <div id="g-answer"></div>
      </div>`;
    stage.querySelector('[data-zoom]')?.addEventListener('click', (e) => gameZoom(e.target.src));
    const area = $('#g-answer');
    let sent = false;
    const send = async (answer, timeout = false) => {
      if (sent) return;
      sent = true;
      clearInterval(timer);
      stage.querySelectorAll('button, .g-drag, input').forEach((b) => (b.classList.add('locked'), b.tagName === 'INPUT' && (b.disabled = true)));
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
    const fg = $('#g-ring-fg');
    const sec = $('#g-sec');
    let lastSec = null;
    const draw = () => {
      const left = Math.max(0, end - Date.now());
      fg.style.strokeDashoffset = String(RING * (1 - left / limit));
      const sLeft = Math.ceil(left / 1000);
      sec.textContent = sLeft;
      $('#g-ring').classList.toggle('low', left < 5000);
      if (left < 5000 && sLeft !== lastSec && sLeft > 0) gameSound.tick();
      lastSec = sLeft;
      if (left <= 0) send(null, true);
    };
    draw();
    timer = setInterval(draw, 100);
    gameAnswerUI(q, area, send);
  }

  function feedback(q, r, answer) {
    (r.correct ? gameSound.good : gameSound.bad)();
    buzz(r.correct ? 25 : [60, 40, 60]);
    const sc = $('#g-score');
    if (sc) countUp(sc, Number(sc.textContent) || 0, r.score);
    const solution = gameReveal(q, r, answer, stage);
    const tags = [
      r.bonus?.speed ? `<span>⚡ سرعة +${r.bonus.speed}</span>` : '',
      r.bonus?.streak ? `<span>🔥 سلسلة +${r.bonus.streak}</span>` : '',
      r.correct && r.bonus?.retry === 'half' ? '<span>🔁 المحاولة الثانية: نصف النقاط</span>' : '',
      !r.correct && r.bonus?.retry === 'half' ? '<span>🔁 سيعود مرّة أخرى (دون نقاط)</span>' : '',
      r.bonus?.retry === 'none' ? '<span>🔁 محاولة إضافيّة: دون نقاط</span>' : '',
      !r.correct && !r.bonus?.retry ? '<span>🔁 سيعود في الجولة الموالية بنصف النقاط</span>' : '',
      r.partial && !r.correct ? `<span>✳️ ${Math.round(r.partial * 100)}% صحيح</span>` : '',
    ].join('');
    const sheet = document.createElement('div');
    sheet.className = `g-sheet ${r.correct ? 'ok' : 'ko'}`;
    sheet.innerHTML = `<div class="g-sheet-in">
      <div class="g-fb-head"><span class="g-fb-ico">${r.correct ? '🎉' : r.timed_out ? '⏰' : '😕'}</span>
        <div><b>${r.correct ? ['أحسنت!', 'رائع!', 'ممتاز!', 'برافو!'][Math.floor(Math.random() * 4)] : r.timed_out ? 'انتهى الوقت' : 'ليست الإجابة الصحيحة'}</b>
        <small>${r.correct ? (r.streak >= 3 ? `🔥 ${r.streak} إجابات صحيحة متتالية` : 'واصل هكذا') : 'لا بأس، ستراه مرّة أخرى'}</small></div>
        ${r.points ? `<b class="g-plus">+${r.points}</b>` : ''}</div>
      ${tags ? `<div class="g-tags">${tags}</div>` : ''}
      ${solution}
      ${r.explanation ? `<p class="g-expl">💡 ${esc(r.explanation)}</p>` : ''}
      <button class="g-next">${r.done ? 'النتيجة 🏁' : 'التالي ←'}</button></div>`;
    stage.appendChild(sheet);
    if (r.correct && r.streak >= 3) stage.insertAdjacentHTML('beforeend', `<div class="g-streak-pop">🔥 ${r.streak}</div>`);
    sheet.querySelector('.g-next').addEventListener('click', () => (r.done ? finish(r.summary) : next()));
    sheet.querySelector('.g-next').focus();
  }

  function finish(s) {
    clearInterval(timer);
    gameSound.win();
    stage.innerHTML = `
      <div class="g-blobs"><i></i><i></i><i></i></div>
      <div class="g-end g-pop">
        ${s.stars >= 2 ? confetti() : ''}
        <div class="g-end-stars">${[1, 2, 3].map((k) => `<span class="${k <= s.stars ? 'on' : ''}" style="--d:${k * 0.25}s">★</span>`).join('')}</div>
        <h2>${s.stars === 3 ? 'مذهل! جولة كاملة 💯' : s.stars === 2 ? 'رائع جدًا! 👏' : s.stars === 1 ? 'جيّد، واصل! 💪' : 'لا بأس، حاول من جديد 🌱'}</h2>
        <div class="g-end-score"><b id="g-final">0</b><small>نقطة</small></div>
        <div class="g-end-stats">
          <span>✅ ${s.correct}/${s.total || total}</span><span>🔥 ${s.best_streak}</span>${s.rank_week ? `<span>🏆 ${medal(s.rank_week)} هذا الأسبوع</span>` : ''}
        </div>
        ${s.correct < (s.total || total) ? '<p class="g-expl">🔁 الأسئلة التي أخطأت فيها تعود في جولتك القادمة: صحّحها لتربح نصف نقاطها.</p>' : ''}
        ${s.preview ? '<p class="g-expl">جولة تجريبية: لا تُحتسب في الترتيب.</p>' : ''}
        ${
          s.new_badges?.length
            ? `<div class="g-new-badges"><p>🎖️ شارات جديدة!</p>${s.new_badges.map((b) => `<div class="g-badge on g-pop"><span>${b.icon}</span><b>${esc(b.label)}</b></div>`).join('')}</div>`
            : ''
        }
        <div class="g-end-actions"><button class="g-play-btn" id="g-again">🔄 جولة جديدة</button><a class="g-back" href="#/arena">رجوع إلى ركن التحدّي</a></div>
      </div>`;
    countUp($('#g-final'), 0, s.score, 900);
    $('#g-again').addEventListener('click', async () => {
      try {
        const body = gameState.last || (state.user.role === 'parent' ? { student_id: gameState.kid } : { level: gameState.level });
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

function countUp(node, from, to, ms = 500) {
  if (!node) return;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    node.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function gameZoom(src) {
  const lb = document.createElement('div');
  lb.className = 'st-lightbox';
  lb.innerHTML = `<img src="${esc(src)}" alt=""><button class="st-lb-x" aria-label="إغلاق">✕</button>`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

function confetti() {
  return `<div class="g-confetti">${Array.from({ length: 48 }, (_, i) =>
    `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 1.2).toFixed(2)}s;--c:${GAME_COLORS[i % GAME_COLORS.length]};--r:${Math.round(Math.random() * 360)}deg"></i>`
  ).join('')}</div>`;
}

// ---------- واجهة الإجابة حسب نوع السؤال ----------
function gameAnswerUI(q, area, send) {
  if (q.kind === 'mcq') {
    const pics = q.options.some((o) => o.img);
    area.innerHTML = `${pics ? '<p class="g-hint">👆 اختر الصورة الصحيحة</p>' : ''}<div class="g-options ${pics ? 'pics' : ''} ${q.options.length === 3 ? 'three' : ''}">${q.options
      .map((o, k) => `<button class="g-opt" style="--c:${GAME_COLORS[k % GAME_COLORS.length]}" data-i="${o.i}"><span class="g-shape">${GAME_SHAPES[k % GAME_SHAPES.length]}</span>${cellHTML(o)}</button>`)
      .join('')}</div>`;
    area.querySelectorAll('.g-opt').forEach((b) => b.addEventListener('click', () => (b.classList.add('picked'), send(Number(b.dataset.i)))));
  } else if (q.kind === 'truefalse') {
    area.innerHTML = `<div class="g-options two"><button class="g-opt" style="--c:#26890c" data-v="1"><span class="g-shape">✔</span><span class="g-cell">صحيح</span></button>
      <button class="g-opt" style="--c:#e21b3c" data-v="0"><span class="g-shape">✘</span><span class="g-cell">خطأ</span></button></div>`;
    area.querySelectorAll('.g-opt').forEach((b) => b.addEventListener('click', () => (b.classList.add('picked'), send(b.dataset.v === '1'))));
  } else if (q.kind === 'order') {
    const pics = q.items.some((o) => o.img);
    area.innerHTML = `<p class="g-hint">✋ اسحب البطاقات لترتيبها (من الأعلى إلى الأسفل)</p>
      <ul class="g-order ${pics ? 'pics' : ''}">${q.items.map((o) => `<li class="g-drag" data-i="${o.i}"><span class="g-pos"></span>${cellHTML(o)}
        <span class="g-arrows"><button type="button" data-up aria-label="أعلى">▲</button><button type="button" data-down aria-label="أسفل">▼</button></span></li>`).join('')}</ul>
      <button class="g-confirm" id="g-ok">تأكيد الترتيب ✓</button>`;
    const list = area.querySelector('.g-order');
    const number = () => [...list.children].forEach((li, k) => (li.querySelector('.g-pos').textContent = k + 1));
    number();
    sortable(list, number);
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (e.target.closest('[data-up]') && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
      if (e.target.closest('[data-down]') && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
      number();
    });
    $('#g-ok').addEventListener('click', () => send([...list.children].map((li) => Number(li.dataset.i))));
  } else if (q.kind === 'match') {
    area.innerHTML = `<p class="g-hint">✋ اسحب كل بطاقة إلى مكانها (أو المسها ثمّ المس الخانة)</p>
      <div class="g-match">${q.left.map((l) => `<div class="g-row"><span class="g-left">${cellHTML(l)}</span><span class="g-slot" data-slot="${l.i}"></span></div>`).join('')}</div>
      <div class="g-pool">${q.right.map((r) => `<span class="g-chip g-drag" data-i="${r.i}">${cellHTML(r)}</span>`).join('')}</div>
      <button class="g-confirm" id="g-ok" disabled>تأكيد ✓</button>`;
    matcher(area, () => ($('#g-ok').disabled = !!area.querySelector('.g-pool .g-chip')));
    $('#g-ok').addEventListener('click', () => {
      const arr = [];
      q.left.forEach((l) => (arr[l.i] = Number(area.querySelector(`[data-slot="${l.i}"] .g-chip`)?.dataset.i ?? -1)));
      send(arr);
    });
  } else if (q.kind === 'connect') {
    area.innerHTML = `<p class="g-hint">🏹 المس عنصرًا ثمّ ما يقابله لرسم السهم (أو اسحب بينهما). المس سهمًا مرسومًا لحذفه.</p>
      <div class="g-connect"><svg class="g-lines"><defs>${GAME_COLORS.map((c, k) => `<marker id="g-arrow${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('')}</defs></svg>
        <div class="g-col" data-col="l">${q.left.map((l) => `<button type="button" class="g-node" data-side="l" data-i="${l.i}">${cellHTML(l)}<i class="g-dot"></i></button>`).join('')}</div>
        <div class="g-col" data-col="r">${q.right.map((r) => `<button type="button" class="g-node" data-side="r" data-i="${r.i}"><i class="g-dot"></i>${cellHTML(r)}</button>`).join('')}</div></div>
      <button class="g-confirm" id="g-ok" disabled>تأكيد ✓</button>`;
    const links = connector(area.querySelector('.g-connect'), q.left.length, (n) => ($('#g-ok').disabled = n < q.left.length));
    $('#g-ok').addEventListener('click', () => {
      const arr = [];
      q.left.forEach((l) => (arr[l.i] = links.get(l.i) ?? -1));
      send(arr);
    });
  } else if (q.kind === 'categorize') {
    area.innerHTML = `<p class="g-hint">🗂️ اسحب كل بطاقة إلى مجموعتها (أو المسها ثمّ المس المجموعة)</p>
      <div class="g-buckets n${q.groups.length}">${q.groups.map((g, k) => `<div class="g-bucket" style="--c:${GAME_COLORS[k % GAME_COLORS.length]}"><h4>${esc(g)}</h4><div class="g-slot multi" data-g="${k}"></div></div>`).join('')}</div>
      <div class="g-pool">${q.items.map((x) => `<span class="g-chip g-drag" data-i="${x.i}">${cellHTML(x)}</span>`).join('')}</div>
      <button class="g-confirm" id="g-ok" disabled>تأكيد ✓</button>`;
    matcher(area, () => ($('#g-ok').disabled = !!area.querySelector('.g-pool .g-chip')));
    $('#g-ok').addEventListener('click', () => {
      const arr = [];
      area.querySelectorAll('.g-bucket .g-chip').forEach((c) => (arr[Number(c.dataset.i)] = Number(c.closest('[data-g]').dataset.g)));
      send(Array.from({ length: q.items.length }, (_, k) => arr[k] ?? -1));
    });
  } else {
    area.innerHTML = `<form class="g-type" autocomplete="off"><input id="g-typed" maxlength="120" placeholder="اكتب إجابتك هنا…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">
      <button class="g-confirm" id="g-ok" disabled>تأكيد ✓</button></form>`;
    const input = $('#g-typed');
    input.addEventListener('input', () => ($('#g-ok').disabled = !input.value.trim()));
    area.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.trim()) send(input.value.trim());
    });
    setTimeout(() => input.focus(), 50);
  }
}

// إظهار الإجابة الصحيحة على البطاقات + الحلّ في الورقة السفلية
function gameReveal(q, r, answer, stage) {
  const rv = r.reveal || {};
  if (q.kind === 'mcq') {
    stage.querySelectorAll('.g-opt').forEach((b) => {
      const i = Number(b.dataset.i);
      b.classList.add(i === rv.answer ? 'right' : i === answer ? 'wrong' : 'dim');
    });
    return '';
  }
  if (q.kind === 'truefalse') {
    stage.querySelectorAll('.g-opt').forEach((b) => {
      const v = b.dataset.v === '1';
      b.classList.add(v === rv.answer ? 'right' : v === answer ? 'wrong' : 'dim');
    });
    return '';
  }
  if (q.kind === 'type') {
    stage.querySelector('#g-typed')?.classList.add(r.correct ? 'right' : 'wrong');
    return r.correct ? '' : `<div class="g-solution"><span>الإجابة الصحيحة:</span> <b>${esc(rv.answers?.[0] ?? '')}</b></div>`;
  }
  if (q.kind === 'order') {
    stage.querySelectorAll('.g-order li').forEach((li, k) => li.classList.add(Number(li.dataset.i) === k ? 'ok' : 'ko'));
    return r.correct ? '' : `<ol class="g-solution">${rv.items.map((c) => `<li>${cellHTML(c)}</li>`).join('')}</ol>`;
  }
  if (q.kind === 'match') {
    stage.querySelectorAll('.g-slot[data-slot]').forEach((s) => s.classList.add(Number(s.querySelector('.g-chip')?.dataset.i) === Number(s.dataset.slot) ? 'ok' : 'ko'));
    return r.correct ? '' : `<ul class="g-solution pairs">${rv.pairs.map((p) => `<li>${cellHTML(p[0])}<span>↔</span>${cellHTML(p[1])}</li>`).join('')}</ul>`;
  }
  if (q.kind === 'connect') {
    stage.querySelectorAll('.g-lines path').forEach((p) => p.classList.add(p.dataset.l === p.dataset.r ? 'ok' : 'ko'));
    return r.correct ? '' : `<ul class="g-solution pairs">${rv.pairs.map((p) => `<li>${cellHTML(p[0])}<span>→</span>${cellHTML(p[1])}</li>`).join('')}</ul>`;
  }
  if (q.kind === 'categorize') {
    stage.querySelectorAll('.g-bucket .g-chip').forEach((c) => c.classList.add(rv.items[Number(c.dataset.i)]?.g === Number(c.closest('[data-g]').dataset.g) ? 'ok' : 'ko'));
    return r.correct
      ? ''
      : `<div class="g-solution groups">${rv.groups.map((g, k) => `<div><b>${esc(g)}</b>${rv.items.filter((x) => x.g === k).map((x) => cellHTML(x)).join('')}</div>`).join('')}</div>`;
  }
  return '';
}

// ترتيب بالسحب (فأرة ولمس) — الأسهم بديل للوصول
function sortable(list, changed = () => {}) {
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
    changed();
  });
  const stop = () => {
    drag?.classList.remove('dragging');
    drag = null;
    changed();
  };
  list.addEventListener('pointerup', stop);
  list.addEventListener('pointercancel', stop);
}

// سحب وإفلات: البطاقة إلى خانة (واحدة) أو مجموعة (عدّة بطاقات)، أو لمسة على البطاقة ثمّ على الخانة
function matcher(area, changed) {
  const pool = area.querySelector('.g-pool');
  let picked = null;
  let ghost = null;
  let from = null;
  let moved = false;
  const place = (chip, slot) => {
    if (!slot) return pool.appendChild(chip);
    if (!slot.classList.contains('multi')) {
      const old = slot.querySelector('.g-chip');
      if (old && old !== chip) pool.appendChild(old);
    }
    slot.appendChild(chip);
    gameSound.pop();
  };
  const slotAt = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    return hit?.closest('.g-slot') || hit?.closest('.g-bucket')?.querySelector('.g-slot');
  };
  const pick = (chip) => {
    area.querySelectorAll('.g-chip.sel').forEach((c) => c.classList.remove('sel'));
    picked = chip;
    chip?.classList.add('sel');
  };
  area.addEventListener('click', (e) => {
    if (moved || area.querySelector('.locked')) return;
    const chip = e.target.closest('.g-chip');
    const slot = e.target.closest('.g-slot') || e.target.closest('.g-bucket')?.querySelector('.g-slot');
    // بطاقة مختارة + لمسة على خانة (أو مجموعة): توضع فيها
    if (picked && slot && chip !== picked) {
      place(picked, slot);
      pick(null);
      return changed();
    }
    if (chip) return pick(picked === chip ? null : chip);
    if (picked && e.target.closest('.g-pool')) {
      place(picked, null);
      pick(null);
      changed();
    }
  });
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
    area.querySelectorAll('.g-slot, .g-bucket').forEach((s) => s.classList.remove('hover'));
    const s = slotAt(e.clientX, e.clientY);
    (s?.closest('.g-bucket') || s)?.classList.add('hover');
  });
  const up = (e) => {
    if (!from) return;
    if (moved) {
      ghost?.remove();
      from.chip.classList.remove('dragging');
      area.querySelectorAll('.g-slot, .g-bucket').forEach((s) => s.classList.remove('hover'));
      const slot = slotAt(e.clientX, e.clientY);
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

// اربط بسهم: لمسة على عنصر ثمّ على ما يقابله، أو سحب بينهما؛ الأسهم ترسم في SVG
function connector(box, n, changed) {
  const svg = box.querySelector('.g-lines');
  const links = new Map(); // يسار ← يمين
  let sel = null;
  let temp = null;
  const node = (side, i) => box.querySelector(`.g-node[data-side="${side}"][data-i="${i}"]`);
  const dot = (el) => {
    const b = box.getBoundingClientRect();
    const r = el.querySelector('.g-dot').getBoundingClientRect();
    return [r.left + r.width / 2 - b.left, r.top + r.height / 2 - b.top];
  };
  const curve = ([x1, y1], [x2, y2]) => {
    const dx = (x2 - x1) * 0.45;
    return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };
  const order = [...box.querySelectorAll('.g-node[data-side="l"]')].map((x) => Number(x.dataset.i));
  const draw = () => {
    svg.querySelectorAll('path').forEach((p) => p.remove());
    svg.setAttribute('viewBox', `0 0 ${box.clientWidth} ${box.clientHeight}`);
    box.querySelectorAll('.g-node').forEach((x) => x.style.removeProperty('--lc'));
    for (const [l, r] of links) {
      const k = order.indexOf(l) % GAME_COLORS.length;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', curve(dot(node('l', l)), dot(node('r', r))));
      p.setAttribute('stroke', GAME_COLORS[k]);
      p.setAttribute('marker-end', `url(#g-arrow${k})`);
      p.dataset.l = l;
      p.dataset.r = r;
      svg.appendChild(p);
      node('l', l).style.setProperty('--lc', GAME_COLORS[k]);
      node('r', r).style.setProperty('--lc', GAME_COLORS[k]);
    }
    box.querySelectorAll('.g-node').forEach((x) => x.classList.toggle('linked', x.dataset.side === 'l' ? links.has(Number(x.dataset.i)) : [...links.values()].includes(Number(x.dataset.i))));
    changed(links.size);
  };
  const link = (a, b) => {
    const l = a.dataset.side === 'l' ? a : b;
    const r = a.dataset.side === 'l' ? b : a;
    if (l.dataset.side === r.dataset.side) return;
    for (const [k, v] of links) if (v === Number(r.dataset.i)) links.delete(k);
    links.set(Number(l.dataset.i), Number(r.dataset.i));
    gameSound.pop();
    draw();
  };
  const select = (el) => {
    box.querySelectorAll('.g-node.sel').forEach((x) => x.classList.remove('sel'));
    sel = el;
    el?.classList.add('sel');
  };
  box.addEventListener('click', (e) => {
    if (box.querySelector('.locked')) return;
    const path = e.target.closest('path');
    if (path) {
      links.delete(Number(path.dataset.l));
      return draw();
    }
    const el = e.target.closest('.g-node');
    if (!el) return;
    if (sel && sel !== el && sel.dataset.side !== el.dataset.side) {
      link(sel, el);
      return select(null);
    }
    select(sel === el ? null : el);
  });
  // السحب من نقطة إلى أخرى
  box.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.g-node');
    if (!el || el.classList.contains('locked')) return;
    temp = { el, path: null, start: dot(el) };
  });
  box.addEventListener('pointermove', (e) => {
    if (!temp) return;
    const b = box.getBoundingClientRect();
    const pt = [e.clientX - b.left, e.clientY - b.top];
    if (!temp.path && Math.hypot(pt[0] - temp.start[0], pt[1] - temp.start[1]) < 12) return;
    if (!temp.path) {
      temp.path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      temp.path.setAttribute('class', 'temp');
      svg.appendChild(temp.path);
    }
    temp.path.setAttribute('d', curve(temp.start, pt));
  });
  window.addEventListener('pointerup', (e) => {
    if (!temp) return;
    const t = temp;
    temp = null;
    if (!t.path) return;
    t.path.remove();
    const other = document.elementFromPoint(e.clientX, e.clientY)?.closest('.g-node');
    if (other && box.contains(other) && other.dataset.side !== t.el.dataset.side) {
      link(t.el, other);
      select(null);
    }
  });
  box.querySelectorAll('.g-node').forEach((x) => (x.style.touchAction = 'none'));
  new ResizeObserver(draw).observe(box);
  draw();
  return links;
}

// ---------- الإدارة والمعلّمون: نظرة عامة، الترتيب، الإحصائيات، بنك الأسئلة ----------
async function arenaAdmin(el, hub) {
  gameState.level ||= hub.level;
  // المعلّم: أقسامه وموادّه فقط
  const isTeacher = !!hub.teacher;
  const myLevels = state.meta.levels.filter((l) => hub.levels.some((x) => x.code === l.code));
  const mySubjects = isTeacher ? state.user.subjects || [] : state.meta.subjects;
  if (!myLevels.length) {
    el.innerHTML = '<div class="arena"><div class="g-hero"><h2>🏆 ركن التحدّي</h2><p>لا توجد أقسام مسندة إليك بعد.</p></div></div>';
    return;
  }
  const tabs = [['overview', '📊 نظرة عامة'], ['stats', isTeacher ? '📈 تلاميذي' : '📈 الإحصائيات'], ['board', '🏆 الترتيب'], ['bank', isTeacher ? '📚 أسئلتي' : '📚 بنك الأسئلة']];
  el.innerHTML = `
    <div class="arena">
      <div class="g-hero">
        <div class="g-hero-top"><div><small>🏆 ركن التحدّي</small><h2>${isTeacher ? 'أسئلة أقسامي' : 'لوحة الإدارة'}</h2>
          <span class="g-level">${isTeacher ? 'أضف تمارين موادّك حسب المحور، وتابع تلاميذك' : 'المعلّمون يدخلون الأسئلة حسب المحور'} · ${hub.rounds_week} جولة هذا الأسبوع</span></div>
          <button class="g-icon-btn" id="g-mute">${gameSound.muted() ? '🔇' : '🔊'}</button></div>
      </div>
      <div class="g-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${gameState.adminTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="g-panel" id="g-panel"></div>
    </div>`;
  $('#g-mute').addEventListener('click', (e) => (e.currentTarget.textContent = gameSound.toggle() ? '🔇' : '🔊'));
  el.querySelectorAll('.g-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => ((gameState.adminTab = b.dataset.tab), arenaAdmin(el, hub))));
  const p = $('#g-panel');
  const levelSelect = (id, val) => `<select id="${id}">${myLevels.map((l) => `<option value="${esc(l.code)}" ${l.code === val ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select>`;
  const tryRound = async (level) => {
    try {
      gameState.level = level;
      gameState.last = { level };
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
        <li>كل معلّم يدخل تمارين مادّته لأقسامه، ويحدّد <b>المحور</b> (مثلًا: الجمع، الكسور، النبات…) أو يتركه فارغًا لسؤال <b>شامل</b> لكل المحاور.</li>
        <li>مادّة «علوم (حساب + إيقاظ)»: لكل سؤال فرعه، ولكل فرع تحدّيه وترتيبه.</li>
        <li>7 أنواع: اختيار من متعدّد (نصّ أو صور)، صحيح/خطأ، ترتيب (نصّ أو صور)، سحب وإفلات، اربط بسهم، صنّف في مجموعات، إجابة مكتوبة.</li>
        <li>التلميذ يختار المادّة ثمّ المحور (أو الكلّ): 10 أسئلة. الصحيح من أوّل مرّة = كل النقاط + السرعة والسلسلة ولا يعود؛ الخطأ يعود في الجولة الموالية بترتيب جديد للإجابات: نصف النقاط في المرّة الثانية ثمّ دون نقاط.</li>
        <li>ترتيب لكل مادّة وترتيب عامّ، والمعلّم يرى تلاميذه: من أجاب صحيحًا من أوّل مرّة ومن لا، سؤالًا بسؤال.</li></ul></div>`;
    p.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => tryRound(b.dataset.try)));
    p.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => questionForm({ level: b.dataset.add }, () => arenaAdmin(el, hub))));
  } else if (gameState.adminTab === 'board') {
    const key = gameState.bSubj ?? hub.subjects?.[0]?.key ?? '';
    p.innerHTML = `<div class="filters">${levelSelect('g-blevel', gameState.level)}</div>
      ${boardSubjects(hub.subjects, hub.leaderboard, key)}
      <div class="g-seg"><button data-b="week" class="${gameState.board === 'week' ? 'on' : ''}">هذا الأسبوع</button><button data-b="all" class="${gameState.board === 'all' ? 'on' : ''}">منذ البداية</button></div>
      ${boardList(pickBoard(hub.leaderboard, key)?.[gameState.board], 'لا لاعبين بعد في هذا القسم')}`;
    $('#g-blevel').addEventListener('change', (e) => ((gameState.level = e.target.value), (gameState.bSubj = null), viewArena(el)));
    p.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => ((gameState.board = b.dataset.b), arenaAdmin(el, hub))));
    p.querySelectorAll('[data-bs]').forEach((b) => b.addEventListener('click', () => ((gameState.bSubj = b.dataset.bs), arenaAdmin(el, hub))));
  } else if (gameState.adminTab === 'stats') {
    // إحصائيات التلاميذ: المعلّم لتلاميذه في موادّه، الإدارة كاملة
    if (!myLevels.some((l) => l.code === gameState.level)) gameState.level = myLevels[0].code;
    const qs = trackParams(gameState.sTrack, new URLSearchParams({ level: gameState.level }));
    if (gameState.sTopic) qs.set('topic', gameState.sTopic);
    p.innerHTML = '<p class="muted">…</p>';
    let st;
    try {
      st = await api('GET', '/api/game/stats?' + qs);
    } catch (err) {
      p.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
      return;
    }
    const track = st.tracks.find((t) => t.key === gameState.sTrack);
    const players = st.students.filter((x) => x.attempts);
    const sum = (k) => st.students.reduce((t, x) => t + x[k], 0);
    const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
    p.innerHTML = `<div class="filters">${levelSelect('g-slevel', gameState.level)}
        <select id="g-strack"><option value="">— كل ${isTeacher ? 'موادّي' : 'المواد'} —</option>${st.tracks.map((t) => `<option value="${esc(t.key)}" ${t.key === gameState.sTrack ? 'selected' : ''}>${esc(t.branch ? `${t.subject_name.replace(/\(.*\)/, '').trim()} · ${t.branch}` : t.name)}</option>`).join('')}</select>
        ${track ? `<select id="g-stopic"><option value="">— كل المحاور —</option>${track.topics.map((x) => `<option ${x.name === gameState.sTopic ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}${track.comprehensive ? `<option value="*" ${gameState.sTopic === '*' ? 'selected' : ''}>🧩 الأسئلة الشاملة</option>` : ''}</select>` : ''}</div>
      <div class="g-kpis">
        <div><b>${st.total}</b><span>❓ سؤال</span></div>
        <div><b>${players.length}/${st.students.length}</b><span>🎮 تلميذ لعب</span></div>
        <div class="ok"><b>${sum('first_try')}</b><span>✅ صحيح من أوّل مرّة</span></div>
        <div class="mid"><b>${sum('second_try') + sum('later')}</b><span>🔁 صحيح بعد خطأ</span></div>
        <div class="ko"><b>${sum('pending_wrong')}</b><span>✘ أخطاء تنتظر</span></div>
        <div><b>${pct(sum('first_try'), sum('first_try') + sum('second_try') + sum('later') + sum('pending_wrong'))}</b><span>🎯 نجاح من أوّل مرّة</span></div>
      </div>
      ${
        st.students.length
          ? `<div class="table-wrap"><table class="g-stats"><thead><tr><th>التلميذ</th><th>النقاط</th><th>التقدّم</th><th title="صحيح من أوّل مرّة">✅ أوّل مرّة</th><th title="صحيح في المحاولة الثانية">🔁 ثانية</th><th title="صحيح بعد ذلك">↻ بعدها</th><th title="أخطأ ولم يصحّح بعد">✘ تنتظر</th><th>الصواب</th><th>جولات</th><th>آخر لعب</th><th></th></tr></thead><tbody>${st.students
              .map(
                (x) => `<tr class="${x.attempts ? '' : 'muted'}" data-st="${x.id}"><td><b>${esc(x.full_name)}</b></td><td><b>${x.points}</b></td>
                <td><div class="g-prog3" title="${x.done}/${st.total}"><i class="a" style="width:${st.total ? (100 * x.first_try) / st.total : 0}%"></i><i class="b" style="width:${st.total ? (100 * (x.second_try + x.later)) / st.total : 0}%"></i><i class="c" style="width:${st.total ? (100 * x.pending_wrong) / st.total : 0}%"></i></div><small dir="ltr">${x.done}/${st.total}</small></td>
                <td class="ok">${x.first_try || '—'}</td><td class="mid">${x.second_try || '—'}</td><td class="mid">${x.later || '—'}</td><td class="ko">${x.pending_wrong || '—'}</td>
                <td>${x.accuracy == null ? '—' : x.accuracy + '%'}</td><td>${x.rounds}</td><td><small>${x.last_played ? fmtTime(x.last_played) : 'لم يلعب'}</small></td>
                <td>${x.attempts ? '<button class="btn small ghost">التفاصيل</button>' : ''}</td></tr>`
              )
              .join('')}</tbody></table></div>`
          : `<p class="muted g-empty">${isTeacher ? 'لا تلاميذ يدرسون موادّك في هذا القسم.' : 'لا تلاميذ في هذا القسم.'}</p>`
      }
      <p class="muted small">✅ أوّل مرّة = أجاب صحيحًا من المحاولة الأولى (كل النقاط) · 🔁 ثانية = صحّحه في المرّة الثانية (نصف النقاط) · ✘ تنتظر = أخطأ ولم يصحّح بعد (يعود في جولته القادمة). اضغط على تلميذ لرؤية كل سؤال.</p>`;
    $('#g-slevel').addEventListener('change', (e) => ((gameState.level = e.target.value), (gameState.sTrack = ''), (gameState.sTopic = ''), arenaAdmin(el, hub)));
    $('#g-strack').addEventListener('change', (e) => ((gameState.sTrack = e.target.value), (gameState.sTopic = ''), arenaAdmin(el, hub)));
    $('#g-stopic')?.addEventListener('change', (e) => ((gameState.sTopic = e.target.value), arenaAdmin(el, hub)));
    p.querySelectorAll('tr[data-st]').forEach((tr) => tr.addEventListener('click', () => studentQuizDetail(Number(tr.dataset.st), qs)));
  } else {
    // بنك الأسئلة: كل سنة لوحدها، حسب المادّة/الفرع والمحور
    if (!myLevels.some((l) => l.code === gameState.qLevel)) gameState.qLevel = myLevels.some((l) => l.code === gameState.level) ? gameState.level : myLevels[0]?.code || '';
    const qs = trackParams(gameState.qTrack, new URLSearchParams({ level: gameState.qLevel }));
    if (gameState.qTopic) qs.set('topic', gameState.qTopic);
    if (gameState.qKind) qs.set('kind', gameState.qKind);
    const [{ questions }, { topics }] = await Promise.all([
      api('GET', '/api/game/questions?' + qs),
      api('GET', '/api/game/topics?' + trackParams(gameState.qTrack, new URLSearchParams({ level: gameState.qLevel }))),
    ]);
    const lvl = (c) => (c ? state.meta.levels.find((l) => l.code === c)?.label || c : 'كل الأقسام');
    p.innerHTML = `
      <div class="g-bank-head">
        <div class="g-years">${myLevels
          .map((l) => `<button class="g-year ${l.code === gameState.qLevel ? 'on' : ''}" data-year="${esc(l.code)}">${esc(l.label)}<small>${hub.levels.find((x) => x.code === l.code)?.questions ?? 0}</small></button>`)
          .join('')}</div>
        <div class="filters">
          <select id="g-qs">${gameTrackOptions(mySubjects, gameState.qTrack, '— كل المواد —')}</select>
          <select id="g-qt"><option value="">— كل المحاور —</option>${topics.map((x) => `<option ${x.topic === gameState.qTopic ? 'selected' : ''}>${esc(x.topic)}</option>`).join('')}<option value="*" ${gameState.qTopic === '*' ? 'selected' : ''}>🧩 الأسئلة الشاملة</option></select>
          <select id="g-qk"><option value="">— كل الأنواع —</option>${Object.entries(GAME_KIND_LABELS).map(([k, v]) => `<option value="${k}" ${k === gameState.qKind ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="g-bank-btns"><button class="btn ghost" id="g-qimp">📥 استيراد من ملف</button><button class="btn" id="g-qadd">+ سؤال جديد</button></div>
      </div>
      <p class="muted small">${esc(lvl(gameState.qLevel))}: ${questions.length} سؤال${questions.filter((q) => !q.active).length ? ` · ${questions.filter((q) => !q.active).length} موقوف/مؤرشف` : ''}</p>
      ${
        questions.length
          ? `<div class="g-qlist">${questions
              .map(
                (q) => `<div class="g-q ${q.active ? '' : 'off'}">
                  ${q.image ? `<img class="g-q-img" src="${gImg(q.image)}" alt="" loading="lazy">` : ''}
                  <div class="g-q-tags"><span class="g-kind">${GAME_KIND_LABELS[q.kind]}</span>${q.subject_name ? `<span>${esc(q.subject_name.replace(/\(.*\)/, '').trim())}${q.branch ? ' · ' + esc(q.branch) : ''}</span>` : ''}
                    <span class="g-topic-tag ${q.topic ? '' : 'all'}">${q.topic ? '📌 ' + esc(q.topic) : '🧩 شامل'}</span><span>+${q.points} · ⏱ ${q.time_limit}ث</span>
                    ${q.attempts ? `<span title="نسبة النجاح">🎯 ${Math.round((q.correct / q.attempts) * 100)}% من ${q.attempts}</span>` : ''}${q.active ? '' : '<span class="off-tag">موقوف</span>'}</div>
                  <p class="g-q-prompt">${esc(q.prompt)}</p>
                  <p class="g-q-ans small">${gameAnswerText(q)}</p>
                  ${q.author_name ? `<p class="muted small">✍️ ${esc(q.author_name)}</p>` : ''}
                  ${q.mine ? `<div class="g-q-actions"><button class="btn small ghost" data-edit="${q.id}">✏️ تعديل</button>
                    <button class="btn small ghost" data-copy="${q.id}">⧉ نسخ</button>
                    <button class="btn small ghost" data-toggle="${q.id}">${q.active ? '⏸ إيقاف' : '▶ تفعيل'}</button>
                    <button class="btn small ghost danger" data-del="${q.id}">🗑</button></div>` : ''}
                </div>`
              )
              .join('')}</div>`
          : '<div class="card empty-state"><span>📚</span><p>لا أسئلة بعد. ابدأ بإضافة أوّل سؤال!</p></div>'
      }`;
    const reload = () => arenaAdmin(el, hub);
    p.querySelectorAll('[data-year]').forEach((b) => b.addEventListener('click', () => ((gameState.qLevel = b.dataset.year), (gameState.qTopic = ''), reload())));
    $('#g-qs').addEventListener('change', (e) => ((gameState.qTrack = e.target.value), (gameState.qTopic = ''), reload()));
    $('#g-qt').addEventListener('change', (e) => ((gameState.qTopic = e.target.value), reload()));
    $('#g-qk').addEventListener('change', (e) => ((gameState.qKind = e.target.value), reload()));
    const t = splitTrack(gameState.qTrack);
    $('#g-qadd').addEventListener('click', () =>
      questionForm({ level: gameState.qLevel, subject_id: t.subject_id, branch: t.branch, topic: gameState.qTopic && gameState.qTopic !== '*' ? gameState.qTopic : '' }, reload)
    );
    $('#g-qimp').addEventListener('click', () => importQuestions(myLevels, mySubjects, reload));
    p.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => questionForm(questions.find((q) => q.id === Number(b.dataset.edit)), reload)));
    p.querySelectorAll('[data-copy]').forEach((b) =>
      b.addEventListener('click', () => {
        const q = questions.find((x) => x.id === Number(b.dataset.copy));
        questionForm({ ...q, id: null, prompt: q.prompt }, reload);
      })
    );
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

// تفاصيل تلميذ: كل سؤال ونتيجته، وملخّص حسب المحور
async function studentQuizDetail(id, qs) {
  const q2 = new URLSearchParams(qs);
  q2.delete('level');
  let d;
  try {
    d = await api('GET', `/api/game/stats/students/${id}?${q2}`);
  } catch (err) {
    return toast(err.message, true);
  }
  const RES = { first: ['✅ من أوّل مرّة', 'ok'], second: ['🔁 في المرّة الثانية', 'mid'], later: ['↻ بعد عدّة محاولات', 'mid'], pending: ['✘ أخطأ، ينتظر', 'ko'], unseen: ['⏳ لم يظهر له بعد', 'off'] };
  openModal(
    `📈 ${d.student.full_name}`,
    `<div class="table-wrap"><table class="g-stats small"><thead><tr><th>المحور</th><th>أسئلة</th><th>✅ أوّل مرّة</th><th>🔁 ثانية</th><th>↻ بعدها</th><th>✘ تنتظر</th><th>⏳ لم يظهر</th></tr></thead><tbody>${d.topics
      .map((t) => `<tr><td><b>${t.topic ? esc(t.topic) : '🧩 شامل'}</b></td><td>${t.total}</td><td class="ok">${t.first || '—'}</td><td class="mid">${t.second || '—'}</td><td class="mid">${t.later || '—'}</td><td class="ko">${t.pending || '—'}</td><td>${t.unseen || '—'}</td></tr>`)
      .join('')}</tbody></table></div>
     <div class="g-detail">${d.questions
       .map(
         (q) => `<div class="g-dq ${RES[q.result][1]}"><span class="g-dres">${RES[q.result][0]}</span>
           <p>${esc(q.prompt)}</p>
           <small>${GAME_KIND_LABELS[q.kind]}${q.topic ? ' · 📌 ' + esc(q.topic) : ' · 🧩 شامل'}${q.branch ? ' · ' + esc(q.branch) : ''}</small>
           ${q.history.length ? `<span class="g-hist">${q.history.map((h) => `<i class="${h.correct ? 'ok' : 'ko'}" title="${fmtTime(h.at)} · ${h.points} نقطة · ${Math.round(h.ms / 100) / 10} ث">${h.correct ? '✓' : '✘'}</i>`).join('')}</span>` : ''}</div>`
       )
       .join('')}</div>`,
    async () => {}
  );
  $('#modal-form button[type=submit]').hidden = true;
}

// ---------- 🖼️ رفع صورة (مصغّرة في المتصفّح) ----------
async function gameUploadImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('اختر صورة');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error('تعذّر فتح الصورة'));
      i.src = url;
    });
    const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const r = await api('POST', '/api/game/images', { data: c.toDataURL('image/jpeg', 0.82) });
    return r.id;
  } finally {
    URL.revokeObjectURL(url);
  }
}
function pickImage() {
  return new Promise((ok) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => ok(input.files[0] || null);
    input.click();
  });
}

// ---------- استمارة السؤال: الحقول تتغيّر حسب النوع، وكل خانة نصّ أو صورة ----------
function questionForm(q, done) {
  const editing = !!q?.id;
  let d = q?.data || {};
  let kind = q?.kind || 'mcq';
  const teacher = state.user.role === 'teacher';
  const subjects = teacher ? state.user.subjects || [] : state.meta.subjects;
  const cellIn = (c = '', ph = 'نصّ', cls = 'g-in') => {
    const v = typeof c === 'string' ? { t: c } : c || {};
    return `<span class="g-cellin" data-img="${v.img || ''}"><img class="g-thumb" ${v.img ? `src="${gImg(v.img)}"` : 'hidden'} alt=""><input class="${cls}" value="${esc(v.t || '')}" placeholder="${v.img ? 'تعليق (اختياري)' : ph}" maxlength="200"><button type="button" class="g-imgbtn" title="صورة">🖼️</button></span>`;
  };
  const readCell = (span) => {
    const t = span.querySelector('input').value.trim();
    const img = Number(span.dataset.img) || null;
    return img ? (t ? { img, t } : { img }) : t;
  };
  const row = (cls, inner) => `<div class="g-frow ${cls}">${inner}<button type="button" class="btn small ghost g-frm" title="حذف">✕</button></div>`;
  const optRow = (v = '', checked = false) => row('opt', `<input type="radio" name="g-correct" ${checked ? 'checked' : ''} title="الإجابة الصحيحة">${cellIn(v, 'اختيار')}`);
  const itemRow = (v = '') => row('item', `<span class="g-num"></span>${cellIn(v, 'عنصر')}`);
  const pairRow = (a = '', b = '') => row('pair', `${cellIn(a, 'العمود الأول')}<span>↔</span>${cellIn(b, 'ما يقابله', 'g-in2')}`);
  const groupRow = (v = '') => row('group', `<input class="g-gin" value="${esc(v)}" placeholder="اسم المجموعة" maxlength="200">`);
  const groupNames = () => [...document.querySelectorAll('#g-ffields .g-gin')].map((i, k) => i.value.trim() || `المجموعة ${k + 1}`);
  const catRow = (c = '', g = 0) => row('cat', `${cellIn(c, 'عنصر')}<select class="g-gsel">${groupNames().map((n, k) => `<option value="${k}" ${k === g ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`);
  const ansRow = (v = '') => row('ans', `<input class="g-in" value="${esc(v)}" placeholder="إجابة مقبولة" maxlength="200">`);
  const LIMITS = { mcq: [2, 6], order: [3, 8], match: [2, 6], connect: [2, 6], categorize: [3, 12], type: [1, 5] };
  const fields = () => {
    const same = kind === q?.kind;
    const tip = `<p class="small muted g-tip">💡 ${GAME_KIND_TIPS[kind]}</p>`;
    if (kind === 'mcq') {
      const opts = same && d.options?.length ? d.options : ['', '', '', ''];
      return `${tip}<p class="small muted">⦿ = الإجابة الصحيحة (2 إلى 6)</p><div class="g-rows">${opts.map((o, i) => optRow(o, same ? i === d.answer : i === 0)).join('')}</div><button type="button" class="btn small ghost" data-addrow>+ اختيار</button>`;
    }
    if (kind === 'truefalse') {
      return `${tip}<div class="g-tf"><label class="check"><input type="radio" name="g-tf" value="1" ${!same || d.answer !== false ? 'checked' : ''}> ✔ صحيح</label>
        <label class="check"><input type="radio" name="g-tf" value="0" ${same && d.answer === false ? 'checked' : ''}> ✘ خطأ</label></div>`;
    }
    if (kind === 'order') {
      const items = same && d.items?.length ? d.items : ['', '', ''];
      return `${tip}<p class="small muted">اكتب العناصر <b>بالترتيب الصحيح</b> (3 إلى 8)</p><div class="g-rows">${items.map((x) => itemRow(x)).join('')}</div><button type="button" class="btn small ghost" data-addrow>+ عنصر</button>`;
    }
    if (kind === 'match' || kind === 'connect') {
      const pairs = (q?.kind === 'match' || q?.kind === 'connect') && d.pairs?.length ? d.pairs : [['', ''], ['', ''], ['', '']];
      return `${tip}<p class="small muted">كل سطر = زوج صحيح (2 إلى 6)</p><div class="g-rows">${pairs.map((x) => pairRow(x[0], x[1])).join('')}</div><button type="button" class="btn small ghost" data-addrow>+ زوج</button>`;
    }
    if (kind === 'categorize') {
      const groups = same && d.groups?.length ? d.groups : ['', ''];
      return `${tip}<p class="small muted">المجموعات (2 إلى 4)</p><div class="g-groups">${groups.map((g) => groupRow(g)).join('')}</div><button type="button" class="btn small ghost" data-addgroup>+ مجموعة</button>
        <p class="small muted">العناصر ومجموعة كل عنصر (3 إلى 12)</p><div class="g-rows" data-pending="${esc(JSON.stringify(same && d.items?.length ? d.items : [{ c: '', g: 0 }, { c: '', g: 1 }, { c: '', g: 0 }]))}"></div><button type="button" class="btn small ghost" data-addrow>+ عنصر</button>`;
    }
    const answers = same && d.answers?.length ? d.answers : [''];
    return `${tip}<p class="small muted">الإجابة الصحيحة، ويمكن إضافة صيغ أخرى مقبولة (مثلًا: 12 و«اثنا عشر»)</p><div class="g-rows">${answers.map((x) => ansRow(x)).join('')}</div><button type="button" class="btn small ghost" data-addrow>+ صيغة أخرى</button>`;
  };
  const trackVal = q?.subject_id ? (q.branch ? `${q.subject_id}:${q.branch}` : String(q.subject_id)) : '';
  openModal(
    editing ? '✏️ تعديل سؤال' : '+ سؤال جديد — ركن التحدّي',
    `<div class="row">
       <label>القسم (السنة)<select name="level" required>${gameFormLevels().map((l) => `<option value="${esc(l.code)}" ${l.code === (q?.level || gameState.qLevel) ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>
       <label>المادّة<select name="track" id="g-ftrack" ${teacher ? 'required' : ''}>${gameTrackOptions(subjects, trackVal, teacher ? '' : '—')}</select></label>
     </div>
     <label>المحور <small class="muted">(اتركه فارغًا = سؤال شامل لكل المحاور)</small><input name="topic" id="g-ftopic" list="g-topics" maxlength="80" value="${esc(q?.topic || '')}" placeholder="مثال: الجمع، الكسور، النبات…"><datalist id="g-topics"></datalist></label>
     <label>نوع السؤال</label>
     <div class="g-kinds">${Object.entries(GAME_KIND_LABELS).map(([k, v]) => `<button type="button" class="g-kindbtn ${k === kind ? 'on' : ''}" data-kind="${k}">${v}</button>`).join('')}</div>
     <label>السؤال<textarea name="prompt" rows="2" maxlength="500" required placeholder="مثال: ما هو ناتج 7 × 8 ؟">${esc(q?.prompt || '')}</textarea></label>
     <div class="g-qimgin"><span class="g-cellin" id="g-pimg" data-img="${q?.image || ''}"><img class="g-thumb" ${q?.image ? `src="${gImg(q.image)}"` : 'hidden'} alt=""><input hidden><button type="button" class="g-imgbtn">🖼️ ${q?.image ? 'تغيير' : 'إضافة'} صورة للسؤال</button>${q?.image ? '<button type="button" class="g-imgdel" title="حذف الصورة">✕</button>' : ''}</span></div>
     <div id="g-ffields" class="g-ffields"></div>
     <label>شرح يظهر بعد الإجابة (اختياري)<input name="explanation" maxlength="500" value="${esc(q?.explanation || '')}"></label>
     <div class="row">
       <label>النقاط<input type="number" name="points" min="1" max="100" value="${q?.points || 10}"></label>
       <label>الوقت (ثانية)<input type="number" name="time_limit" min="5" max="300" value="${q?.time_limit || (kind === 'type' ? 45 : 30)}"></label>
     </div>
     <label class="check"><input type="checkbox" name="active" ${q?.active === false ? '' : 'checked'}> مفعّل (يظهر في الجولات)</label>`,
    async (data) => {
      const box = $('#g-ffields');
      const rows = () => [...box.querySelectorAll('.g-rows .g-frow')];
      let payload;
      if (kind === 'mcq') payload = { options: rows().map((r) => readCell(r.querySelector('.g-cellin'))), answer: rows().findIndex((r) => r.querySelector('input[type=radio]').checked) };
      else if (kind === 'truefalse') payload = { answer: box.querySelector('input[name=g-tf]:checked')?.value === '1' };
      else if (kind === 'order') payload = { items: rows().map((r) => readCell(r.querySelector('.g-cellin'))) };
      else if (kind === 'match' || kind === 'connect') payload = { pairs: rows().map((r) => [...r.querySelectorAll('.g-cellin')].map(readCell)) };
      else if (kind === 'categorize')
        payload = { groups: [...box.querySelectorAll('.g-gin')].map((i) => i.value.trim()), items: rows().map((r) => ({ c: readCell(r.querySelector('.g-cellin')), g: Number(r.querySelector('.g-gsel').value) })) };
      else payload = { answers: rows().map((r) => r.querySelector('.g-in').value.trim()) };
      const t = splitTrack(data.track);
      const body = {
        ...data, kind, data: payload, active: !!data.active, subject_id: t.subject_id, branch: t.branch, topic: data.topic || null,
        image: Number($('#g-pimg').dataset.img) || null, level: data.level || null,
      };
      await api(editing ? 'PUT' : 'POST', editing ? `/api/game/questions/${q.id}` : '/api/game/questions', body);
      toast(editing ? 'تمّ تعديل السؤال' : 'تمّت إضافة السؤال ✓');
      gameState.qTopic = data.topic && gameState.qTopic ? data.topic : gameState.qTopic;
      done?.();
    }
  );
  const box = $('#g-ffields');
  const refreshGroups = () => {
    const names = groupNames();
    box.querySelectorAll('.g-gsel').forEach((s) => {
      const v = Number(s.value) || 0;
      s.innerHTML = names.map((n, k) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(n)}</option>`).join('');
    });
  };
  const draw = () => {
    box.innerHTML = fields();
    const pend = box.querySelector('[data-pending]');
    if (pend) pend.innerHTML = JSON.parse(pend.dataset.pending).map((x) => catRow(x.c, x.g)).join('');
    box.querySelector('[data-addrow]')?.addEventListener('click', () => {
      const rows = box.querySelector('.g-rows');
      const max = LIMITS[kind][1];
      if (rows.children.length >= max) return toast(`${max} على الأقصى`, true);
      rows.insertAdjacentHTML('beforeend', { mcq: optRow, order: itemRow, match: pairRow, connect: pairRow, categorize: catRow, type: ansRow }[kind]());
    });
    box.querySelector('[data-addgroup]')?.addEventListener('click', () => {
      const g = box.querySelector('.g-groups');
      if (g.children.length >= 4) return toast('4 مجموعات على الأقصى', true);
      g.insertAdjacentHTML('beforeend', groupRow());
      refreshGroups();
    });
  };
  box.addEventListener('input', (e) => e.target.classList.contains('g-gin') && refreshGroups());
  box.addEventListener('click', (e) => {
    const rm = e.target.closest('.g-frm');
    if (!rm) return;
    const list = rm.closest('.g-rows, .g-groups');
    const min = list.classList.contains('g-groups') ? 2 : LIMITS[kind][0];
    if (list.children.length <= min) return toast(`${min} على الأقل`, true);
    rm.closest('.g-frow').remove();
    if (list.classList.contains('g-groups')) refreshGroups();
  });
  // 🖼️ صورة لأيّ خانة أو للسؤال
  $('#modal-body').addEventListener('click', async (e) => {
    const del = e.target.closest('.g-imgdel');
    if (del) {
      const span = del.closest('.g-cellin');
      span.dataset.img = '';
      span.querySelector('.g-thumb').hidden = true;
      del.remove();
      return;
    }
    const btn = e.target.closest('.g-imgbtn');
    if (!btn) return;
    const span = btn.closest('.g-cellin');
    const file = await pickImage();
    if (!file) return;
    btn.disabled = true;
    btn.classList.add('busy');
    try {
      const id = await gameUploadImage(file);
      span.dataset.img = id;
      const th = span.querySelector('.g-thumb');
      th.src = gImg(id);
      th.hidden = false;
      const inp = span.querySelector('input:not([hidden])');
      if (inp) inp.placeholder = 'تعليق (اختياري)';
      if (span.id === 'g-pimg' && !span.querySelector('.g-imgdel')) span.insertAdjacentHTML('beforeend', '<button type="button" class="g-imgdel" title="حذف الصورة">✕</button>');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
    }
  });
  // صورة خانة: لمسة على المصغّرة تحذفها
  box.addEventListener('dblclick', (e) => {
    const th = e.target.closest('.g-cellin .g-thumb');
    if (!th) return;
    th.closest('.g-cellin').dataset.img = '';
    th.hidden = true;
  });
  $('#modal-body').querySelectorAll('[data-kind]').forEach((b) =>
    b.addEventListener('click', () => {
      kind = b.dataset.kind;
      $('#modal-body').querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
      draw();
    })
  );
  // اقتراح المحاور الموجودة للمادّة والقسم
  const loadTopics = async () => {
    const qs = trackParams($('#g-ftrack').value, new URLSearchParams({ level: $('#modal-body select[name=level]').value }));
    try {
      const { topics } = await api('GET', '/api/game/topics?' + qs);
      $('#g-topics').innerHTML = topics.map((x) => `<option value="${esc(x.topic)}">${x.n} سؤال</option>`).join('');
    } catch {}
  };
  $('#g-ftrack').addEventListener('change', loadTopics);
  $('#modal-body select[name=level]').addEventListener('change', loadTopics);
  loadTopics();
  draw();
}

// أقسام استمارة السؤال: كل الأقسام للإدارة، وأقسام المعلّم فقط (من موادّه)
function gameFormLevels() {
  if (state.user.role !== 'teacher') return state.meta.levels;
  const codes = new Set((state.user.subjects || []).flatMap((x) => (x.teach_levels?.length ? x.teach_levels : x.levels?.length ? x.levels : state.meta.levels.map((l) => l.code))));
  return state.meta.levels.filter((l) => codes.has(l.code));
}

// ملخّص الإجابة في البنك والمعاينة
const gameAnswerText = (q) => {
  const d = q.data || {};
  if (q.kind === 'mcq') return d.options.map((o, i) => (i === d.answer ? `<b class="ok">✓ ${cellShort(o)}</b>` : cellShort(o))).join(' · ');
  if (q.kind === 'truefalse') return `<b class="ok">${d.answer ? '✓ صحيح' : '✘ خطأ'}</b>`;
  if (q.kind === 'order') return d.items.map((x, i) => `${i + 1}. ${cellShort(x)}`).join(' ← ');
  if (q.kind === 'categorize') return d.groups.map((g, k) => `<b>${esc(g)}:</b> ${d.items.filter((x) => x.g === k).map((x) => cellShort(x.c)).join('، ')}`).join(' · ');
  if (q.kind === 'type') return `<b class="ok">✓ ${d.answers.map(esc).join(' / ')}</b>`;
  return d.pairs.map((x) => `${cellShort(x[0])} ${q.kind === 'connect' ? '→' : '↔'} ${cellShort(x[1])}`).join(' · ');
};

// ---------- 📥 استيراد أسئلة من ملف (PDF / Word / Excel) بالذكاء الاصطناعي ----------
function importQuestions(levels, subjects, done) {
  const teacher = state.user.role === 'teacher';
  const off = !state.meta.ai_import;
  openModal(
    '📥 استيراد أسئلة من ملف',
    `<p class="muted small">ارفع ملفًا فيه مجموعة أسئلة <b>مع الإجابات الصحيحة</b> (PDF أو Word ‎.docx أو Excel ‎.xlsx). الذكاء الاصطناعي يحوّلها إلى أسئلة تفاعلية (اختيار، صحيح/خطأ، ترتيب، ربط)، ثمّ تراجعها قبل الحفظ.</p>
     ${off ? '<p class="error small">⚠️ الذكاء الاصطناعي غير مفعّل بعد على المنصّة (المفتاح ANTHROPIC_API_KEY في إعدادات Netlify). اطلب من الإدارة تفعيله.</p>' : ''}
     <div class="row">
       <label>القسم (السنة)<select name="level" required>${levels.map((l) => `<option value="${esc(l.code)}" ${l.code === gameState.qLevel ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>
       <label>المادّة<select name="track" ${teacher ? 'required' : ''}>${gameTrackOptions(subjects, gameState.qTrack, teacher ? '' : '—')}</select></label>
     </div>
     <label>المحور (اختياري: فارغ = أسئلة شاملة)<input name="topic" maxlength="80" value="${esc(gameState.qTopic && gameState.qTopic !== '*' ? gameState.qTopic : '')}"></label>
     <label>الملف<input type="file" id="gi-file" accept=".pdf,.docx,.xlsx,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label>
     <p class="muted small">حتى 4 ميغا. ملفات .doc و .xls القديمة: احفظها أوّلًا بصيغة .docx أو .xlsx أو PDF.</p>`,
    async (d) => {
      const file = $('#gi-file').files[0];
      if (!file) throw new Error('اختر الملف');
      if (file.size > 4 * 1024 * 1024) throw new Error('الملف أكبر من 4 ميغا');
      const data = await new Promise((ok, ko) => {
        const fr = new FileReader();
        fr.onload = () => ok(fr.result);
        fr.onerror = ko;
        fr.readAsDataURL(file);
      });
      const t = splitTrack(d.track);
      const r = await api('POST', '/api/game/import', { level: d.level, subject_id: t.subject_id, filename: file.name, data });
      // على Netlify: التحويل في دالّة خلفيّة (قد يأخذ دقيقة أو أكثر)
      if (!r.inline) fetch('/.netlify/functions/game-import-background', { method: 'POST', body: JSON.stringify({ id: r.id, token: r.token }) }).catch(() => {});
      setTimeout(() => importProgress(r.id, { level: d.level, subject_id: t.subject_id, branch: t.branch, topic: d.topic || null, filename: file.name }, done), 0);
    }
  );
  $('#modal-form button[type=submit]').textContent = '✨ تحويل الأسئلة';
}

function importProgress(id, scope, done) {
  const started = Date.now();
  openModal('⏳ تحويل الأسئلة بالذكاء الاصطناعي…', `<div class="gi-wait"><div class="gi-spin">✨</div><p><b>${esc(scope.filename)}</b></p>
      <p class="muted small" id="gi-msg">جاري قراءة الملف وتحويل الأسئلة… قد يأخذ ذلك دقيقة أو أكثر حسب عدد الأسئلة.</p></div>`, async () => {});
  $('#modal-form button[type=submit]').hidden = true;
  const tick = async () => {
    if (!$('#modal').open || !$('#gi-msg')) return;
    try {
      const { job } = await api('GET', `/api/game/import/${id}`);
      if (job.status === 'done') return preview(job);
      if (job.status === 'error' || job.status === 'stuck') {
        $('#gi-msg').innerHTML = `<span class="error">${job.status === 'stuck' ? 'لم يبدأ التحويل. أعد المحاولة بعد قليل.' : `تعذّر التحويل: ${esc(job.error || '')}`}</span>`;
        return;
      }
      $('#gi-msg').textContent = `جاري التحويل… ${Math.round((Date.now() - started) / 1000)} ث`;
    } catch (err) {
      $('#gi-msg').textContent = err.message;
    }
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 1500);
  const preview = (job) => {
    const qs = job.questions;
    openModal(
      `✅ ${qs.length} سؤال جاهز — راجعها قبل الحفظ`,
      `${job.skipped ? `<p class="muted small">⚠️ ${job.skipped} سؤال لم يُحوَّل (دون إجابة واضحة أو سؤال مفتوح).</p>` : ''}
       ${job.notes ? `<p class="muted small">💬 ${esc(job.notes)}</p>` : ''}
       ${qs.length
         ? `<label class="check"><input type="checkbox" id="gi-all" checked> تحديد الكلّ</label>
            <div class="gi-list">${qs
              .map((q, i) => `<label class="gi-q"><input type="checkbox" data-gi="${i}" checked>
                <span><span class="g-kind">${GAME_KIND_LABELS[q.kind]}</span><b>${esc(q.prompt)}</b><small>${gameAnswerText(q)}</small>${q.explanation ? `<small class="muted">💡 ${esc(q.explanation)}</small>` : ''}</span></label>`)
              .join('')}</div>
            <p class="muted small">بعد الحفظ تنجم تعدّل أيّ سؤال (النقاط، الوقت، المحور، الصور…) من بنك الأسئلة.</p>`
         : '<p class="error">لم نجد أسئلة بإجابات صحيحة في هذا الملف.</p>'}`,
      async () => {
        const picked = [...document.querySelectorAll('[data-gi]:checked')].map((c) => qs[Number(c.dataset.gi)]);
        if (!picked.length) throw new Error('اختر سؤالًا واحدًا على الأقلّ');
        const r = await api('POST', '/api/game/questions/bulk', { level: scope.level, subject_id: scope.subject_id, branch: scope.branch, topic: scope.topic, questions: picked });
        toast(`تمّت إضافة ${r.saved} سؤال ✓`);
        done?.();
      }
    );
    const btn = $('#modal-form button[type=submit]');
    btn.hidden = !qs.length;
    const label = () => (btn.textContent = `💾 حفظ ${document.querySelectorAll('[data-gi]:checked').length} سؤال`);
    label();
    $('#gi-all')?.addEventListener('change', (e) => {
      document.querySelectorAll('[data-gi]').forEach((c) => (c.checked = e.target.checked));
      label();
    });
    document.querySelectorAll('[data-gi]').forEach((c) => c.addEventListener('change', label));
  };
}
