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

-- ===== 20261101090000_evaluations.sql =====
-- ===== بطاقة التقييم الشهرية والاستيراد من التطبيق السابق =====
-- معرّف التطبيق السابق (s01…، t-alaa…): الاستيراد يمكن إعادته دون تكرار
ALTER TABLE students ADD COLUMN legacy_id TEXT;
CREATE UNIQUE INDEX students_legacy_key ON students (legacy_id) WHERE legacy_id IS NOT NULL;
ALTER TABLE users ADD COLUMN legacy_id TEXT;
CREATE UNIQUE INDEX users_legacy_key ON users (legacy_id) WHERE legacy_id IS NOT NULL;

-- ملاحظة المعلم كما في البطاقة الورقية: المستوى (rating) والسلوك معًا
ALTER TABLE notes ADD COLUMN behavior TEXT CHECK (behavior IN ('excellent', 'good', 'average', 'weak'));
-- ملاحظة داخلية لا يراها الولي
ALTER TABLE notes ADD COLUMN visible_to_parent BOOLEAN NOT NULL DEFAULT true;
-- كاتب الملاحظة إن لم يكن حسابًا (مثال: «بطاقة تقييم أكتوبر»)
ALTER TABLE notes ADD COLUMN author_label TEXT;
ALTER TABLE notes ADD COLUMN legacy_id TEXT;
CREATE UNIQUE INDEX notes_legacy_key ON notes (legacy_id) WHERE legacy_id IS NOT NULL;

-- المستويات التي يدرّس فيها المعلم هذه المادة (فارغ = كل مستويات المادة)
ALTER TABLE teacher_subjects ADD COLUMN levels TEXT[];

-- ===== 20261102090000_messages_cards_signup.sql =====
-- ===== مراسلة الأولياء: محادثة مع أستاذ(ة) مادة أو مع الإدارة، حول تلميذ =====
CREATE TABLE threads (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target TEXT NOT NULL CHECK (target IN ('admin', 'subject')),
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (target = 'admin' OR subject_id IS NOT NULL)
);
CREATE INDEX threads_student_idx ON threads (student_id);

CREATE TABLE thread_messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX thread_messages_thread_idx ON thread_messages (thread_id, id);

-- آخر رسالة قرأها كل مستعمل في كل محادثة (لعدد الرسائل غير المقروءة)
CREATE TABLE thread_reads (
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id)
);

-- ===== بطاقة التقييم الشهرية: ملاحظة واحدة لكل تلميذ ومادة وشهر عند الإدخال السريع =====
ALTER TABLE notes ADD COLUMN card_month TEXT;
CREATE UNIQUE INDEX notes_card_key ON notes (student_id, subject_id, card_month) WHERE card_month IS NOT NULL;

-- ===== تسجيل المعلمين بأنفسهم: الحساب ينتظر موافقة الإدارة =====
ALTER TABLE users ADD COLUMN approved BOOLEAN NOT NULL DEFAULT true;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user
    AND tablename IN ('threads', 'thread_messages', 'thread_reads')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- 20261103090000_google_parents.sql
