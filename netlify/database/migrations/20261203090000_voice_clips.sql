-- رسائل صوتية: المعلم أو الإدارة يسجّل رسالة صوتية للأولياء (في المحادثات ورسائل القسم)
CREATE TABLE IF NOT EXISTS voice_clips (
  id SERIAL PRIMARY KEY,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  seconds INTEGER,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE voice_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS audio_id INTEGER REFERENCES voice_clips(id) ON DELETE SET NULL;
ALTER TABLE program_posts ADD COLUMN IF NOT EXISTS audio_id INTEGER REFERENCES voice_clips(id) ON DELETE SET NULL;
