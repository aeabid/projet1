-- تعويض حصة: مدرّس آخر يعوّض المدرّس الغائب في تاريخ معيّن (الساعات والغيابات له)
CREATE TABLE IF NOT EXISTS session_substitutions (
  id SERIAL PRIMARY KEY,
  timetable_id INT NOT NULL REFERENCES timetable(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  substitute_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (timetable_id, date)
);
CREATE INDEX IF NOT EXISTS session_substitutions_sub_idx ON session_substitutions (substitute_id, date);
ALTER TABLE session_substitutions ENABLE ROW LEVEL SECURITY;
