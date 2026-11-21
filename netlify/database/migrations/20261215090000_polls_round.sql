-- «إعادة من البداية»: تُحذف الأصوات ويزيد رقم الجولة حتى تنسى هواتف الأولياء تصويتها السابق
ALTER TABLE polls ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 0;
