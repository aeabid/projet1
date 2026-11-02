'use strict';
// الدخول بحساب Google للأولياء: الحساب المعروف يدخل مباشرة،
// والجديد يختار أبناءه (أو يضيفهم) ويرسل طلبًا توافق عليه الإدارة.

let googleConfig = null;
async function setupGoogleLogin() {
  try {
    googleConfig ??= await api('GET', '/api/auth/config');
  } catch {
    return;
  }
  if (!googleConfig.google_client_id || !$('#google-box')) return;
  await new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.onload = resolve;
    sc.onerror = reject;
    document.head.appendChild(sc);
  }).catch(() => null);
  if (!window.google?.accounts || !$('#google-btn')) return;
  google.accounts.id.initialize({ client_id: googleConfig.google_client_id, callback: onGoogleCredential });
  google.accounts.id.renderButton($('#google-btn'), {
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    locale: 'ar',
    width: Math.min(320, $('#google-btn').clientWidth || 320),
  });
  $('#google-box').hidden = false;
}

async function onGoogleCredential({ credential }) {
  try {
    const r = await api('POST', '/api/auth/google', { credential });
    if (r.user) {
      state.user = r.user;
      state.meta = await api('GET', '/api/meta');
      location.hash = homeFor(r.user);
      return;
    }
    sessionStorage.setItem('googleLink', JSON.stringify(r));
    location.hash = '#/google-link';
  } catch (err) {
    const p = $('#login-error');
    if (p) {
      p.textContent = err.message;
      p.hidden = false;
    } else toast(err.message, true);
  }
}

async function viewGoogleLink(el) {
  let g;
  try {
    g = JSON.parse(sessionStorage.getItem('googleLink'));
  } catch {}
  if (!g?.ticket) {
    location.hash = '#/login';
    return;
  }
  if (g.status === 'pending') {
    el.innerHTML = `<div class="login"><div class="card center">
      <h2>⏳ طلبك عند الإدارة</h2>
      <p>مرحبًا ${esc(g.name)}، وصلنا طلب ربط أبنائك بحساب Google <b dir="ltr">${esc(g.email)}</b>.</p>
      <p class="muted">بعد موافقة إدارة فيد، ادخل من جديد بزر Google وتلقى أبناءك.</p>
      <a class="btn" href="#/login">رجوع</a></div></div>`;
    return;
  }
  const { levels } = await api('GET', '/api/public/meta');
  const picked = []; // {type,id,full_name,label} أو {type:'new',full_name,level}
  el.innerHTML = `
    <div class="login"><div class="card">
      <h2>مرحبًا ${esc(g.name)} 👋</h2>
      <p class="muted">حساب Google: <b dir="ltr">${esc(g.email)}</b>. أكمل المعطيات واختر أبناءك، ثم ترسل الطلب لإدارة فيد للموافقة.</p>
      <form id="gl-form">
        <label>اسم الولي ولقبه<input name="full_name" value="${esc(g.name || '')}" required></label>
        <label>رقم الهاتف<input name="phone" inputmode="tel" value="${esc(g.phone || '')}" required placeholder="مثال: 98123456"></label>
        <fieldset><legend>أبنائي</legend>
          <div id="gl-picked" class="gl-picked"></div>
          <label>ابحث عن ابنك بالاسم (3 حروف على الأقل)<input id="gl-q" autocomplete="off" placeholder="الاسم أو اللقب"></label>
          <div id="gl-results" class="gl-results"></div>
          <details class="gl-new"><summary>ابني غير موجود في القائمة: إضافته</summary>
            <div class="row">
              <label>اسم الابن ولقبه<input id="gl-new-name"></label>
              <label>المستوى<select id="gl-new-level">${levels.map((l) => `<option value="${esc(l.code)}">${esc(l.label)}</option>`).join('')}</select></label>
            </div>
            <button type="button" class="btn ghost small" id="gl-new-add">+ إضافة</button>
          </details>
        </fieldset>
        <label>ملاحظة للإدارة (اختياري)<input name="note"></label>
        <p class="error" id="gl-error" hidden></p>
        <button class="btn block">إرسال الطلب</button>
        <p class="muted small center"><a href="#/login">رجوع</a></p>
      </form>
    </div></div>`;
  const renderPicked = () => {
    $('#gl-picked').innerHTML = picked.length
      ? picked
          .map(
            (c, i) => `<span class="chip">${esc(c.full_name)} <span class="muted small">${esc(c.label || (c.type === 'new' ? 'جديد · ' + levels.find((l) => l.code === c.level)?.label : ''))}</span>
              <button type="button" class="link danger" data-rm="${i}">✕</button></span>`
          )
          .join('')
      : '<p class="muted small">لم تختر أي ابن بعد.</p>';
    $('#gl-picked').querySelectorAll('[data-rm]').forEach((b) =>
      b.addEventListener('click', () => {
        picked.splice(Number(b.dataset.rm), 1);
        renderPicked();
      })
    );
  };
  renderPicked();
  let timer;
  $('#gl-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = e.target.value.trim();
      if (q.length < 3) return ($('#gl-results').innerHTML = '');
      const { children } = await api('GET', `/api/auth/google/children?ticket=${g.ticket}&q=${encodeURIComponent(q)}`).catch((err) => {
        toast(err.message, true);
        return { children: [] };
      });
      const label = (c) => (c.type === 'student' ? levels.find((l) => l.code === c.level)?.label || c.level : `البرنامج التربوي${c.class_name ? ' · ' + c.class_name : ''}`);
      $('#gl-results').innerHTML = children.length
        ? children
            .map((c, i) => `<button type="button" class="gl-result" data-i="${i}"><b>${esc(c.full_name)}</b> <span class="muted small">${esc(label(c))}</span> <span class="add">+ اختيار</span></button>`)
            .join('')
        : '<p class="muted small">لا نتيجة. جرّب اللقب، أو أضف ابنك كجديد.</p>';
      $('#gl-results').querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => {
          const c = children[Number(b.dataset.i)];
          if (!picked.some((x) => x.type === c.type && x.id === c.id)) picked.push({ type: c.type, id: c.id, full_name: c.full_name, label: label(c) });
          $('#gl-q').value = '';
          $('#gl-results').innerHTML = '';
          renderPicked();
        })
      );
    }, 300);
  });
  $('#gl-new-add').addEventListener('click', () => {
    const name = $('#gl-new-name').value.trim();
    if (!name) return toast('اكتب اسم الابن', true);
    picked.push({ type: 'new', full_name: name, level: $('#gl-new-level').value });
    $('#gl-new-name').value = '';
    renderPicked();
  });
  $('#gl-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    try {
      await api('POST', '/api/auth/google/request', {
        ticket: g.ticket,
        full_name: data.full_name,
        phone: data.phone,
        note: data.note,
        children: picked.map(({ type, id, full_name, level }) => ({ type, id, full_name, level })),
      });
      sessionStorage.setItem('googleLink', JSON.stringify({ ...g, name: data.full_name, status: 'pending' }));
      viewGoogleLink(el);
    } catch (err) {
      $('#gl-error').textContent = err.message;
      $('#gl-error').hidden = false;
    }
  });
}

