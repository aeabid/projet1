-- حالة التلميذ: يدرس / في الانتظار / خرج / متوقف
ALTER TABLE students ADD COLUMN status TEXT NOT NULL DEFAULT 'studying'
  CHECK (status IN ('studying', 'waiting', 'left', 'stopped'));
-- تاريخ بداية الدراسة (للحساب بالـ prorata) وتاريخ الخروج أو التوقف
ALTER TABLE students ADD COLUMN start_date DATE;
ALTER TABLE students ADD COLUMN end_date DATE;
-- تلميذ يدرس مجانًا
ALTER TABLE students ADD COLUMN free BOOLEAN NOT NULL DEFAULT false;
UPDATE students SET start_date = (billing_start || '-01')::date WHERE billing_start IS NOT NULL;

-- بطاقة التعريف الوطنية للولي
ALTER TABLE users ADD COLUMN cin TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN address TEXT;
CREATE UNIQUE INDEX users_cin_key ON users (cin) WHERE cin IS NOT NULL;

-- مهام عامة يحددها المعلم لكل القسم (مستوى + مادة)
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  level TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_level_idx ON tasks (level);
