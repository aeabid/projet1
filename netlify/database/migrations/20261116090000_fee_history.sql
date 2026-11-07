-- تاريخ المعلوم الشهري: تغيير المعلوم (مثلًا باقة) يُطبَّق من شهر معيّن، والأشهر السابقة تبقى بمعلومها القديم.
-- كل سطر: المعلوم والتخفيض اللذان يُطبَّقان على الأشهر حتى upto_month (شامل)
CREATE TABLE fee_history (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  child_id INTEGER REFERENCES program_children(id) ON DELETE CASCADE,
  upto_month TEXT NOT NULL,
  monthly_fee NUMERIC(10, 3),
  discount NUMERIC(10, 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (child_id IS NULL))
);
CREATE INDEX fee_history_student_idx ON fee_history (student_id);
CREATE INDEX fee_history_child_idx ON fee_history (child_id);
ALTER TABLE fee_history ENABLE ROW LEVEL SECURITY;
