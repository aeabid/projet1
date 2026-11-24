// ---------- 🏨 حجز الغرف في دار أوغوز ----------
// الإدارة: تفعيل الصفحة، سعر كل غرفة، تأكيد/إلغاء الحجوزات وجدول توزيع الغرف.
// الولي (بعد التفعيل): يتصفّح الغرف بالصور ويحجز غرفة متاحة.

const STAY_STATUS = { pending: ['⏳ في انتظار التأكيد', 'warn'], confirmed: ['✅ مؤكَّد', 'ok'], cancelled: ['✘ ملغى', 'off'] };
const stayState = { kind: '' };
const stayNum = (n) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

// الطاقة + نوع الأسرّة (ملف التوزيع): الكبير = lit simple ou double، الطفل = canapé
// العائلة دائمًا والدان (كبيران) والبقيّة أطفال: ما يفرّق بين الغرف هو عدد الأسرّة ونوعها
const stayKids = (r) => Math.max(0, r.adults + r.children - 2);
const stayCap = (r) =>
  `<span class="st-cap" title="الطاقة">👤 2 كبار${stayKids(r) ? ` + 🧒 ${stayKids(r)} ${stayKids(r) > 1 ? 'أطفال' : 'طفل'}` : ''}</span>
   <span class="st-beds" dir="ltr">🛏️ ${r.adults} lit${r.adults > 1 ? 's' : ''} (simple ou double)${r.children ? ` · 🛋️ ${r.children} canapé${r.children > 1 ? 's' : ''}` : ''}</span>`;
const stayName = (r) => (r.kind === 'suite' && !/\(suite\)/i.test(r.name) ? `${r.name} (Suite)` : r.name);
const stayPrice = (r, unit) =>
  r.price == null ? '<span class="st-price none">السعر يُعلن قريبًا</span>' : `<span class="st-price"><b>${stayNum(r.price)}</b> ${esc(unit)}</span>`;

