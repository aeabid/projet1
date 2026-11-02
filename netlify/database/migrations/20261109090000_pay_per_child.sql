-- أجرة المرافق حسب عدد الأطفال: مبلغ عن كل طفل يدفع في أقسامه (مثلًا أمال: 40 = نصف 80 في أثر)
ALTER TABLE users ADD COLUMN pay_per_child NUMERIC(10, 3);
