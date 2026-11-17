-- حجز الغرف: المدير يختار من يرى الصفحة ويحجز (أولياء الدعم، أولياء التربوي، المدرّسون، أو أشخاص من خارج فيد برابط عمومي)
-- حجز شخص خارجي: دون حساب، بالاسم والهاتف
ALTER TABLE stay_bookings ALTER COLUMN parent_id DROP NOT NULL;
ALTER TABLE stay_bookings ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE stay_bookings ADD COLUMN IF NOT EXISTS guest_phone TEXT;