function stayPhotos(r) {
  const photos = r.photos || [];
  return `<div class="st-photos">
      <div class="st-track" dir="ltr">${photos.map((p, i) => `<img src="${esc(p)}" alt="${esc(r.name)} ${i + 1}" loading="lazy" data-zoom="${esc(p)}">`).join('')}</div>
      ${photos.length > 1 ? `<span class="st-count">📷 ${photos.length}</span><div class="st-dots" dir="ltr">${photos.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
      ${r.tour?.length ? `<button type="button" class="st-360" data-tour="${r.id}" title="جولة 360°">👁️ 360°</button>` : ''}
      <span class="st-kind ${r.kind}">${r.kind === 'suite' ? `🏠 جناح · ${r.bedrooms} غرف` : '🛏️ غرفة'}</span>
    </div>`;
}

// تمرير الصور + نقاط المؤشّر + تكبير الصورة
function stayWire(root, rooms = []) {
  root.querySelectorAll('[data-tour]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = rooms.find((x) => x.id === Number(b.dataset.tour));
      if (r) stayTour(r);
    })
  );
  root.querySelectorAll('.st-photos').forEach((box) => {
    const track = box.querySelector('.st-track');
    const dots = [...box.querySelectorAll('.st-dots i')];
    if (dots.length)
      track.addEventListener('scroll', () => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        dots.forEach((d, k) => d.classList.toggle('on', k === i));
      }, { passive: true });
  });
  root.querySelectorAll('[data-zoom]').forEach((img) =>
    img.addEventListener('click', () => {
      const all = [...img.parentElement.querySelectorAll('img')].map((x) => x.dataset.zoom);
      let i = all.indexOf(img.dataset.zoom);
      const lb = document.createElement('div');
      lb.className = 'st-lightbox';
      const show = () => (lb.innerHTML = `<img src="${esc(all[i])}" alt=""><button class="st-lb-x" aria-label="إغلاق">✕</button>${all.length > 1 ? '<button class="st-lb-prev">›</button><button class="st-lb-next">‹</button>' : ''}<span class="st-lb-n">${i + 1} / ${all.length}</span>`);
      show();
      lb.addEventListener('click', (e) => {
        if (e.target.closest('.st-lb-next')) (i = (i + 1) % all.length), show();
        else if (e.target.closest('.st-lb-prev')) (i = (i - 1 + all.length) % all.length), show();
        else if (e.target.tagName !== 'IMG') lb.remove();
      });
      document.body.appendChild(lb);
    })
  );
}

async function viewStay(el) {
  let data;
  try {
    data = await api('GET', '/api/stay');
  } catch (err) {
    // الصفحة غير مفعّلة (أو غير موجّهة لهذا الحساب): صفحة فارغة لطيفة
    el.innerHTML = `<section class="st-hero"><div><small>🏨 الملتقى العائلي - ديسمبر 2026</small><h2>لا توجد حجوزات متاحة حاليًا</h2>
      <p>عندما تفتح الإدارة الحجز، ستجد هنا الغرف بالصور والأسعار وتحجز مباشرة.</p></div></section>
      <div class="card empty-state"><span>🛏️</span><p>لا توجد برامج إقامة إلى حدّ الآن.</p></div>`;
    return;
  }
  return state.user.role === 'admin' ? stayAdmin(el, data) : stayParent(el, data);
}

function stayKindTabs(rooms) {
  const n = (k) => rooms.filter((r) => !k || r.kind === k).length;
  return `<div class="st-tabs">${[['', 'الكل'], ['room', '🛏️ الغرف'], ['suite', '🏠 الأجنحة']]
    .map(([k, l]) => `<button data-kind="${k}" class="${stayState.kind === k ? 'on' : ''}">${l} <small>${n(k)}</small></button>`)
    .join('')}</div>`;
}

// ---------- الولي ----------
function stayParent(el, { settings, rooms, bookings = [] }, guest = false) {
  const live = bookings.filter((b) => b.status !== 'cancelled');
  const shown = rooms.filter((r) => !stayState.kind || r.kind === stayState.kind);
  const free = rooms.filter((r) => r.status === 'free').length;
  el.innerHTML = `
    <section class="st-hero">
      <div><small>🏨 الملتقى العائلي - ديسمبر 2026</small><h2>${esc(settings.title)}</h2>
        ${settings.info ? `<p>${esc(settings.info).replace(/\n/g, '<br>')}</p>` : ''}
        <span class="st-hero-n">${free} غرفة متاحة من ${rooms.length}</span></div>
    </section>
    ${live.length ? `<div class="card st-mine"><h3>حجوزاتي</h3>${live
      .map((b) => {
        const r = rooms.find((x) => x.id === b.room_id);
        const [label, cls] = STAY_STATUS[b.status];
        return `<div class="st-mine-row"><img src="${esc(r?.photos?.[0] || '')}" alt=""><div><b>${esc(r ? stayName(r) : '')}</b>
            <small>${b.adults} كبار${b.children ? ` · ${b.children} أطفال` : ''}${b.price != null ? ` · ${stayNum(b.price)} ${esc(settings.unit)}` : ''}</small>
            <span class="st-badge ${cls}">${label}</span></div>
            ${b.status === 'pending' ? `<button class="btn small ghost" data-cancel="${b.id}">إلغاء</button>` : ''}</div>`;
      })
      .join('')}</div>` : ''}
    <div class="st-legend">العائلة: الوالدان + الأطفال (دون 18 سنة) · 🛏️ lit simple ou double · 🛋️ canapé · السعر لليلة الواحدة</div>
    ${stayKindTabs(rooms)}
    <div class="st-grid">${shown
      .map(
        (r) => `<article class="st-card ${r.status}">
          ${stayPhotos(r)}
          <div class="st-body">
            <div class="st-head"><h3>${esc(stayName(r))}</h3>${stayPrice(r, settings.unit)}</div>
            <p class="st-label">${esc(r.label || '')} · ${esc(r.floor_label)}</p>
            ${stayCap(r)}
            <ul class="st-feat">${(r.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
            ${
              r.status === 'mine'
                ? '<div class="st-state mine">⭐ هذه غرفتك</div>'
                : r.status === 'taken'
                  ? '<div class="st-state taken">محجوزة</div>'
                  : r.price == null
                    ? '<div class="st-state taken">الحجز يُفتح بعد إعلان السعر</div>'
                    : `<button class="btn st-book" data-book="${r.id}">احجز هذه الغرفة</button>`
            }
          </div></article>`
      )
      .join('')}</div>`;
  stayWire(el, rooms);
  el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => ((stayState.kind = b.dataset.kind), stayParent(el, { settings, rooms, bookings }, guest))));
  el.querySelectorAll('[data-cancel]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('إلغاء هذا الحجز؟')) return;
      try {
        await api('PUT', `/api/stay/bookings/${b.dataset.cancel}`, { status: 'cancelled' });
        toast('أُلغي الحجز');
        viewStay(el);
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
  el.querySelectorAll('[data-book]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = rooms.find((x) => x.id === Number(b.dataset.book));
      const opts = (from, to, sel) => Array.from({ length: to - from + 1 }, (_, k) => from + k).map((n) => `<option ${n === sel ? 'selected' : ''}>${n}</option>`).join('');
      openModal(
        `حجز ${stayName(r)}`,
        `<p class="muted">${esc(r.label || '')} · ${esc(r.floor_label)} · ${stayPrice(r, settings.unit)}</p>
         <p class="small">طاقة الغرفة: 2 كبار${stayKids(r) ? ` + ${stayKids(r)} ${stayKids(r) > 1 ? 'أطفال' : 'طفل'}` : ''} · الأسرّة: ${r.adults} lit${r.adults > 1 ? 's' : ''} (simple ou double)${r.children ? ` + ${r.children} canapé${r.children > 1 ? 's' : ''}` : ''}.</p>
         ${guest ? '<label>الاسم واللقب<input name="name" required maxlength="120" autocomplete="name"></label><label>رقم الهاتف<input name="phone" required inputmode="tel" dir="ltr" maxlength="16" autocomplete="tel" placeholder="2X XXX XXX"></label>' : ''}
         <label>عدد الكبار<select name="adults">${opts(1, Math.min(2, r.adults), Math.min(2, r.adults))}</select></label>
         <label>عدد الأطفال (دون 18 سنة)<select name="children">${opts(0, r.adults + r.children - 1, Math.min(stayKids(r), 0))}</select></label>
         <label>ملاحظة (اختياري)<textarea name="note" rows="2" maxlength="500" placeholder="مثلًا: أعمار الأطفال، طلب خاص…"></textarea></label>
         <p class="muted small">الحجز يبقى «في انتظار التأكيد» حتى تؤكّده الإدارة.</p>`,
        async (f) => {
          const body = { room_id: r.id, adults: Number(f.adults), children: Number(f.children), note: f.note };
          if (guest) {
            await api('POST', '/api/public/stay/bookings', { ...body, name: f.name, phone: f.phone });
            alert('✅ تمّ تسجيل حجزك. ستتّصل بك إدارة فيد لتأكيده.');
            return viewPublicStay(el);
          }
          await api('POST', '/api/stay/bookings', body);
          toast('✅ تمّ إرسال الحجز، في انتظار تأكيد الإدارة');
          viewStay(el);
        }
      );
      $('#modal-form button[type=submit]').textContent = 'تأكيد الحجز';
    })
  );
}

// ---------- الإدارة ----------
function stayAdmin(el, data) {
  const { settings, rooms, bookings } = data;
  const isSuper = !!state.user.super_admin;
  const liveOf = (id) => bookings.find((b) => b.room_id === id && b.status !== 'cancelled');
  const live = bookings.filter((b) => b.status !== 'cancelled');
  const confirmed = live.filter((b) => b.status === 'confirmed');
  const shown = rooms.filter((r) => !stayState.kind || r.kind === stayState.kind);
  const persons = live.reduce((t, b) => t + b.adults + b.children, 0);
  const priced = rooms.filter((r) => r.price != null).length;
  el.innerHTML = `
    <section class="st-hero">
      <div><small>🏨 الملتقى العائلي - ديسمبر 2026 · دار أوغوز</small><h2>${esc(settings.title)}</h2>
        <span class="st-hero-n ${settings.enabled ? 'on' : ''}">${settings.enabled ? `🟢 الصفحة ظاهرة: ${esc(settings.audience.map((a) => ({ support: 'أولياء الدعم', program: 'أولياء التربوي', teachers: 'المدرّسون', public: 'الرابط العمومي' })[a]).join('، '))}` : '🔒 الصفحة مخفيّة: لا يراها أحد'}</span></div>
      ${isSuper ? `<button class="btn ${settings.enabled ? 'ghost' : ''}" id="st-toggle">${settings.enabled ? 'إخفاء الصفحة' : '🚀 تفعيل الصفحة'}</button>` : ''}
    </section>
    <div class="st-kpis">
      <div><b>${live.length}/${rooms.length}</b><span>غرفة محجوزة</span></div>
      <div><b>${live.filter((b) => b.status === 'pending').length}</b><span>في انتظار التأكيد</span></div>
      <div><b>${persons}</b><span>شخص</span></div>
      <div><b>${priced}/${rooms.length}</b><span>غرفة بسعر</span></div>
      <div><b>${stayNum(confirmed.reduce((t, b) => t + (b.price || 0), 0))}</b><span>${esc(settings.unit)} (المؤكَّد)</span></div>
    </div>
    ${isSuper ? `<div class="card st-aud"><h3>👥 من يرى الصفحة ويحجز؟</h3>
      <div class="st-aud-list">${Object.entries(data.audiences)
        .map(([k, l]) => `<label class="st-aud-item ${settings.audience.includes(k) ? 'on' : ''}"><input type="checkbox" value="${k}" ${settings.audience.includes(k) ? 'checked' : ''}><span>${{ support: '📚', program: '🎨', teachers: '👩‍🏫', public: '🌐' }[k]} ${esc(l)}</span></label>`)
        .join('')}</div>
      <div class="st-aud-actions"><button class="btn small ghost" id="st-all-feed">✨ كل فيد</button><button class="btn small" id="st-aud-save">حفظ الاختيار</button></div>
      ${settings.audience.includes('public') ? `<div class="st-link"><span>🔗 رابط الحجز لشخص من خارج فيد:</span><b dir="ltr">${esc(location.origin)}/rooms</b><button class="btn small ghost" id="st-copy">نسخ</button></div>
        ${settings.enabled ? '' : '<p class="muted small">الرابط يعمل بعد تفعيل الصفحة.</p>'}` : ''}
    </div>
    <details class="card st-settings"><summary>⚙️ نصّ الصفحة ووحدة السعر</summary>
      <div class="form-grid"><label>العنوان<input id="st-title" value="${esc(settings.title)}" maxlength="120"></label>
        <label>وحدة السعر<input id="st-unit" value="${esc(settings.unit)}" maxlength="40" placeholder="د.ت / الليلة"></label></div>
      <label>معلومات للأولياء (التواريخ، ما يشمله السعر، طريقة الخلاص…)<textarea id="st-info" rows="3" maxlength="1500">${esc(settings.info || '')}</textarea></label>
      <button class="btn" id="st-save">حفظ</button></details>` : ''}
    <div class="st-legend">العائلة: الوالدان + الأطفال (دون 18 سنة) · 🛏️ lit simple ou double للكبار · 🛋️ canapé للأطفال</div>
    ${stayKindTabs(rooms)}
    <div class="st-grid">${shown
      .map((r) => {
        const b = liveOf(r.id);
        return `<article class="st-card ${r.active ? '' : 'hidden-room'}">
          ${stayPhotos(r)}
          <div class="st-body">
            <div class="st-head"><h3>${esc(stayName(r))}</h3>${stayPrice(r, settings.unit)}</div>
            <p class="st-label">${esc(r.label || '')} · ${esc(r.floor_label)}</p>
            ${stayCap(r)}
            <ul class="st-feat">${(r.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
            <div class="st-admin">
              <div class="st-arow">
                <span class="st-albl">💰 السعر لليلة</span>
                <div class="st-pricebox">
                  <input type="number" min="0" step="10" inputmode="numeric" data-price="${r.id}" value="${r.price ?? ''}" data-orig="${r.price ?? ''}" placeholder="—" aria-label="السعر">
                  <span class="st-unit">د.ت</span>
                  <button type="button" class="st-save" data-save-price="${r.id}" disabled>حفظ</button>
                </div>
              </div>
              <div class="st-arow">
                <span class="st-albl">👁️ ظاهرة في الحجز</span>
                <label class="st-switch"><input type="checkbox" data-active="${r.id}" ${r.active ? 'checked' : ''}><i></i></label>
              </div>
              <div class="st-arow">
                <span class="st-albl">📌 الحالة</span>
                ${
                  b?.status === 'pending'
                    ? '<span class="st-pill warn">● في انتظار التأكيد</span>'
                    : `<div class="st-seg2" role="group" aria-label="حالة الغرفة"><button type="button" class="${b ? '' : 'on free'}" data-hold="0" data-room="${r.id}">🟢 متاحة</button><button type="button" class="${b ? 'on held' : ''}" data-hold="1" data-room="${r.id}">🔒 محجوزة</button></div>`
                }
              </div>
            </div>
            ${
              b
                ? `<div class="st-booking ${b.status}"><span class="st-badge ${STAY_STATUS[b.status][1]}">${STAY_STATUS[b.status][0]}</span>
                    <b>${esc(b.parent_name)}</b> <small class="st-who">${{ guest: '🌐 من خارج فيد', teacher: '👩‍🏫 مدرّس', parent: '👪 وليّ' }[b.booker] || ''}</small>${b.parent_phone ? ` · <a href="tel:${esc(b.parent_phone)}" dir="ltr">${esc(b.parent_phone)}</a>` : ''}
                    <small>${b.adults} كبار${b.children ? ` · ${b.children} أطفال` : ''}${b.kids ? ` · التلاميذ: ${esc(b.kids)}` : ''}</small>
                    ${b.note ? `<small>📝 ${esc(b.note)}</small>` : ''}
                    <div class="st-actions">${b.status === 'pending' ? `<button class="btn small" data-status="confirmed" data-b="${b.id}">تأكيد</button>` : ''}
                      <button class="btn small ghost" data-status="cancelled" data-b="${b.id}">إلغاء الحجز</button></div></div>`
                : ''
            }
          </div></article>`;
      })
      .join('')}</div>
    <div class="card"><h3>📋 توزيع الغرف</h3><div class="table-wrap"><table class="st-table">
      <thead><tr><th>الغرفة</th><th>النوع</th><th>الطابق</th><th>الطاقة</th><th>الوليّ</th><th>الأشخاص</th><th>الحالة</th><th>السعر</th></tr></thead>
      <tbody>${rooms
        .map((r) => {
          const b = liveOf(r.id);
          return `<tr><td><b>${esc(stayName(r))}</b></td><td>${r.kind === 'suite' ? 'Suite (غرفتان)' : 'غرفة'}</td><td>${esc(r.floor_label)}</td>
            <td>${r.adults} كبار${r.children ? ` + ${r.children}` : ''}</td><td>${b ? esc(b.parent_name) : '—'}</td>
            <td>${b ? `${b.adults}${b.children ? ` + ${b.children}` : ''}` : '—'}</td>
            <td>${b ? `<span class="st-badge ${STAY_STATUS[b.status][1]}">${STAY_STATUS[b.status][0]}</span>` : '<span class="muted">متاحة</span>'}</td>
            <td>${r.price == null ? '—' : `${stayNum(r.price)} ${esc(settings.unit)}`}</td></tr>`;
        })
        .join('')}</tbody></table></div></div>`;
  stayWire(el, rooms);
  const reload = () => viewStay(el);
  const act = async (fn, ok) => {
    try {
      await fn();
      if (ok) toast(ok);
      reload();
    } catch (err) {
      toast(err.message, true);
    }
  };
  el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => ((stayState.kind = b.dataset.kind), stayAdmin(el, data))));
  $('#st-toggle')?.addEventListener('click', () => {
    if (!settings.enabled && !confirm('تفعيل صفحة الحجز؟ يراها ويحجز منها من اخترتهم في «من يرى الصفحة».')) return;
    act(() => api('PUT', '/api/stay/settings', { enabled: !settings.enabled }), settings.enabled ? 'أُخفيت الصفحة' : '🚀 الصفحة مفعّلة');
  });
  const audBoxes = () => [...el.querySelectorAll('.st-aud-item input')];
  audBoxes().forEach((c) => c.addEventListener('change', () => c.closest('label').classList.toggle('on', c.checked)));
  $('#st-all-feed')?.addEventListener('click', () =>
    audBoxes().forEach((c) => {
      c.checked = c.value !== 'public' || c.checked;
      c.closest('label').classList.toggle('on', c.checked);
    })
  );
  $('#st-aud-save')?.addEventListener('click', () => act(() => api('PUT', '/api/stay/settings', { audience: audBoxes().filter((c) => c.checked).map((c) => c.value) }), 'حُفظ الاختيار'));
  $('#st-copy')?.addEventListener('click', () => navigator.clipboard?.writeText(`${location.origin}/rooms`).then(() => toast('نُسخ الرابط')));
  $('#st-save')?.addEventListener('click', () =>
    act(() => api('PUT', '/api/stay/settings', { title: $('#st-title').value, unit: $('#st-unit').value, info: $('#st-info').value }), 'حُفظ')
  );
  el.querySelectorAll('[data-save-price]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = el.querySelector(`[data-price="${b.dataset.savePrice}"]`).value;
      act(() => api('PUT', `/api/stay/rooms/${b.dataset.savePrice}`, { price: v === '' ? null : Number(v) }), 'حُفظ السعر');
    })
  );
  el.querySelectorAll('[data-price]').forEach((i) =>
    i.addEventListener('input', () => {
      const btn = el.querySelector(`[data-save-price="${i.dataset.price}"]`);
      btn.disabled = i.value === i.dataset.orig;
    })
  );
  el.querySelectorAll('[data-price]').forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && el.querySelector(`[data-save-price="${i.dataset.price}"]`).click()));
  // 🔒/🟢 الإدارة تجعل الغرفة محجوزة أو متاحة بضغطة
  el.querySelectorAll('[data-hold]').forEach((btn) =>
    btn.addEventListener('click', () => {
      if (btn.classList.contains('on')) return;
      const held = btn.dataset.hold === '1';
      const b = liveOf(Number(btn.dataset.room));
      if (!held && b && !confirm(`جعل الغرفة متاحة؟ يُلغى حجز «${b.parent_name}» وتصبح الغرفة قابلة للحجز.`)) return;
      act(() => api('PUT', `/api/stay/rooms/${btn.dataset.room}/hold`, { held }), held ? '🔒 الغرفة محجوزة' : '🟢 الغرفة متاحة');
    })
  );
  el.querySelectorAll('[data-active]').forEach((c) => c.addEventListener('change', () => act(() => api('PUT', `/api/stay/rooms/${c.dataset.active}`, { active: c.checked }))));
  el.querySelectorAll('[data-b]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.status === 'cancelled' && !confirm('إلغاء هذا الحجز؟ تصبح الغرفة متاحة لغيره.')) return;
      act(() => api('PUT', `/api/stay/bookings/${b.dataset.b}`, { status: b.dataset.status }), b.dataset.status === 'confirmed' ? '✅ أُكّد الحجز' : 'أُلغي الحجز');
    })
  );
}

// ---------- 🌐 الرابط العمومي education.feed.tn/rooms: شخص من خارج فيد يحجز دون حساب ----------
async function viewPublicStay(el) {
  let data;
  try {
    data = await api('GET', '/api/public/stay');
  } catch (err) {
    el.innerHTML = `<div class="st-public"><img class="st-logo" src="feed-logo.png" alt="فيد"><section class="st-hero"><div><small>🏨 الملتقى العائلي - ديسمبر 2026</small><h2>الحجز غير متاح حاليًا</h2><p>${esc(err.message)}</p></div></section></div>`;
    return;
  }
  el.innerHTML = '<div class="st-public"><img class="st-logo" src="feed-logo.png" alt="فيد"><div id="st-pub"></div></div>';
  stayParent($('#st-pub'), data, true);
}

// ---------- 👁️ جولة 360° (Pannellum، مكتبة مفتوحة المصدر، محمّلة عند الحاجة) ----------
let pannellumReady = null;
function loadPannellum() {
  pannellumReady ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/pannellum.css';
    document.head.appendChild(css);
    const sc = document.createElement('script');
    sc.src = 'vendor/pannellum.js';
    sc.onload = () => resolve(window.pannellum);
    sc.onerror = () => ((pannellumReady = null), reject(new Error('تعذّر تحميل الجولة 360°')));
    document.head.appendChild(sc);
  });
  return pannellumReady;
}
async function stayTour(r) {
  const box = document.createElement('div');
  box.className = 'st-tour';
  box.innerHTML = `<div class="st-tour-top"><b>👁️ ${esc(stayName(r))} · 360°</b><button class="st-tour-x" aria-label="إغلاق">✕</button></div>
    <div class="st-tour-view" id="st-tour-view"><div class="st-tour-load">⏳</div></div>
    ${r.tour.length > 1 ? `<div class="st-tour-scenes">${r.tour.map((x, k) => `<button data-scene="s${k}" class="${k ? '' : 'on'}">${esc(x.name)}</button>`).join('')}</div>` : ''}
    <p class="st-tour-hint">☝️ اسحب لتدور حول الغرفة · قرّب وبعّد بإصبعين</p>`;
  document.body.appendChild(box);
  document.body.classList.add('st-tour-open');
  let viewer = null;
  const close = () => {
    try {
      viewer?.destroy();
    } catch {}
    box.remove();
    document.body.classList.remove('st-tour-open');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  box.querySelector('.st-tour-x').addEventListener('click', close);
  try {
    const pannellum = await loadPannellum();
    if (!box.isConnected) return;
    box.querySelector('.st-tour-view').innerHTML = '';
    const scenes = Object.fromEntries(r.tour.map((x, k) => [`s${k}`, { title: x.name, type: 'equirectangular', panorama: x.src, hfov: 105 }]));
    viewer = pannellum.viewer('st-tour-view', {
      default: { firstScene: 's0', sceneFadeDuration: 600, autoLoad: true, autoRotate: -3, showFullscreenCtrl: true, compass: false },
      scenes,
    });
    viewer.on('scenechange', (id) => box.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('on', b.dataset.scene === id)));
    box.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => viewer.loadScene(b.dataset.scene)));
  } catch (err) {
    box.querySelector('.st-tour-view').innerHTML = `<p class="st-tour-load">${esc(err.message)}</p>`;
  }
}
