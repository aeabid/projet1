-- استيراد أسئلة ركن التحدّي من ملف (PDF / Word / Excel) بالذكاء الاصطناعي: يُعالَج في الخلفية ثمّ يُعرض للمعاينة
CREATE TABLE IF NOT EXISTS game_import_jobs (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  filename TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('pdf', 'text')),
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
  result JSONB,
  skipped INTEGER,
  notes TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
ALTER TABLE game_import_jobs ENABLE ROW LEVEL SECURITY;
