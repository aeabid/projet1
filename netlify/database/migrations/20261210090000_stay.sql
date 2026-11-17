-- 🏨 حجز الغرف في دار أوغوز (daroguz.com): الغرف والأجنحة كما في ملف «Répartition des chambres»
-- الصفحة مخفيّة حتى يفعّلها المدير (settings.stay.enabled). السعر يدخله المدير تحت كل غرفة.
CREATE TABLE IF NOT EXISTS stay_rooms (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('room', 'suite')),
  floor TEXT NOT NULL,
  bedrooms INTEGER NOT NULL DEFAULT 1,
  adults INTEGER NOT NULL,
  children INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  features JSONB NOT NULL DEFAULT '[]',
  photos JSONB NOT NULL DEFAULT '[]',
  site_price NUMERIC(10, 3),
  source_url TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  price NUMERIC(10, 3),
  active BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE stay_rooms ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS stay_bookings (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES stay_rooms(id) ON DELETE CASCADE,
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adults INTEGER NOT NULL CHECK (adults >= 1),
  children INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  price NUMERIC(10, 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- غرفة واحدة = حجز واحد قائم
CREATE UNIQUE INDEX IF NOT EXISTS stay_bookings_room_live ON stay_bookings (room_id) WHERE status IN ('pending', 'confirmed');
CREATE INDEX IF NOT EXISTS stay_bookings_parent ON stay_bookings (parent_id);
ALTER TABLE stay_bookings ENABLE ROW LEVEL SECURITY;

INSERT INTO stay_rooms (slug, name, kind, floor, bedrooms, adults, children, label, features, photos, site_price, source_url, sort) VALUES
  ('rimel-1', 'Rimel 1', 'room', 'rdc', 1, 4, 0, 'غرفة تطلّ على الحديقة', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "إطلالة على الحديقة والمسبح", "باب يفتح على الحديقة"]'::jsonb, '["stay/rimel-1-1.jpg", "stay/rimel-1-2.jpg", "stay/rimel-1-3.jpg", "stay/rimel-1-4.jpg", "stay/rimel-1-5.jpg"]'::jsonb, 350, 'https://daroguz.com/rooms/rimel-1/', 1),
  ('rimel-2', 'Rimel 2', 'room', 'rdc', 1, 4, 0, 'غرفة بجاكوزي', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "شرفة", "إطلالة على المدينة", "جاكوزي"]'::jsonb, '["stay/rimel-2-1.jpg", "stay/rimel-2-2.jpg", "stay/rimel-2-3.jpg"]'::jsonb, 350, 'https://daroguz.com/rooms/rimel-2/', 2),
  ('rimel-3', 'Rimel 3', 'room', 'rdc', 1, 3, 1, 'غرفة عادية', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "باب يفتح على تيراس خارجي"]'::jsonb, '["stay/rimel-3-1.jpg", "stay/rimel-3-2.jpg", "stay/rimel-3-3.jpg", "stay/rimel-3-4.jpg"]'::jsonb, NULL, 'https://daroguz.com/rooms/rimel-3/', 3),
  ('rimel-4', 'Rimel 4', 'room', 'rdc', 1, 3, 1, 'غرفة تطلّ على الحديقة', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "إطلالة على الحديقة والمسبح", "باب يفتح على تيراس خارجي"]'::jsonb, '["stay/rimel-4-1.jpg", "stay/rimel-4-2.jpg", "stay/rimel-4-3.jpg", "stay/rimel-4-4.jpg"]'::jsonb, NULL, 'https://daroguz.com/rooms/rimel-4/', 4),
  ('rimel-5', 'Rimel 5', 'room', '1', 1, 3, 1, 'غرفة', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "شرفة", "إطلالة على المدينة"]'::jsonb, '["stay/rimel-5-1.jpg", "stay/rimel-5-2.jpg", "stay/rimel-5-3.jpg", "stay/rimel-5-4.jpg"]'::jsonb, 320, 'https://daroguz.com/rooms/rimel-5/', 5),
  ('rimel-6', 'Rimel 6', 'room', '1', 1, 2, 2, 'غرفة عادية', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "شرفة", "إطلالة على المدينة"]'::jsonb, '["stay/rimel-6-1.jpg", "stay/rimel-6-2.jpg", "stay/rimel-6-3.jpg"]'::jsonb, 320, 'https://daroguz.com/rooms/rimel-6/', 6),
  ('rimel-7', 'Rimel 7', 'room', '1', 1, 3, 1, 'غرفة عادية', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "شرفة تطلّ على البحر"]'::jsonb, '["stay/rimel-7-1.jpg", "stay/rimel-7-2.jpg", "stay/rimel-7-3.jpg"]'::jsonb, 320, 'https://daroguz.com/rooms/rimel-7/', 7),
  ('rimel-8', 'Rimel 8', 'room', '1', 1, 2, 0, 'غرفة تطلّ على الحديقة', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "شرفة", "إطلالة على الحديقة والبحر"]'::jsonb, '["stay/rimel-8-1.jpg", "stay/rimel-8-2.jpg", "stay/rimel-8-3.jpg", "stay/rimel-8-4.jpg", "stay/rimel-8-5.jpg"]'::jsonb, NULL, 'https://daroguz.com/rooms/rimel-8/', 8),
  ('oguz-5', 'Oguz 5', 'room', '2', 1, 3, 1, 'غرفة عادية', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "شرفة", "إطلالة على المدينة"]'::jsonb, '["stay/oguz-5-1.jpg", "stay/oguz-5-2.jpg", "stay/oguz-5-3.jpg"]'::jsonb, 350, 'https://daroguz.com/rooms/oguz-5/', 9),
  ('oguz-6', 'Oguz 6', 'room', '2', 1, 3, 1, 'غرفة عادية', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "شرفة", "إطلالة على المدينة"]'::jsonb, '["stay/oguz-6-1.jpg", "stay/oguz-6-2.jpg", "stay/oguz-6-3.jpg", "stay/oguz-6-4.jpg"]'::jsonb, 320, 'https://daroguz.com/rooms/oguz-6/', 10),
  ('oguz-7', 'Oguz 7', 'room', '2', 1, 4, 0, 'غرفة واسعة', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "إطلالة على المدينة", "غرفة فسيحة"]'::jsonb, '["stay/oguz-7-1.jpg", "stay/oguz-7-2.jpg", "stay/oguz-7-3.jpg", "stay/oguz-7-4.jpg"]'::jsonb, NULL, 'https://daroguz.com/rooms/oguz-7/', 11),
  ('oguz-3', 'Oguz 3', 'room', '2', 1, 2, 2, 'غرفة تطلّ على البحر', '["سرير مزدوج", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "شرفة", "إطلالة بانوراميّة على البحر والحديقة والمسبح"]'::jsonb, '["stay/oguz-3-1.jpg", "stay/oguz-3-2.jpg", "stay/oguz-3-3.jpg", "stay/oguz-3-4.jpg"]'::jsonb, 380, 'https://daroguz.com/rooms/oguz-3/', 12),
  ('demna-2', 'Demna 2', 'suite', '1', 2, 5, 0, 'جناح عادي', '["غرفتان منفصلتان", "سرير مزدوج + سريران منفصلان", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "تيراس"]'::jsonb, '["stay/demna-2-1.jpg", "stay/demna-2-2.jpg", "stay/demna-2-3.jpg"]'::jsonb, 500, 'https://daroguz.com/rooms/demna-2/', 13),
  ('demna-3', 'Demna 3', 'suite', '1', 2, 5, 0, 'جناح عادي', '["غرفتان منفصلتان", "سرير مزدوج + سريران منفصلان", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "تيراس", "إطلالة على البحر والحديقة والمسبح"]'::jsonb, '["stay/demna-3-1.jpg", "stay/demna-3-2.jpg", "stay/demna-3-3.jpg", "stay/demna-3-4.jpg"]'::jsonb, 500, 'https://daroguz.com/rooms/demna-3/', 14),
  ('oguz-1', 'Oguz 1', 'suite', '2', 2, 5, 0, 'جناح يطلّ على البحر', '["غرفتان منفصلتان", "سرير مزدوج + سريران منفصلان", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "شرفة", "إطلالة بانوراميّة على البحر"]'::jsonb, '["stay/oguz-1-1.jpg", "stay/oguz-1-2.jpg", "stay/oguz-1-3.jpg", "stay/oguz-1-4.jpg"]'::jsonb, 580, 'https://daroguz.com/rooms/oguz-1/', 15),
  ('oguz-4', 'Oguz 4', 'suite', '2', 2, 5, 0, 'جناح يطلّ على البحر', '["غرفتان منفصلتان", "سرير مزدوج + سريران منفصلان", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "شرفة", "إطلالة بانوراميّة على البحر"]'::jsonb, '["stay/oguz-4-1.jpg", "stay/oguz-4-2.jpg", "stay/oguz-4-3.jpg", "stay/oguz-4-4.jpg", "stay/oguz-4-5.jpg", "stay/oguz-4-6.jpg", "stay/oguz-4-7.jpg"]'::jsonb, 580, 'https://daroguz.com/rooms/oguz-4/', 16),
  ('oguz-2', 'Oguz 2', 'suite', '2', 2, 5, 0, 'جناح فاخر', '["غرفتان منفصلتان", "سرير مزدوج + سريران منفصلان", "بيت ماء", "تلفاز", "مكيّف", "ميني بار", "تيراس يطلّ على البحر", "إطلالة بانوراميّة"]'::jsonb, '["stay/oguz-2-1.jpg", "stay/oguz-2-2.jpg", "stay/oguz-2-3.jpg", "stay/oguz-2-4.jpg", "stay/oguz-2-5.jpg", "stay/oguz-2-6.jpg", "stay/oguz-2-7.jpg"]'::jsonb, 580, 'https://daroguz.com/rooms/oguz-2/', 17)
ON CONFLICT (slug) DO NOTHING;
