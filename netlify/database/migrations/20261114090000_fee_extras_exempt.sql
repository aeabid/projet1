-- معلوم التسجيل يمكن أن يكون 0 (معفى) حتى يُعرف أنه حُسم
ALTER TABLE fee_extras DROP CONSTRAINT fee_extras_amount_check;
ALTER TABLE fee_extras ADD CONSTRAINT fee_extras_amount_check CHECK (amount >= 0);
