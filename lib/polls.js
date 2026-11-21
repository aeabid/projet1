// ---------- 🗳️ تصويت مباشر للأولياء ----------
// الإدارة تفتح تصويتًا (اجتماع أولياء)، تعرض QR على الشاشة، الأولياء يقيّمون من هواتفهم دون حساب وبصفة مجهولة،
// والنتائج تتحدّث مباشرة على الشاشة.

// سلّم من 1 إلى 5
export const POLL_SCALE = [
  ['excellent', 'ممتاز', 5],
  ['very_good', 'جيد', 4],
  ['average', 'متوسط', 3],
  ['below', 'دون المتوسط', 2],
  ['weak', 'ضعيف', 1],
];
// أصوات قديمة بسلّم 6 درجات: «حسن» تُحتسب «جيد»
const LEGACY = { good: 'very_good' };
export const DEFAULT_CRITERIA = [
  'التواصل والإدارة', 'المستوى الدراسي', 'الفرنسية', 'العربية', 'الرياضيات',
  'علوم الحياة والأرض', 'الجانب التربوي', 'التحفيز والمتابعة', 'مركز فيد إجمالًا',
];
const KEYS = POLL_SCALE.map((s) => s[0]);
const SCORE = Object.fromEntries(POLL_SCALE.map((s) => [s[0], s[2]]));

