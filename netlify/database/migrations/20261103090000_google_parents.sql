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