// ---------- الإدارة: طلبات أولياء Google ----------
async function viewParentRequests(el) {
  const { requests, parents } = await api('GET', '/api/parent-requests');
  const kidLine = (c) =>
    c.type === 'new'
      ? `<span class="chip">${esc(c.full_name)} <span class="badge average">جديد · ${esc(levelLabel(c.level))}</span></span>`
      : `<a class="chip" href="${c.type === 'student' ? `#/students/${c.id}` : `#/program/child/${c.id}`}">${esc(c.full_name)}${c.type === 'child' ? ' 🎨' : ''}</a>`;
  el.innerHTML = `
    <div class="page-head"><div><h2>طلبات أولياء Google</h2>
      <p class="muted">ولي دخل بحساب Google واختار أبناءه. عند الموافقة: يُربط بحسابه الموجود (إن وُجد) أو يُنشأ له حساب، والأبناء الجدد يدخلون قائمة الانتظار.</p></div></div>
    ${
      requests.length
        ? requests
            .map(
              (r) => `<section class="card ${r.status === 'rejected' ? 'muted' : ''}" data-id="${r.id}">
          <div class="section-head"><h3>${esc(r.full_name || r.google_name)}</h3>
            ${r.status === 'rejected' ? '<span class="badge weak">مرفوض</span>' : `<span class="muted small">${r.submitted_at ? fmtDate(r.submitted_at.slice(0, 10)) : ''}</span>`}</div>
          <p class="muted small"><span dir="ltr">${esc(r.google_email)}</span> · <span dir="ltr">${esc(r.phone || '')}</span></p>
          <div class="gl-picked">${r.children.map(kidLine).join('')}</div>
          ${r.note ? `<p class="remarks">📝 ${esc(r.note)}</p>` : ''}
          ${
            r.status === 'pending'
              ? `<label>ربطه بحساب ولي موجود<select class="pr-parent">
                  <option value="">— إنشاء حساب ولي جديد —</option>
                  ${parents
                    .map((p) => `<option value="${p.id}" ${p.id === r.suggested_parent_id ? 'selected' : ''}>${esc(p.full_name)} (${esc(p.phone || p.username)})</option>`)
                    .join('')}
                </select></label>
                ${r.suggested_parent_id ? '<p class="muted small">✔ اقتراح تلقائي حسب الهاتف أو الابن المختار.</p>' : ''}
                <p><button class="btn small pr-ok">✔ موافقة</button> <button class="btn small danger pr-no">رفض</button></p>`
              : ''
          }
        </section>`
            )
            .join('')
        : '<div class="card muted">لا توجد طلبات.</div>'
    }`;
  el.querySelectorAll('section[data-id]').forEach((sec) => {
    const id = sec.dataset.id;
    sec.querySelector('.pr-ok')?.addEventListener('click', async () => {
      try {
        await api('POST', `/api/parent-requests/${id}/approve`, { parent_id: sec.querySelector('.pr-parent').value || null });
        toast('تمت الموافقة، يمكن للولي الدخول بـ Google');
        viewParentRequests(el);
      } catch (err) {
        toast(err.message, true);
      }
    });
    sec.querySelector('.pr-no')?.addEventListener('click', async () => {
      if (!confirmAction('رفض الطلب؟')) return;
      await api('POST', `/api/parent-requests/${id}/reject`).catch((err) => toast(err.message, true));
      viewParentRequests(el);
    });
  });
}
