-- 👁️ الجولة 360° لكل غرفة (من موقع daroguz.com): مشاهد الغرفة وبيت الماء والشرفة
ALTER TABLE stay_rooms ADD COLUMN IF NOT EXISTS tour JSONB NOT NULL DEFAULT '[]';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/demna-2-1.jpg"}, {"name": "الغرفة 2", "src": "stay/360/demna-2-2.jpg"}, {"name": "بيت الماء", "src": "stay/360/demna-2-3.jpg"}]'::jsonb WHERE slug = 'demna-2';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/demna-3-1.jpg"}, {"name": "الغرفة 2", "src": "stay/360/demna-3-2.jpg"}]'::jsonb WHERE slug = 'demna-3';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/oguz-1-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/oguz-1-2.jpg"}]'::jsonb WHERE slug = 'oguz-1';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/oguz-2-1.jpg"}, {"name": "الشرفة", "src": "stay/360/oguz-2-2.jpg"}, {"name": "بيت الماء", "src": "stay/360/oguz-2-3.jpg"}]'::jsonb WHERE slug = 'oguz-2';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/oguz-3-1.jpg"}, {"name": "الشرفة", "src": "stay/360/oguz-3-2.jpg"}, {"name": "بيت الماء", "src": "stay/360/oguz-3-3.jpg"}]'::jsonb WHERE slug = 'oguz-3';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/oguz-4-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/oguz-4-2.jpg"}]'::jsonb WHERE slug = 'oguz-4';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/oguz-5-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/oguz-5-2.jpg"}]'::jsonb WHERE slug = 'oguz-5';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/oguz-6-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/oguz-6-2.jpg"}]'::jsonb WHERE slug = 'oguz-6';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/oguz-7-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/oguz-7-2.jpg"}]'::jsonb WHERE slug = 'oguz-7';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/rimel-1-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/rimel-1-2.jpg"}]'::jsonb WHERE slug = 'rimel-1';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/rimel-2-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/rimel-2-2.jpg"}]'::jsonb WHERE slug = 'rimel-2';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/rimel-3-1.jpg"}]'::jsonb WHERE slug = 'rimel-3';
UPDATE stay_rooms SET tour = '[]'::jsonb WHERE slug = 'rimel-4';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/rimel-5-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/rimel-5-2.jpg"}]'::jsonb WHERE slug = 'rimel-5';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/rimel-6-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/rimel-6-2.jpg"}]'::jsonb WHERE slug = 'rimel-6';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/rimel-7-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/rimel-7-2.jpg"}]'::jsonb WHERE slug = 'rimel-7';
UPDATE stay_rooms SET tour = '[{"name": "الغرفة", "src": "stay/360/rimel-8-1.jpg"}, {"name": "بيت الماء", "src": "stay/360/rimel-8-2.jpg"}]'::jsonb WHERE slug = 'rimel-8';
