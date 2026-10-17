-- جدول الأوقات: حصص أسبوعية لكل مستوى (day: 1 = الإثنين ... 7 = الأحد)
CREATE TABLE timetable (
  id SERIAL PRIMARY KEY,
  level TEXT NOT NULL,
  group_name TEXT,
  day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  room TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_time < end_time)
);
CREATE INDEX timetable_level_idx ON timetable (level);
CREATE INDEX timetable_teacher_idx ON timetable (teacher_id);
