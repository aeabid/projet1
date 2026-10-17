ALTER TABLE students ADD COLUMN address TEXT;
-- صورة التلميذ (JPEG مصغّرة بصيغة data URL)
ALTER TABLE students ADD COLUMN photo TEXT;
ALTER TABLE students ADD COLUMN photo_version INTEGER NOT NULL DEFAULT 0;
-- pack = مسجّل في كل مواد مستواه
ALTER TABLE students ADD COLUMN pack BOOLEAN NOT NULL DEFAULT false;
-- المبلغ الشهري المتفق عليه (د.ت) وأول شهر يُحتسب (YYYY-MM)
ALTER TABLE students ADD COLUMN monthly_fee NUMERIC(10, 3);
ALTER TABLE students ADD COLUMN billing_start TEXT;

CREATE TABLE student_subjects (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, subject_id)
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  method TEXT,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_student_idx ON payments (student_id);
