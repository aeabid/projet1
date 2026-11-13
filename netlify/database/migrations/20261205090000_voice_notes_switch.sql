-- تقييم صوتي: المعلم يسجّل رسالة صوتية مع الملاحظة (يسمعها الولي)
ALTER TABLE notes ADD COLUMN IF NOT EXISTS audio_id INTEGER REFERENCES voice_clips(id) ON DELETE SET NULL;
ALTER TABLE program_notes ADD COLUMN IF NOT EXISTS audio_id INTEGER REFERENCES voice_clips(id) ON DELETE SET NULL;
-- حسابان لنفس الشخص (مدير ومعلّم): التبديل بينهما دون إعادة الدخول
ALTER TABLE users ADD COLUMN IF NOT EXISTS switch_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
