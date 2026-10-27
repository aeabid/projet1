-- =====================================================================
-- إعداد قاعدة بيانات فيد على Supabase (يُنفَّذ مرة واحدة في SQL Editor)
-- 1) حذف تطبيق سابق غير مستعمل (كل جداوله فارغة: 0 سطر، 0 مستعمل)
-- 2) إنشاء كل جداول فيد
-- =====================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TABLE IF EXISTS public.message_likes, public.message_reads, public.messages, public.poll_votes, public.polls,
  public.student_badges, public.badges, public.completions, public.tasks, public.materials, public.announcements,
  public.about_sections, public.app_settings, public.user_roles, public.groups, public.profiles CASCADE;
DROP FUNCTION IF EXISTS public.get_admin_id, public.guard_child_profile_insert, public.handle_new_user, public.has_role,
  public.is_approved, public.list_badge_awards, public.list_groups, public.owns_student,
  public.prevent_profile_privilege_escalation, public.sync_profile_points CASCADE;
DROP TYPE IF EXISTS public.app_role, public.approval_status, public.task_type CASCADE;

-- ===== 20261017120000_init.sql =====
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'parent')),
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- levels NULL = المادة تُدرّس في كل المستويات
CREATE TABLE subjects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  levels TEXT[]
);

CREATE TABLE teacher_subjects (
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id)
);

