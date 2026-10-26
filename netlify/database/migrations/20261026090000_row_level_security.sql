-- Supabase يفتح جداول المخطط public عبر الـ API بمفتاح عمومي: نُغلقها كلها بـ RLS دون أي سياسة.
-- الخادم يتصل بصاحب الجداول، فلا يتأثّر. كل جدول جديد يجب أن يُغلق بنفس الطريقة.
DO $$
DECLARE t record;
BEGIN
  -- جداول التطبيق فقط (التي يملكها مستعمل التطبيق)، لا جداول المنصّة
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
