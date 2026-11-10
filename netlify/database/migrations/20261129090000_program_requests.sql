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
