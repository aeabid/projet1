// ---------- 🏆 ركن التحدّي (gamification) ----------
// بنك الأسئلة تدخله الإدارة فقط. التلميذ (من حساب وليّه) يلعب جولات قصيرة: نقاط، سرعة، سلاسل إجابات صحيحة،
// نجوم، شارات وترتيب حسب القسم. كل الحساب (التصحيح، التوقيت، النقاط) يتمّ في الخادم.


export const GAME_KINDS = ['mcq', 'truefalse', 'order', 'match', 'connect', 'categorize', 'type'];
// فروع المادّة من اسمها: «علوم(حساب+إيقاظ)» ← حساب، إيقاظ (كل فرع تحدّيه وترتيبه)
export const branchesOf = (name) => {
  const m = String(name || '').match(/\(([^)]+)\)/);
  if (!m || !m[1].includes('+')) return [];
  return m[1].split('+').map((x) => x.trim()).filter(Boolean);
};
// مقارنة الإجابة المكتوبة: دون تشكيل، الألف والياء والتاء المربوطة موحّدة، الأرقام العربية ← لاتينية
export const normAnswer = (v) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[\s.,;:!?،؛؟'"«»()\-_]+/g, ' ')
    .trim();
const ROUND_SIZE = 10;
const GRACE_MS = 1500; // هامش لزمن الشبكة

// الشارات: تُحسب من إحصائيات التلميذ
export const GAME_BADGES = [
  ['first_round', '🎯', 'الانطلاقة', 'أنهِ أول جولة', (s) => s.rounds >= 1],
  ['perfect', '💯', 'بلا أخطاء', 'جولة كاملة دون أي خطأ', (s) => s.perfect >= 1],
  ['streak5', '🔥', 'سلسلة نارية', '5 إجابات صحيحة متتالية', (s) => s.best_streak >= 5],
  ['streak10', '☄️', 'لا يُوقَف', '10 إجابات صحيحة متتالية', (s) => s.best_streak >= 10],
  ['fast', '⚡', 'البرق', '10 إجابات صحيحة في أقل من 5 ثوانٍ', (s) => s.fast >= 10],
  ['points100', '🥉', 'مئة نقطة', 'اجمع 100 نقطة', (s) => s.points >= 100],
  ['points500', '🥈', 'خمسمائة', 'اجمع 500 نقطة', (s) => s.points >= 500],
  ['points1000', '🥇', 'الألف', 'اجمع 1000 نقطة', (s) => s.points >= 1000],
  ['stars30', '🌟', 'جامع النجوم', 'اجمع 30 نجمة', (s) => s.stars >= 30],
  ['regular', '📅', 'المواظب', 'العب في 5 أيام مختلفة', (s) => s.days >= 5],
  ['rounds20', '🏅', 'المثابر', 'أنهِ 20 جولة', (s) => s.rounds >= 20],
  ['champion', '👑', 'بطل الأسبوع', 'المرتبة الأولى في قسمك هذا الأسبوع', (s) => s.rank_week === 1],
];

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// خلط لا يُبقي الترتيب الصحيح كما هو (وإلا صار السؤال بلا معنى)
const shuffleNotSorted = (list) => {
  if (list.length < 2) return list;
  for (let k = 0; k < 10; k++) {
    const s = shuffle(list);
    if (s.some((x, i) => x.i !== i)) return s;
  }
  return [...list].reverse();
};
const imgUrl = (id) => `/api/game/images/${id}`;
// خانة للعرض: نصّ أو صورة
const cellView = (c, i) => (typeof c === 'string' ? { i, text: c } : { i, text: c.t || '', img: imgUrl(c.img) });
const cellOut = (c) => (typeof c === 'string' ? { text: c } : { text: c.t || '', img: imgUrl(c.img) });
// اسم مختصر في الترتيب: الاسم الأول + أول حرف من اللقب
const shortName = (full) => {
  const parts = String(full || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0] || '—';
};
const starsFor = (correct, total) => {
  const r = total ? correct / total : 0;
  return r >= 1 ? 3 : r >= 0.7 ? 2 : r >= 0.4 ? 1 : 0;
};

export function registerGame({ route, one, all, pool, HttpError, text, LEVEL_CODES, LEVELS, teacherSubjects, studentSubjectsOf }) {
  // المعلّم: مواده والأقسام التي يدرّسها فيها (teach_levels فارغ = كل أقسام المادة)
  async function teacherScope(user) {
    const subs = await teacherSubjects(user.id);
    const levelsOf = (s) => s.teach_levels?.length ? s.teach_levels : s.levels?.length ? s.levels : [...LEVEL_CODES];
    return {
      subjectIds: subs.map((s) => s.id),
      levels: [...new Set(subs.flatMap(levelsOf))].filter((l) => LEVEL_CODES.includes(l)),
      allows: (subjectId, level) => subs.some((s) => s.id === subjectId && levelsOf(s).includes(level)),
    };
  }
  const bad = (msg) => new HttpError(400, msg);
  const strList = (value, min, max, name) => {
    if (!Array.isArray(value)) throw bad(`${name}: القائمة غير صالحة`);
    const list = value.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
    if (list.length !== value.length) throw bad(`${name}: لا يمكن ترك خانة فارغة`);
    if (list.length < min || list.length > max) throw bad(`${name}: من ${min} إلى ${max}`);
    if (list.some((x) => x.length > 200)) throw bad(`${name}: نص طويل جدًا`);
    if (new Set(list).size !== list.length) throw bad(`${name}: عناصر مكرّرة`);
    return list;
  };
  // خانة: نصّ، أو صورة {img: معرّف, t: تعليق اختياري}
  async function readCells(value, min, max, name) {
    if (!Array.isArray(value)) throw bad(`${name}: القائمة غير صالحة`);
    const cells = value.map((x) => {
      if (typeof x === 'string') return x.trim();
      if (x && typeof x === 'object' && Number.isInteger(Number(x.img)) && Number(x.img) > 0) {
        const t = typeof x.t === 'string' ? x.t.trim().slice(0, 200) : '';
        return t ? { img: Number(x.img), t } : { img: Number(x.img) };
      }
      return '';
    });
    if (cells.some((c) => c === '')) throw bad(`${name}: لا يمكن ترك خانة فارغة`);
    if (cells.length < min || cells.length > max) throw bad(`${name}: من ${min} إلى ${max}`);
    if (cells.some((c) => typeof c === 'string' && c.length > 200)) throw bad(`${name}: نص طويل جدًا`);
    const keys = cells.map((c) => (typeof c === 'string' ? `t:${c}` : `i:${c.img}`));
    if (new Set(keys).size !== keys.length) throw bad(`${name}: عناصر مكرّرة`);
    const imgs = cells.filter((c) => typeof c === 'object').map((c) => c.img);
    if (imgs.length) {
      const found = await all('SELECT id FROM game_images WHERE id = ANY($1::int[])', [imgs]);
      if (found.length !== new Set(imgs).size) throw bad(`${name}: صورة غير موجودة`);
    }
    return cells;
  }
  const intIn = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? Math.min(hi, Math.max(lo, n)) : dflt;
  };

  async function readQuestion(body) {
    const kind = GAME_KINDS.includes(body.kind) ? body.kind : null;
    if (!kind) throw bad('نوع السؤال غير صالح');
    // كل سنة لوحدها: لكل سؤال قسم واحد
    const level = String(body.level || '');
    if (!LEVEL_CODES.includes(level)) throw bad('اختر القسم (السنة)');
    const subjectId = Number(body.subject_id) || null;
    const subject = subjectId ? await one('SELECT id, name FROM subjects WHERE id = $1', [subjectId]) : null;
    if (subjectId && !subject) throw bad('المادة غير موجودة');
    // الفرع: إجباري لمادّة فيها فروع (علوم: حساب / إيقاظ)
    const branches = branchesOf(subject?.name);
    let branch = text(body.branch, { max: 60, name: 'الفرع' });
    if (branches.length) {
      if (!branch || !branches.includes(branch)) throw bad(`اختر الفرع: ${branches.join(' أو ')}`);
    } else branch = null;
    // المحور: فارغ = سؤال شامل لكل المحاور
    const topic = text(body.topic, { max: 80, name: 'المحور' });
    const image = Number(body.image) || null;
    if (image && !(await one('SELECT 1 FROM game_images WHERE id = $1', [image]))) throw bad('صورة السؤال غير موجودة');
    const prompt = text(body.prompt, { required: true, max: 500, name: 'السؤال' });
    const d = body.data || {};
    let data;
    if (kind === 'mcq') {
      const options = await readCells(d.options, 2, 6, 'الاختيارات');
      const answer = Number(d.answer);
      if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) throw bad('حدّد الإجابة الصحيحة');
      data = { options, answer };
    } else if (kind === 'truefalse') {
      if (typeof d.answer !== 'boolean') throw bad('حدّد: صحيح أم خطأ');
      data = { answer: d.answer };
    } else if (kind === 'order') {
      data = { items: await readCells(d.items, 3, 8, 'عناصر الترتيب') };
    } else if (kind === 'match' || kind === 'connect') {
      if (!Array.isArray(d.pairs)) throw bad('الأزواج غير صالحة');
      const left = await readCells(d.pairs.map((p) => p?.[0] ?? ''), 2, 6, 'العمود الأول');
      const right = await readCells(d.pairs.map((p) => p?.[1] ?? ''), 2, 6, 'العمود الثاني');
      data = { pairs: left.map((l, i) => [l, right[i]]) };
    } else if (kind === 'categorize') {
      const groups = strList(d.groups, 2, 4, 'المجموعات');
      if (!Array.isArray(d.items)) throw bad('العناصر غير صالحة');
      const cells = await readCells(d.items.map((x) => x?.c ?? ''), 3, 12, 'العناصر');
      const gs = d.items.map((x) => Number(x?.g));
      if (gs.some((g) => !Number.isInteger(g) || g < 0 || g >= groups.length)) throw bad('حدّد مجموعة كل عنصر');
      if (groups.some((_, k) => !gs.includes(k))) throw bad('كل مجموعة تحتاج عنصرًا واحدًا على الأقلّ');
      data = { groups, items: cells.map((c, i) => ({ c, g: gs[i] })) };
    } else {
      // إجابة مكتوبة: إجابة صحيحة أو أكثر (مثلًا 12 و اثنا عشر)
      const answers = strList(d.answers, 1, 5, 'الإجابات المقبولة');
      if (answers.some((x) => !normAnswer(x))) throw bad('الإجابات المقبولة: نصّ غير صالح');
      data = { answers };
    }
    return {
      kind, level, subjectId, prompt, data, branch, topic, image,
      explanation: text(body.explanation, { max: 500, name: 'الشرح' }),
      points: intIn(body.points, 1, 100, 10),
      timeLimit: intIn(body.time_limit, 5, 300, 30),
      active: body.active === undefined ? true : !!body.active,
    };
  }

  // ---------- بنك الأسئلة: الإدارة (كل الأسئلة) والمعلّمون (في موادهم وأقسامهم، ويعدّلون أسئلتهم فقط) ----------
  const Q_SELECT = `SELECT q.id, q.level, q.subject_id, s.name AS subject_name, q.branch, q.topic, q.image, q.kind, q.prompt, q.data, q.explanation, q.points, q.time_limit, q.active, q.created_at,
      q.created_by, cu.full_name AS author_name,
      (SELECT COUNT(*)::int FROM game_attempts a WHERE a.question_id = q.id) AS attempts,
      (SELECT COUNT(*)::int FROM game_attempts a WHERE a.question_id = q.id AND a.correct) AS correct
    FROM game_questions q LEFT JOIN subjects s ON s.id = q.subject_id LEFT JOIN users cu ON cu.id = q.created_by`;
  const withMine = (user, q) => q && { ...q, mine: user.role === 'admin' || q.created_by === user.id };
  // المعلّم: المادة إجبارية، ويدرّسها في هذا القسم
  async function checkTeacherQuestion(user, q) {
    if (user.role !== 'teacher') return;
    if (!q.subjectId) throw bad('اختر المادة');
    if (!(await teacherScope(user)).allows(q.subjectId, q.level)) throw new HttpError(403, 'هذه المادة أو هذا القسم ليس من أقسامك');
  }
  async function ownQuestion(user, id) {
    const row = await one('SELECT id, created_by FROM game_questions WHERE id = $1', [id]);
    if (!row) throw new HttpError(404, 'السؤال غير موجود');
    if (user.role === 'teacher' && row.created_by !== user.id) throw new HttpError(403, 'لا يمكنك تعديل سؤال أضافه شخص آخر');
    return row;
  }

  route('GET', '/api/game/questions', ['admin', 'teacher'], async ({ user, query }) => {
    const where = [];
    const params = [];
    // المعلّم: أسئلته، وأسئلة زملائه في موادّه (للاطّلاع)
    if (user.role === 'teacher') {
      const sc = await teacherScope(user);
      params.push(user.id, sc.subjectIds);
      where.push(`(q.created_by = $1 OR q.subject_id = ANY($2::int[]))`);
    }
    const level = query.get('level');
    if (level) {
      params.push(level);
      where.push(`q.level = $${params.length}`);
    }
    if (Number(query.get('subject_id'))) {
      params.push(Number(query.get('subject_id')));
      where.push(`q.subject_id = $${params.length}`);
    }
    if (GAME_KINDS.includes(query.get('kind'))) {
      params.push(query.get('kind'));
      where.push(`q.kind = $${params.length}`);
    }
    if (query.get('branch')) {
      params.push(query.get('branch'));
      where.push(`q.branch = $${params.length}`);
    }
    // المحور: '*' = الأسئلة الشاملة فقط
    if (query.get('topic') === '*') where.push('q.topic IS NULL');
    else if (query.get('topic')) {
      params.push(query.get('topic'));
      where.push(`q.topic = $${params.length}`);
    }
    const rows = await all(`${Q_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.active DESC, q.id DESC`, params);
    return { questions: rows.map((q) => withMine(user, q)) };
  });

  route('POST', '/api/game/questions', ['admin', 'teacher'], async ({ user, body }) => {
    const q = await readQuestion(body);
    await checkTeacherQuestion(user, q);
    const row = await one(
      `INSERT INTO game_questions (level, subject_id, kind, prompt, data, explanation, points, time_limit, active, created_by, branch, topic, image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [q.level, q.subjectId, q.kind, q.prompt, JSON.stringify(q.data), q.explanation, q.points, q.timeLimit, q.active, user.id, q.branch, q.topic, q.image]
    );
    return [201, { question: withMine(user, await one(`${Q_SELECT} WHERE q.id = $1`, [row.id])) }];
  });

  route('PUT', '/api/game/questions/:id', ['admin', 'teacher'], async ({ user, params, body }) => {
    await ownQuestion(user, params.id);
    const q = await readQuestion(body);
    await checkTeacherQuestion(user, q);
    await pool.query(
      `UPDATE game_questions SET level = $2, subject_id = $3, kind = $4, prompt = $5, data = $6, explanation = $7, points = $8, time_limit = $9, active = $10,
         branch = $11, topic = $12, image = $13 WHERE id = $1`,
      [params.id, q.level, q.subjectId, q.kind, q.prompt, JSON.stringify(q.data), q.explanation, q.points, q.timeLimit, q.active, q.branch, q.topic, q.image]
    );
    return { question: withMine(user, await one(`${Q_SELECT} WHERE q.id = $1`, [params.id])) };
  });

  // ---------- 🖼️ صور الأسئلة ----------
  route('POST', '/api/game/images', ['admin', 'teacher'], async ({ user, body }) => {
    const m = String(body?.data || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw bad('صورة غير صالحة (JPG أو PNG)');
    if (m[2].length > 900 * 1024) throw bad('الصورة كبيرة جدًا');
    const row = await one('INSERT INTO game_images (mime, data, created_by) VALUES ($1, $2, $3) RETURNING id', [m[1], m[2], user.id]);
    return [201, { id: row.id, url: `/api/game/images/${row.id}` }];
  });
  route('GET', '/api/game/images/:id', ['admin', 'teacher', 'parent'], async ({ params }) => {
    const img = await one('SELECT mime, data FROM game_images WHERE id = $1', [params.id]);
    if (!img) throw new HttpError(404, 'الصورة غير موجودة');
    return new Response(Buffer.from(img.data, 'base64'), { headers: { 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=2592000, immutable' } });
  });

  // المحاور الموجودة (للاقتراح في الاستمارة) + فروع المواد
  route('GET', '/api/game/topics', ['admin', 'teacher'], async ({ query }) => {
    const rows = await all(
      `SELECT topic, COUNT(*)::int AS n FROM game_questions
       WHERE topic IS NOT NULL AND ($1::text IS NULL OR level = $1) AND ($2::int IS NULL OR subject_id = $2) AND ($3::text IS NULL OR branch = $3)
       GROUP BY topic ORDER BY topic`,
      [query.get('level') || null, Number(query.get('subject_id')) || null, query.get('branch') || null]
    );
    const subjects = await all('SELECT id, name FROM subjects ORDER BY id');
    return { topics: rows, branches: Object.fromEntries(subjects.map((x) => [x.id, branchesOf(x.name)]).filter((x) => x[1].length)) };
  });

  // سؤال أُجيب عنه لا يُحذف (تبقى نقاط التلاميذ): يُؤرشف فقط
  route('DELETE', '/api/game/questions/:id', ['admin', 'teacher'], async ({ user, params }) => {
    await ownQuestion(user, params.id);
    const used = await one('SELECT 1 FROM game_attempts WHERE question_id = $1 LIMIT 1', [params.id]);
    if (used) {
      await pool.query('UPDATE game_questions SET active = false WHERE id = $1', [params.id]);
      return { archived: true };
    }
    await pool.query('DELETE FROM game_questions WHERE id = $1', [params.id]);
    return { deleted: true };
  });

  // ---------- الإحصائيات، الشارات والترتيب ----------
  // الترتيب: عامّ (كل المواد) أو لمادّة واحدة
  // المسار = مادّة (+ فرع): كل مسار تحدّيه وترتيبه. المفتاح: «6» أو «6:حساب»
  const trackKey = (subjectId, branch) => (branch ? `${subjectId}:${branch}` : String(subjectId));
  async function leaderboard(level, week, track = null) {
    return all(
      `SELECT st.id, st.full_name, COALESCE(SUM(a.points), 0)::int AS points, COUNT(a.id) FILTER (WHERE a.correct)::int AS correct
       FROM students st JOIN game_attempts a ON a.student_id = st.id ${week ? "AND a.created_at >= date_trunc('week', now())" : ''}
       ${track ? 'JOIN game_questions gq ON gq.id = a.question_id AND gq.subject_id = $2 AND gq.branch IS NOT DISTINCT FROM $3' : ''}
       WHERE st.level = $1 AND st.status = 'studying'
       GROUP BY st.id HAVING SUM(a.points) > 0 ORDER BY points DESC, correct DESC, st.id`,
      track ? [level, track.id, track.branch || null] : [level]
    );
  }
  const boards = async (level, mine, tracks) => {
    const out = { week: board(await leaderboard(level, true), mine), all: board(await leaderboard(level, false), mine), by_subject: {} };
    for (const t of tracks) {
      out.by_subject[t.key] = { week: board(await leaderboard(level, true, t), mine), all: board(await leaderboard(level, false, t), mine) };
    }
    return out;
  };
  // مسارات القسم (مادّة + فرع) مع المحاور؛ مع تلميذ: ما أنجزه، الأخطاء التي تنتظر، والباقي
  async function tracksFor(level, student = null) {
    const sid = student?.id ?? -1;
    const rows = await all(
      `SELECT q.subject_id, s.name AS subject_name, q.branch, q.topic, COUNT(q.id)::int AS total,
         COUNT(q.id) FILTER (WHERE EXISTS (SELECT 1 FROM game_attempts a WHERE a.question_id = q.id AND a.student_id = $2 AND a.correct))::int AS done,
         COUNT(q.id) FILTER (WHERE EXISTS (SELECT 1 FROM game_attempts a WHERE a.question_id = q.id AND a.student_id = $2 AND NOT a.correct)
           AND NOT EXISTS (SELECT 1 FROM game_attempts a WHERE a.question_id = q.id AND a.student_id = $2 AND a.correct))::int AS pending
       FROM game_questions q JOIN subjects s ON s.id = q.subject_id
       WHERE q.active AND (q.level = $1 OR q.level IS NULL)
       GROUP BY q.subject_id, s.name, q.branch, q.topic ORDER BY q.subject_id, q.branch NULLS FIRST, q.topic NULLS LAST`,
      [level, sid]
    );
    const points = student
      ? await all(
          `SELECT g.subject_id, g.branch, SUM(a.points)::int AS points FROM game_attempts a JOIN game_questions g ON g.id = a.question_id
           WHERE a.student_id = $1 GROUP BY g.subject_id, g.branch`,
          [sid]
        )
      : [];
    const map = new Map();
    for (const r of rows) {
      const key = trackKey(r.subject_id, r.branch);
      if (!map.has(key)) {
        map.set(key, {
          key, id: r.subject_id, subject_name: r.subject_name, branch: r.branch, name: r.branch || r.subject_name,
          total: 0, done: 0, pending: 0, topics: [], comprehensive: null,
          points: points.find((p) => p.subject_id === r.subject_id && (p.branch || null) === (r.branch || null))?.points || 0,
        });
      }
      const t = map.get(key);
      t.total += r.total;
      t.done += r.done;
      t.pending += r.pending;
      const part = { name: r.topic, total: r.total, done: r.done, pending: r.pending, remaining: r.total - r.done };
      if (r.topic) t.topics.push(part);
      else t.comprehensive = part;
    }
    let list = [...map.values()].map((t) => ({ ...t, remaining: t.total - t.done }));
    if (student) {
      const mine = new Set((await studentSubjectsOf(student.id)).map((x) => x.id));
      list = list.filter((t) => mine.has(t.id));
    }
    return list;
  }
  const board = (rows, mine) => {
    const ranked = rows.map((r, i) => ({ rank: i + 1, id: r.id, name: shortName(r.full_name), points: r.points, me: mine.includes(r.id) }));
    return [...ranked.slice(0, 10), ...ranked.slice(10).filter((r) => r.me)];
  };

  async function statsOf(student) {
    const a = await one(
      `SELECT COALESCE(SUM(points), 0)::int AS points, COUNT(*) FILTER (WHERE correct)::int AS correct, COUNT(*)::int AS answered,
         COUNT(*) FILTER (WHERE correct AND ms < 5000)::int AS fast, COUNT(DISTINCT (created_at AT TIME ZONE 'Africa/Tunis')::date)::int AS days,
         COALESCE(SUM(points) FILTER (WHERE created_at >= date_trunc('week', now())), 0)::int AS week_points
       FROM game_attempts WHERE student_id = $1`,
      [student.id]
    );
    const s = await one(
      `SELECT COUNT(*)::int AS rounds, COALESCE(SUM(stars), 0)::int AS stars, COALESCE(MAX(best_streak), 0)::int AS best_streak,
         COUNT(*) FILTER (WHERE stars = 3)::int AS perfect
       FROM game_sessions WHERE student_id = $1 AND finished_at IS NOT NULL`,
      [student.id]
    );
    const week = await leaderboard(student.level, true);
    const allTime = await leaderboard(student.level, false);
    const rankOf = (rows) => {
      const i = rows.findIndex((r) => r.id === student.id);
      return i < 0 ? null : i + 1;
    };
    return { ...a, ...s, rank_week: rankOf(week), rank_all: rankOf(allTime), players: allTime.length };
  }
  const earned = (stats) => GAME_BADGES.filter((b) => b[4](stats)).map((b) => b[0]);
  const badgeList = (keys) =>
    GAME_BADGES.map(([key, icon, label, desc]) => ({ key, icon, label, desc, earned: keys.includes(key) }));

  const countFor = async (level) =>
    (await one('SELECT COUNT(*)::int AS n FROM game_questions WHERE active AND (level = $1 OR level IS NULL)', [level])).n;

  // التلميذ الذي يلعب: من أبناء الولي، يدرس حاليًا
  async function playerFor(user, studentId) {
    const st = await one(`SELECT id, full_name, level, parent_id, status FROM students WHERE id = $1`, [Number(studentId) || 0]);
    if (!st || (user.role === 'parent' && st.parent_id !== user.id)) throw new HttpError(404, 'التلميذ غير موجود');
    return st;
  }

  route('GET', '/api/game/hub', ['admin', 'parent', 'teacher'], async ({ user, query }) => {
    if (user.role === 'admin' || user.role === 'teacher') {
      // المعلّم: أقسامه فقط
      const allowed = user.role === 'teacher' ? (await teacherScope(user)).levels : LEVEL_CODES;
      const myLevels = LEVELS.filter((l) => allowed.includes(l.code));
      const levels = [];
      for (const l of myLevels) {
        const rows = await leaderboard(l.code, true);
        levels.push({
          code: l.code, label: l.label, questions: await countFor(l.code),
          players: (await leaderboard(l.code, false)).length, week: board(rows, []).slice(0, 3),
        });
      }
      const level = allowed.includes(query.get('level')) ? query.get('level') : (levels.find((l) => l.questions) || levels[0])?.code;
      return {
        admin: true, teacher: user.role === 'teacher', levels, level,
        ...(await (async () => {
          const subs = level ? await tracksFor(level) : [];
          return { subjects: subs, leaderboard: level ? await boards(level, [], subs) : null };
        })()),
        rounds_week: (await one(`SELECT COUNT(*)::int AS n FROM game_sessions WHERE student_id IS NOT NULL AND finished_at >= date_trunc('week', now())`)).n,
      };
    }
    const kids = await all(
      `SELECT id, full_name, level FROM students WHERE parent_id = $1 AND status = 'studying' ORDER BY full_name`,
      [user.id]
    );
    if (!kids.length) return { kids: [] };
    const student = kids.find((k) => k.id === Number(query.get('student_id'))) || kids[0];
    const stats = await statsOf(student);
    const mine = kids.map((k) => k.id);
    // كل مادّة لوحدها: مواد التلميذ فقط
    const subjects = await tracksFor(student.level, student);
    return {
      kids, student, level_label: LEVELS.find((l) => l.code === student.level)?.label || student.level,
      stats, badges: badgeList(earned(stats)),
      leaderboard: await boards(student.level, mine, subjects),
      subjects, total_questions: subjects.reduce((t, x) => t + x.total, 0),
      recent: await all(
        `SELECT id, score, correct_count, array_length(question_ids, 1) AS total, stars, finished_at, best_streak
         FROM game_sessions WHERE student_id = $1 AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 5`,
        [student.id]
      ),
    };
  });

  // ---------- 📈 إحصائيات التلاميذ: المعلّم (تلاميذه في موادّه وأقسامه) والإدارة (الكل) ----------
  // النطاق: القسم + المادّة/الفرع + المحور؛ المعلّم لا يرى إلا موادّه
  async function statsScope(user, query, level) {
    let subjectIds = null;
    if (user.role === 'teacher') {
      const sc = await teacherScope(user);
      if (!sc.levels.includes(level)) throw new HttpError(403, 'هذا القسم ليس من أقسامك');
      subjectIds = sc.subjectIds.filter((id) => sc.allows(id, level));
    }
    const wanted = Number(query.get('subject_id')) || null;
    if (wanted) {
      if (subjectIds && !subjectIds.includes(wanted)) throw new HttpError(403, 'هذه المادّة ليست من موادّك');
      subjectIds = [wanted];
    }
    const branch = query.get('branch') || null;
    const topic = query.get('topic') || null;
    const questions = await all(
      `SELECT q.id, q.active, q.subject_id, q.branch, q.topic FROM game_questions q
       WHERE (q.level = $1 OR q.level IS NULL) AND q.subject_id IS NOT NULL AND ($2::int[] IS NULL OR q.subject_id = ANY($2::int[]))
         AND ($3::text IS NULL OR q.branch = $3)
         AND ($4::text IS NULL OR ($4 = '*' AND q.topic IS NULL) OR q.topic = $4)`,
      [level, subjectIds, branch, topic]
    );
    return { subjectIds, branch, topic, questions, qids: questions.map((q) => q.id) };
  }
  // نتيجة التلميذ في كل سؤال: صحيح من أوّل مرّة، من الثانية، بعدها، أو خطأ ينتظر
  const PER_QUESTION = `
    WITH att AS (
      SELECT a.id, a.student_id, a.question_id, a.correct, a.points, a.ms, a.session_id, a.created_at,
        ROW_NUMBER() OVER (PARTITION BY a.student_id, a.question_id ORDER BY a.id) AS n
      FROM game_attempts a WHERE a.question_id = ANY($1::int[]) AND a.student_id IS NOT NULL
    ), per AS (
      SELECT student_id, question_id, (MIN(n) FILTER (WHERE correct))::int AS solved_at, COUNT(*)::int AS tries FROM att GROUP BY 1, 2
    )`;

  route('GET', '/api/game/stats', ['admin', 'teacher'], async ({ user, query }) => {
    const level = String(query.get('level') || '');
    if (!LEVEL_CODES.includes(level)) throw bad('اختر القسم');
    const sc = await statsScope(user, query, level);
    const tracks = (await tracksFor(level)).filter((t) => !sc.subjectIds || sc.subjectIds.includes(t.id));
    const total = sc.questions.filter((q) => q.active).length;
    // المعلّم: تلاميذه فقط (يدرسون مادّته)
    const students = await all(
      `${PER_QUESTION}
       SELECT st.id, st.full_name,
         COALESCE((SELECT SUM(points) FROM att WHERE att.student_id = st.id), 0)::int AS points,
         (SELECT COUNT(*) FROM att WHERE att.student_id = st.id)::int AS attempts,
         (SELECT COUNT(*) FROM att WHERE att.student_id = st.id AND correct)::int AS correct_attempts,
         (SELECT COUNT(*) FROM per WHERE per.student_id = st.id AND solved_at = 1)::int AS first_try,
         (SELECT COUNT(*) FROM per WHERE per.student_id = st.id AND solved_at = 2)::int AS second_try,
         (SELECT COUNT(*) FROM per WHERE per.student_id = st.id AND solved_at > 2)::int AS later,
         (SELECT COUNT(*) FROM per WHERE per.student_id = st.id AND solved_at IS NULL)::int AS pending_wrong,
         (SELECT COUNT(DISTINCT session_id) FROM att WHERE att.student_id = st.id)::int AS rounds,
         (SELECT ROUND(AVG(ms) FILTER (WHERE correct) / 1000.0, 1) FROM att WHERE att.student_id = st.id)::float8 AS avg_seconds,
         (SELECT MAX(created_at) FROM att WHERE att.student_id = st.id) AS last_played
       FROM students st
       WHERE st.level = $2 AND st.status = 'studying'
         AND ($3::int[] IS NULL OR st.pack OR EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.student_id = st.id AND ss.subject_id = ANY($3::int[])))
       ORDER BY points DESC, st.full_name`,
      [sc.qids, level, user.role === 'teacher' ? sc.subjectIds : null]
    );
    return {
      level, total, tracks,
      subjects: tracks.map((t) => ({ id: t.id, key: t.key, name: t.name, branch: t.branch, total: t.total })),
      students: students.map((x) => ({
        ...x, done: x.first_try + x.second_try + x.later,
        accuracy: x.attempts ? Math.round((x.correct_attempts / x.attempts) * 100) : null,
        first_rate: x.first_try + x.second_try + x.later + x.pending_wrong ? Math.round((x.first_try / (x.first_try + x.second_try + x.later + x.pending_wrong)) * 100) : null,
      })),
    };
  });

  // تفاصيل تلميذ: كل سؤال ونتيجته (من أوّل مرّة أم لا)، وملخّص حسب المحور
  route('GET', '/api/game/stats/students/:id', ['admin', 'teacher'], async ({ user, params, query }) => {
    const st = await one(`SELECT id, full_name, level FROM students WHERE id = $1`, [params.id]);
    if (!st) throw new HttpError(404, 'التلميذ غير موجود');
    const sc = await statsScope(user, query, st.level);
    const rows = await all(
      `${PER_QUESTION}
       SELECT q.id, q.prompt, q.kind, q.topic, q.branch, q.points, q.active, s.name AS subject_name, per.solved_at, COALESCE(per.tries, 0) AS tries,
         (SELECT json_agg(json_build_object('correct', att.correct, 'points', att.points, 'ms', att.ms, 'at', att.created_at) ORDER BY att.id)
            FROM att WHERE att.student_id = $2 AND att.question_id = q.id) AS history
       FROM game_questions q LEFT JOIN subjects s ON s.id = q.subject_id
       LEFT JOIN per ON per.question_id = q.id AND per.student_id = $2
       WHERE q.id = ANY($1::int[]) AND (q.active OR per.tries IS NOT NULL)
       ORDER BY q.subject_id, q.branch NULLS FIRST, q.topic NULLS LAST, q.id`,
      [sc.qids, st.id]
    );
    const result = (r) => (!r.tries ? 'unseen' : r.solved_at === 1 ? 'first' : r.solved_at === 2 ? 'second' : r.solved_at ? 'later' : 'pending');
    const questions = rows.map((r) => ({ ...r, result: result(r), history: r.history || [] }));
    const topics = new Map();
    for (const q of questions) {
      const k = q.topic || '';
      if (!topics.has(k)) topics.set(k, { topic: q.topic, total: 0, first: 0, second: 0, later: 0, pending: 0, unseen: 0 });
      const t = topics.get(k);
      t.total++;
      t[q.result]++;
    }
    return { student: st, questions, topics: [...topics.values()] };
  });

  // ---------- الجولات ----------
  // الولي يلعب لابنه؛ الإدارة تجرّب جولة قسم (لا تُحتسب في الترتيب)
  route('POST', '/api/game/sessions', ['admin', 'parent', 'teacher'], async ({ user, body }) => {
    let student = null;
    let level;
    if (user.role === 'parent') {
      student = await playerFor(user, body.student_id);
      if (student.status !== 'studying') throw bad('التلميذ لا يدرس حاليًا');
      level = student.level;
    } else {
      level = String(body.level || '');
      if (!LEVEL_CODES.includes(level)) throw bad('اختر القسم');
      if (user.role === 'teacher' && !(await teacherScope(user)).levels.includes(level)) throw new HttpError(403, 'هذا القسم ليس من أقسامك');
    }
    const subjectId = Number(body.subject_id) || null;
    const branch = subjectId ? text(body.branch, { max: 60, name: 'الفرع' }) : null;
    // المحور: فارغ = كل أسئلة المادّة، '*' = الأسئلة الشاملة، وإلا محور واحد
    const topic = subjectId ? text(body.topic, { max: 80, name: 'المحور' }) : null;
    // كل مادّة جولاتها وحدها: التلميذ يختار مادّة من موادّه
    if (student) {
      if (!subjectId) throw bad('اختر المادّة');
      if (!(await studentSubjectsOf(student.id)).some((x) => x.id === subjectId)) throw new HttpError(403, 'هذه المادّة ليست من موادّ التلميذ');
    }
    // أسئلة لم يُجب عنها التلميذ صحيحًا بعد (المُجاب صحيحًا لا يعود). الأخطاء السابقة تعود أوّلًا في السلسلة الموالية،
    // ثمّ أسئلة جديدة عشوائيًا؛ وترتيب الأسئلة والإجابات يُخلط من جديد
    const scope = `q.active AND (q.level = $1 OR q.level IS NULL) AND ($2::int IS NULL OR (q.subject_id = $2 AND q.branch IS NOT DISTINCT FROM $3))
         AND ($4::text IS NULL OR ($4 = '*' AND q.topic IS NULL) OR q.topic = $4)`;
    const qs = await all(
      `SELECT q.id FROM game_questions q
       WHERE ${scope} AND NOT EXISTS (SELECT 1 FROM game_attempts a WHERE a.question_id = q.id AND a.student_id = $5 AND a.correct)
       ORDER BY EXISTS (SELECT 1 FROM game_attempts a WHERE a.question_id = q.id AND a.student_id = $5) DESC, random() LIMIT ${ROUND_SIZE}`,
      [level, subjectId, branch, topic, student?.id ?? -1]
    );
    if (!qs.length) {
      const any = await one(`SELECT 1 FROM game_questions q WHERE ${scope} LIMIT 1`, [level, subjectId, branch, topic]);
      throw bad(any ? 'أكملت كل أسئلة هذا التحدّي 🎉 انتظر أسئلة جديدة' : 'لا توجد أسئلة بعد هنا');
    }
    const before = student ? earned(await statsOf(student)) : [];
    const row = await one(
      `INSERT INTO game_sessions (student_id, played_by, level, subject_id, question_ids, badges_before, branch, topic) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [student?.id ?? null, user.id, level, subjectId, shuffle(qs.map((q) => q.id)), before, branch, topic]
    );
    return [201, { id: row.id, total: qs.length, preview: !student }];
  });

  async function loadSession(user, id) {
    const s = await one(
      `SELECT gs.*, (EXTRACT(EPOCH FROM (now() - gs.served_at)) * 1000)::int AS elapsed, st.parent_id, st.level AS student_level
       FROM game_sessions gs LEFT JOIN students st ON st.id = gs.student_id WHERE gs.id = $1`,
      [Number(id) || 0]
    );
    const mine = s && (user.role === 'parent' ? s.parent_id === user.id : s.student_id === null && s.played_by === user.id);
    if (!mine) throw new HttpError(404, 'الجولة غير موجودة');
    return s;
  }

  async function summary(s, user) {
    const total = s.question_ids.length;
    const out = { done: true, score: s.score, correct: s.correct_count, total, stars: s.stars ?? starsFor(s.correct_count, total), best_streak: s.best_streak, preview: !s.student_id, new_badges: [] };
    if (s.student_id) {
      const st = await one('SELECT id, level FROM students WHERE id = $1', [s.student_id]);
      const stats = await statsOf(st);
      const now = earned(stats);
      out.new_badges = badgeList(now).filter((b) => b.earned && !s.badges_before.includes(b.key));
      out.rank_week = stats.rank_week;
      out.week_points = stats.week_points;
    }
    return out;
  }

  // السؤال الحالي دون الإجابة؛ وقت العرض يُسجَّل مرة واحدة (إعادة الطلب لا تعيد العدّاد)
  route('GET', '/api/game/sessions/:id/next', ['admin', 'parent', 'teacher'], async ({ user, params }) => {
    let s = await loadSession(user, params.id);
    if (s.finished_at) return await summary(s, user);
    let q = null;
    while (s.current_index < s.question_ids.length) {
      q = await one('SELECT * FROM game_questions WHERE id = $1', [s.question_ids[s.current_index]]);
      if (q) break;
      await pool.query('UPDATE game_sessions SET current_index = current_index + 1, served_at = NULL WHERE id = $1', [s.id]);
      s = await loadSession(user, params.id);
    }
    if (!q) {
      await pool.query('UPDATE game_sessions SET finished_at = now(), stars = $2 WHERE id = $1', [s.id, starsFor(s.correct_count, s.question_ids.length)]);
      return await summary(await loadSession(user, params.id), user);
    }
    if (!s.served_at) {
      await pool.query('UPDATE game_sessions SET served_at = now() WHERE id = $1', [s.id]);
      s.elapsed = 0;
    }
    const d = q.data;
    const view = {
      id: q.id, kind: q.kind, prompt: q.prompt, points: q.points, time_limit: q.time_limit, topic: q.topic,
      image: q.image ? imgUrl(q.image) : null,
      // محاولة سابقة خاطئة: يعرف التلميذ أنّه سؤال يعود (بنصف النقاط ثمّ دون نقاط)
      retry: s.student_id ? (await one('SELECT COUNT(*)::int AS n FROM game_attempts WHERE student_id = $1 AND question_id = $2', [s.student_id, q.id])).n : 0,
    };
    if (q.kind === 'mcq') view.options = shuffleNotSorted(d.options.map((c, i) => cellView(c, i)));
    if (q.kind === 'order') view.items = shuffleNotSorted(d.items.map((c, i) => cellView(c, i)));
    if (q.kind === 'match' || q.kind === 'connect') {
      view.left = shuffle(d.pairs.map((p, i) => cellView(p[0], i)));
      view.right = shuffleNotSorted(d.pairs.map((p, i) => cellView(p[1], i)));
    }
    if (q.kind === 'categorize') {
      view.groups = d.groups;
      view.items = shuffle(d.items.map((x, i) => cellView(x.c, i)));
    }
    return {
      done: false, index: s.current_index, total: s.question_ids.length, score: s.score, streak: s.streak,
      remaining_ms: Math.max(0, q.time_limit * 1000 - (s.elapsed || 0)), question: view,
    };
  });

  route('POST', '/api/game/sessions/:id/answer', ['admin', 'parent', 'teacher'], async ({ user, params, body }) => {
    const s = await loadSession(user, params.id);
    if (s.finished_at) throw new HttpError(409, 'انتهت الجولة');
    if (!s.served_at) throw new HttpError(409, 'السؤال لم يُعرض بعد');
    const q = await one('SELECT * FROM game_questions WHERE id = $1', [s.question_ids[s.current_index]]);
    if (!q) throw new HttpError(409, 'السؤال لم يعد موجودًا');
    const d = q.data;
    const ms = Math.max(0, s.elapsed || 0);
    const timedOut = ms > q.time_limit * 1000 + GRACE_MS || body.timeout === true;
    let fraction = 0;
    let reveal;
    const a = body.answer;
    if (q.kind === 'mcq') {
      fraction = Number(a) === d.answer ? 1 : 0;
      reveal = { answer: d.answer, options: d.options.map(cellOut) };
    } else if (q.kind === 'truefalse') {
      fraction = (a === true || a === 'true') === d.answer && (a === true || a === false || a === 'true' || a === 'false') ? 1 : 0;
      reveal = { answer: d.answer };
    } else if (q.kind === 'type') {
      fraction = typeof a === 'string' && normAnswer(a) && d.answers.some((x) => normAnswer(x) === normAnswer(a)) ? 1 : 0;
      reveal = { answers: d.answers };
    } else if (q.kind === 'categorize') {
      // الإجابة: لكل عنصر (حسب رقمه الأصلي) رقم مجموعته
      const n = d.items.length;
      const arr = Array.isArray(a) && a.length === n ? a.map(Number) : [];
      fraction = arr.length ? arr.filter((g, k) => g === d.items[k].g).length / n : 0;
      reveal = { groups: d.groups, items: d.items.map((x) => ({ ...cellOut(x.c), g: x.g })) };
    } else {
      const n = q.kind === 'order' ? d.items.length : d.pairs.length;
      const arr = Array.isArray(a) && a.length === n ? a.map(Number) : [];
      fraction = arr.length ? arr.filter((v, k) => v === k).length / n : 0;
      reveal = q.kind === 'order' ? { items: d.items.map(cellOut) } : { pairs: d.pairs.map((p) => [cellOut(p[0]), cellOut(p[1])]) };
    }
    // انتهاء الوقت = إجابة خاطئة
    if (timedOut) fraction = 0;
    const correct = fraction === 1;
    let points = 0;
    let streak = 0;
    // المحاولات الخاطئة السابقة لهذا السؤال: 0 = أوّل مرّة، 1 = المحاولة الثانية، 2+ = بعدها
    const tries = s.student_id
      ? (await one('SELECT COUNT(*)::int AS n FROM game_attempts WHERE student_id = $1 AND question_id = $2 AND NOT correct', [s.student_id, q.id])).n
      : 0;
    let bonus = { speed: 0, streak: 0, retry: tries === 0 ? null : tries === 1 ? 'half' : 'none' };
    if (correct) {
      streak = s.streak + 1;
      if (tries === 0) {
        // أوّل مرّة: النقاط كاملة + السرعة + السلسلة
        bonus.speed = Math.round(q.points * 0.5 * Math.max(0, 1 - ms / (q.time_limit * 1000)));
        bonus.streak = streak >= 3 ? Math.min(10, 2 * (streak - 2)) : 0;
        points = q.points + bonus.speed + bonus.streak;
      } else if (tries === 1) {
        // المحاولة الثانية بعد خطأ: نصف النقاط
        points = Math.ceil(q.points / 2);
      }
    }
    const next = s.current_index + 1;
    const done = next >= s.question_ids.length;
    const correctCount = s.correct_count + (correct ? 1 : 0);
    // تحديث مشروط: إجابة واحدة فقط لكل سؤال حتى مع ضغطتين متتاليتين
    const upd = await pool.query(
      `UPDATE game_sessions SET current_index = $3, served_at = NULL, score = score + $4, correct_count = $5, streak = $6,
         best_streak = GREATEST(best_streak, $6), finished_at = CASE WHEN $7 THEN now() ELSE NULL END,
         stars = CASE WHEN $7 THEN $8::int ELSE NULL END
       WHERE id = $1 AND current_index = $2 AND served_at IS NOT NULL AND finished_at IS NULL`,
      [s.id, s.current_index, next, points, correctCount, streak, done, starsFor(correctCount, s.question_ids.length)]
    );
    if (!upd.rowCount) throw new HttpError(409, 'تمّت الإجابة عن هذا السؤال');
    await pool.query(
      'INSERT INTO game_attempts (session_id, student_id, question_id, correct, ms, points) VALUES ($1, $2, $3, $4, $5, $6)',
      [s.id, s.student_id, q.id, correct, ms, points]
    );
    const out = {
      correct, partial: !correct && fraction > 0 ? fraction : 0, timed_out: timedOut, points, bonus, ms,
      streak, score: s.score + points, reveal, explanation: q.explanation, done,
    };
    if (done) out.summary = await summary(await loadSession(user, params.id), user);
    return out;
  });
}
