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
