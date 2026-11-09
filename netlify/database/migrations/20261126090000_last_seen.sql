-- آخر نشاط لكل حساب (يظهر للمدير والإدارة)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
