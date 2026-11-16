// ---------- 📥 استيراد أسئلة ركن التحدّي من ملف (PDF / Word / Excel) بالذكاء الاصطناعي ----------
import Anthropic from '@anthropic-ai/sdk';
import { unzipSync, strFromU8 } from 'fflate';

const MODEL = 'claude-opus-5-5';
export const IMPORT_MAX_BYTES = 4 * 1024 * 1024;

const xmlText = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

// Word (.docx): نصّ الفقرات والجداول بالترتيب
function docxText(buf) {
  const files = unzipSync(buf, { filter: (f) => f.name === 'word/document.xml' });
  const xml = files['word/document.xml'] ? strFromU8(files['word/document.xml']) : '';
  if (!xml) throw new Error('ملف Word غير صالح');
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .split(/<\/w:p>/)
    .map((p) => xmlText([...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|(\t)/g)].map((m) => m[1] ?? m[2]).join('')).trim())
    .filter(Boolean)
    .join('\n');
}

// Excel (.xlsx): كل الأوراق، سطر لكل صفّ والخانات مفصولة بـ |
function xlsxText(buf) {
  const files = unzipSync(buf, { filter: (f) => f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name) });
  const shared = files['xl/sharedStrings.xml']
    ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join('')))
    : [];
  const sheets = Object.keys(files).filter((n) => n.startsWith('xl/worksheets/')).sort();
  if (!sheets.length) throw new Error('ملف Excel غير صالح');
  const out = [];
  for (const name of sheets) {
    const xml = strFromU8(files[name]);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        const attrs = c[1] || '';
        const inner = c[2] || '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (/t="s"/.test(attrs)) return shared[Number(v)] ?? '';
        if (/t="inlineStr"/.test(attrs)) return xmlText([...inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(''));
        return v != null ? xmlText(v) : '';
      });
      if (cells.some((x) => String(x).trim())) out.push(cells.map((x) => String(x).trim()).join(' | '));
    }
  }
  return out.join('\n');
}

// يرجع { pdf: base64 } أو { text }
export function readImportFile(filename, dataUrl) {
  const m = /^data:([^;,]*)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('الملف غير صالح');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new Error('الملف فارغ');
  if (buf.length > IMPORT_MAX_BYTES) throw new Error('الملف أكبر من 4 ميغا');
  const ext = String(filename || '').toLowerCase().split('.').pop();
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (ext === 'pdf' || buf.subarray(0, 4).toString() === '%PDF') return { pdf: buf.toString('base64') };
  if (ext === 'docx' && isZip) return { text: docxText(new Uint8Array(buf)) };
  if (ext === 'xlsx' && isZip) return { text: xlsxText(new Uint8Array(buf)) };
  if (['txt', 'csv', 'tsv'].includes(ext)) return { text: buf.toString('utf8') };
  if (ext === 'doc' || ext === 'xls') throw new Error('صيغة قديمة: احفظ الملف بصيغة .docx أو .xlsx أو PDF ثمّ أعد المحاولة');
  throw new Error('صيغة غير مدعومة: PDF أو Word (.docx) أو Excel (.xlsx)');
}

const SYSTEM = `أنت مساعد في مركز دروس دعم تونسي. يعطيك المعلّم ملفًا فيه مجموعة أسئلة مع إجاباتها الصحيحة.
حوّل كلّ سؤال إلى سؤال تفاعليّ بأحد الأنواع التالية:
- mcq: اختيار من متعدّد (2 إلى 6 اختيارات)، answer_index = رقم الاختيار الصحيح بدءًا من 0.
- truefalse: صحيح أم خطأ، answer_bool.
- order: ترتيب عناصر (3 إلى 8) — اكتب items بالترتيب الصحيح.
- match: ربط أزواج (2 إلى 6) — pairs كلّ زوج صحيح {left, right}.
قواعد:
- انقل الأسئلة والاختيارات كما هي في الملف (نفس اللغة ونفس الصياغة، مع تصحيح الأخطاء المطبعيّة الواضحة فقط).
- استعمل الإجابة الصحيحة المذكورة في الملف (مفتاح الإجابات، علامة، لون، نجمة، سطر «الجواب»…). لا تخترع إجابة.
- سؤال ليس له إجابة صحيحة واضحة في الملف: لا تضعه، واحسبه في skipped.
- سؤال مفتوح (تعبير، شرح، حلّ مسألة طويلة) لا يمكن تحويله: لا تضعه، واحسبه في skipped.
- اترك الحقول غير المستعملة فارغة: options و items و pairs قوائم فارغة، answer_index = 0، answer_bool = false.
- explanation: شرح قصير إن وُجد في الملف، وإلّا فارغ.`;

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['mcq', 'truefalse', 'order', 'match'] },
          prompt: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answer_index: { type: 'integer' },
          answer_bool: { type: 'boolean' },
          items: { type: 'array', items: { type: 'string' } },
          pairs: {
            type: 'array',
            items: { type: 'object', properties: { left: { type: 'string' }, right: { type: 'string' } }, required: ['left', 'right'], additionalProperties: false },
          },
          explanation: { type: 'string' },
        },
        required: ['kind', 'prompt', 'options', 'answer_index', 'answer_bool', 'items', 'pairs', 'explanation'],
        additionalProperties: false,
      },
    },
    skipped: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['questions', 'skipped', 'notes'],
  additionalProperties: false,
};

