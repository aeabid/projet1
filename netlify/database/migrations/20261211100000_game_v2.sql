-- ركن التحدّي v2: محاور، فروع المادّة (علوم: حساب / إيقاظ)، صور، وأنواع أسئلة جديدة
ALTER TABLE game_questions DROP CONSTRAINT IF EXISTS game_questions_kind_check;
ALTER TABLE game_questions ADD CONSTRAINT game_questions_kind_check
  CHECK (kind IN ('mcq', 'truefalse', 'order', 'match', 'connect', 'categorize', 'type'));
-- الفرع: لمادّة مثل «علوم(حساب+إيقاظ)» — كل فرع تحدّيه وترتيبه
ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS branch TEXT;
-- المحور: فارغ = سؤال شامل لكل المحاور
ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS topic TEXT;
-- صورة السؤال (معرّف في game_images)
ALTER TABLE game_questions ADD COLUMN IF NOT EXISTS image INTEGER;
CREATE INDEX IF NOT EXISTS game_questions_track_idx ON game_questions (level, subject_id, branch, topic) WHERE active;

ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS branch TEXT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS topic TEXT;
CREATE INDEX IF NOT EXISTS game_attempts_question_idx ON game_attempts (student_id, question_id);

-- صور الأسئلة والاختيارات (مصغّرة في المتصفّح قبل الرفع)
CREATE TABLE IF NOT EXISTS game_images (
  id SERIAL PRIMARY KEY,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE game_images ENABLE ROW LEVEL SECURITY;
