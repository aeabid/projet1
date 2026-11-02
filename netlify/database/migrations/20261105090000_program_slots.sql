-- جدول أوقات البرنامج التربوي: حصص أسبوعية لكل قسم (day: 1 = الإثنين ... 7 = الأحد)
CREATE TABLE program_slots (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES program_classes(id) ON DELETE CASCADE,
  day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  title TEXT,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  room TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE program_slots ENABLE ROW LEVEL SECURITY;
