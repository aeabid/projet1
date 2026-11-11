-- حساب موقوف: لا يدخل للمنصّة (مثلًا ولي خرج ابنه)
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
