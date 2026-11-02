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
