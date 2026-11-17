// ---------- 🏆 ركن التحدّي (gamification) ----------
// بنك الأسئلة تدخله الإدارة فقط. التلميذ (من حساب وليّه) يلعب جولات قصيرة: نقاط، سرعة، سلاسل إجابات صحيحة،
// نجوم، شارات وترتيب حسب القسم. كل الحساب (التصحيح، التوقيت، النقاط) يتمّ في الخادم.

import crypto from 'node:crypto';
import { readImportFile, processImportJob } from './importer.js';

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

export function registerGame({ route, one, all, pool, HttpError, text, LEVEL_CODES, LEVELS, teacherSubjects, studentSubjectsOf, extractQuestions = null, runImportsInline = false }) {
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

  // ---------- بنك الأسئلة: الإدارة (كل الأسئلة) والمعلّمون (في موادهم وأقسامهم، ويعدّلون أسئلتهم فقط) ----------
  const Q_SELECT = `SELECT q.id, q.level, q.subject_id, s.name AS subject_name, q.kind, q.prompt, q.data, q.explanation, q.points, q.time_limit, q.active, q.created_at,
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
    const rows = await all(`${Q_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.active DESC, q.id DESC`, params);
    return { questions: rows.map((q) => withMine(user, q)) };
  });

  route('POST', '/api/game/questions', ['admin', 'teacher'], async ({ user, body }) => {
    const q = await readQuestion(body);
    await checkTeacherQuestion(user, q);
    const row = await one(
      `INSERT INTO game_questions (level, subject_id, kind, prompt, data, explanation, points, time_limit, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [q.level, q.subjectId, q.kind, q.prompt, JSON.stringify(q.data), q.explanation, q.points, q.timeLimit, q.active, user.id]
    );
    return [201, { question: withMine(user, await one(`${Q_SELECT} WHERE q.id = $1`, [row.id])) }];
  });

  route('PUT', '/api/game/questions/:id', ['admin', 'teacher'], async ({ user, params, body }) => {
    await ownQuestion(user, params.id);
    const q = await readQuestion(body);
    await checkTeacherQuestion(user, q);
    await pool.query(
      `UPDATE game_questions SET level = $2, subject_id = $3, kind = $4, prompt = $5, data = $6, explanation = $7, points = $8, time_limit = $9, active = $10 WHERE id = $1`,
      [params.id, q.level, q.subjectId, q.kind, q.prompt, JSON.stringify(q.data), q.explanation, q.points, q.timeLimit, q.active]
    );
    return { question: withMine(user, await one(`${Q_SELECT} WHERE q.id = $1`, [params.id])) };
  });

  // ---------- 📥 استيراد أسئلة من ملف بالذكاء الاصطناعي ----------
  const levelName = (code) => LEVELS.find((l) => l.code === code)?.label || code;
  async function importScope(user, body) {
    const level = String(body.level || '');
    if (!LEVEL_CODES.includes(level)) throw bad('اختر القسم (السنة)');
    const subjectId = Number(body.subject_id) || null;
    if (subjectId && !(await one('SELECT 1 FROM subjects WHERE id = $1', [subjectId]))) throw bad('المادة غير موجودة');
    // المعلّم: مادّة يدرّسها وفي قسم يدرّسه فقط
    await checkTeacherQuestion(user, { subjectId, level });
    return { level, subjectId };
  }
  route('POST', '/api/game/import', ['admin', 'teacher'], async ({ user, body }) => {
    const { level, subjectId } = await importScope(user, body);
    if (!extractQuestions) throw new HttpError(503, 'الذكاء الاصطناعي غير مفعّل بعد: يجب إضافة المفتاح ANTHROPIC_API_KEY في إعدادات Netlify');
    let file;
    try {
      file = readImportFile(body.filename, body.data);
    } catch (err) {
      throw bad(err.message);
    }
    const token = crypto.randomBytes(24).toString('hex');
    const row = await one(
      `INSERT INTO game_import_jobs (token, created_by, level, subject_id, filename, kind, payload) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [token, user.id, level, subjectId, text(body.filename, { max: 200, name: 'اسم الملف' }), file.pdf ? 'pdf' : 'text', file.pdf || file.text]
    );
    // محلّيًا (وفي الاختبارات): المعالجة في نفس العمليّة. على Netlify: الواجهة تشغّل الدالّة الخلفيّة
    if (runImportsInline) setTimeout(() => processImportJob(pool, row.id, extractQuestions, levelName).catch(() => {}), 0);
    return [201, { id: row.id, token, inline: runImportsInline }];
  });
  route('GET', '/api/game/import/:id', ['admin', 'teacher'], async ({ user, params }) => {
    const job = await one(
      `SELECT id, created_by, level, subject_id, filename, status, result, skipped, notes, error, created_at FROM game_import_jobs WHERE id = $1`,
      [params.id]
    );
    if (!job || (user.role !== 'admin' && job.created_by !== user.id)) throw new HttpError(404, 'غير موجود');
    // طلب عالق (الدالّة الخلفيّة لم تبدأ بعد 3 دقائق)
    if (job.status === 'pending' && Date.now() - new Date(job.created_at).getTime() > 180000) job.status = 'stuck';
    return { job: { ...job, questions: job.result || [] } };
  });
  // حفظ الأسئلة المختارة بعد المعاينة (كلّها في نفس القسم والمادّة)
  route('POST', '/api/game/questions/bulk', ['admin', 'teacher'], async ({ user, body }) => {
    const { level, subjectId } = await importScope(user, body);
    const list = Array.isArray(body.questions) ? body.questions.slice(0, 200) : [];
    if (!list.length) throw bad('لا توجد أسئلة للحفظ');
    const ready = [];
    for (const [i, x] of list.entries()) {
      try {
        ready.push(await readQuestion({ ...x, level, subject_id: subjectId }));
      } catch (err) {
        throw bad(`السؤال ${i + 1}: ${err.message}`);
      }
    }
    for (const q of ready) {
      await pool.query(
        `INSERT INTO game_questions (level, subject_id, kind, prompt, data, explanation, points, time_limit, active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [q.level, q.subjectId, q.kind, q.prompt, JSON.stringify(q.data), q.explanation, q.points, q.timeLimit, q.active, user.id]
      );
    }
    return [201, { saved: ready.length }];
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
  async function leaderboard(level, week, subjectId = null) {
    return all(
      `SELECT st.id, st.full_name, COALESCE(SUM(a.points), 0)::int AS points, COUNT(a.id) FILTER (WHERE a.correct)::int AS correct
       FROM students st JOIN game_attempts a ON a.student_id = st.id ${week ? "AND a.created_at >= date_trunc('week', now())" : ''}
       ${subjectId ? 'JOIN game_questions gq ON gq.id = a.question_id AND gq.subject_id = $2' : ''}
       WHERE st.level = $1 AND st.status = 'studying'
       GROUP BY st.id HAVING SUM(a.points) > 0 ORDER BY points DESC, correct DESC, st.id`,
      subjectId ? [level, subjectId] : [level]
    );
  }
  const boards = async (level, mine, subjects) => {
    const out = { week: board(await leaderboard(level, true), mine), all: board(await leaderboard(level, false), mine), by_subject: {} };
    for (const sub of subjects) {
      out.by_subject[sub.id] = { week: board(await leaderboard(level, true, sub.id), mine), all: board(await leaderboard(level, false, sub.id), mine) };
    }
    return out;
  };
  // مواد التلميذ التي فيها أسئلة: المجموع، ما أنجزه (أجاب صحيحًا)، الباقي ونقاطه في المادّة
  async function studentSubjectsProgress(student) {
    const mine = new Set((await studentSubjectsOf(student.id)).map((x) => x.id));
    const rows = await all(
      `SELECT s.id, s.name, COUNT(q.id)::int AS total,
         COUNT(q.id) FILTER (WHERE EXISTS (SELECT 1 FROM game_attempts a WHERE a.question_id = q.id AND a.student_id = $2 AND a.correct))::int AS done,
         COALESCE((SELECT SUM(a.points) FROM game_attempts a JOIN game_questions g2 ON g2.id = a.question_id WHERE a.student_id = $2 AND g2.subject_id = s.id), 0)::int AS points
       FROM game_questions q JOIN subjects s ON s.id = q.subject_id
       WHERE q.active AND (q.level = $1 OR q.level IS NULL) GROUP BY s.id, s.name ORDER BY s.id`,
      [student.level, student.id]
    );
    return rows.filter((r) => mine.has(r.id)).map((r) => ({ ...r, remaining: r.total - r.done }));
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
          const subs = level ? await subjectsFor(level) : [];
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
    const subjects = await studentSubjectsProgress(student);
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

  // ---------- 📈 إحصائيات التلاميذ: المعلّم (موادّه وأقسامه) والإدارة (الكل) ----------
  route('GET', '/api/game/stats', ['admin', 'teacher'], async ({ user, query }) => {
    const level = String(query.get('level') || '');
    if (!LEVEL_CODES.includes(level)) throw bad('اختر القسم');
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
    const subjects = await all(
      `SELECT s.id, s.name, COUNT(q.id)::int AS total FROM game_questions q JOIN subjects s ON s.id = q.subject_id
       WHERE q.active AND (q.level = $1 OR q.level IS NULL) AND ($2::int[] IS NULL OR s.id = ANY($2::int[]))
       GROUP BY s.id, s.name ORDER BY s.id`,
      [level, subjectIds]
    );
    const ids = subjects.map((x) => x.id);
    const total = subjects.reduce((t, x) => t + x.total, 0);
    const students = await all(
      `SELECT st.id, st.full_name,
         COALESCE(SUM(a.points), 0)::int AS points,
         COUNT(a.id)::int AS attempts,
         COUNT(a.id) FILTER (WHERE a.correct)::int AS correct_attempts,
         COUNT(DISTINCT a.question_id) FILTER (WHERE a.correct)::int AS done,
         COUNT(DISTINCT a.question_id) FILTER (WHERE NOT a.correct AND NOT EXISTS (
           SELECT 1 FROM game_attempts b WHERE b.student_id = st.id AND b.question_id = a.question_id AND b.correct))::int AS pending_wrong,
         COUNT(DISTINCT a.session_id)::int AS rounds,
         COALESCE(ROUND(AVG(a.ms) FILTER (WHERE a.correct) / 1000.0, 1), 0)::float8 AS avg_seconds,
         MAX(a.created_at) AS last_played
       FROM students st
       LEFT JOIN game_attempts a ON a.student_id = st.id
         AND a.question_id IN (SELECT q.id FROM game_questions q WHERE q.subject_id = ANY($2::int[]))
       WHERE st.level = $1 AND st.status = 'studying'
       GROUP BY st.id, st.full_name
       ORDER BY points DESC, done DESC, st.full_name`,
      [level, ids]
    );
    return {
      level, subjects, total,
      students: students.map((x) => ({ ...x, accuracy: x.attempts ? Math.round((x.correct_attempts / x.attempts) * 100) : null })),
    };
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
    // كل مادّة جولاتها وحدها: التلميذ يختار مادّة من موادّه
    if (student) {
      if (!subjectId) throw bad('اختر المادّة');
      if (!(await studentSubjectsOf(student.id)).some((x) => x.id === subjectId)) throw new HttpError(403, 'هذه المادّة ليست من موادّ التلميذ');
    }
    // أسئلة لم يُجب عنها التلميذ إجابة صحيحة بعد (السؤال المُجاب صحيحًا لا يعود)، عشوائيًا
    const qs = await all(
      `SELECT q.id FROM game_questions q
       WHERE q.active AND (q.level = $1 OR q.level IS NULL) AND ($2::int IS NULL OR q.subject_id = $2)
         AND NOT EXISTS (SELECT 1 FROM game_attempts a WHERE a.question_id = q.id AND a.student_id = $3 AND a.correct)
       ORDER BY random() LIMIT ${ROUND_SIZE}`,
      [level, subjectId, student?.id ?? -1]
    );
    if (!qs.length) {
      const any = await one(`SELECT 1 FROM game_questions q WHERE q.active AND (q.level = $1 OR q.level IS NULL) AND ($2::int IS NULL OR q.subject_id = $2) LIMIT 1`, [level, subjectId]);
      throw bad(any ? 'أكملت كل أسئلة هذه المادّة 🎉 انتظر أسئلة جديدة' : 'لا توجد أسئلة بعد في هذه المادّة');
    }
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
