-- مستحقات سابقة للمدرّسين (أشهر قبل استعمال التطبيقة: سبتمبر، أكتوبر…): تبقى متخلّدة بذمّة الإدارة حتى تُدفع
CREATE TABLE IF NOT EXISTS teacher_past_dues (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
  hours NUMERIC(6, 2),
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teacher_past_dues_idx ON teacher_past_dues (teacher_id, month);
ALTER TABLE teacher_past_dues ENABLE ROW LEVEL SECURITY;
