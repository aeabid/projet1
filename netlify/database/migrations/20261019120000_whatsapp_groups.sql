-- مجموعات واتساب: مجموعة لكل مستوى (وفوج اختياري) مع رابط الدعوة
CREATE TABLE whatsapp_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT,
  group_name TEXT,
  invite_link TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
