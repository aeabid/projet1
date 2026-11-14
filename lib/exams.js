// ---------- 📝 امتحانات للعموم ----------
// الإدارة تنشئ امتحانًا (محاور + أسئلة اختيار)، ترسل رابطه لأيّ شخص؛ المترشّح يكتب اسمه ولقبه وعمره ويجيب،
// والعلامة تُحسب في الخادم وتظهر في صفحة الإدارة.

const grade = (t) => (t >= 85 ? 'ممتاز' : t >= 70 ? 'جيّد جدًّا' : t >= 50 ? 'جيّد' : 'يحتاج إلى دعم');

export function registerExams({ route, one, all, pool, HttpError, text }) {
  const bad = (m) => new HttpError(400, m);
  const str = (v, max, name, required = false) => text(typeof v === 'string' ? v : v == null ? '' : String(v), { required, max, name });

  function readExam(body) {
    const title = str(body.title, 150, 'عنوان الامتحان', true);
    const intro = str(body.intro, 600, 'التقديم');
    const secIn = Array.isArray(body.sections) ? body.sections : [];
    if (!secIn.length || secIn.length > 20) throw bad('من محور واحد إلى 20 محورًا');
    const sections = secIn.map((s, i) => ({
      title: str(s?.title, 120, `عنوان المحور ${i + 1}`, true),
      passage: str(s?.passage, 4000, 'نصّ القراءة') || '',
      tip: str(s?.tip, 1000, 'التذكير') || '',
      advice: str(s?.advice, 400, 'النصيحة') || '',
    }));
    const qIn = Array.isArray(body.questions) ? body.questions : [];
    if (!qIn.length || qIn.length > 200) throw bad('من سؤال واحد إلى 200 سؤال');
    const questions = qIn.map((q, i) => {
      const n = i + 1;
      const sec = Number(q?.sec);
      if (!Number.isInteger(sec) || sec < 0 || sec >= sections.length) throw bad(`السؤال ${n}: اختر المحور`);
      const options = (Array.isArray(q?.options) ? q.options : []).map((o) => String(o ?? '').trim()).filter(Boolean);
      if (options.length < 2 || options.length > 6) throw bad(`السؤال ${n}: من اختيارين إلى 6 اختيارات`);
      if (new Set(options).size !== options.length) throw bad(`السؤال ${n}: اختيارات مكرّرة`);
      if (options.some((o) => o.length > 200)) throw bad(`السؤال ${n}: اختيار طويل جدًا`);
      const answer = Number(q?.answer);
      if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) throw bad(`السؤال ${n}: حدّد الجواب الصحيح`);
      const prompt = str(q?.prompt, 300, `نصّ السؤال ${n}`) || '';
      const word = str(q?.word, 200, `الكلمة البارزة ${n}`) || '';
      const sentence = str(q?.sentence, 300, `الجملة ${n}`) || '';
      if (!prompt && !word && !sentence) throw bad(`السؤال ${n}: اكتب نصّ السؤال`);
      return { sec, prompt, word, sentence, options, answer, why: str(q?.why, 400, `الشرح ${n}`) || '' };
    });
    return { title, intro, sections, questions, show_feedback: body.show_feedback === undefined ? true : !!body.show_feedback };
  }
  const newCode = async () => {
    for (let k = 0; k < 20; k++) {
      const code = String(100000 + Math.floor(Math.random() * 900000));
      if (!(await one('SELECT 1 FROM exams WHERE code = $1', [code]))) return code;
    }
    throw new HttpError(500, 'تعذّر إنشاء رمز');
  };
  const EXAM_COLS = `e.id, e.code, e.title, e.intro, e.sections, e.questions, e.show_feedback, e.active, e.created_at, e.updated_at,
    (SELECT COUNT(*)::int FROM exam_attempts a WHERE a.exam_id = e.id) AS attempts,
    (SELECT ROUND(AVG(total))::int FROM exam_attempts a WHERE a.exam_id = e.id) AS avg_total`;

  // ---------- الإدارة ----------
  route('GET', '/api/exams', ['admin'], async () => ({ exams: await all(`SELECT ${EXAM_COLS} FROM exams e ORDER BY e.created_at DESC`) }));

  route('POST', '/api/exams', ['admin'], async ({ user, body }) => {
    const x = readExam(body);
    const row = await one(
      `INSERT INTO exams (code, title, intro, sections, questions, show_feedback, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [await newCode(), x.title, x.intro, JSON.stringify(x.sections), JSON.stringify(x.questions), x.show_feedback, user.id]
    );
    return [201, { exam: await one(`SELECT ${EXAM_COLS} FROM exams e WHERE e.id = $1`, [row.id]) }];
  });

  route('PUT', '/api/exams/:id', ['admin'], async ({ params, body }) => {
    if (!(await one('SELECT 1 FROM exams WHERE id = $1', [params.id]))) throw new HttpError(404, 'الامتحان غير موجود');
    const x = readExam(body);
    await pool.query(
      `UPDATE exams SET title = $2, intro = $3, sections = $4, questions = $5, show_feedback = $6, updated_at = now() WHERE id = $1`,
      [params.id, x.title, x.intro, JSON.stringify(x.sections), JSON.stringify(x.questions), x.show_feedback]
    );
    return { exam: await one(`SELECT ${EXAM_COLS} FROM exams e WHERE e.id = $1`, [params.id]) };
  });

  route('PATCH', '/api/exams/:id', ['admin'], async ({ params, body }) => {
    if (!(await one('SELECT 1 FROM exams WHERE id = $1', [params.id]))) throw new HttpError(404, 'الامتحان غير موجود');
    await pool.query('UPDATE exams SET active = $2 WHERE id = $1', [params.id, !!body.active]);
    return { ok: true };
  });

  route('DELETE', '/api/exams/:id', ['admin'], async ({ params }) => {
    await pool.query('DELETE FROM exams WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // محاولات المترشّحين (أسفل صفحة الإدارة)
  route('GET', '/api/exams/:id/attempts', ['admin'], async ({ params }) => ({
    attempts: await all(
      `SELECT id, first_name, last_name, age, total, grade, correct, q_count, skills, answers, created_at
       FROM exam_attempts WHERE exam_id = $1 ORDER BY created_at DESC LIMIT 1000`,
      [params.id]
    ),
  }));

  route('DELETE', '/api/exam-attempts/:id', ['admin'], async ({ params }) => {
    await pool.query('DELETE FROM exam_attempts WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // ---------- العموم: دون حساب ----------
  route('GET', '/api/public/exams/:code', null, async ({ params }) => {
    const e = await one('SELECT title, intro, sections, questions, show_feedback, active FROM exams WHERE code = $1', [params.code]);
    if (!e) throw new HttpError(404, 'الامتحان غير موجود');
    if (!e.active) return { exam: { title: e.title, active: false } };
    // الأجوبة لا تُرسل إلّا إذا كان التصحيح الفوريّ مفعّلًا (والعلامة تُحسب في الخادم في كلّ الحالات)
    const questions = e.questions.map((q) => {
      const v = { sec: q.sec, prompt: q.prompt, word: q.word, sentence: q.sentence, options: q.options };
      if (e.show_feedback) Object.assign(v, { answer: q.answer, why: q.why });
      return v;
    });
    return { exam: { title: e.title, intro: e.intro, sections: e.sections, questions, show_feedback: e.show_feedback, active: true } };
  });

  route('POST', '/api/public/exams/:code/submit', null, async ({ params, body }) => {
    const e = await one('SELECT id, sections, questions, active FROM exams WHERE code = $1', [params.code]);
    if (!e) throw new HttpError(404, 'الامتحان غير موجود');
    if (!e.active) throw new HttpError(409, 'الامتحان مغلق');
    const first = str(body.first_name, 40, 'الاسم', true);
    const last = str(body.last_name, 40, 'اللقب', true);
    const age = Number(body.age);
    if (!Number.isInteger(age) || age < 3 || age > 99) throw bad('العمر غير صالح');
    // answers: { رقم السؤال: رقم الاختيار في القائمة الأصلية }
    const given = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const per = e.sections.map(() => ({ ok: 0, tot: 0 }));
    const log = [];
    let correct = 0;
    e.questions.forEach((q, i) => {
      const c = given[i];
      const choice = Number.isInteger(Number(c)) && c !== null && c !== '' ? Number(c) : null;
      const ok = choice === q.answer;
      per[q.sec].tot++;
      if (ok) {
        per[q.sec].ok++;
        correct++;
      }
      log.push({ s: e.sections[q.sec]?.title || '', q: [q.prompt, q.word, q.sentence].filter(Boolean).join(' — '),
        c: choice !== null && q.options[choice] !== undefined ? q.options[choice] : '—', a: q.options[q.answer], ok });
    });
    const count = e.questions.length;
    const total = Math.round((correct / Math.max(count, 1)) * 100);
    const skills = e.sections
      .map((s, i) => (per[i].tot ? { t: s.title, pct: Math.round((per[i].ok / per[i].tot) * 100), detail: `${per[i].ok} من ${per[i].tot}`, advice: s.advice } : null))
      .filter(Boolean);
    const row = await one(
      `INSERT INTO exam_attempts (exam_id, first_name, last_name, age, total, grade, correct, q_count, skills, answers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [e.id, first, last, age, total, grade(total), correct, count, JSON.stringify(skills), JSON.stringify(log)]
    );
    return [201, { id: row.id, total, grade: grade(total), correct, count, skills }];
  });
}