export function registerPolls({ route, one, all, pool, HttpError, text }) {
  const readCriteria = (value) => {
    const list = (Array.isArray(value) ? value : String(value || '').split('\n'))
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    if (list.length < 1 || list.length > 20) throw new HttpError(400, 'من 1 إلى 20 محورًا للتقييم');
    if (list.some((x) => x.length > 80)) throw new HttpError(400, 'اسم المحور طويل جدًا');
    return [...new Set(list)];
  };
  // سبر آراء: [{ q: 'السؤال', options: ['…', '…'] }] — من 2 إلى 5 اختيارات لكل سؤال
  const readQuestions = (body) => {
    if (body.kind !== 'choice') return { kind: 'rating', criteria: readCriteria(body.criteria), options: null };
    const list = Array.isArray(body.questions) ? body.questions : [];
    if (list.length < 1 || list.length > 20) throw new HttpError(400, 'من 1 إلى 20 سؤالًا');
    const criteria = [];
    const options = [];
    list.forEach((x, i) => {
      const q = String(x?.q || '').trim();
      if (!q || q.length > 150) throw new HttpError(400, `السؤال ${i + 1}: نصّ غير صالح`);
      // ☁️ سؤال مفتوح: الوليّ يكتب كلمة، والكلمات تظهر سحابةً
      if (x?.type === 'words') {
        criteria.push(q);
        options.push({ words: true });
        return;
      }
      const opts = (Array.isArray(x?.options) ? x.options : []).map((o) => String(o || '').trim()).filter(Boolean);
      if (opts.length < 2 || opts.length > 5) throw new HttpError(400, `السؤال ${i + 1}: من 2 إلى 5 اختيارات`);
      if (opts.some((o) => o.length > 80) || new Set(opts).size !== opts.length) throw new HttpError(400, `السؤال ${i + 1}: اختيارات مكرّرة أو طويلة جدًا`);
      criteria.push(q);
      options.push(opts);
    });
    return { kind: 'choice', criteria, options };
  };
  const isWords = (poll, i) => poll.kind === 'choice' && !Array.isArray(poll.options?.[i]) && !!poll.options?.[i]?.words;
  // توحيد الكلمة للعدّ: دون تشكيل ولا علامات، الألف والياء والتاء المربوطة موحّدة
  const wordKey = (w) =>
    String(w || '')
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة(?=\s|$)/g, 'ه')
      .replace(/[.,;:!?،؛؟'"«»()\-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const newCode = async () => {
    for (let k = 0; k < 20; k++) {
      const code = String(100000 + Math.floor(Math.random() * 900000));
      if (!(await one('SELECT 1 FROM polls WHERE code = $1', [code]))) return code;
    }
    throw new HttpError(500, 'تعذّر إنشاء رمز');
  };

  async function results(poll) {
    const votes = await all('SELECT answers, comment, updated_at FROM poll_votes WHERE poll_id = $1 ORDER BY updated_at DESC', [poll.id]);
    const comments = votes.filter((v) => v.comment).slice(0, 50).map((v) => ({ text: v.comment, at: v.updated_at }));
    // سبر آراء: عدد ونسبة كل اختيار (من الذين أجابوا فقط)
    if (poll.kind === 'choice') {
      const criteria = poll.criteria.map((name, i) => {
        if (isWords(poll, i)) {
          // سحابة الكلمات: كل كلمة وعدد من كتبها (بأكثر كتابة شيوعًا)
          const map = new Map();
          for (const v of votes) {
            const w = typeof v.answers?.[i] === 'string' ? v.answers[i].trim() : '';
            const k = wordKey(w);
            if (!k) continue;
            const e = map.get(k) || { count: 0, forms: new Map() };
            e.count++;
            e.forms.set(w, (e.forms.get(w) || 0) + 1);
            map.set(k, e);
          }
          const words = [...map.values()]
            .map((e) => ({ text: [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0][0], count: e.count }))
            .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
          const n = words.reduce((t, w) => t + w.count, 0);
          return { name, words, n, skipped: votes.length - n };
        }
        const opts = poll.options?.[i] || [];
        const counts = opts.map(() => 0);
        for (const v of votes) {
          const a = Number(v.answers?.[i]);
          if (Number.isInteger(a) && a >= 0 && a < opts.length) counts[a]++;
        }
        const n = counts.reduce((t, c) => t + c, 0);
        return { name, options: opts, n, counts, pct: counts.map((c) => (n ? Math.round((c / n) * 100) : 0)), skipped: votes.length - n };
      });
      return { votes: votes.length, overall: null, criteria, comments };
    }
    const criteria = poll.criteria.map((name, i) => {
      const counts = Object.fromEntries(KEYS.map((k) => [k, 0]));
      let n = 0;
      let sum = 0;
      for (const v of votes) {
        const a = LEGACY[v.answers?.[i]] || v.answers?.[i];
        if (KEYS.includes(a)) {
          counts[a]++;
          n++;
          sum += SCORE[a];
        }
      }
      // المعدّل من 5، ونسبة الرضا = ممتاز + جيد (4 و5)
      // النسب من الذين أجابوا عن هذا السؤال فقط (من لم يُجب لا يُحتسب)
      const pct = Object.fromEntries(KEYS.map((k) => [k, n ? Math.round((counts[k] / n) * 100) : 0]));
      return {
        name, n, counts, pct, skipped: votes.length - n,
        avg: n ? Math.round((sum / n) * 100) / 100 : null,
        satisfied: n ? Math.round(((counts.excellent + counts.very_good) / n) * 100) : null,
      };
    });
    const rated = criteria.filter((c) => c.n);
    return {
      votes: votes.length,
      overall: rated.length ? Math.round((rated.reduce((t, c) => t + c.avg, 0) / rated.length) * 100) / 100 : null,
      criteria,
      comments,
    };
  }

  // ---------- الإدارة ----------
  route('GET', '/api/polls', ['admin'], async () => ({
    polls: await all(
      `SELECT p.id, p.code, p.title, p.criteria, p.active, p.allow_comment, p.created_at, p.mode, p.current, p.kind, p.options,
         (SELECT COUNT(*)::int FROM poll_votes v WHERE v.poll_id = p.id) AS votes
       FROM polls p ORDER BY p.created_at DESC`
    ),
    defaults: DEFAULT_CRITERIA,
    scale: POLL_SCALE.map(([key, label]) => ({ key, label })),
  }));

  route('POST', '/api/polls', ['admin'], async ({ user, body }) => {
    const q = readQuestions(body);
    const row = await one(
      `INSERT INTO polls (code, title, criteria, allow_comment, created_by, mode, kind, options) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, code`,
      [await newCode(), text(body.title, { required: true, max: 150, name: 'العنوان' }), JSON.stringify(q.criteria),
        body.allow_comment === undefined ? true : !!body.allow_comment, user.id, body.mode === 'step' ? 'step' : 'all', q.kind, q.options && JSON.stringify(q.options)]
    );
    return [201, { poll: row }];
  });

  route('PATCH', '/api/polls/:id', ['admin'], async ({ params, body }) => {
    const p = await one('SELECT id, criteria FROM polls WHERE id = $1', [params.id]);
    if (!p) throw new HttpError(404, 'التصويت غير موجود');
    // سؤال بسؤال: المدير يختار السؤال المعروض (null = شاشة الانتظار)
    if (body.current !== undefined) {
      const c = body.current === null ? null : Number(body.current);
      if (c !== null && !(Number.isInteger(c) && c >= 0 && c < p.criteria.length)) throw new HttpError(400, 'سؤال غير صالح');
      await pool.query('UPDATE polls SET current = $2 WHERE id = $1', [p.id, c]);
    }
    if (body.mode !== undefined) await pool.query('UPDATE polls SET mode = $2 WHERE id = $1', [p.id, body.mode === 'step' ? 'step' : 'all']);
    if (body.active !== undefined) await pool.query('UPDATE polls SET active = $2 WHERE id = $1', [p.id, !!body.active]);
    if (body.title !== undefined) await pool.query('UPDATE polls SET title = $2 WHERE id = $1', [p.id, text(body.title, { required: true, max: 150, name: 'العنوان' })]);
    return { ok: true };
  });

  // ✏️ تعديل التصويت (العنوان، الأسئلة، الاختيارات، طريقة العرض). بعد بدء التصويت: تعديل النصوص والإضافة فقط
  route('PUT', '/api/polls/:id', ['admin'], async ({ params, body }) => {
    const p = await one('SELECT id, kind, criteria, options, current, (SELECT COUNT(*)::int FROM poll_votes v WHERE v.poll_id = polls.id) AS votes FROM polls WHERE id = $1', [params.id]);
    if (!p) throw new HttpError(404, 'التصويت غير موجود');
    const q = readQuestions({ ...body, kind: body.kind || p.kind });
    if (p.votes) {
      const bad = q.kind !== p.kind || q.criteria.length < p.criteria.length ||
        (q.kind === 'choice' && p.options.some((o, i) => {
          const n = q.options[i];
          return Array.isArray(o) ? !Array.isArray(n) || n.length < o.length : Array.isArray(n);
        }));
      if (bad) throw new HttpError(409, 'بدأ التصويت: يمكنك تعديل النصوص وإضافة أسئلة أو اختيارات، لا حذفها ولا تغيير نوعها');
    }
    const current = p.current !== null && p.current >= q.criteria.length ? null : p.current;
    await pool.query(
      `UPDATE polls SET title = $2, criteria = $3, options = $4, kind = $5, allow_comment = $6, mode = $7, current = $8 WHERE id = $1`,
      [p.id, text(body.title, { required: true, max: 150, name: 'العنوان' }), JSON.stringify(q.criteria), q.options && JSON.stringify(q.options), q.kind,
        body.allow_comment === undefined ? true : !!body.allow_comment, body.mode === 'step' ? 'step' : 'all', current]
    );
    return { ok: true };
  });

  // 🔄 إعادة التصويت من البداية (بعد التجربة): حذف كل الأصوات والملاحظات، الرجوع إلى أوّل سؤال
  route('POST', '/api/polls/:id/reset', ['admin'], async ({ params }) => {
    const p = await one('SELECT id FROM polls WHERE id = $1', [params.id]);
    if (!p) throw new HttpError(404, 'التصويت غير موجود');
    const { rowCount } = await pool.query('DELETE FROM poll_votes WHERE poll_id = $1', [p.id]);
    await pool.query('UPDATE polls SET current = NULL, active = true, round = round + 1 WHERE id = $1', [p.id]);
    return { ok: true, removed: rowCount };
  });

  route('DELETE', '/api/polls/:id', ['admin'], async ({ params }) => {
    await pool.query('DELETE FROM polls WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // النتائج الحيّة (تُطلب كل بضع ثوانٍ من شاشة العرض)
  route('GET', '/api/polls/:id/results', ['admin'], async ({ params }) => {
    const poll = await one('SELECT id, code, title, criteria, active, allow_comment, mode, current, kind, options FROM polls WHERE id = $1', [params.id]);
    if (!poll) throw new HttpError(404, 'التصويت غير موجود');
    return { poll, scale: POLL_SCALE.map(([key, label, score]) => ({ key, label, score })), ...(await results(poll)) };
  });

  // ---------- الأولياء: دون حساب ----------
  route('GET', '/api/public/polls/:code', null, async ({ params }) => {
    const poll = await one('SELECT title, criteria, active, allow_comment, mode, current, kind, options, round FROM polls WHERE code = $1', [params.code]);
    if (!poll) throw new HttpError(404, 'التصويت غير موجود');
    return { poll, scale: POLL_SCALE.map(([key, label, score]) => ({ key, label, score })) };
  });

  route('POST', '/api/public/polls/:code/vote', null, async ({ params, body }) => {
    const poll = await one('SELECT id, criteria, active, allow_comment, mode, current, kind, options FROM polls WHERE code = $1', [params.code]);
    if (!poll) throw new HttpError(404, 'التصويت غير موجود');
    if (!poll.active) throw new HttpError(409, 'التصويت مغلق');
    // معرّف عشوائي للجهاز فقط (لمنع التصويت مرّتين) — لا اسم ولا هاتف ولا حساب
    const device = String(body.device || '');
    if (!/^[a-z0-9]{16,64}$/i.test(device)) throw new HttpError(400, 'معرّف غير صالح');
    const answers = {};
    for (let i = 0; i < poll.criteria.length; i++) {
      const a = body.answers?.[i];
      if (a === undefined || a === null || a === '') continue;
      if (isWords(poll, i)) {
        const w = String(a).replace(/\s+/g, ' ').trim();
        if (!w || w.length > 40) throw new HttpError(400, 'اكتب كلمة أو عبارة قصيرة (40 حرفًا على الأكثر)');
        answers[i] = w;
      } else if (poll.kind === 'choice') {
        const k = Number(a);
        if (!Number.isInteger(k) || k < 0 || k >= (poll.options?.[i]?.length || 0)) throw new HttpError(400, 'اختيار غير صالح');
        answers[i] = k;
      } else {
        if (!KEYS.includes(a)) throw new HttpError(400, 'تقييم غير صالح');
        answers[i] = a;
      }
    }
    const step = poll.mode === 'step';
    const comment = poll.allow_comment ? text(body.comment, { max: 500, name: 'الملاحظة' }) : null;
    // سؤال بسؤال: ملاحظة وحدها مقبولة (في آخر الاجتماع)
    if (!Object.keys(answers).length && !(step && comment)) throw new HttpError(400, 'أجب عن سؤال واحد على الأقل');
    // سؤال بسؤال: نقبل إجابة السؤال المعروض فقط، وتُضاف إلى إجابات الولي السابقة
    if (step && Object.keys(answers).some((k) => Number(k) !== poll.current)) throw new HttpError(409, 'هذا السؤال لم يعد معروضًا');
    const r = await one(
      `INSERT INTO poll_votes (poll_id, device, answers, comment) VALUES ($1, $2, $3, $4)
       ON CONFLICT (poll_id, device) DO UPDATE SET answers = CASE WHEN $5 THEN poll_votes.answers || EXCLUDED.answers ELSE EXCLUDED.answers END,
         comment = COALESCE(EXCLUDED.comment, CASE WHEN $5 THEN poll_votes.comment END), updated_at = now()
       RETURNING (xmax = 0) AS created`,
      [poll.id, device, JSON.stringify(answers), comment, step]
    );
    return [r.created ? 201 : 200, { ok: true, updated: !r.created }];
  });
}
