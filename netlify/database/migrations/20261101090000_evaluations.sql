-- ===== بطاقة التقييم الشهرية والاستيراد من التطبيق السابق =====
-- معرّف التطبيق السابق (s01…، t-alaa…): الاستيراد يمكن إعادته دون تكرار
ALTER TABLE students ADD COLUMN legacy_id TEXT;
CREATE UNIQUE INDEX students_legacy_key ON students (legacy_id) WHERE legacy_id IS NOT NULL;
ALTER TABLE users ADD COLUMN legacy_id TEXT;
CREATE UNIQUE INDEX users_legacy_key ON users (legacy_id) WHERE legacy_id IS NOT NULL;

-- ملاحظة المعلم كما في البطاقة الورقية: المستوى (rating) والسلوك معًا
ALTER TABLE notes ADD COLUMN behavior TEXT CHECK (behavior IN ('excellent', 'good', 'average', 'weak'));
-- ملاحظة داخلية لا يراها الولي
ALTER TABLE notes ADD COLUMN visible_to_parent BOOLEAN NOT NULL DEFAULT true;
-- كاتب الملاحظة إن لم يكن حسابًا (مثال: «بطاقة تقييم أكتوبر»)
ALTER TABLE notes ADD COLUMN author_label TEXT;
ALTER TABLE notes ADD COLUMN legacy_id TEXT;
CREATE UNIQUE INDEX notes_legacy_key ON notes (legacy_id) WHERE legacy_id IS NOT NULL;

-- المستويات التي يدرّس فيها المعلم هذه المادة (فارغ = كل مستويات المادة)
ALTER TABLE teacher_subjects ADD COLUMN levels TEXT[];
