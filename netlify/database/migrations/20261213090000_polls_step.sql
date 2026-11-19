-- التصويت المباشر: «كل الأسئلة معًا» أو «سؤال بسؤال» (المدير ينتقل من سؤال إلى آخر والنتائج تظهر مباشرة)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'all';
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_mode_check;
ALTER TABLE polls ADD CONSTRAINT polls_mode_check CHECK (mode IN ('all', 'step'));
-- السؤال المعروض حاليًا في وضع «سؤال بسؤال» (NULL = لم يبدأ بعد)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS current INTEGER;
