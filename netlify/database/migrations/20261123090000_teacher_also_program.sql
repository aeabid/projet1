-- معلم الدعم يمكن أن يكون مؤطّرًا في البرنامج التربوي أيضًا (يحتفظ بمعلوم الساعة)
ALTER TABLE users ADD COLUMN IF NOT EXISTS also_program BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS volunteer BOOLEAN NOT NULL DEFAULT false;