CREATE TABLE students (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  level TEXT NOT NULL,
  group_name TEXT,
  birth_date DATE,
  parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX students_parent_idx ON students (parent_id);

CREATE TABLE absences (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  justified BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX absences_student_idx ON absences (student_id);

-- subject_id NULL = ملاحظة من الإدارة
CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('behavior', 'level', 'general')),
  rating TEXT CHECK (rating IN ('excellent', 'good', 'average', 'weak')),
  content TEXT NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notes_student_idx ON notes (student_id);

INSERT INTO subjects (name, levels) VALUES
  ('العربية', NULL),
  ('الفرنسية', NULL),
  ('الإنجليزية', NULL),
  ('الرياضيات', NULL),
  ('علوم الحياة والأرض', ARRAY['9']);

-- ===== 20261018090000_student_details.sql =====
ALTER TABLE students ADD COLUMN city TEXT;
ALTER TABLE students ADD COLUMN school TEXT;
-- ملاحظات التسجيل (مثال: المواد التي لا يدرسها التلميذ)
ALTER TABLE students ADD COLUMN remarks TEXT;

-- ===== 20261018120000_enrollment_finance.sql =====
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

-- ===== 20261018150000_status_tasks_registration.sql =====
-- حالة التلميذ: يدرس / في الانتظار / خرج / متوقف
ALTER TABLE students ADD COLUMN status TEXT NOT NULL DEFAULT 'studying'
  CHECK (status IN ('studying', 'waiting', 'left', 'stopped'));
-- تاريخ بداية الدراسة (للحساب بالـ prorata) وتاريخ الخروج أو التوقف
ALTER TABLE students ADD COLUMN start_date DATE;
ALTER TABLE students ADD COLUMN end_date DATE;
-- تلميذ يدرس مجانًا
ALTER TABLE students ADD COLUMN free BOOLEAN NOT NULL DEFAULT false;
UPDATE students SET start_date = (billing_start || '-01')::date WHERE billing_start IS NOT NULL;

-- بطاقة التعريف الوطنية للولي
ALTER TABLE users ADD COLUMN cin TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN address TEXT;
CREATE UNIQUE INDEX users_cin_key ON users (cin) WHERE cin IS NOT NULL;

-- مهام عامة يحددها المعلم لكل القسم (مستوى + مادة)
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  level TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_level_idx ON tasks (level);

-- ===== 20261019090000_timetable.sql =====
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

-- ===== 20261019120000_whatsapp_groups.sql =====
-- مجموعات واتساب: مجموعة لكل مستوى (وفوج اختياري) مع رابط الدعوة
CREATE TABLE whatsapp_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT,
  group_name TEXT,
  invite_link TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== 20261019150000_teacher_payroll.sql =====
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

-- ===== 20261020090000_programs_courses_finance.sql =====
-- ===== البرنامج التربوي السنوي (سبتمبر → ماي): أقسام حسب الأعمار، تديره الإدارة فقط =====
CREATE TABLE program_classes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  age_range TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE program_children (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  birth_date DATE,
  class_id INTEGER REFERENCES program_classes(id) ON DELETE SET NULL,
  guardian_name TEXT,
  guardian_phone TEXT,
  monthly_fee NUMERIC(10, 3),
  start_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  end_date DATE,
  free BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE program_payments (
  id SERIAL PRIMARY KEY,
  child_id INTEGER NOT NULL REFERENCES program_children(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  method TEXT,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX program_payments_child_idx ON program_payments (child_id);

-- ===== الدورات (العطل، الصيف، مجموعات) =====
CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'holiday' CHECK (kind IN ('holiday', 'summer', 'other')),
  start_date DATE,
  end_date DATE,
  price NUMERIC(10, 3),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE course_participants (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  fee NUMERIC(10, 3),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE course_payments (
  id SERIAL PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES course_participants(id) ON DELETE CASCADE,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  method TEXT,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== الإطار (أجور شهرية: مربّون، عملة، ...) =====
CREATE TABLE staff (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  activity TEXT NOT NULL CHECK (activity IN ('support', 'program', 'courses', 'general')),
  role TEXT,
  monthly_salary NUMERIC(10, 3),
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== دفتر المداخيل والمصاريف الأخرى =====
CREATE TABLE ledger_entries (
  id SERIAL PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
  activity TEXT NOT NULL CHECK (activity IN ('support', 'program', 'courses', 'general')),
  category TEXT NOT NULL,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
  date DATE NOT NULL,
  description TEXT,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  salary_month TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_date_idx ON ledger_entries (date);
CREATE UNIQUE INDEX ledger_salary_key ON ledger_entries (staff_id, salary_month) WHERE staff_id IS NOT NULL AND salary_month IS NOT NULL;

-- ===== 20261021090000_center_management.sql =====
-- ===== التعريفات والتخفيضات =====
ALTER TABLE students ADD COLUMN discount NUMERIC(10, 3);
ALTER TABLE students ADD COLUMN discount_reason TEXT;
ALTER TABLE program_children ADD COLUMN discount NUMERIC(10, 3);
ALTER TABLE program_children ADD COLUMN discount_reason TEXT;
ALTER TABLE program_classes ADD COLUMN default_fee NUMERIC(10, 3);
ALTER TABLE course_participants ADD COLUMN discount NUMERIC(10, 3);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- ===== الوصولات: رقم تسلسلي واحد لكل الخلاصات =====
CREATE SEQUENCE receipt_seq;
ALTER TABLE payments ADD COLUMN receipt_no INTEGER;
ALTER TABLE program_payments ADD COLUMN receipt_no INTEGER;
ALTER TABLE course_payments ADD COLUMN receipt_no INTEGER;
UPDATE payments SET receipt_no = nextval('receipt_seq') WHERE receipt_no IS NULL;
UPDATE program_payments SET receipt_no = nextval('receipt_seq') WHERE receipt_no IS NULL;
UPDATE course_payments SET receipt_no = nextval('receipt_seq') WHERE receipt_no IS NULL;
ALTER TABLE payments ALTER COLUMN receipt_no SET DEFAULT nextval('receipt_seq');
ALTER TABLE program_payments ALTER COLUMN receipt_no SET DEFAULT nextval('receipt_seq');
ALTER TABLE course_payments ALTER COLUMN receipt_no SET DEFAULT nextval('receipt_seq');

-- ===== الأنشطة والرحلات والمخيمات (نفس نظام الدورات) =====
ALTER TABLE courses DROP CONSTRAINT courses_kind_check;
ALTER TABLE courses ADD CONSTRAINT courses_kind_check
  CHECK (kind IN ('holiday', 'summer', 'other', 'activity', 'trip', 'camp'));
ALTER TABLE courses ADD COLUMN place TEXT;
ALTER TABLE courses ADD COLUMN capacity INTEGER;
ALTER TABLE courses ADD COLUMN status TEXT NOT NULL DEFAULT 'planned'
  CHECK (status IN ('planned', 'done', 'cancelled'));

-- ===== الاجتماعات والقرارات =====
CREATE TABLE meetings (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  date DATE NOT NULL,
  attendees TEXT,
  agenda TEXT,
  minutes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE decisions (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  owner TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== مهام الإدارة والمشاكل =====
CREATE TABLE center_tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'problem')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assignee_name TEXT,
  due_date DATE,
  decision_id INTEGER REFERENCES decisions(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ
);
CREATE INDEX center_tasks_status_idx ON center_tasks (status);

-- ===== 20261026090000_row_level_security.sql =====
-- Supabase يفتح جداول المخطط public عبر الـ API بمفتاح عمومي: نُغلقها كلها بـ RLS دون أي سياسة.
-- الخادم يتصل بصاحب الجداول، فلا يتأثّر. كل جدول جديد يجب أن يُغلق بنفس الطريقة.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;


-- ===== 20261027090000_program_families.sql =====
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
