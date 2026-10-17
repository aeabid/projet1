-- معلوم الساعة لكل معلم (د.ت)
ALTER TABLE users ADD COLUMN hourly_rate NUMERIC(10, 3);

-- تاريخ صلوحية كل حصة في الجدول حتى لا يتغيّر حساب الأشهر الماضية عند تعديل الجدول
-- valid_to حصريّ: الحصة تُحتسب في التواريخ valid_from <= d < valid_to
ALTER TABLE timetable ADD COLUMN valid_from DATE;
ALTER TABLE timetable ADD COLUMN valid_to DATE;
UPDATE timetable SET valid_from = created_at::date;
ALTER TABLE timetable ALTER COLUMN valid_from SET NOT NULL;
ALTER TABLE timetable ALTER COLUMN valid_from SET DEFAULT current_date;

-- تعديلات الإدارة على ساعات المعلم:
--  timetable_id محدّد: تعديل حصة مبرمجة في تاريخ معيّن (hours = 0 تعني غياب / حذف)
--  timetable_id فارغ: حصة إضافية
CREATE TABLE teacher_hour_adjustments (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  timetable_id INTEGER REFERENCES timetable(id) ON DELETE CASCADE,
  hours NUMERIC(5, 2) NOT NULL CHECK (hours >= 0 AND hours <= 24),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teacher_hour_adjustments_slot_key
  ON teacher_hour_adjustments (teacher_id, date, timetable_id) WHERE timetable_id IS NOT NULL;

-- ما دُفع للمعلم: كامل المبلغ أو تسبقة
CREATE TABLE teacher_payments (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
  kind TEXT NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'advance')),
  paid_on DATE NOT NULL,
  method TEXT,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX teacher_payments_teacher_idx ON teacher_payments (teacher_id);
