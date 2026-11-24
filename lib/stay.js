// ---------- 🏨 حجز الغرف في دار أوغوز ----------
// الغرف والأجنحة مأخوذة من daroguz.com ومربوطة بملف «Répartition des chambres» (الطابق، عدد الكبار والصغار).
// الصفحة مخفيّة حتى يفعّلها المدير، ويختار من يراها ويحجز: أولياء الدعم، أولياء التربوي، المدرّسون،
// أو أشخاص من خارج فيد برابط عمومي (education.feed.tn/rooms). المدير يدخل سعر كل غرفة، والإدارة تؤكّد الحجز.
// غرفة واحدة = حجز واحد قائم (فهرس فريد في القاعدة).

export const FLOORS = { rdc: 'الطابق الأرضي', 1: 'الطابق الأوّل', 2: 'الطابق الثاني' };
export const STAY_AUDIENCES = {
  support: 'أولياء تلاميذ دروس الدعم',
  program: 'أولياء أطفال البرنامج التربوي',
  teachers: 'المدرّسون والمؤطّرون',
  public: 'أشخاص من خارج فيد (رابط عمومي)',
};
const DEFAULTS = { enabled: false, title: 'إقامة في دار أوغوز', info: '', unit: 'د.ت / الليلة', audience: ['support', 'program'] };

