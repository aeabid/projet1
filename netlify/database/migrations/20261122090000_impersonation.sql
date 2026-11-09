-- تجربة الواجهة: المدير يفتح التطبيقة بحساب آخر (للاطّلاع فقط)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS impersonator_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
