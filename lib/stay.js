// ---------- 🏨 حجز الغرف في دار أوغوز ----------
// الغرف والأجنحة مأخوذة من daroguz.com ومربوطة بملف «Répartition des chambres» (الطابق، عدد الكبار والصغار).
// الصفحة مخفيّة عن الأولياء حتى يفعّلها المدير. المدير يدخل سعر كل غرفة، والوليّ يحجز غرفة متاحة،
// والإدارة تؤكّد الحجز أو تلغيه. غرفة واحدة = حجز واحد قائم (فهرس فريد في القاعدة).

export const FLOORS = { rdc: 'الطابق الأرضي', 1: 'الطابق الأوّل', 2: 'الطابق الثاني' };
const DEFAULTS = { enabled: false, title: 'إقامة في دار أوغوز', info: '', unit: 'د.ت / الليلة' };

export function registerStay({ route, one, all, HttpError, text }) {
  const bad = (m) => new HttpError(400, m);
  const settings = async () => ({ ...DEFAULTS, ...((await one(`SELECT value FROM settings WHERE key = 'stay'`))?.value || {}) });
  const num = (v) => (v == null ? null : Number(v));
  const roomOut = (r) => ({
    id: r.id, slug: r.slug, name: r.name, kind: r.kind, floor: r.floor, floor_label: FLOORS[r.floor] || r.floor,
    bedrooms: r.bedrooms, adults: r.adults, children: r.children, label: r.label, features: r.features, photos: r.photos,
    price: num(r.price), active: r.active,
  });
  const live = `status IN ('pending', 'confirmed')`;

  // متاحة للولي فقط بعد التفعيل
  const guard = async (user) => {
    const s = await settings();
    if (user.role === 'parent' && !s.enabled) throw new HttpError(403, 'هذه الصفحة غير متاحة حاليًا');
    return s;
  };

  route('GET', '/api/stay', ['admin', 'parent'], async ({ user }) => {
    const s = await guard(user);
    const rooms = await all(`SELECT * FROM stay_rooms ${user.role === 'parent' ? 'WHERE active' : ''} ORDER BY kind, sort, id`);
    const bookings = await all(
      `SELECT b.id, b.room_id, b.parent_id, b.adults, b.children, b.note, b.status, b.price, b.created_at,
         u.full_name AS parent_name, u.phone AS parent_phone,
         (SELECT string_agg(st.full_name, '، ' ORDER BY st.full_name) FROM students st WHERE st.parent_id = u.id AND st.status <> 'left') AS kids
       FROM stay_bookings b JOIN users u ON u.id = b.parent_id
       ${user.role === 'parent' ? 'WHERE b.parent_id = $1' : `WHERE b.status <> 'cancelled' OR b.updated_at > now() - interval '30 days'`}
       ORDER BY b.created_at DESC`,
      user.role === 'parent' ? [user.id] : []
    );
    const taken = new Set((await all(`SELECT room_id FROM stay_bookings WHERE ${live}`)).map((r) => r.room_id));
    if (user.role === 'parent') {
      const mine = new Map(bookings.filter((b) => b.status !== 'cancelled').map((b) => [b.room_id, b]));
      return {
        settings: { title: s.title, info: s.info, unit: s.unit },
        rooms: rooms.map((r) => ({
          ...roomOut(r),
          status: mine.has(r.id) ? 'mine' : taken.has(r.id) ? 'taken' : 'free',
        })),
        bookings: bookings.map((b) => ({ ...b, price: num(b.price), parent_phone: undefined, kids: undefined })),
      };
    }
    return {
      settings: s,
      rooms: rooms.map((r) => ({ ...roomOut(r), site_price: num(r.site_price), source_url: r.source_url, status: taken.has(r.id) ? 'taken' : 'free' })),
      bookings: bookings.map((b) => ({ ...b, price: num(b.price) })),
    };
  });

  // التفعيل والنصوص: المدير
  route('PUT', '/api/stay/settings', ['admin'], async ({ user, body }) => {
    if (!user.super_admin) throw new HttpError(403, 'التفعيل من صلاحيات المدير');
    const s = await settings();
    const value = {
      enabled: body?.enabled === undefined ? s.enabled : body.enabled === true,
      title: body?.title === undefined ? s.title : text(body.title, { required: true, max: 120, name: 'العنوان' }),
      info: body?.info === undefined ? s.info : text(body.info, { max: 1500, name: 'المعلومات' }) || '',
      unit: body?.unit === undefined ? s.unit : text(body.unit, { required: true, max: 40, name: 'وحدة السعر' }),
    };
    await one(`INSERT INTO settings (key, value) VALUES ('stay', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING key`, [value]);
    return { settings: value };
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

  // الولي يحجز
  route('POST', '/api/stay/bookings', ['parent'], async ({ user, body }) => {
    await guard(user);
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
        `INSERT INTO stay_bookings (room_id, parent_id, adults, children, note, price) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [room.id, user.id, adults, children, note, room.price]
      );
      return [201, { booking: { ...b, price: num(b.price) } }];
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'هذه الغرفة حُجزت للتوّ، اختر غرفة أخرى');
      throw err;
    }
  });

  // الولي يلغي حجزه (قبل التأكيد)، الإدارة تؤكّد أو تلغي
  route('PUT', '/api/stay/bookings/:id', ['admin', 'parent'], async ({ user, params, body }) => {
    const b = await one('SELECT * FROM stay_bookings WHERE id = $1', [params.id]);
    if (!b || (user.role === 'parent' && b.parent_id !== user.id)) throw new HttpError(404, 'الحجز غير موجود');
    const status = String(body?.status || '');
    if (user.role === 'parent') {
      await guard(user);
      if (status !== 'cancelled') throw new HttpError(403, 'الإدارة هي التي تؤكّد الحجز');
      if (b.status !== 'pending') throw bad('الحجز مؤكَّد: اتّصل بالإدارة لإلغائه');
    } else if (!['confirmed', 'cancelled', 'pending'].includes(status)) throw bad('حالة غير صالحة');
    if (status === b.status) return { booking: b };
    try {
      const r = await one('UPDATE stay_bookings SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [b.id, status]);
      return { booking: { ...r, price: num(r.price) } };
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'الغرفة محجوزة لوليّ آخر الآن');
      throw err;
    }
  });
}
