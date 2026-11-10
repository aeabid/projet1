-- مجموعات واتساب للبرنامج التربوي: لكل الأطفال أو لقسم معيّن
ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS program BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS class_id INT REFERENCES program_classes(id) ON DELETE CASCADE;
