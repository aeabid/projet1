// تعمير حقول الملاحظة بالذكاء الاصطناعي (Claude) انطلاقًا من نصّ يمليه المعلم بالمايك
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';

const FIELD_HINTS = {
  category: 'نوع الملاحظة',
  rating: 'مستوى التلميذ الدراسي في المادة',
  behavior: 'سلوك التلميذ في القسم',
};

const SYSTEM = `أنت مساعد في مركز دروس دعم تونسي. يملي المعلم ملاحظة قصيرة عن تلميذ (باللهجة التونسية أو بالعربية الفصحى أو بالفرنسية).
مهمتك:
1. اختيار القيمة المناسبة لكل حقل من القيم المسموح بها فقط، اعتمادًا على ما قاله المعلم صراحة أو ضمنيًا.
   إن لم يذكر المعلم شيئًا يخصّ حقلًا ما فأرجع له سلسلة فارغة "" ولا تخمّن.
2. إعادة كتابة الملاحظة في الحقل content بعربية فصحى بسيطة وواضحة موجّهة للولي، بعلامات ترقيم صحيحة،
   دون إضافة أي معلومة لم يقلها المعلم، ودون ذكر اسم المعلم، وفي جملة إلى ثلاث جمل.`;

// fields: { category: [{value, label}], rating: [...], behavior: [...] }
export function makeNoteFiller(apiKey = process.env.ANTHROPIC_API_KEY) {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  return async ({ text, fields }) => {
    const properties = { content: { type: 'string' } };
    const lines = [];
    for (const [name, options] of Object.entries(fields)) {
      properties[name] = { type: 'string', enum: ['', ...options.map((o) => o.value)] };
      lines.push(`- ${name} (${FIELD_HINTS[name] || name}): ${options.map((o) => `"${o.value}" = ${o.label}`).join('، ')}`);
    }
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
        },
      },
      system: SYSTEM,
      messages: [{ role: 'user', content: `الحقول والقيم المسموح بها:\n${lines.join('\n')}\n\nملاحظة المعلم:\n${text}` }],
    });
    if (response.stop_reason === 'refusal') throw new Error('refusal');
    const block = response.content.find((b) => b.type === 'text');
    if (!block) throw new Error('empty response');
    return JSON.parse(block.text);
  };
}
