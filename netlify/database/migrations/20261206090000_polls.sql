-- تصويت مباشر للأولياء (اجتماع): رابط/QR دون حساب، مجهول الهوية، نتائج حيّة
CREATE TABLE IF NOT EXISTS polls (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  criteria JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  allow_comment BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
-- صوت واحد لكل جهاز (يمكن تعديله)، دون أي معطى شخصي
CREATE TABLE IF NOT EXISTS poll_votes (
  id SERIAL PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  device TEXT NOT NULL,
  answers JSONB NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poll_id, device)
);
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;
