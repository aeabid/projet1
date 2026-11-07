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
