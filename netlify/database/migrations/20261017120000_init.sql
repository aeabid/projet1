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
