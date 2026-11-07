-- حصة 1:45 تُحتسب ساعتين للمدرّس (بقرار من الإدارة)
ALTER TABLE users ADD COLUMN IF NOT EXISTS round_hours BOOLEAN NOT NULL DEFAULT false;