// يرجع null إن لم يُضبط المفتاح
export function makeQuestionExtractor(apiKey = process.env.ANTHROPIC_API_KEY) {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  return async ({ pdf, text, levelLabel, subjectName }) => {
    const intro = `القسم: ${levelLabel}${subjectName ? ` · المادة: ${subjectName}` : ''}.\nحوّل كلّ أسئلة الملف.`;
    const content = pdf
      ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }, { type: 'text', text: intro }]
      : [{ type: 'text', text: `${intro}\n\nمحتوى الملف:\n${text.slice(0, 200000)}` }];
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('تعذّر تحليل هذا الملف');
    if (msg.stop_reason === 'max_tokens') throw new Error('الملف طويل جدًا: قسّمه إلى ملفّات أصغر');
    const block = msg.content.find((b) => b.type === 'text');
    if (!block) throw new Error('لم يُرجع الذكاء الاصطناعي أيّ نتيجة');
    return JSON.parse(block.text);
  };
}

// من شكل الذكاء الاصطناعي إلى شكل بنك الأسئلة (يُرفض ما لا يكتمل)
export function toBankQuestion(x) {
  const clean = (v) => String(v ?? '').trim();
  const list = (a) => (Array.isArray(a) ? a.map(clean).filter(Boolean) : []);
  const prompt = clean(x?.prompt).slice(0, 500);
  if (!prompt) return null;
  const base = { kind: x.kind, prompt, explanation: clean(x.explanation).slice(0, 500) || null };
  if (x.kind === 'mcq') {
    const options = [...new Set(list(x.options))].slice(0, 6);
    const i = Number(x.answer_index);
    const right = list(x.options)[i];
    const answer = options.indexOf(right);
    if (options.length < 2 || answer < 0) return null;
    return { ...base, data: { options, answer } };
  }
  if (x.kind === 'truefalse') return { ...base, data: { answer: !!x.answer_bool } };
  if (x.kind === 'order') {
    const items = [...new Set(list(x.items))];
    return items.length >= 3 && items.length <= 8 ? { ...base, data: { items } } : null;
  }
  if (x.kind === 'match') {
    const pairs = (Array.isArray(x.pairs) ? x.pairs : []).map((p) => [clean(p?.left), clean(p?.right)]).filter((p) => p[0] && p[1]);
    const ok = pairs.length >= 2 && pairs.length <= 6 && new Set(pairs.map((p) => p[0])).size === pairs.length && new Set(pairs.map((p) => p[1])).size === pairs.length;
    return ok ? { ...base, data: { pairs } } : null;
  }
  return null;
}

// معالجة طلب استيراد (في الخلفية): يُقرأ من الجدول، يُحوَّل، تُحفظ النتيجة للمعاينة
export async function processImportJob(pool, id, extractor, levelLabel = (c) => c) {
  const { rows } = await pool.query(
    `UPDATE game_import_jobs SET status = 'running' WHERE id = $1 AND status = 'pending'
     RETURNING id, level, subject_id, kind, payload, (SELECT name FROM subjects WHERE id = subject_id) AS subject_name`,
    [id]
  );
  const job = rows[0];
  if (!job) return;
  try {
    if (!extractor) throw new Error('الذكاء الاصطناعي غير مفعّل');
    const out = await extractor({
      pdf: job.kind === 'pdf' ? job.payload : null,
      text: job.kind === 'text' ? job.payload : null,
      levelLabel: levelLabel(job.level),
      subjectName: job.subject_name,
    });
    const raw = Array.isArray(out?.questions) ? out.questions : [];
    const questions = raw.map(toBankQuestion).filter(Boolean).slice(0, 200);
    const skipped = (Number(out?.skipped) || 0) + (raw.length - questions.length);
    await pool.query(
      `UPDATE game_import_jobs SET status = 'done', result = $2, skipped = $3, notes = $4, payload = NULL, finished_at = now() WHERE id = $1`,
      [id, JSON.stringify(questions), skipped, String(out?.notes || '').slice(0, 500) || null]
    );
  } catch (err) {
    await pool.query(`UPDATE game_import_jobs SET status = 'error', error = $2, payload = NULL, finished_at = now() WHERE id = $1`, [id, String(err.message || err).slice(0, 300)]);
  }
}
