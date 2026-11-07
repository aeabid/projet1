-- مبلغ يُضاف إلى مستحق شهر معيّن (مثلًا معلوم التسجيل 40 مع أول شهر)، يجتمع مع أي تعديل آخر على نفس الشهر
CREATE TABLE fee_extras (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  child_id INTEGER REFERENCES program_children(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
  reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (child_id IS NULL))
);
CREATE INDEX fee_extras_student_idx ON fee_extras (student_id);
CREATE INDEX fee_extras_child_idx ON fee_extras (child_id);
ALTER TABLE fee_extras ENABLE ROW LEVEL SECURITY;
