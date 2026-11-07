-- تعديل دفعة بعد تسليم الوصل: نفس رقم الوصل، مع تاريخ آخر تعديل
ALTER TABLE payments ADD COLUMN edited_at TIMESTAMPTZ;
ALTER TABLE program_payments ADD COLUMN edited_at TIMESTAMPTZ;
