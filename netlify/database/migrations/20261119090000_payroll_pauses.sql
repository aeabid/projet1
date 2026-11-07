-- إيقاف عدّ ساعات المدرّسين لفترة (عطلة، امتحانات…): لكل المدرّسين أو لمدرّس واحد
CREATE TABLE payroll_pauses (
  id SERIAL PRIMARY KEY,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_from <= date_to)
);
ALTER TABLE payroll_pauses ENABLE ROW LEVEL SECURITY;
