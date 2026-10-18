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
