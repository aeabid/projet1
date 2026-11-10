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
