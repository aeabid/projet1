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
