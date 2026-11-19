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
  const newCode = async () => {
    for (let k = 0; k < 20; k++) {
      const code = String(100000 + Math.floor(Math.random() * 900000));
      if (!(await one('SELECT 1 FROM polls WHERE code = $1', [code]))) return code;
    }
    throw new HttpError(500, 'تعذّر إنشاء رمز');
  };

  async function results(poll) {
    const votes = await all('SELECT answers, comment, updated_at FROM poll_votes WHERE poll_id = $1 ORDER BY updated_at DESC', [poll.id]);
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
      comments: votes.filter((v) => v.comment).slice(0, 50).map((v) => ({ text: v.comment, at: v.updated_at })),
    };
  }

  // ---------- الإدارة ----------
  route('GET', '/api/polls', ['admin'], async () => ({
    polls: await all(
      `SELECT p.id, p.code, p.title, p.criteria, p.active, p.allow_comment, p.created_at, p.mode, p.current,
         (SELECT COUNT(*)::int FROM poll_votes v WHERE v.poll_id = p.id) AS votes
       FROM polls p ORDER BY p.created_at DESC`
    ),
    defaults: DEFAULT_CRITERIA,
    scale: POLL_SCALE.map(([key, label]) => ({ key, label })),
  }));

  route('POST', '/api/polls', ['admin'], async ({ user, body }) => {
    const row = await one(
      `INSERT INTO polls (code, title, criteria, allow_comment, created_by, mode) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, code`,
      [await newCode(), text(body.title, { required: true, max: 150, name: 'العنوان' }), JSON.stringify(readCriteria(body.criteria)),
        body.allow_comment === undefined ? true : !!body.allow_comment, user.id, body.mode === 'step' ? 'step' : 'all']
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

  route('DELETE', '/api/polls/:id', ['admin'], async ({ params }) => {
    await pool.query('DELETE FROM polls WHERE id = $1', [params.id]);
    return { ok: true };
  });

  // النتائج الحيّة (تُطلب كل بضع ثوانٍ من شاشة العرض)
  route('GET', '/api/polls/:id/results', ['admin'], async ({ params }) => {
    const poll = await one('SELECT id, code, title, criteria, active, allow_comment, mode, current FROM polls WHERE id = $1', [params.id]);
    if (!poll) throw new HttpError(404, 'التصويت غير موجود');
    return { poll, scale: POLL_SCALE.map(([key, label, score]) => ({ key, label, score })), ...(await results(poll)) };
  });

  // ---------- الأولياء: دون حساب ----------
  route('GET', '/api/public/polls/:code', null, async ({ params }) => {
    const poll = await one('SELECT title, criteria, active, allow_comment, mode, current FROM polls WHERE code = $1', [params.code]);
    if (!poll) throw new HttpError(404, 'التصويت غير موجود');
    return { poll, scale: POLL_SCALE.map(([key, label, score]) => ({ key, label, score })) };
  });

  route('POST', '/api/public/polls/:code/vote', null, async ({ params, body }) => {
    const poll = await one('SELECT id, criteria, active, allow_comment, mode, current FROM polls WHERE code = $1', [params.code]);
    if (!poll) throw new HttpError(404, 'التصويت غير موجود');
    if (!poll.active) throw new HttpError(409, 'التصويت مغلق');
    // معرّف عشوائي للجهاز فقط (لمنع التصويت مرّتين) — لا اسم ولا هاتف ولا حساب
    const device = String(body.device || '');
    if (!/^[a-z0-9]{16,64}$/i.test(device)) throw new HttpError(400, 'معرّف غير صالح');
    const answers = {};
    for (let i = 0; i < poll.criteria.length; i++) {
      const a = body.answers?.[i];
      if (a !== undefined && a !== null && a !== '' && !KEYS.includes(a)) throw new HttpError(400, 'تقييم غير صالح');
      if (KEYS.includes(a)) answers[i] = a;
    }
    const step = poll.mode === 'step';
    const comment = poll.allow_comment ? text(body.comment, { max: 500, name: 'الملاحظة' }) : null;
    // سؤال بسؤال: ملاحظة وحدها مقبولة (في آخر الاجتماع)
    if (!Object.keys(answers).length && !(step && comment)) throw new HttpError(400, 'قيّم محورًا واحدًا على الأقل');
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
