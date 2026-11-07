-- لوحة المهام: ترتيب البطاقات في كل عمود، وقائمة تحقق (checklist) لكل مهمة
ALTER TABLE center_tasks ADD COLUMN IF NOT EXISTS position INTEGER;
ALTER TABLE center_tasks ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
