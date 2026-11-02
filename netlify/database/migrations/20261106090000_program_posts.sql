-- أنشطة وتمارين ورسائل لكامل قسم في البرنامج التربوي (يراها أولياء أطفال القسم)
CREATE TABLE program_posts (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES program_classes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'activity' CHECK (kind IN ('activity', 'message')),
  title TEXT NOT NULL,
  body TEXT,
  due_date DATE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX program_posts_class_idx ON program_posts (class_id, created_at DESC);
ALTER TABLE program_posts ENABLE ROW LEVEL SECURITY;
