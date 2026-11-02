-- تعديل مبلغ شهر معيّن لتلميذ أو طفل (غياب شهر كامل أو جزء منه، أو مبلغ آخر)
CREATE TABLE fee_adjustments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  child_id INTEGER REFERENCES program_children(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('exempt', 'absent_days', 'amount')),
  value NUMERIC(10, 3),
  reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (child_id IS NULL))
);
CREATE UNIQUE INDEX fee_adjustments_student_month ON fee_adjustments (student_id, month) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX fee_adjustments_child_month ON fee_adjustments (child_id, month) WHERE child_id IS NOT NULL;
ALTER TABLE fee_adjustments ENABLE ROW LEVEL SECURITY;
