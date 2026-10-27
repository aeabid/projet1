-- ===== البرنامج التربوي: حسابات الأولياء، نفس الطفل في الدعم والتربوي، المنشط =====
ALTER TABLE program_children ADD COLUMN parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
-- الطفل نفسه مسجّل في دروس الدعم: شخص واحد (الولي من ملف الدعم، ومعلوم تسجيل سنوي واحد)
ALTER TABLE program_children ADD COLUMN student_id INTEGER REFERENCES students(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX program_children_student_key ON program_children (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX program_children_parent_idx ON program_children (parent_id);
-- المنشط: حساب معلم يسجّل الحضور والملاحظات لقسمه
ALTER TABLE program_classes ADD COLUMN teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE program_absences (
  id SERIAL PRIMARY KEY,
  child_id INTEGER NOT NULL REFERENCES program_children(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  justified BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_id, date)
);

-- المستوى، متابعة المحتوى، السلوك
CREATE TABLE program_notes (
  id SERIAL PRIMARY KEY,
  child_id INTEGER NOT NULL REFERENCES program_children(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('level', 'content', 'behavior', 'general')),
  rating TEXT CHECK (rating IN ('excellent', 'good', 'average', 'weak')),
  content TEXT NOT NULL,
  date DATE NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX program_notes_child_idx ON program_notes (child_id);

-- ===== معلوم التسجيل السنوي: مرة واحدة لكل طفل في السنة الدراسية، مهما كان عدد البرامج =====
CREATE TABLE registration_payments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  child_id INTEGER REFERENCES program_children(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  method TEXT,
  note TEXT,
  receipt_no INTEGER DEFAULT nextval('receipt_seq'),
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (child_id IS NULL))
);
CREATE INDEX registration_payments_student_idx ON registration_payments (student_id);
CREATE INDEX registration_payments_child_idx ON registration_payments (child_id);

-- الجداول الجديدة مغلقة كبقية الجداول (التطبيق يتصل كصاحب الجداول)
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user
    AND tablename IN ('program_absences', 'program_notes', 'registration_payments')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
