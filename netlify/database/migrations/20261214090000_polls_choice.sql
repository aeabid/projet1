-- التصويت: نوعان — «تقييم» (سلّم من 1 إلى 5) أو «سبر آراء» (اختيارات يضعها المدير لكل سؤال، حتى 5)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'rating';
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_kind_check;
ALTER TABLE polls ADD CONSTRAINT polls_kind_check CHECK (kind IN ('rating', 'choice'));
-- لكل سؤال قائمة اختياراته (سبر آراء فقط)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS options JSONB;
