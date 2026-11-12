// ---------- 🏆 ركن التحدّي (gamification) ----------
// بنك الأسئلة تدخله الإدارة فقط. التلميذ (من حساب وليّه) يلعب جولات قصيرة: نقاط، سرعة، سلاسل إجابات صحيحة،
// نجوم، شارات وترتيب حسب القسم. كل الحساب (التصحيح، التوقيت، النقاط) يتمّ في الخادم.

export const GAME_KINDS = ['mcq', 'truefalse', 'order', 'match'];
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
// اسم مختصر في الترتيب: الاسم الأول + أول حرف من اللقب
const shortName = (full) => {
  const parts = String(full || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0] || '—';
};
const starsFor = (correct, total) => {
  const r = total ? correct / total : 0;
  return r >= 1 ? 3 : r >= 0.7 ? 2 : r >= 0.4 ? 1 : 0;
};

export function registerGame({ route, one, all, pool, HttpError, text, LEVEL_CODES, LEVELS }) {
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
  const intIn = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? Math.min(hi, Math.max(lo, n)) : dflt;
  };

  async function readQuestion(body) {
    const kind = GAME_KINDS.includes(body.kind) ? body.kind : null;
    if (!kind) throw bad('نوع السؤال غير صالح');
    const level = body.level ? String(body.level) : null;
    if (level && !LEVEL_CODES.includes(level)) throw bad('القسم غير صالح');
    const subjectId = Number(body.subject_id) || null;
    if (subjectId && !(await one('SELECT 1 FROM subjects WHERE id = $1', [subjectId]))) throw bad('المادة غير موجودة');
    const prompt = text(body.prompt, { required: true, max: 500, name: 'السؤال' });
    const d = body.data || {};
    let data;
    if (kind === 'mcq') {
      const options = strList(d.options, 2, 6, 'الاختيارات');
      const answer = Number(d.answer);
      if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) throw bad('حدّد الإجابة الصحيحة');
      data = { options, answer };
    } else if (kind === 'truefalse') {
      if (typeof d.answer !== 'boolean') throw bad('حدّد: صحيح أم خطأ');
      data = { answer: d.answer };
    } else if (kind === 'order') {
      data = { items: strList(d.items, 3, 8, 'عناصر الترتيب') };
    } else {
      if (!Array.isArray(d.pairs)) throw bad('الأزواج غير صالحة');
      const left = strList(d.pairs.map((p) => p?.[0]), 2, 6, 'العمود الأول');
      const right = strList(d.pairs.map((p) => p?.[1]), 2, 6, 'العمود الثاني');
      data = { pairs: left.map((l, i) => [l, right[i]]) };
    }
    return {
      kind, level, subjectId, prompt, data,
      explanation: text(body.explanation, { max: 500, name: 'الشرح' }),
      points: intIn(body.points, 1, 100, 10),
      timeLimit: intIn(body.time_limit, 5, 300, 30),
      active: body.active === undefined ? true : !!body.active,
    };
  }

  // ---------- بنك الأسئلة (الإدارة فقط) ----------
  const Q_SELECT = `SELECT q.id, q.level, q.subject_id, s.name AS subject_name, q.kind, q.prompt, q.data, q.explanation, q.points, q.time_limit, q.active, q.created_at,
      (SELECT COUNT(*)::int FROM game_attempts a WHERE a.question_id = q.id) AS attempts,
      (SELECT COUNT(*)::int FROM game_attempts a WHERE a.question_id = q.id AND a.correct) AS correct
    FROM game_questions q LEFT JOIN subjects s ON s.id = q.subject_id`;

  route('GET', '/api/game/questions', ['admin'], async ({ query }) => {
    const where = [];
    const params = [];
    const level = query.get('level');
    if (level) {
      params.push(level);
      where.push(`(q.level = $${params.length} OR q.level IS NULL)`);
    }
    if (Number(query.get('subject_id'))) {
      params.push(Number(query.get('subject_id')));
      where.push(`q.subject_id = $${params.length}`);
    }
    if (GAME_KINDS.includes(query.get('kind'))) {
      params.push(query.get('kind'));
      where.push(`q.kind = $${params.length}`);
    }
    return { questions: await all(`${Q_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.active DESC, q.id DESC`, params) };
  });

  route('POST', '/api/game/questions', ['admin'], async ({ user, body }) => {
    const q = await readQuestion(body);
    const row = await one(
      `INSERT INTO game_questions (level, subject_id, kind, prompt, data, explanation, points, time_limit, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [q.level, q.subjectId, q.kind, q.prompt, JSON.stringify(q.data), q.explanation, q.points, q.timeLimit, q.active, user.id]
    );
    return [201, { question: await one(`${Q_SELECT} WHERE q.id = $1`, [row.id]) }];
  });

  route('PUT', '/api/game/questions/:id', ['admin'], async ({ params, body }) => {
    if (!(await one('SELECT 1 FROM game_questions WHERE id = $1', [params.id]))) throw new HttpError(404, 'السؤال غير موجود');
    const q = await readQuestion(body);
    await pool.query(
      `UPDATE game_questions SET level = $2, subject_id = $3, kind = $4, prompt = $5, data = $6, explanation = $7, points = $8, time_limit = $9, active = $10 WHERE id = $1`,
      [params.id, q.level, q.subjectId, q.kind, q.prompt, JSON.stringify(q.data), q.explanation, q.points, q.timeLimit, q.active]
    );
    return { question: await one(`${Q_SELECT} WHERE q.id = $1`, [params.id]) };
  });

  // سؤال أُجيب عنه لا يُحذف (تبقى نقاط التلاميذ): يُؤرشف فقط
  route('DELETE', '/api/game/questions/:id', ['admin'], async ({ params }) => {
    const used = await one('SELECT 1 FROM game_attempts WHERE question_id = $1 LIMIT 1', [params.id]);
    if (used) {
      await pool.query('UPDATE game_questions SET active = false WHERE id = $1', [params.id]);
      return { archived: true };
    }
    await pool.query('DELETE FROM game_questions WHERE id = $1', [params.id]);
    return { deleted: true };
  });

  // ---------- الإحصائيات، الشارات والترتيب ----------
  async function leaderboard(level, week) {
    return all(
      `SELECT st.id, st.full_name, COALESCE(SUM(a.points), 0)::int AS points, COUNT(a.id) FILTER (WHERE a.correct)::int AS correct
       FROM students st JOIN game_attempts a ON a.student_id = st.id ${week ? "AND a.created_at >= date_trunc('week', now())" : ''}
       WHERE st.level = $1 AND st.status = 'studying'
       GROUP BY st.id HAVING SUM(a.points) > 0 ORDER BY points DESC, correct DESC, st.id`,
      [level]
    );
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

  async function subjectsFor(level) {
    return all(
      `SELECT s.id, s.name, COUNT(q.id)::int AS count FROM game_questions q JOIN subjects s ON s.id = q.subject_id
       WHERE q.active AND (q.level = $1 OR q.level IS NULL) GROUP BY s.id, s.name ORDER BY s.id`,
      [level]
    );
  }
  const countFor = async (level) =>
    (await one('SELECT COUNT(*)::int AS n FROM game_questions WHERE active AND (level = $1 OR level IS NULL)', [level])).n;

  // التلميذ الذي يلعب: من أبناء الولي، يدرس حاليًا
  async function playerFor(user, studentId) {
    const st = await one(`SELECT id, full_name, level, parent_id, status FROM students WHERE id = $1`, [Number(studentId) || 0]);
    if (!st || (user.role === 'parent' && st.parent_id !== user.id)) throw new HttpError(404, 'التلميذ غير موجود');
    return st;
  }

  route('GET', '/api/game/hub', ['admin', 'parent'], async ({ user, query }) => {
    if (user.role === 'admin') {
      const levels = [];
      for (const l of LEVELS) {
        const rows = await leaderboard(l.code, true);
        levels.push({
          code: l.code, label: l.label, questions: await countFor(l.code),
          players: (await leaderboard(l.code, false)).length, week: board(rows, []).slice(0, 3),
        });
      }
      const level = LEVEL_CODES.includes(query.get('level')) ? query.get('level') : LEVELS[0]?.code;
      return {
        admin: true, levels, level,
        leaderboard: level ? { week: board(await leaderboard(level, true), []), all: board(await leaderboard(level, false), []) } : null,
        subjects: level ? await subjectsFor(level) : [],
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
    return {
      kids, student, level_label: LEVELS.find((l) => l.code === student.level)?.label || student.level,
      stats, badges: badgeList(earned(stats)),
      leaderboard: { week: board(await leaderboard(student.level, true), mine), all: board(await leaderboard(student.level, false), mine) },
      subjects: await subjectsFor(student.level), total_questions: await countFor(student.level),
      recent: await all(
        `SELECT id, score, correct_count, array_length(question_ids, 1) AS total, stars, finished_at, best_streak
         FROM game_sessions WHERE student_id = $1 AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 5`,
        [student.id]
      ),
    };
  });

  // ---------- الجولات ----------
  // الولي يلعب لابنه؛ الإدارة تجرّب جولة قسم (لا تُحتسب في الترتيب)
  route('POST', '/api/game/sessions', ['admin', 'parent'], async ({ user, body }) => {
    let student = null;
    let level;
    if (user.role === 'parent') {
      student = await playerFor(user, body.student_id);
      if (student.status !== 'studying') throw bad('التلميذ لا يدرس حاليًا');
      level = student.level;
    } else {
      level = String(body.level || '');
      if (!LEVEL_CODES.includes(level)) throw bad('اختر القسم');
    }
    const subjectId = Number(body.subject_id) || null;
    // الأسئلة التي لم يُجب عنها التلميذ بعد إجابة صحيحة أولًا، ثم عشوائيًا
    const qs = await all(
      `SELECT q.id FROM game_questions q
       WHERE q.active AND (q.level = $1 OR q.level IS NULL) AND ($2::int IS NULL OR q.subject_id = $2)
       ORDER BY EXISTS (SELECT 1 FROM game_attempts a WHERE a.question_id = q.id AND a.student_id = $3 AND a.correct), random()
       LIMIT ${ROUND_SIZE}`,
      [level, subjectId, student?.id ?? null]
    );
    if (!qs.length) throw bad('لا توجد أسئلة بعد في هذا القسم');
    const before = student ? earned(await statsOf(student)) : [];
    const row = await one(
      `INSERT INTO game_sessions (student_id, played_by, level, subject_id, question_ids, badges_before) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [student?.id ?? null, user.id, level, subjectId, shuffle(qs.map((q) => q.id)), before]
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
  route('GET', '/api/game/sessions/:id/next', ['admin', 'parent'], async ({ user, params }) => {
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
    const view = { id: q.id, kind: q.kind, prompt: q.prompt, points: q.points, time_limit: q.time_limit };
    if (q.kind === 'mcq') view.options = shuffle(d.options.map((t, i) => ({ i, text: t })));
    if (q.kind === 'order') view.items = shuffleNotSorted(d.items.map((t, i) => ({ i, text: t })));
    if (q.kind === 'match') {
      view.left = d.pairs.map((p, i) => ({ i, text: p[0] }));
      view.right = shuffleNotSorted(d.pairs.map((p, i) => ({ i, text: p[1] })));
    }
    return {
      done: false, index: s.current_index, total: s.question_ids.length, score: s.score, streak: s.streak,
      remaining_ms: Math.max(0, q.time_limit * 1000 - (s.elapsed || 0)), question: view,
    };
  });

  route('POST', '/api/game/sessions/:id/answer', ['admin', 'parent'], async ({ user, params, body }) => {
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
      reveal = { answer: d.answer, options: d.options };
    } else if (q.kind === 'truefalse') {
      fraction = (a === true || a === 'true') === d.answer && (a === true || a === false || a === 'true' || a === 'false') ? 1 : 0;
      reveal = { answer: d.answer };
    } else {
      const n = q.kind === 'order' ? d.items.length : d.pairs.length;
      const arr = Array.isArray(a) && a.length === n ? a.map(Number) : [];
      fraction = arr.length ? arr.filter((v, k) => v === k).length / n : 0;
      reveal = q.kind === 'order' ? { items: d.items } : { pairs: d.pairs };
    }
    if (timedOut) fraction = 0;
    const correct = fraction === 1;
    let points = 0;
    let streak = 0;
    let bonus = { speed: 0, streak: 0, repeat: false };
    if (correct) {
      streak = s.streak + 1;
      // سؤال سبق أن أجاب عنه صحيحًا: ربع النقاط فقط (لا تضخيم للترتيب بالإعادة)
      const repeat = s.student_id
        ? !!(await one('SELECT 1 FROM game_attempts WHERE student_id = $1 AND question_id = $2 AND correct LIMIT 1', [s.student_id, q.id]))
        : false;
      const base = repeat ? Math.ceil(q.points / 4) : q.points;
      bonus = {
        speed: Math.round(base * 0.5 * Math.max(0, 1 - ms / (q.time_limit * 1000))),
        streak: streak >= 3 ? Math.min(10, 2 * (streak - 2)) : 0,
        repeat,
      };
      points = base + bonus.speed + bonus.streak;
    } else if (fraction > 0) {
      points = Math.round(q.points * fraction * 0.5);
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
