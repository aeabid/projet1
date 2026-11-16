// دالّة خلفيّة (حتى 15 دقيقة): تحويل ملف أسئلة إلى أسئلة ركن التحدّي بالذكاء الاصطناعي
// الإسم ينتهي بـ -background: Netlify ترجع 202 مباشرة وتواصل العمل في الخلفيّة.
// بالصيغة الحديثة (مثل api.mjs) حتى تصلها نفس متغيّرات الذكاء الاصطناعي (AI Gateway).
import { resilientPool } from '../../lib/db.js';
import { LEVELS } from '../../lib/app.js';
import { makeQuestionExtractor, processImportJob } from '../../lib/importer.js';

let pool = null;

export default async (request) => {
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!process.env.DATABASE_URL || !id || typeof body.token !== 'string') return;
  pool ??= resilientPool(process.env.DATABASE_URL);
  // الرمز السرّي يُعطى لصاحب الطلب فقط
  const { rows } = await pool.query(`SELECT id FROM game_import_jobs WHERE id = $1 AND token = $2 AND status = 'pending'`, [id, body.token]);
  if (!rows.length) return;
  await processImportJob(pool, id, makeQuestionExtractor(), (code) => LEVELS.find((l) => l.code === code)?.label || code);
};
