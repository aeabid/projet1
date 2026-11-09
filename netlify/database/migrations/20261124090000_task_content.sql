-- محتوى تعليمي في مهام القسم: رابط فيديو وملفات مرفقة
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS video_url TEXT;
CREATE TABLE IF NOT EXISTS task_files (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_files_task_idx ON task_files (task_id);
ALTER TABLE task_files ENABLE ROW LEVEL SECURITY;
