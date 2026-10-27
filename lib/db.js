// الاتصال بقاعدة البيانات: Supabase (DATABASE_URL) أو قاعدة Netlify
import pg from 'pg';

// Supabase من دالة Netlify: رابط «Transaction pooler» (المنفذ 6543)، مع SSL
export function poolFromUrl(connectionString) {
  return new pg.Pool({
    connectionString: connectionString.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''),
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
  });
}

// عنوان الـ pooler يختلف حسب المشروع (aws-0 أو aws-1): نجرّب الاثنين ونحتفظ بالذي يعمل
export function resilientPool(connectionString) {
  const candidates = [...new Set([
    connectionString,
    connectionString.replace('aws-0-', 'aws-1-'),
    connectionString.replace('aws-1-', 'aws-0-'),
  ])];
  let chosen = null;
  let pending = null;
  const resolve = () =>
    chosen ||
    (pending ??= (async () => {
      let lastError;
      for (const url of candidates) {
        const pool = poolFromUrl(url);
        try {
          await pool.query('SELECT 1');
          chosen = pool;
          console.log('database host:', new URL(url).hostname);
          return pool;
        } catch (err) {
          lastError = err;
          await pool.end().catch(() => {});
        }
      }
      pending = null;
      throw lastError;
    })());
  return {
    query: async (...args) => (await resolve()).query(...args),
    connect: async () => (await resolve()).connect(),
  };
}

// الجداول بترتيب المفاتيح الخارجية (الأب قبل الابن)
export const TABLES = [
  'users', 'sessions', 'subjects', 'teacher_subjects', 'students', 'student_subjects', 'absences', 'notes',
  'payments', 'tasks', 'timetable', 'teacher_hour_adjustments', 'teacher_payments', 'whatsapp_groups',
  'program_classes', 'program_children', 'program_payments', 'courses', 'course_participants', 'course_payments',
  'staff', 'ledger_entries', 'settings', 'meetings', 'decisions', 'center_tasks',
  'program_absences', 'program_notes', 'registration_payments',
];

const BATCH = 200;

export async function countRows(pool) {
  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM students)::int + (SELECT COUNT(*) FROM program_children)::int
       + (SELECT COUNT(*) FROM payments)::int + (SELECT COUNT(*) FROM courses)::int AS n`
  );
  return rows[0].n;
}

// نسخ كل المعطيات من قاعدة إلى أخرى (نفس المخطط). القاعدة الهدف تُفرغ أولًا، والكل في معاملة واحدة.
// onlyIfEmpty: لا شيء إن كانت القاعدة الهدف فيها حسابات (نسخ تلقائي آمن حتى مع عدّة نسخ من الدالة)
export async function copyDatabase(source, target, { onlyIfEmpty = false } = {}) {
  const client = await target.connect();
  const copied = {};
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(724411)');
    if (onlyIfEmpty && (await client.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n > 0) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    for (const table of TABLES) {
      copied[table] = 0;
      for (let offset = 0; ; offset += BATCH) {
        // Postgres نفسه يحوّل الصفوف إلى JSON: التواريخ والمصفوفات تبقى كما هي
        const { rows } = await source.query(
          `SELECT json_agg(x)::text AS data, COUNT(*)::int AS n
           FROM (SELECT * FROM ${table} ORDER BY 1, 2 LIMIT ${BATCH} OFFSET ${offset}) x`
        );
        if (!rows[0].n) break;
        await client.query(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`, [rows[0].data]);
        copied[table] += rows[0].n;
        if (rows[0].n < BATCH) break;
      }
      // المعرّفات التسلسلية تواصل بعد آخر رقم
      const { rows: seq } = await client.query(
        `SELECT pg_get_serial_sequence($1, 'id') AS s FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'`,
        [table]
      );
      if (seq[0]?.s) {
        await client.query(`SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`, [seq[0].s]);
      }
    }
    await client.query(
      `SELECT setval('receipt_seq', COALESCE(GREATEST(
         (SELECT MAX(receipt_no) FROM payments), (SELECT MAX(receipt_no) FROM program_payments),
         (SELECT MAX(receipt_no) FROM course_payments), (SELECT MAX(receipt_no) FROM registration_payments)), 0) + 1, false)`
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return copied;
}
