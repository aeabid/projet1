-- ===== مراسلة الأولياء: محادثة مع أستاذ(ة) مادة أو مع الإدارة، حول تلميذ =====
CREATE TABLE threads (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target TEXT NOT NULL CHECK (target IN ('admin', 'subject')),
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (target = 'admin' OR subject_id IS NOT NULL)
);
CREATE INDEX threads_student_idx ON threads (student_id);

CREATE TABLE thread_messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX thread_messages_thread_idx ON thread_messages (thread_id, id);

-- آخر رسالة قرأها كل مستعمل في كل محادثة (لعدد الرسائل غير المقروءة)
CREATE TABLE thread_reads (
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id)
);

-- ===== بطاقة التقييم الشهرية: ملاحظة واحدة لكل تلميذ ومادة وشهر عند الإدخال السريع =====
ALTER TABLE notes ADD COLUMN card_month TEXT;
CREATE UNIQUE INDEX notes_card_key ON notes (student_id, subject_id, card_month) WHERE card_month IS NOT NULL;

-- ===== تسجيل المعلمين بأنفسهم: الحساب ينتظر موافقة الإدارة =====
ALTER TABLE users ADD COLUMN approved BOOLEAN NOT NULL DEFAULT true;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user
    AND tablename IN ('threads', 'thread_messages', 'thread_reads')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
