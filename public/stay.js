// ---------- 🏨 حجز الغرف في دار أوغوز ----------
// الإدارة: تفعيل الصفحة، سعر كل غرفة، تأكيد/إلغاء الحجوزات وجدول توزيع الغرف.
// الولي (بعد التفعيل): يتصفّح الغرف بالصور ويحجز غرفة متاحة.

const STAY_STATUS = { pending: ['⏳ في انتظار التأكيد', 'warn'], confirmed: ['✅ مؤكَّد', 'ok'], cancelled: ['✘ ملغى', 'off'] };
const stayState = { kind: '' };
const stayNum = (n) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

const stayCap = (r) =>
  `<span class="st-cap" title="الطاقة">👤 ${r.adults} ${r.adults > 2 ? 'كبار' : 'كبيران'}${r.children ? ` · 🧒 ${r.children} ${r.children > 1 ? 'أطفال' : 'طفل'}` : ''}</span>`;
const stayPrice = (r, unit) =>
  r.price == null ? '<span class="st-price none">السعر يُعلن قريبًا</span>' : `<span class="st-price"><b>${stayNum(r.price)}</b> ${esc(unit)}</span>`;

function stayPhotos(r) {
  const photos = r.photos || [];
  return `<div class="st-photos">
      <div class="st-track" dir="ltr">${photos.map((p, i) => `<img src="${esc(p)}" alt="${esc(r.name)} ${i + 1}" loading="lazy" data-zoom="${esc(p)}">`).join('')}</div>
      ${photos.length > 1 ? `<span class="st-count">📷 ${photos.length}</span><div class="st-dots" dir="ltr">${photos.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
      <span class="st-kind ${r.kind}">${r.kind === 'suite' ? `🏠 جناح · ${r.bedrooms} غرف` : '🛏️ غرفة'}</span>
    </div>`;
}

// تمرير الصور + نقاط المؤشّر + تكبير الصورة
function stayWire(root) {
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
  const data = await api('GET', '/api/stay');
  return state.user.role === 'parent' ? stayParent(el, data) : stayAdmin(el, data);
}

function stayKindTabs(rooms) {
  const n = (k) => rooms.filter((r) => !k || r.kind === k).length;
  return `<div class="st-tabs">${[['', 'الكل'], ['room', '🛏️ الغرف'], ['suite', '🏠 الأجنحة']]
    .map(([k, l]) => `<button data-kind="${k}" class="${stayState.kind === k ? 'on' : ''}">${l} <small>${n(k)}</small></button>`)
    .join('')}</div>`;
}

// ---------- الولي ----------
function stayParent(el, { settings, rooms, bookings }) {
  const live = bookings.filter((b) => b.status !== 'cancelled');
  const shown = rooms.filter((r) => !stayState.kind || r.kind === stayState.kind);
  const free = rooms.filter((r) => r.status === 'free').length;
  el.innerHTML = `
    <section class="st-hero">
      <div><small>🏨 حجز الغرف</small><h2>${esc(settings.title)}</h2>
        ${settings.info ? `<p>${esc(settings.info).replace(/\n/g, '<br>')}</p>` : ''}
        <span class="st-hero-n">${free} غرفة متاحة من ${rooms.length}</span></div>
    </section>
    ${live.length ? `<div class="card st-mine"><h3>حجوزاتي</h3>${live
      .map((b) => {
        const r = rooms.find((x) => x.id === b.room_id);
        const [label, cls] = STAY_STATUS[b.status];
        return `<div class="st-mine-row"><img src="${esc(r?.photos?.[0] || '')}" alt=""><div><b>${esc(r?.name || '')}</b>
            <small>${b.adults} كبار${b.children ? ` · ${b.children} أطفال` : ''}${b.price != null ? ` · ${stayNum(b.price)} ${esc(settings.unit)}` : ''}</small>
            <span class="st-badge ${cls}">${label}</span></div>
            ${b.status === 'pending' ? `<button class="btn small ghost" data-cancel="${b.id}">إلغاء</button>` : ''}</div>`;
      })
      .join('')}</div>` : ''}
    <div class="st-legend">👤 الكبير: سرير فردي أو مزدوج · 🧒 الطفل: سرير أريكة (canapé)</div>
    ${stayKindTabs(rooms)}
    <div class="st-grid">${shown
      .map(
        (r) => `<article class="st-card ${r.status}">
          ${stayPhotos(r)}
          <div class="st-body">
            <div class="st-head"><h3>${esc(r.name)}</h3>${stayPrice(r, settings.unit)}</div>
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
  stayWire(el);
  el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => ((stayState.kind = b.dataset.kind), stayParent(el, { settings, rooms, bookings }))));
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
        `حجز ${r.name}`,
        `<p class="muted">${esc(r.label || '')} · ${esc(r.floor_label)} · ${stayPrice(r, settings.unit)}</p>
         <p class="small">طاقة الغرفة: ${r.adults} كبار${r.children ? ` و${r.children} ${r.children > 1 ? 'أطفال' : 'طفل'}` : ''}.</p>
         <label>عدد الكبار<select name="adults">${opts(1, r.adults, Math.min(2, r.adults))}</select></label>
         <label>عدد الأطفال<select name="children">${opts(0, r.adults + r.children - 1, 0)}</select></label>
         <label>ملاحظة (اختياري)<textarea name="note" rows="2" maxlength="500" placeholder="مثلًا: أعمار الأطفال، طلب خاص…"></textarea></label>
         <p class="muted small">الحجز يبقى «في انتظار التأكيد» حتى تؤكّده الإدارة.</p>`,
        async (f) => {
          await api('POST', '/api/stay/bookings', { room_id: r.id, adults: Number(f.adults), children: Number(f.children), note: f.note });
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
      <div><small>🏨 حجز الغرف · دار أوغوز</small><h2>${esc(settings.title)}</h2>
        <span class="st-hero-n ${settings.enabled ? 'on' : ''}">${settings.enabled ? '🟢 الصفحة ظاهرة للأولياء' : '🔒 الصفحة مخفيّة: لا يراها أي وليّ'}</span></div>
      ${isSuper ? `<button class="btn ${settings.enabled ? 'ghost' : ''}" id="st-toggle">${settings.enabled ? 'إخفاء الصفحة' : '🚀 تفعيل الصفحة للأولياء'}</button>` : ''}
    </section>
    <div class="st-kpis">
      <div><b>${live.length}/${rooms.length}</b><span>غرفة محجوزة</span></div>
      <div><b>${live.filter((b) => b.status === 'pending').length}</b><span>في انتظار التأكيد</span></div>
      <div><b>${persons}</b><span>شخص</span></div>
      <div><b>${priced}/${rooms.length}</b><span>غرفة بسعر</span></div>
      <div><b>${stayNum(confirmed.reduce((t, b) => t + (b.price || 0), 0))}</b><span>${esc(settings.unit)} (المؤكَّد)</span></div>
    </div>
    ${isSuper ? `<details class="card st-settings"><summary>⚙️ نصّ الصفحة ووحدة السعر</summary>
      <div class="form-grid"><label>العنوان<input id="st-title" value="${esc(settings.title)}" maxlength="120"></label>
        <label>وحدة السعر<input id="st-unit" value="${esc(settings.unit)}" maxlength="40" placeholder="د.ت / الليلة"></label></div>
      <label>معلومات للأولياء (التواريخ، ما يشمله السعر، طريقة الخلاص…)<textarea id="st-info" rows="3" maxlength="1500">${esc(settings.info || '')}</textarea></label>
      <button class="btn" id="st-save">حفظ</button></details>` : ''}
    <div class="st-legend">من ملف «Répartition des chambres»: 👤 الكبير: سرير فردي أو مزدوج · 🧒 الطفل: سرير أريكة (canapé)</div>
    ${stayKindTabs(rooms)}
    <div class="st-grid">${shown
      .map((r) => {
        const b = liveOf(r.id);
        return `<article class="st-card ${r.active ? '' : 'hidden-room'}">
          ${stayPhotos(r)}
          <div class="st-body">
            <div class="st-head"><h3>${esc(r.name)}</h3><a class="small" href="${esc(r.source_url || '#')}" target="_blank" rel="noopener">الموقع ↗</a></div>
            <p class="st-label">${esc(r.label || '')} · ${esc(r.floor_label)}</p>
            ${stayCap(r)}
            <ul class="st-feat">${(r.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
            <div class="st-price-edit">
              <label>السعر (${esc(settings.unit)})<input type="number" min="0" step="0.5" inputmode="decimal" data-price="${r.id}" value="${r.price ?? ''}" placeholder="أدخل السعر"></label>
              <button class="btn small" data-save-price="${r.id}">حفظ</button>
            </div>
            ${r.site_price ? `<p class="muted small">سعر موقع دار أوغوز: ${stayNum(r.site_price)} د.ت / الليلة</p>` : ''}
            <label class="st-active"><input type="checkbox" data-active="${r.id}" ${r.active ? 'checked' : ''}> ظاهرة في الحجز</label>
            ${
              b
                ? `<div class="st-booking ${b.status}"><span class="st-badge ${STAY_STATUS[b.status][1]}">${STAY_STATUS[b.status][0]}</span>
                    <b>${esc(b.parent_name)}</b>${b.parent_phone ? ` · <a href="tel:${esc(b.parent_phone)}" dir="ltr">${esc(b.parent_phone)}</a>` : ''}
                    <small>${b.adults} كبار${b.children ? ` · ${b.children} أطفال` : ''}${b.kids ? ` · التلاميذ: ${esc(b.kids)}` : ''}</small>
                    ${b.note ? `<small>📝 ${esc(b.note)}</small>` : ''}
                    <div class="st-actions">${b.status === 'pending' ? `<button class="btn small" data-status="confirmed" data-b="${b.id}">تأكيد</button>` : ''}
                      <button class="btn small ghost" data-status="cancelled" data-b="${b.id}">إلغاء الحجز</button></div></div>`
                : '<div class="st-state free">متاحة</div>'
            }
          </div></article>`;
      })
      .join('')}</div>
    <div class="card"><h3>📋 توزيع الغرف</h3><div class="table-wrap"><table class="st-table">
      <thead><tr><th>الغرفة</th><th>النوع</th><th>الطابق</th><th>الطاقة</th><th>الوليّ</th><th>الأشخاص</th><th>الحالة</th><th>السعر</th></tr></thead>
      <tbody>${rooms
        .map((r) => {
          const b = liveOf(r.id);
          return `<tr><td><b>${esc(r.name)}</b></td><td>${r.kind === 'suite' ? 'جناح (غرفتان)' : 'غرفة'}</td><td>${esc(r.floor_label)}</td>
            <td>${r.adults} كبار${r.children ? ` + ${r.children}` : ''}</td><td>${b ? esc(b.parent_name) : '—'}</td>
            <td>${b ? `${b.adults}${b.children ? ` + ${b.children}` : ''}` : '—'}</td>
            <td>${b ? `<span class="st-badge ${STAY_STATUS[b.status][1]}">${STAY_STATUS[b.status][0]}</span>` : '<span class="muted">متاحة</span>'}</td>
            <td>${r.price == null ? '—' : `${stayNum(r.price)} ${esc(settings.unit)}`}</td></tr>`;
        })
        .join('')}</tbody></table></div></div>`;
  stayWire(el);
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
    if (!settings.enabled && !confirm('تفعيل صفحة الحجز؟ سيراها كل الأولياء ويمكنهم الحجز.')) return;
    act(() => api('PUT', '/api/stay/settings', { enabled: !settings.enabled }), settings.enabled ? 'أُخفيت الصفحة' : '🚀 الصفحة مفعّلة للأولياء');
  });
  $('#st-save')?.addEventListener('click', () =>
    act(() => api('PUT', '/api/stay/settings', { title: $('#st-title').value, unit: $('#st-unit').value, info: $('#st-info').value }), 'حُفظ')
  );
  el.querySelectorAll('[data-save-price]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = el.querySelector(`[data-price="${b.dataset.savePrice}"]`).value;
      act(() => api('PUT', `/api/stay/rooms/${b.dataset.savePrice}`, { price: v === '' ? null : Number(v) }), 'حُفظ السعر');
    })
  );
  el.querySelectorAll('[data-price]').forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && el.querySelector(`[data-save-price="${i.dataset.price}"]`).click()));
  el.querySelectorAll('[data-active]').forEach((c) => c.addEventListener('change', () => act(() => api('PUT', `/api/stay/rooms/${c.dataset.active}`, { active: c.checked }))));
  el.querySelectorAll('[data-b]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.status === 'cancelled' && !confirm('إلغاء هذا الحجز؟ تصبح الغرفة متاحة لغيره.')) return;
      act(() => api('PUT', `/api/stay/bookings/${b.dataset.b}`, { status: b.dataset.status }), b.dataset.status === 'confirmed' ? '✅ أُكّد الحجز' : 'أُلغي الحجز');
    })
  );
}
