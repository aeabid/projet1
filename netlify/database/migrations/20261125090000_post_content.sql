-- منشورات أقسام البرنامج التربوي: رابط فيديو وملفات مرفقة
ALTER TABLE program_posts ADD COLUMN IF NOT EXISTS video_url TEXT;
CREATE TABLE IF NOT EXISTS program_post_files (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES program_posts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS program_post_files_post_idx ON program_post_files (post_id);
ALTER TABLE program_post_files ENABLE ROW LEVEL SECURITY;
