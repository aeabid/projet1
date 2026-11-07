-- تلميذ يدفع معلومه كاملًا حتى لو عنده إخوة مسجّلون
ALTER TABLE students ADD COLUMN no_sibling BOOLEAN NOT NULL DEFAULT false;
