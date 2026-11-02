-- مرافقو البرنامج التربوي: لا علاقة لهم بالمواد والمستويات، وأجرتهم شهرية
ALTER TABLE users ADD COLUMN program_staff BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN monthly_salary NUMERIC(10, 3);
ALTER TABLE users ADD COLUMN super_admin BOOLEAN NOT NULL DEFAULT false;
-- خلاص المرافق الشهري في دفتر المصاريف (مرة واحدة لكل شهر)
ALTER TABLE ledger_entries ADD COLUMN teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX ledger_teacher_salary_month ON ledger_entries (teacher_id, salary_month)
  WHERE teacher_id IS NOT NULL AND salary_month IS NOT NULL;

-- صيغ القسم (مثلًا أثر: «أفلا ينظرون» 80 أو «أفلا ينظرون + لسان العرب» 120)
ALTER TABLE program_classes ADD COLUMN formulas JSONB NOT NULL DEFAULT '[]';
ALTER TABLE program_children ADD COLUMN formula TEXT;

-- الشركاء: نصيب من المرابيح الشهرية، وما دُفع لكل شريك
CREATE TABLE partner_payments (
  id SERIAL PRIMARY KEY,
  partner TEXT NOT NULL,
  amount NUMERIC(10, 3) NOT NULL CHECK (amount <> 0),
  paid_on DATE NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE partner_payments ENABLE ROW LEVEL SECURITY;
