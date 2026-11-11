-- تاريخ إرسال بيانات الدخول (اسم المستخدم وكلمة السر) لصاحب الحساب
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_sent_at TIMESTAMPTZ;
