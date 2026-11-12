-- ركن التحدّي (gamification): بنك أسئلة تدخله الإدارة فقط، جولات، نقاط، نجوم، شارات وترتيب حسب القسم
CREATE TABLE IF NOT EXISTS game_questions (
  id SERIAL PRIMARY KEY,
  level TEXT,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mcq', 'truefalse', 'order', 'match')),
  prompt TEXT NOT NULL,
  data JSONB NOT NULL,
  explanation TEXT,
  points INTEGER NOT NULL DEFAULT 10 CHECK (points BETWEEN 1 AND 100),
  time_limit INTEGER NOT NULL DEFAULT 30 CHECK (time_limit BETWEEN 5 AND 300),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_questions_level_idx ON game_questions (level, subject_id) WHERE active;
ALTER TABLE game_questions ENABLE ROW LEVEL SECURITY;
-- جولة: أسئلة مختارة، السؤال الحالي ووقت عرضه (التوقيت يُحسب في الخادم)
CREATE TABLE IF NOT EXISTS game_sessions (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  played_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  level TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  question_ids INTEGER[] NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  served_at TIMESTAMPTZ,
  score INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  stars INTEGER,
  badges_before TEXT[] NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS game_sessions_student_idx ON game_sessions (student_id, finished_at);
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS game_attempts (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES game_questions(id) ON DELETE SET NULL,
  correct BOOLEAN NOT NULL,
  ms INTEGER NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_attempts_student_idx ON game_attempts (student_id, created_at);
ALTER TABLE game_attempts ENABLE ROW LEVEL SECURITY;
