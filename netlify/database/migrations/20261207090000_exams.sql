-- امتحانات للعموم: الإدارة تنشئ الامتحان وترسل رابطه، المترشّح يكتب اسمه ولقبه وعمره، والنتائج تصل للإدارة
CREATE TABLE IF NOT EXISTS exams (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  intro TEXT,
  sections JSONB NOT NULL DEFAULT '[]',
  questions JSONB NOT NULL DEFAULT '[]',
  show_feedback BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS exam_attempts (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  age INTEGER,
  total INTEGER NOT NULL,
  grade TEXT,
  correct INTEGER NOT NULL,
  q_count INTEGER NOT NULL,
  skills JSONB NOT NULL DEFAULT '[]',
  answers JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exam_attempts_exam_idx ON exam_attempts (exam_id, created_at DESC);
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
