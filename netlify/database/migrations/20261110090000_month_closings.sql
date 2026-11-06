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