export function registerStay({ route, one, all, pool, HttpError, text }) {
  const bad = (m) => new HttpError(400, m);
  const settings = async () => {
    const s = { ...DEFAULTS, ...((await one(`SELECT value FROM settings WHERE key = 'stay'`))?.value || {}) };
    s.audience = (Array.isArray(s.audience) ? s.audience : DEFAULTS.audience).filter((a) => STAY_AUDIENCES[a]);
    return s;
  };
  const num = (v) => (v == null ? null : Number(v));
  const roomOut = (r) => ({
    id: r.id, slug: r.slug, name: r.name, kind: r.kind, floor: r.floor, floor_label: FLOORS[r.floor] || r.floor,
    bedrooms: r.bedrooms, adults: r.adults, children: r.children, label: r.label, features: r.features, photos: r.photos, tour: r.tour || [],
    price: num(r.price), active: r.active,
  });
  const live = `status IN ('pending', 'confirmed')`;

  // هل يرى هذا الحساب صفحة الحجز؟ (حسب اختيار المدير)
  async function eligible(user, s) {
    if (!s.enabled || !user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'teacher') return s.audience.includes('teachers');
    if (user.role !== 'parent') return false;
    if (s.audience.includes('support') && (await one(`SELECT 1 FROM students WHERE parent_id = $1 AND status = 'studying' LIMIT 1`, [user.id]))) return true;
    if (s.audience.includes('program') && (await one(`SELECT 1 FROM program_children WHERE parent_id = $1 AND status = 'active' LIMIT 1`, [user.id]))) return true;
    return false;
  }
  const guard = async (user) => {
    const s = await settings();
    if (user.role !== 'admin' && !(await eligible(user, s))) throw new HttpError(403, 'هذه الصفحة غير متاحة حاليًا');
    return s;
  };

  // للقائمة: هل يظهر رابط «حجز الغرف»
  const stayVisible = async (user) => eligible(user, await settings());

  const takenRooms = async () => new Set((await all(`SELECT room_id FROM stay_bookings WHERE ${live}`)).map((r) => r.room_id));
  const publicView = (s, rooms, taken, mine = new Map()) => ({
    settings: { title: s.title, info: s.info, unit: s.unit },
    rooms: rooms.map((r) => ({ ...roomOut(r), status: mine.has(r.id) ? 'mine' : taken.has(r.id) ? 'taken' : 'free' })),
  });

  route('GET', '/api/stay', ['admin', 'parent', 'teacher'], async ({ user }) => {
    const s = await guard(user);
    const staff = user.role === 'admin';
    const rooms = await all(`SELECT * FROM stay_rooms ${staff ? '' : 'WHERE active'} ORDER BY kind, sort, id`);
    const bookings = await all(
      `SELECT b.id, b.room_id, b.parent_id, b.adults, b.children, b.note, b.status, b.price, b.created_at,
         COALESCE(u.full_name, b.guest_name) AS parent_name, COALESCE(u.phone, b.guest_phone) AS parent_phone,
         CASE WHEN b.parent_id IS NULL THEN 'guest' ELSE u.role END AS booker,
         (SELECT string_agg(st.full_name, '، ' ORDER BY st.full_name) FROM students st WHERE st.parent_id = u.id AND st.status <> 'left') AS kids
       FROM stay_bookings b LEFT JOIN users u ON u.id = b.parent_id
       ${staff ? `WHERE b.status <> 'cancelled' OR b.updated_at > now() - interval '30 days'` : 'WHERE b.parent_id = $1'}
       ORDER BY b.created_at DESC`,
      staff ? [] : [user.id]
    );
    const taken = await takenRooms();
    if (!staff) {
      const mine = new Map(bookings.filter((b) => b.status !== 'cancelled').map((b) => [b.room_id, b]));
      return { ...publicView(s, rooms, taken, mine), bookings: bookings.map((b) => ({ ...b, price: num(b.price), parent_phone: undefined, kids: undefined })) };
    }
    return {
      settings: s,
      audiences: STAY_AUDIENCES,
      rooms: rooms.map((r) => ({ ...roomOut(r), status: taken.has(r.id) ? 'taken' : 'free' })),
      bookings: bookings.map((b) => ({ ...b, price: num(b.price) })),
    };
  });

  // التفعيل، من يرى الصفحة، والنصوص: المدير
  route('PUT', '/api/stay/settings', ['admin'], async ({ user, body }) => {
    if (!user.super_admin) throw new HttpError(403, 'التفعيل من صلاحيات المدير');
    const s = await settings();
    let audience = s.audience;
    if (body?.audience !== undefined) {
      if (!Array.isArray(body.audience)) throw bad('اختر من يرى الصفحة');
      audience = [...new Set(body.audience.map(String))].filter((a) => STAY_AUDIENCES[a]);
      if (!audience.length) throw bad('اختر فئة واحدة على الأقلّ');
    }
    const value = {
      enabled: body?.enabled === undefined ? s.enabled : body.enabled === true,
      title: body?.title === undefined ? s.title : text(body.title, { required: true, max: 120, name: 'العنوان' }),
      info: body?.info === undefined ? s.info : text(body.info, { max: 1500, name: 'المعلومات' }) || '',
      unit: body?.unit === undefined ? s.unit : text(body.unit, { required: true, max: 40, name: 'وحدة السعر' }),
      audience,
    };
    await one(`INSERT INTO settings (key, value) VALUES ('stay', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING key`, [value]);
    return { settings: value };
  });

  // 🔒 الإدارة تجعل الغرفة محجوزة (دون وليّ: حجز مؤكَّد باسم الإدارة) أو 🔓 متاحة من جديد (إلغاء الحجز القائم)
  route('PUT', '/api/stay/rooms/:id/hold', ['admin'], async ({ user, params, body }) => {
    const room = await one('SELECT * FROM stay_rooms WHERE id = $1', [params.id]);
    if (!room) throw new HttpError(404, 'الغرفة غير موجودة');
    const liveB = await one(`SELECT id FROM stay_bookings WHERE room_id = $1 AND ${live}`, [room.id]);
    if (body?.held) {
      if (liveB) throw new HttpError(409, 'الغرفة محجوزة أصلًا');
      const note = text(body?.note, { max: 200, name: 'الملاحظة' }) || 'محجوزة من الإدارة';
      await one(
        `INSERT INTO stay_bookings (room_id, parent_id, adults, children, note, status, price) VALUES ($1, $2, 1, 0, $3, 'confirmed', 0) RETURNING id`,
        [room.id, user.id, note]
      );
    } else if (liveB) {
      await pool.query(`UPDATE stay_bookings SET status = 'cancelled', updated_at = now() WHERE id = $1`, [liveB.id]);
    }
    return { ok: true };
  });

  // السعر وإظهار/إخفاء الغرفة
  route('PUT', '/api/stay/rooms/:id', ['admin'], async ({ params, body }) => {
    const room = await one('SELECT * FROM stay_rooms WHERE id = $1', [params.id]);
    if (!room) throw new HttpError(404, 'الغرفة غير موجودة');
    let price = room.price;
    if (body?.price !== undefined) {
      if (body.price === null || body.price === '') price = null;
      else {
        price = Number(body.price);
        if (!Number.isFinite(price) || price < 0 || price > 100000) throw bad('السعر غير صالح');
      }
    }
    const active = body?.active === undefined ? room.active : body.active === true;
    const r = await one('UPDATE stay_rooms SET price = $2, active = $3 WHERE id = $1 RETURNING *', [room.id, price, active]);
    return { room: roomOut(r) };
  });

  // التحقّق من الغرفة والعدد ثمّ الحجز (حساب فيد أو شخص خارجي)
  async function book({ userId = null, guestName = null, guestPhone = null, body }) {
    const room = await one('SELECT * FROM stay_rooms WHERE id = $1 AND active', [Number(body?.room_id) || 0]);
    if (!room) throw new HttpError(404, 'الغرفة غير موجودة');
    if (room.price == null) throw bad('سعر هذه الغرفة لم يُحدَّد بعد');
    const adults = Number(body?.adults);
    const children = Number(body?.children || 0);
    if (!Number.isInteger(adults) || adults < 1) throw bad('عدد الكبار غير صالح');
    if (!Number.isInteger(children) || children < 0) throw bad('عدد الأطفال غير صالح');
    // طفل ينام في سرير كبير لا العكس
    if (adults > room.adults || adults + children > room.adults + room.children) {
      throw bad(`طاقة هذه الغرفة: ${room.adults} كبار${room.children ? ` و${room.children} ${room.children > 1 ? 'أطفال' : 'طفل'}` : ''}`);
    }
    const note = text(body?.note, { max: 500, name: 'الملاحظة' });
    try {
      const b = await one(
        `INSERT INTO stay_bookings (room_id, parent_id, guest_name, guest_phone, adults, children, note, price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [room.id, userId, guestName, guestPhone, adults, children, note, room.price]
      );
      return [201, { booking: { ...b, price: num(b.price) } }];
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'هذه الغرفة حُجزت للتوّ، اختر غرفة أخرى');
      throw err;
    }
  }

  route('POST', '/api/stay/bookings', ['parent', 'teacher'], async ({ user, body }) => {
    await guard(user);
    return book({ userId: user.id, body });
  });

  // ---------- 🌐 شخص من خارج فيد: الرابط العمومي education.feed.tn/rooms ----------
  const publicGuard = async () => {
    const s = await settings();
    if (!s.enabled || !s.audience.includes('public')) throw new HttpError(403, 'الحجز غير متاح حاليًا');
    return s;
  };
  route('GET', '/api/public/stay', null, async () => {
    const s = await publicGuard();
    return publicView(s, await all('SELECT * FROM stay_rooms WHERE active ORDER BY kind, sort, id'), await takenRooms());
  });
  route('POST', '/api/public/stay/bookings', null, async ({ body }) => {
    await publicGuard();
    const name = text(body?.name, { required: true, max: 120, name: 'الاسم واللقب' });
    const phone = String(body?.phone || '').replace(/[^\d+]/g, '');
    if (phone.replace(/\D/g, '').length < 8 || phone.length > 16) throw bad('رقم الهاتف غير صالح');
    return book({ guestName: name, guestPhone: phone, body });
  });

  // صاحب الحجز يلغي حجزه (قبل التأكيد)، الإدارة تؤكّد أو تلغي
  route('PUT', '/api/stay/bookings/:id', ['admin', 'parent', 'teacher'], async ({ user, params, body }) => {
    const b = await one('SELECT * FROM stay_bookings WHERE id = $1', [params.id]);
    const staff = user.role === 'admin';
    if (!b || (!staff && b.parent_id !== user.id)) throw new HttpError(404, 'الحجز غير موجود');
    const status = String(body?.status || '');
    if (!staff) {
      await guard(user);
      if (status !== 'cancelled') throw new HttpError(403, 'الإدارة هي التي تؤكّد الحجز');
      if (b.status !== 'pending') throw bad('الحجز مؤكَّد: اتّصل بالإدارة لإلغائه');
    } else if (!['confirmed', 'cancelled', 'pending'].includes(status)) throw bad('حالة غير صالحة');
    if (status === b.status) return { booking: b };
    try {
      const r = await one('UPDATE stay_bookings SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [b.id, status]);
      return { booking: { ...r, price: num(r.price) } };
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'الغرفة محجوزة لشخص آخر الآن');
      throw err;
    }
  });

  return { stayVisible };
}