-- الدخول بحساب Google للأولياء + طلبات ربط الأبناء (توافق عليها الإدارة)
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN google_email TEXT;
CREATE UNIQUE INDEX users_google_sub_key ON users (google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE parent_requests (
  id SERIAL PRIMARY KEY,
  ticket TEXT NOT NULL UNIQUE,
  google_sub TEXT NOT NULL UNIQUE,
  google_email TEXT,
  google_name TEXT,
  full_name TEXT,
  phone TEXT,
  children JSONB NOT NULL DEFAULT '[]',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ
);
ALTER TABLE parent_requests ENABLE ROW LEVEL SECURITY;

-- 20261104090000_fee_adjustments.sql
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

-- 20261105090000_program_slots.sql
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

-- 20261106090000_program_posts.sql
-- أنشطة وتمارين ورسائل لكامل قسم في البرنامج التربوي (يراها أولياء أطفال القسم)
CREATE TABLE program_posts (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES program_classes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'activity' CHECK (kind IN ('activity', 'message')),
  title TEXT NOT NULL,
  body TEXT,
  due_date DATE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX program_posts_class_idx ON program_posts (class_id, created_at DESC);
ALTER TABLE program_posts ENABLE ROW LEVEL SECURITY;

-- 20261107090000_staff_formulas_partners.sql
-- مرافقو البرنامج التربوي: لا علاقة لهم بالمواد والمستويات، وأجرتهم شهرية
ALTER TABLE users ADD COLUMN program_staff BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN monthly_salary NUMERIC(10, 3);
ALTER TABLE users ADD COLUMN super_admin BOOLEAN NOT NULL DEFAULT false;
-- خلاص المرافق الشهري في دفتر المصاريف (مرة واحدة لكل شهر)
ALTER TABLE ledger_entries ADD COLUMN teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX ledger_teacher_salary_month ON ledger_entries (teacher_id, salary_month)
  WHERE teacher_id IS NOT NULL AND salary_month IS NOT NULL;

-- صيغ القسم (مثلًا أثر: «أفلا ينظرون» 80 أو «أفلا ينظرون + لسان العرب» 120)
ALTER TABLE program_classes ADD COLUMN formulas JSONB NOT NULL DEFAULT '[]';
ALTER TABLE program_children ADD COLUMN formula TEXT;

-- الشركاء: نصيب من المرابيح الشهرية، وما دُفع لكل شريك
CREATE TABLE partner_payments (
  id SERIAL PRIMARY KEY,
  partner TEXT NOT NULL,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount <> 0),
  paid_on DATE NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE partner_payments ENABLE ROW LEVEL SECURITY;

-- 20261108090000_center_debts.sql
-- ديون المركز (Crédits): لكل جهة دائنة مبلغ، وكل تسديد ينقص الباقي
CREATE TABLE center_debts (
  id SERIAL PRIMARY KEY,
  creditor TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
  since DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE center_debt_payments (
  id SERIAL PRIMARY KEY,
  debt_id INTEGER NOT NULL REFERENCES center_debts(id) ON DELETE CASCADE,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  note TEXT,
  ledger_id INTEGER REFERENCES ledger_entries(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE center_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE center_debt_payments ENABLE ROW LEVEL SECURITY;

-- 20261109090000_pay_per_child.sql
-- أجرة المرافق حسب عدد الأطفال: مبلغ عن كل طفل يدفع في أقسامه (مثلًا أمال: 40 = نصف 80 في أثر)
ALTER TABLE users ADD COLUMN pay_per_child NUMERIC(10, 3);

-- 20261110090000_month_closings.sql
-- تسكير الشهر: تُجمَّد أرقام الشهر (نقدًا) ونصيب كل شريك، ولا تُسجَّل بعدها عملية بتاريخ ذلك الشهر
CREATE TABLE month_closings (
  month TEXT PRIMARY KEY,
  income NUMERIC(12, 3) NOT NULL,
  expense NUMERIC(12, 3) NOT NULL,
  net NUMERIC(12, 3) NOT NULL,
  shares JSONB NOT NULL DEFAULT '{}',
  details JSONB NOT NULL DEFAULT '{}',
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE month_closings ENABLE ROW LEVEL SECURITY;

-- 20261111090000_fee_extras.sql
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

-- المنتجات (مثلًا «المرجع في العربية»): كل بيع يُحتسب مدخولًا في شهر تاريخه
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10, 3) CHECK (price >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE product_sales (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  child_id INTEGER REFERENCES program_children(id) ON DELETE SET NULL,
  buyer_name TEXT,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price NUMERIC(10, 3) NOT NULL CHECK (unit_price >= 0),
  amount NUMERIC(10, 3) NOT NULL CHECK (amount >= 0),
  sold_on DATE NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_sales_sold_on_idx ON product_sales (sold_on);
CREATE INDEX product_sales_student_idx ON product_sales (student_id);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sales ENABLE ROW LEVEL SECURITY;

-- تلميذ يدفع معلومه كاملًا حتى لو عنده إخوة مسجّلون
ALTER TABLE students ADD COLUMN no_sibling BOOLEAN NOT NULL DEFAULT false;

-- معلوم التسجيل يمكن أن يكون 0 (معفى) حتى يُعرف أنه حُسم
ALTER TABLE fee_extras DROP CONSTRAINT fee_extras_amount_check;
ALTER TABLE fee_extras ADD CONSTRAINT fee_extras_amount_check CHECK (amount >= 0);

-- تعديل دفعة بعد تسليم الوصل: نفس رقم الوصل، مع تاريخ آخر تعديل
ALTER TABLE payments ADD COLUMN edited_at TIMESTAMPTZ;
ALTER TABLE program_payments ADD COLUMN edited_at TIMESTAMPTZ;

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

-- صلاحيات كل إداري (المشرف العام له كل الصلاحيات)
ALTER TABLE users ADD COLUMN permissions JSONB;
-- ملفات المحاسبة: وصولات كل معاملة (حسب الشهر) وملفات المركز
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  folder TEXT NOT NULL CHECK (folder IN ('month', 'center')),
  month TEXT,
  ledger_id INTEGER REFERENCES ledger_entries(id) ON DELETE SET NULL,
  receipt_no INTEGER,
  title TEXT,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX documents_month_idx ON documents (folder, month);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- الصندوق اليومي: من أين دُفع كل مصروف، وحركات الصندوق (سحب صاحب المشروع، إيداع، عدّ)
ALTER TABLE ledger_entries ADD COLUMN paid_from TEXT NOT NULL DEFAULT 'cash';
CREATE TABLE cash_moves (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('withdraw', 'deposit', 'count')),
  person TEXT,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount >= 0),
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cash_moves_date_idx ON cash_moves (date);
ALTER TABLE cash_moves ENABLE ROW LEVEL SECURITY;

-- إيقاف عدّ ساعات المدرّسين لفترة (عطلة، امتحانات…): لكل المدرّسين أو لمدرّس واحد
CREATE TABLE payroll_pauses (
  id SERIAL PRIMARY KEY,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_from <= date_to)
);
ALTER TABLE payroll_pauses ENABLE ROW LEVEL SECURITY;

-- ===== 20261120090000_round_hours.sql =====
-- حصة 1:45 تُحتسب ساعتين للمدرّس (بقرار من الإدارة)
ALTER TABLE users ADD COLUMN IF NOT EXISTS round_hours BOOLEAN NOT NULL DEFAULT false;

-- ===== 20261120100000_task_board.sql =====
-- لوحة المهام: ترتيب البطاقات في كل عمود، وقائمة تحقق (checklist) لكل مهمة
ALTER TABLE center_tasks ADD COLUMN IF NOT EXISTS position INTEGER;
ALTER TABLE center_tasks ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ===== 20261121090000_accounting_folders.sql =====
-- فضاء المحاسبة: كشوفات البنك ومحاضر الاجتماعات (PV) كملفات مجمّعة
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_folder_check;
ALTER TABLE documents ADD CONSTRAINT documents_folder_check CHECK (folder IN ('month', 'center', 'bank', 'pv'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_date DATE;

-- ===== 20261122090000_impersonation.sql =====
-- تجربة الواجهة: المدير يفتح التطبيقة بحساب آخر (للاطّلاع فقط)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS impersonator_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- ===== 20261123090000_teacher_also_program.sql =====
-- معلم الدعم يمكن أن يكون مؤطّرًا في البرنامج التربوي أيضًا (يحتفظ بمعلوم الساعة)
ALTER TABLE users ADD COLUMN IF NOT EXISTS also_program BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS volunteer BOOLEAN NOT NULL DEFAULT false;

-- ===== 20261124090000_task_content.sql =====
-- محتوى تعليمي في مهام القسم: رابط فيديو وملفات مرفقة
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS video_url TEXT;
CREATE TABLE IF NOT EXISTS task_files (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_files_task_idx ON task_files (task_id);
ALTER TABLE task_files ENABLE ROW LEVEL SECURITY;

-- ===== 20261125090000_post_content.sql =====
-- منشورات أقسام البرنامج التربوي: رابط فيديو وملفات مرفقة
ALTER TABLE program_posts ADD COLUMN IF NOT EXISTS video_url TEXT;
CREATE TABLE IF NOT EXISTS program_post_files (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES program_posts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS program_post_files_post_idx ON program_post_files (post_id);
ALTER TABLE program_post_files ENABLE ROW LEVEL SECURITY;

-- ===== 20261126090000_last_seen.sql =====
-- آخر نشاط لكل حساب (يظهر للمدير والإدارة)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;

-- ===== 20261127090000_fixed_expenses.sql =====
-- المصاريف القارّة (الكراء، المحاسبة والقباضة، الفواتير…) تُدفع كل شهر وتُذكَّر بها الإدارة
CREATE TABLE IF NOT EXISTS fixed_expenses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  amount NUMERIC(12,3) NOT NULL DEFAULT 0,
  due_day INT NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 31),
  paid_from TEXT NOT NULL DEFAULT 'cash',
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE fixed_expenses ENABLE ROW LEVEL SECURITY;
-- دفعة مصروف قارّ في السجلّ: لأي مصروف قارّ ولأي شهر
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS fixed_id INT REFERENCES fixed_expenses(id) ON DELETE SET NULL;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS fixed_month TEXT;
CREATE INDEX IF NOT EXISTS ledger_fixed_idx ON ledger_entries (fixed_id, fixed_month);
-- مدرّس قسم في التربوي من الأولياء: حساب مؤطّر مرتبط بحساب الولي
ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_parent_id INT REFERENCES users(id) ON DELETE SET NULL;

-- ===== 20261128090000_program_whatsapp.sql =====
-- مجموعات واتساب للبرنامج التربوي: لكل الأطفال أو لقسم معيّن
ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS program BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS class_id INT REFERENCES program_classes(id) ON DELETE CASCADE;

-- ===== 20261129090000_program_requests.sql =====
-- طلبات التسجيل في البرنامج التربوي (رابط عمومي): تؤكّدها الإدارة وتلحق كل طفل بقسمه
CREATE TABLE IF NOT EXISTS program_requests (
  id SERIAL PRIMARY KEY,
  parent_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  children JSONB NOT NULL DEFAULT '[]',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  handled_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE program_requests ENABLE ROW LEVEL SECURITY;
-- الموارد البشرية: أجرة شخص تُحتسب في فضاء المحاسبة (مثلًا أجرة المحاسب)، وحساب دخول لكل شخص
ALTER TABLE staff ADD COLUMN IF NOT EXISTS accounting_category TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_id INT REFERENCES staff(id) ON DELETE SET NULL;
