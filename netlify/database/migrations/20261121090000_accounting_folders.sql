-- فضاء المحاسبة: كشوفات البنك ومحاضر الاجتماعات (PV) كملفات مجمّعة
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_folder_check;
ALTER TABLE documents ADD CONSTRAINT documents_folder_check CHECK (folder IN ('month', 'center', 'bank', 'pv'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_date DATE;
