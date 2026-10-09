/* AYNM portal: administrator screens. Uses helpers exported by app.js. */
(function () {
  'use strict';
  const { html, raw, esc, $, $$, S, api, toast, fmtDate, fmtDateTime, icon, register, setFieldError, logoEl, brandText } = window.AYNM;

  const aapi = (p, o = {}) => api(p, { ...o, admin: true });
  const errMsg = (e) => (e && e.data && e.data.error) || 'Something went wrong.';
  async function ensureAdmin() {
    if (S.admin) return true;
    try { const r = await api('/api/admin/session'); if (!r.admin) return false; S.admin = r.admin; S.csrf = r.csrf; return true; } catch { return false; }
  }
  const isSuper = () => S.admin && S.admin.role === 'super_admin';
  const can = (p) => !!S.admin && (isSuper() || (S.admin.permissions || []).includes(p));
  const TABS = [['/admin/dashboard', 'Dashboard', 'members_view'], ['/admin/members', 'Members', 'members_view'], ['/admin/locations', 'Locations', 'locations_manage'], ['/admin/settings', 'Settings', 'settings_manage'], ['/admin/audit', 'Audit Log', 'audit_view'], ['/admin/admins', 'Admins', 'super'], ['/admin/account', 'My Account', '']];
  const tabAllowed = (perm) => !perm || (perm === 'super' ? isSuper() : can(perm));

  function adminLayout(inner, current) {
    const c = S.config;
    return html`<div class="admin"><header class="admin-top"><div class="wrap"><div class="bar">
      <a class="brand" href="#/admin/dashboard">${logoEl()}${brandText()}</a>
      <div class="btn-row"><span class="who">${S.admin.email} (${isSuper() ? 'Super admin' : 'Admin'})</span><a class="btn ghost-light sm" href="#/">View site</a><button class="btn ghost-light sm" type="button" data-admin="logout">Sign out</button></div></div></div>
      <nav class="admin-tabs" aria-label="Admin">${TABS.filter((t) => tabAllowed(t[2])).map(([p, l]) => html`<a href="#${p}" ${current === p ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav></header>
      <main id="main" class="admin-main" tabindex="-1">${inner}</main>
      <dialog id="dlg" aria-labelledby="dlg-title"></dialog></div>`;
  }
  // perm: a permission name, 'super', or '' (any signed-in administrator)
  const homeFor = () => (can('members_view') ? '#/admin/dashboard' : '#/admin/account');
  const guard = (fn, perm = '') => async (ctx) => {
    if (!(await ensureAdmin())) { location.hash = '#/admin'; return html``; }
    if (!tabAllowed(perm)) return adminLayout(html`<h1>Not allowed</h1><div class="notice warn">You do not have permission to open this page. Ask a Super Admin to grant you access.</div>`, '');
    return fn(ctx);
  };

  /* ---------------- auth screens ---------------- */
  const authShell = (inner) => html`<div class="auth-wrap"><div class="auth-card"><a class="brand" href="#/">${logoEl()}${brandText()}</a>${inner}<p class="small center"><a href="#/">← Back to website</a></p></div></div>`;
  const pwField = (name, label, extra = '') => html`<div class="field" id="fld-${name}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="password" autocomplete="${extra || 'current-password'}" maxlength="200" aria-describedby="err-${name}"><span class="err" id="err-${name}" role="alert"></span></div>`;
  const formMsg = (el, msg, kind = 'danger') => { el.className = `notice ${kind}`; el.textContent = msg; el.hidden = false; };

  register('/admin', {
    title: 'Admin Login',
    async render() {
      if (await ensureAdmin()) { location.hash = homeFor(); return html``; }
      return authShell(html`<h1>Administrator sign in</h1>
        <div id="auth-msg" class="notice" role="alert" hidden></div>
        <form id="login-form" novalidate>
          <div class="field" id="fld-email"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" aria-describedby="err-email"><span class="err" id="err-email" role="alert"></span></div>
          ${pwField('password', 'Password')}
          <button class="btn block" type="submit">SIGN IN</button>
        </form>
        <p class="center"><a href="#/admin/forgot">Forgot password?</a></p>`);
    },
    after() {
      const f = $('#login-form'); const msg = $('#auth-msg');
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); msg.hidden = true; setFieldError('email', ''); setFieldError('password', '');
        if (!f.email.value.trim()) return setFieldError('email', 'Please enter your email.');
        if (!f.password.value) return setFieldError('password', 'Please enter your password.');
        const b = $('button', f); b.disabled = true;
        try { const r = await api('/api/admin/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } }); S.admin = r.admin; S.csrf = r.csrf; location.hash = homeFor(); }
        catch (err) { formMsg(msg, errMsg(err)); f.password.value = ''; } finally { b.disabled = false; }
      });
    },
  });
  register('/admin/forgot', {
    title: 'Forgot password',
    render() { return authShell(html`<h1>Reset your password</h1><p class="muted">Enter your administrator email. If an account exists, reset instructions will be sent.</p><div id="auth-msg" class="notice" role="alert" hidden></div>
      <form id="forgot-form" novalidate><div class="field" id="fld-email"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" aria-describedby="err-email"><span class="err" id="err-email" role="alert"></span></div>
      <button class="btn" type="submit">SEND RESET LINK</button></form><p class="center"><a href="#/admin">Back to sign in</a></p>`); },
    after() {
      const f = $('#forgot-form'); const msg = $('#auth-msg');
      f.addEventListener('submit', async (e) => { e.preventDefault(); setFieldError('email', '');
        if (!f.email.value.trim()) return setFieldError('email', 'Please enter your email.');
        try { const r = await api('/api/admin/forgot', { method: 'POST', body: { email: f.email.value } }); formMsg(msg, r.message, 'warn'); } catch (err) { formMsg(msg, errMsg(err)); } });
    },
  });
  register('/admin/reset', {
    title: 'Choose a new password',
    render({ query }) { return authShell(html`<h1>Choose a new password</h1><div id="auth-msg" class="notice" role="alert" hidden></div>
      <form id="reset-form" novalidate>${pwField('password', 'New password (at least 12 characters, letters and numbers)', 'new-password')}${pwField('password2', 'Confirm new password', 'new-password')}<button class="btn" type="submit">SAVE PASSWORD</button></form>`); },
    after({ query }) {
      const f = $('#reset-form'); const msg = $('#auth-msg');
      f.addEventListener('submit', async (e) => { e.preventDefault(); setFieldError('password2', '');
        if (f.password.value !== f.password2.value) return setFieldError('password2', 'The two passwords do not match.');
        try { await api('/api/admin/reset', { method: 'POST', body: { token: query.token || '', password: f.password.value } }); toast('Password updated. Please sign in.'); location.hash = '#/admin'; } catch (err) { formMsg(msg, errMsg(err)); } });
    },
  });

  /* ---------------- dashboard ---------------- */
  const barList = (items) => items.length ? html`<div class="bars">${(() => { const max = Math.max(...items.map((i) => i.value), 1); return items.map((i) => html`<div class="bar-row"><span class="l" title="${i.label}">${i.label}</span><span class="v">${i.value}</span><svg viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${i.label}: ${i.value}"><rect class="track" width="100" height="10" rx="5"/><rect class="fill" width="${Math.max(2, (i.value / max) * 100)}" height="10" rx="5"/></svg></div>`); })()}</div>` : html`<p class="empty">No data yet.</p>`;
  function lineChart(series) {
    const W = 600, H = 220, L = 34, B = 26, T = 12, R = 10; const max = Math.max(...series.map((s) => s.count), 1); const n = series.length;
    const x = (i) => L + (i * (W - L - R)) / (n - 1); const y = (v) => T + (H - T - B) * (1 - v / max);
    const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.count).toFixed(1)}`).join(' ');
    const labels = series.map((s, i) => (i % 7 === 0 && i <= n - 4 || i === n - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(new Date(s.date + 'T00:00:00Z').toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' }))}</text>` : '')).join('');
    const grid = [0, 0.5, 1].map((f) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">${Math.round(max * f)}</text>`).join('');
    const total = series.reduce((a, s) => a + s.count, 0);
    return html`<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Registrations per day over the last 30 days. ${total} in total.">${raw(grid)}<polygon class="area" points="${L},${H - B} ${pts} ${W - R},${H - B}"/><polyline class="ln" points="${pts}"/>${raw(labels)}</svg>`;
  }
  register('/admin/dashboard', {
    title: 'Dashboard',
    render: guard(async () => {
      const s = await aapi('/api/admin/stats'); const t = s.totals;
      const stat = (cls, label, v) => html`<div class="stat ${cls}"><b>${v}</b><span>${label}</span></div>`;
      return adminLayout(html`<h1>Dashboard overview</h1>
        ${t.demo ? html`<div class="notice warn"><b>DEMO DATA present</b>${t.demo} demo record(s) are included in these figures. ${can('settings_manage') ? html`<button class="btn sm secondary" type="button" data-admin="delete-demo">Delete all demo data</button>` : ''}</div>` : ''}
        <div class="stats">${stat('', 'Total Registrations', t.total)}${stat('pending', 'Pending', t.pending)}${stat('approved', 'Approved', t.approved)}${stat('rejected', 'Rejected', t.rejected)}${stat('', 'Registrations Today', t.today)}${stat('', 'Registrations This Week', t.week)}${stat('', 'Registrations This Month', t.month)}</div>
        <div class="charts">
          <section class="card wide"><h2>Recent registrations</h2>${s.recent.length ? html`<ul class="recent-list">${s.recent.map((m) => html`<li><div><b>${m.full_name}</b><small>${m.registration_id} · ${m.lga}, ${m.state} · ${fmtDateTime(m.created_at)}</small></div><span class="badge ${m.status}">${m.status}</span></li>`)}</ul><p><a href="#/admin/members">View all members</a></p>` : html`<p class="empty">No registrations yet.</p>`}</section>
          <section class="card wide"><h2>Registrations over time</h2><p class="muted small">Last 30 days (Nigeria time)</p>${lineChart(s.over_time)}</section>
          <section class="card"><h2>Registrations by State</h2>${barList(s.by_state)}</section>
          <section class="card"><h2>Registrations by LGA</h2>${barList(s.by_lga)}</section>
          <section class="card wide"><h2>Registrations by Ward</h2>${barList(s.by_ward)}</section>
        </div>`, '/admin/dashboard');
    }, 'members_view'),
  });

  /* ---------------- members ---------------- */
  const MQ = { q: '', state: '', lga: '', ward: '', polling_unit: '', status: '', demo: '', page: 1 };
  const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
  let dlgTimer;

  register('/admin/members', {
    title: 'Members',
    render: guard(async () => {
      const states = (await api('/api/locations/states')).states;
      const opt = (arr, cur) => arr.map((o) => html`<option value="${o}" ${cur === o ? raw('selected') : ''}>${o}</option>`);
      return adminLayout(html`<h1>Members</h1>
        <form class="filters" id="m-filters" novalidate role="search">
          <div class="field"><label for="m-q">Search</label><input id="m-q" name="q" type="search" value="${MQ.q}" placeholder="Name, ID, phone or email" autocomplete="off"></div>
          <details id="m-more" class="more"><summary class="btn secondary sm">Filters${(MQ.status || MQ.state || MQ.lga || MQ.ward || MQ.polling_unit) ? ' (active)' : ''}</summary>
          <div class="filters-grid">
          <div class="field"><label for="m-status">Status</label><select id="m-status" name="status"><option value="">All</option>${opt(['Pending', 'Approved', 'Rejected'], MQ.status)}</select></div>
          <div class="field"><label for="m-state">State</label><select id="m-state" name="state"><option value="">All</option>${opt(states, MQ.state)}</select></div>
          <div class="field"><label for="m-lga">LGA</label><input id="m-lga" name="lga" type="text" list="m-lga-list" value="${MQ.lga}" autocomplete="off"><datalist id="m-lga-list"></datalist></div>
          <div class="field"><label for="m-ward">Ward</label><input id="m-ward" name="ward" type="text" value="${MQ.ward}" autocomplete="off"></div>
          <div class="field"><label for="m-pu">Polling Unit</label><input id="m-pu" name="polling_unit" type="text" value="${MQ.polling_unit}" autocomplete="off"></div></div></details>
        </form>
        <div class="toolbar"><span id="m-count" class="muted" aria-live="polite"></span><div class="btn-row"><select id="m-demo" aria-label="Demo data" class="sm"><option value="">Show demo data</option><option value="hide" ${MQ.demo === 'hide' ? raw('selected') : ''}>Hide demo data</option><option value="only" ${MQ.demo === 'only' ? raw('selected') : ''}>Only demo data</option></select><button class="btn secondary sm" type="button" data-admin="reset-filters">Clear filters</button>${can('members_export') ? html`<button class="btn sm" type="button" data-admin="export">Export CSV</button>` : ''}</div></div>
        <div id="m-list" aria-live="polite"><p class="empty">Loading…</p></div><div class="pager" id="m-pager"></div>`, '/admin/members');
    }, 'members_view'),
    after() {
      const f = $('#m-filters'); if (!f) return; let t;
      const run = () => { MQ.page = 1; loadMembers(); };
      const sync = () => { for (const k of ['q', 'state', 'lga', 'ward', 'polling_unit', 'status']) MQ[k] = f.elements[k].value.trim(); };
      f.addEventListener('input', (e) => { sync(); if (e.target.name === 'state') { loadLgaList(); } clearTimeout(t); t = setTimeout(run, 300); });
      f.addEventListener('submit', (e) => { e.preventDefault(); sync(); run(); });
      $('#m-demo').addEventListener('change', (e) => { MQ.demo = e.target.value; run(); });
      const more = $('#m-more'); if (more && (window.matchMedia('(min-width: 760px)').matches || MQ.status || MQ.state || MQ.lga || MQ.ward || MQ.polling_unit)) more.open = true;
      loadLgaList(); loadMembers();
    },
  });
  async function loadLgaList() { const dl = $('#m-lga-list'); if (!dl) return; try { const items = MQ.state ? (await api('/api/locations/lgas?state=' + encodeURIComponent(MQ.state))).items : []; dl.innerHTML = items.map((i) => `<option value="${esc(i)}"></option>`).join(''); } catch { /* */ } }
  async function loadMembers() {
    const list = $('#m-list'); if (!list) return;
    try {
      const r = await aapi('/api/admin/members?' + qs({ ...MQ, per: 25 }));
      $('#m-count').textContent = `${r.total} member${r.total === 1 ? '' : 's'} found`;
      list.innerHTML = r.items.length ? html`<table class="tbl"><thead><tr><th>Reg. ID</th><th>Name</th><th>Phone</th><th>State / LGA</th><th>Ward</th><th>Status</th><th>Date</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
        ${r.items.map((m) => html`<tr><td data-label="Reg. ID"><b>${m.registration_id}</b>${m.is_demo ? html` <span class="badge demo">DEMO DATA</span>` : ''}</td><td data-label="Name">${m.full_name}</td><td data-label="Phone">${m.phone}</td><td data-label="State / LGA">${m.state} / ${m.lga}</td><td data-label="Ward">${m.ward}</td><td data-label="Status"><span class="badge ${m.status}">${m.status}</span></td><td data-label="Date">${fmtDate(m.registration_date)}</td><td class="actions"><button class="btn sm secondary" type="button" data-admin="open" data-id="${m.id}">View details</button></td></tr>`)}</tbody></table>` .s : '<p class="empty">No members match these filters.</p>';
      $('#m-pager').innerHTML = html`<button class="btn secondary sm" type="button" data-admin="page" data-p="${r.page - 1}" ${r.page <= 1 ? raw('disabled') : ''}>Previous</button><span>Page ${r.page} of ${r.pages}</span><button class="btn secondary sm" type="button" data-admin="page" data-p="${r.page + 1}" ${r.page >= r.pages ? raw('disabled') : ''}>Next</button>`.s;
    } catch (e) { list.innerHTML = `<div class="notice danger">${esc(errMsg(e))}</div>`; }
  }

  /* ---------------- member dialog ---------------- */
  const dlg = () => $('#dlg');
  function closeDlg() { clearTimeout(dlgTimer); const d = dlg(); if (d && d.open) d.close(); }
  async function openMember(id) {
    const d = dlg(); d.innerHTML = '<div class="dlg-body"><p class="empty">Loading…</p></div>'; if (!d.open) d.showModal();
    try {
      const { member: m } = await aapi('/api/admin/members/' + id);
      const kv = (k, v) => html`<div><dt>${k}</dt><dd>${v || '—'}</dd></div>`;
      d.innerHTML = html`<div class="dlg-head"><h2 id="dlg-title">${m.registration_id} ${m.is_demo ? html`<span class="badge demo">DEMO DATA</span>` : ''}</h2><button class="x" type="button" data-admin="close" aria-label="Close">×</button></div>
        <div class="dlg-body"><div class="detail"><div>${m.has_photo ? html`<img src="/api/admin/members/${m.id}/photo" alt="Passport photograph of ${m.full_name}">` : html`<div class="nophoto">No photograph</div>`}</div>
          <dl class="kv">${kv('Status', html`<span class="badge ${m.status}">${m.status}</span>`)}${kv('Full name', m.full_name)}${kv('First / Middle / Last', [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(' · '))}${kv('Phone', m.phone)}${kv('Email', m.email)}${kv('Date of birth', fmtDate(m.date_of_birth))}${kv('Gender', m.gender)}${kv('State', m.state)}${kv('LGA', m.lga)}${kv('Ward', m.ward)}${kv('Polling Unit', m.polling_unit)}${kv('Registered', fmtDateTime(m.created_at))}${kv('Consent given', fmtDateTime(m.consent_at))}
            <div><dt>NIN</dt><dd><span class="nin-line"><code id="nin-val">${m.nin_masked}</code>${isSuper() ? html`<button class="btn sm secondary" type="button" data-admin="nin-ask">Show NIN</button>` : html`<span class="small muted">Restricted</span>`}</span></dd></div></dl></div>
          <div id="nin-form" hidden class="notice"><label for="nin-pw"><b>Confirm your password to view this NIN.</b> This action is recorded in the audit log.</label><div class="with-btn"><input id="nin-pw" type="password" autocomplete="current-password"><button class="btn sm" type="button" data-admin="nin-go" data-id="${m.id}">Confirm</button></div><span class="err show-err" id="nin-err" role="alert"></span></div>
          <div class="btn-row" id="m-actions">${can('members_manage') ? html`${m.status !== 'Approved' ? html`<button class="btn sm" type="button" data-admin="status" data-id="${m.id}" data-s="Approved">Approve</button>` : ''}${m.status !== 'Rejected' ? html`<button class="btn sm danger" type="button" data-admin="status" data-id="${m.id}" data-s="Rejected">Reject</button>` : ''}${m.status !== 'Pending' ? html`<button class="btn sm secondary" type="button" data-admin="status" data-id="${m.id}" data-s="Pending">Set to Pending</button>` : ''}<button class="btn sm secondary" type="button" data-admin="edit" data-id="${m.id}">Edit</button>` : ''}${can('members_delete') ? html`<button class="btn sm danger" type="button" data-admin="delete" data-id="${m.id}">Delete</button>` : ''}</div></div>`.s;
      d._member = m;
    } catch (e) { d.innerHTML = `<div class="dlg-head"><h2 id="dlg-title">Error</h2><button class="x" type="button" data-admin="close" aria-label="Close">×</button></div><div class="dlg-body"><div class="notice danger">${esc(errMsg(e))}</div></div>`; }
  }
  function editForm(m) {
    const f = (name, label, v, attrs = '', req = true) => html`<div class="field" id="fld-${name}"><label for="e-${name}">${label}${req ? '' : ' (optional)'}</label><input id="e-${name}" name="${name}" type="${name === 'date_of_birth' ? 'date' : 'text'}" value="${v || ''}" ${raw(attrs)}><span class="err" id="err-${name}" role="alert"></span></div>`;
    dlg().innerHTML = html`<div class="dlg-head"><h2 id="dlg-title">Edit ${m.registration_id}</h2><button class="x" type="button" data-admin="close" aria-label="Close">×</button></div>
      <form class="dlg-body" id="edit-form" novalidate><div id="edit-msg" class="notice danger" hidden role="alert"></div>
      ${f('full_name', 'Full name', m.full_name)}<div class="grid2 grid3">${f('first_name', 'First name', m.first_name)}${f('middle_name', 'Middle name', m.middle_name, '', false)}${f('last_name', 'Last name', m.last_name)}</div>
      <div class="grid2">${f('phone', 'Phone', m.phone, 'inputmode="tel"')}${f('email', 'Email', m.email, 'inputmode="email"', false)}</div>
      <div class="grid2">${f('date_of_birth', 'Date of birth', m.date_of_birth)}<div class="field" id="fld-gender"><label for="e-gender">Gender</label><select id="e-gender" name="gender">${['Male', 'Female'].map((g) => html`<option ${m.gender === g ? raw('selected') : ''}>${g}</option>`)}</select><span class="err" id="err-gender"></span></div></div>
      <div class="grid2">${f('state', 'State', m.state, 'list="e-states"')}${f('lga', 'LGA', m.lga, 'list="e-lgas"')}</div><div class="grid2">${f('ward', 'Ward', m.ward, 'list="e-wards"')}${f('polling_unit', 'Polling Unit', m.polling_unit)}</div>
      <datalist id="e-states"></datalist><datalist id="e-lgas"></datalist><datalist id="e-wards"></datalist>
      <p class="small muted">The NIN and photograph cannot be edited here.</p>
      <div class="btn-row"><button class="btn" type="submit">Save changes</button><button class="btn secondary" type="button" data-admin="open" data-id="${m.id}">Cancel</button></div></form>`.s;
    const form = $('#edit-form'); const fill = (id, items) => { $(id).innerHTML = items.map((i) => `<option value="${esc(i)}"></option>`).join(''); };
    api('/api/locations/states').then((r) => fill('#e-states', r.states));
    const lg = () => api('/api/locations/lgas?state=' + encodeURIComponent(form.state.value)).then((r) => fill('#e-lgas', r.items));
    const wd = () => api(`/api/locations/wards?state=${encodeURIComponent(form.state.value)}&lga=${encodeURIComponent(form.lga.value)}`).then((r) => fill('#e-wards', r.items));
    lg(); wd(); form.state.addEventListener('change', lg); form.lga.addEventListener('change', wd);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); $$('.field.invalid', form).forEach((x) => x.classList.remove('invalid')); $('#edit-msg').hidden = true;
      const body = Object.fromEntries(new FormData(form).entries());
      try { await aapi('/api/admin/members/' + m.id, { method: 'PATCH', body }); toast('Member updated'); await openMember(m.id); loadMembers(); }
      catch (err) { const er = err.data && err.data.errors; if (er) { Object.entries(er).forEach(([k, v]) => { const fld = $('#fld-' + k, form); if (fld) { fld.classList.add('invalid'); $('#err-' + k, form).textContent = v; } }); } formMsg($('#edit-msg'), errMsg(err)); }
    });
  }

  /* ---------------- settings ---------------- */
  const SF = (s, name, label, o = {}) => html`<div class="field" id="fld-${name}"><label for="s-${name}">${label}</label>${o.area ? html`<textarea id="s-${name}" name="${name}" rows="${o.rows || 4}">${s[name]}</textarea>` : html`<input id="s-${name}" name="${name}" type="${o.type || 'text'}" value="${s[name]}" ${raw(o.attrs || '')}>`}${o.hint ? html`<span class="hint">${o.hint}</span>` : ''}<span class="err" id="err-${name}" role="alert"></span></div>`;
  register('/admin/settings', {
    title: 'Settings',
    render: guard(async () => {
      const { settings: s, logo_url } = await aapi('/api/admin/settings');
      const color = (n, l) => html`<div class="field" id="fld-${n}"><label for="s-${n}">${l}</label><div class="color-row"><input id="s-${n}" name="${n}" type="color" value="${s[n]}"><code>${s[n]}</code></div><span class="err" id="err-${n}"></span></div>`;
      return adminLayout(html`<h1>Settings</h1><div id="set-msg" class="notice" hidden role="alert"></div>
        <form id="set-form" novalidate>
        <section class="section-card"><h2>Organization</h2>${SF(s, 'org_name', 'Organization name')}${SF(s, 'org_tagline', 'Short description (tagline)')}${SF(s, 'org_description', 'Organization description', { area: true })}
          <div class="field"><span class="lbl">Logo</span><div class="photo-box">${logo_url ? html`<img src="${logo_url}" alt="Current logo" width="150" height="150">` : html`<p class="muted">No logo uploaded. A neutral placeholder is shown.</p>`}<div class="btn-row"><label class="btn secondary sm" for="logo-file">Upload logo (PNG, JPG or WebP, up to 1 MB)</label>${logo_url ? html`<button type="button" class="btn secondary sm" data-admin="logo-remove">Remove logo</button>` : ''}</div><input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp"></div></div>
          <div class="grid2">${color('color_primary', 'Primary colour')}${color('color_accent', 'Accent colour')}</div>${color('color_dark', 'Dark colour')}</section>
        <section class="section-card"><h2>Contact details</h2><div class="grid2">${SF(s, 'phone', 'Phone')}${SF(s, 'email', 'Email')}</div>${SF(s, 'address', 'Office address', { area: true, rows: 2 })}
          <div class="grid2">${SF(s, 'social_facebook', 'Facebook link', { type: 'url' })}${SF(s, 'social_x', 'X (Twitter) link', { type: 'url' })}${SF(s, 'social_instagram', 'Instagram link', { type: 'url' })}${SF(s, 'social_whatsapp', 'WhatsApp link', { type: 'url' })}${SF(s, 'social_youtube', 'YouTube link', { type: 'url' })}</div></section>
        <section class="section-card"><h2>About page</h2>${SF(s, 'about_purpose', 'Purpose', { area: true })}${SF(s, 'about_membership', 'Membership', { area: true })}${SF(s, 'about_org_info', 'Organizational information', { area: true })}</section>
        <section class="section-card"><h2>Registration</h2>
          <label class="check"><input type="checkbox" name="registration_open" ${s.registration_open === '1' ? raw('checked') : ''}><span>Registration is open to the public</span></label>
          <label class="check"><input type="checkbox" name="strict_locations" ${s.strict_locations === '1' ? raw('checked') : ''}><span>Require official lists for Ward and Polling Unit (applicants cannot type their own). Turn this on after you have imported the official data in Locations.</span></label>
          <div class="grid2">${SF(s, 'id_prefix', 'Registration ID prefix', { hint: '2 to 10 letters or numbers. Example: AYNM gives AYNM-2026-000001.' })}${SF(s, 'max_passport_kb', 'Maximum passport photo size (KB)', { type: 'number', attrs: 'min="50" max="2000"' })}${SF(s, 'min_age', 'Minimum age', { type: 'number', attrs: 'min="16" max="100"' })}
          <div class="field"><label for="s-public_name_display">Name shown on public “Check Registration”</label><select id="s-public_name_display" name="public_name_display"><option value="masked" ${s.public_name_display === 'masked' ? raw('selected') : ''}>Partly hidden (recommended)</option><option value="full" ${s.public_name_display === 'full' ? raw('selected') : ''}>Full name</option></select><span class="hint">Registration IDs are sequential, so a full name would let anyone browse member names by trying IDs.</span></div></div></section>
        <section class="section-card"><h2>Data retention</h2>${SF(s, 'retention_days', 'Delete rejected registrations after (days)', { type: 'number', attrs: 'min="0" max="3650"', hint: '0 turns this off. Applies only to registrations with status Rejected. Deletion happens when you run it below or via “npm run purge”, never silently.' })}
          <div class="btn-row"><button class="btn secondary sm" type="button" data-admin="retention" data-dry="1">Preview what would be deleted</button><button class="btn danger sm" type="button" data-admin="retention" data-dry="0">Delete now</button></div></section>
        <section class="section-card"><h2>Privacy policy</h2>${SF(s, 'privacy_policy', 'Privacy policy text', { area: true, rows: 16, hint: 'Use “# Title” for the main heading and “## Heading” for sections. Leave a blank line between paragraphs. Text in [square brackets] shows as a to-do placeholder.' })}</section>
        <div class="btn-row"><button class="btn" type="submit">Save settings</button></div></form>
`, '/admin/settings');
    }, 'settings_manage'),
    after() {
      const f = $('#set-form'); if (!f) return;
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); $$('.field.invalid', f).forEach((x) => x.classList.remove('invalid')); $('#set-msg').hidden = true;
        const body = Object.fromEntries(new FormData(f).entries()); body.registration_open = f.elements.registration_open.checked; body.strict_locations = f.elements.strict_locations.checked;
        try { await aapi('/api/admin/settings', { method: 'PUT', body }); const cfg = await api('/api/config'); window.AYNM.applyConfig(cfg); toast('Settings saved'); }
        catch (err) { const er = err.data && err.data.errors; if (er) Object.entries(er).forEach(([k, v]) => { const fld = $('#fld-' + k); if (fld) { fld.classList.add('invalid'); $('#err-' + k).textContent = v; } }); formMsg($('#set-msg'), errMsg(err)); window.scrollTo(0, 0); }
      });
      $('#logo-file').addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
        try { await aapi('/api/admin/logo', { method: 'POST', body: { data } }); window.AYNM.applyConfig(await api('/api/config')); toast('Logo updated'); window.AYNM.render(); } catch (err) { toast(errMsg(err), true); }
      });
    },
  });

  /* ---------------- locations ---------------- */
  const LQ = { state: '', lga: '', ward: '' };
  register('/admin/locations', {
    title: 'Locations',
    render: guard(async () => {
      const r = await aapi('/api/admin/locations/summary');
      const states = r.items.map((i) => i.state);
      return adminLayout(html`<h1>Location management</h1>
        <section class="section-card"><h2>Browse States, LGAs, Wards and Polling Units</h2>
          <div class="field"><label for="lb-state">State</label><select id="lb-state"><option value="">Select a State</option>${states.map((x) => html`<option ${LQ.state === x ? raw('selected') : ''}>${x}</option>`)}</select></div>
          <div id="lb-crumbs" class="crumbs"></div><div id="lb-list"><p class="empty">Choose a State to see its Local Government Areas.</p></div></section>
        <section class="section-card"><h2>Import official ward and polling-unit data</h2>
          <p>Upload a CSV with the header <code>state,lga,ward,polling_unit</code>. The State and LGA names must match the lists above. Once a ward list exists for an LGA, applicants must choose from it. Use the official INEC data; nothing is added unless you import it.</p>
          <div id="loc-msg" class="notice" hidden role="alert"></div>
          <div class="field"><label for="loc-file">CSV file</label><input id="loc-file" type="file" accept=".csv,text/csv"></div>
          <div class="field"><label for="loc-csv">…or paste CSV</label><textarea id="loc-csv" rows="6" placeholder="state,lga,ward,polling_unit&#10;Zamfara,Bungudu,Example Ward,Example Polling Unit 001"></textarea></div>
          <label class="check"><input type="checkbox" id="loc-replace"><span>Replace existing data for the States in this file</span></label>
          <div class="btn-row"><button class="btn secondary" type="button" data-admin="loc-import" data-dry="1">Check file</button><button class="btn" type="button" data-admin="loc-import" data-dry="0">Import</button></div></section>
        <section class="section-card"><h2>Data loaded</h2><p class="muted small">The portal ships with the Northern states dataset (LGAs, wards and polling units) and loads it the first time it starts. Names follow the source file. You can add to it, replace a state, or remove entries by importing a CSV above.</p>
          <table class="tbl"><thead><tr><th>State</th><th>LGAs</th><th>Wards</th><th>Polling units</th></tr></thead><tbody>${r.items.map((i) => html`<tr><td data-label="State">${i.state}</td><td data-label="LGAs">${i.lgas}</td><td data-label="Wards">${i.wards}</td><td data-label="Polling units">${i.polling_units}</td></tr>`)}</tbody></table></section>`, '/admin/locations');
    }, 'locations_manage'),
    after() {
      const f = $('#loc-file'); if (f) f.addEventListener('change', async () => { if (f.files[0]) $('#loc-csv').value = await f.files[0].text(); });
      const sel = $('#lb-state'); if (!sel) return;
      sel.addEventListener('change', () => { LQ.state = sel.value; LQ.lga = ''; LQ.ward = ''; browseLoc(); });
      if (LQ.state) browseLoc();
    },
  });
  async function browseLoc() {
    const list = $('#lb-list'); const crumbs = $('#lb-crumbs'); if (!list) return;
    if (!LQ.state) { crumbs.innerHTML = ''; list.innerHTML = '<p class="empty">Choose a State to see its Local Government Areas.</p>'; return; }
    try {
      const r = await aapi('/api/admin/locations/browse?' + qs(LQ));
      crumbs.innerHTML = html`<button type="button" data-admin="lb-up" data-to="state">${LQ.state}</button>${LQ.lga ? html`/ <button type="button" data-admin="lb-up" data-to="lga">${LQ.lga}</button>` : ''}${LQ.ward ? html`/ <b>${LQ.ward}</b>` : ''}${LQ.lga && can('locations_manage') ? html`<button type="button" data-admin="lb-clear">Remove imported data${LQ.ward ? ' for this ward' : ' for this LGA'}</button>` : ''}`.s;
      if (r.level === 'lga') list.innerHTML = html`<ul class="drill">${r.items.map((i) => html`<li><button type="button" data-admin="lb-open" data-level="lga" data-name="${i.name}"><span>${i.name}</span><span class="muted small">${i.wards} wards · ${i.polling_units} polling units</span></button></li>`)}</ul>`.s;
      else if (r.level === 'ward') list.innerHTML = r.items.length ? html`<ul class="drill">${r.items.map((i) => html`<li><button type="button" data-admin="lb-open" data-level="ward" data-name="${i.name}"><span>${i.name}</span><span class="muted small">${i.polling_units} polling units</span></button></li>`)}</ul>`.s : '<p class="empty">No wards have been imported for this LGA yet.</p>';
      else list.innerHTML = r.items.length ? html`<ul class="drill">${r.items.map((i) => html`<li class="plain">${i.name}</li>`)}</ul>`.s : '<p class="empty">No polling units have been imported for this ward yet.</p>';
    } catch (e) { list.innerHTML = `<div class="notice danger">${esc(errMsg(e))}</div>`; }
  }

  /* ---------------- audit ---------------- */
  register('/admin/audit', {
    title: 'Audit Log',
    render: guard(async () => {
      const r = await aapi('/api/admin/audit');
      return adminLayout(html`<h1>Audit Log</h1><p class="muted">The most recent 300 administrator actions. Sensitive values are never written to this log.</p>
        <table class="tbl"><thead><tr><th>When</th><th>Administrator</th><th>Action</th><th>Target</th><th>Detail</th><th>IP</th></tr></thead><tbody>${r.items.map((i) => html`<tr><td data-label="When">${fmtDateTime(i.created_at)}</td><td data-label="Administrator">${i.admin_email || '—'}</td><td data-label="Action"><b>${i.action}</b></td><td data-label="Target">${i.target || ''}</td><td data-label="Detail">${i.detail || ''}</td><td data-label="IP">${i.ip || ''}</td></tr>`)}</tbody></table>`, '/admin/audit');
    }, 'audit_view'),
  });


  /* ---------------- my account (every administrator) ---------------- */
  register('/admin/account', {
    title: 'My Account',
    render: guard(() => adminLayout(html`<h1>My account</h1>
      <section class="section-card"><h2>Signed in as</h2><p><b>${S.admin.name || S.admin.email}</b><br>${S.admin.email}</p>
        <p class="muted small">${isSuper() ? 'Super Admin: full access to everything.' : 'Your access:'}</p>
        ${isSuper() ? '' : html`<div class="chips">${S.admin.permissions.length ? S.admin.permissions.map((p) => html`<span class="chip">${PERM_LABELS[p] || p}</span>`) : html`<span class="muted">No permissions have been granted yet. Ask a Super Admin.</span>`}</div>`}</section>
      <section class="section-card"><h2>Change password</h2><form id="pw-form" novalidate><div id="pw-msg" class="notice" hidden role="alert"></div>
        <div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="pw-new">New password (12+ characters, letters and numbers)</label><input id="pw-new" type="password" autocomplete="new-password"></div>
        <button class="btn secondary" type="submit">Change password</button></form></section>`, '/admin/account')),
    after() {
      const f = $('#pw-form'); if (!f) return;
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); const m = $('#pw-msg');
        try { await aapi('/api/admin/change-password', { method: 'POST', body: { current_password: $('#pw-cur').value, new_password: $('#pw-new').value } }); $('#pw-cur').value = ''; $('#pw-new').value = ''; formMsg(m, 'Password changed. Your other sessions were signed out.', 'warn'); } catch (err) { formMsg(m, errMsg(err)); }
      });
    },
  });

  /* ---------------- admin management (super admin) ---------------- */
  const PERM_LABELS = { members_view: 'View members and dashboard', members_manage: 'Approve, reject and edit members', members_export: 'Export members (CSV)', members_delete: 'Delete members', locations_manage: 'Manage location data', settings_manage: 'Website settings', audit_view: 'View audit log' };
  const permBoxes = (name, selected, all) => html`<div class="perm-grid">${Object.entries(all).map(([k, label]) => html`<label><input type="checkbox" name="${name}" value="${k}" ${selected.includes(k) ? raw('checked') : ''}><span>${label}</span></label>`)}</div>`;
  let ADMINS = null;
  register('/admin/admins', {
    title: 'Administrators',
    render: guard(async () => {
      ADMINS = await aapi('/api/admin/admins');
      const { admins, invites, permissions } = ADMINS;
      return adminLayout(html`<h1>Administrators</h1>
        <section class="section-card"><h2>Invite an administrator</h2>
          <p class="muted small">They receive a one-time link (valid 72 hours) to set their own password. You choose what they can do.</p>
          <div id="inv-msg" class="notice" hidden role="alert"></div>
          <form id="inv-form" novalidate>
            <div class="grid2"><div class="field" id="fld-email"><label for="inv-email">Email</label><input id="inv-email" name="email" type="email" inputmode="email" autocapitalize="none" autocomplete="off"><span class="err" id="err-email" role="alert"></span></div>
            <div class="field"><label for="inv-name">Name (optional)</label><input id="inv-name" name="name" type="text" autocomplete="off" maxlength="80"></div></div>
            <div class="field"><label for="inv-role">Role</label><select id="inv-role" name="role"><option value="admin">Admin (only the permissions below)</option><option value="super_admin">Super Admin (full control)</option></select></div>
            <div id="inv-perms"><span class="lbl">Permissions</span>${permBoxes('perm', ['members_view', 'members_manage'], permissions)}</div>
            <button class="btn" type="submit">Create invitation</button></form>
          <div id="inv-result" hidden></div></section>
        ${invites.length ? html`<section class="section-card"><h2>Pending invitations</h2><table class="tbl"><thead><tr><th>Email</th><th>Role</th><th>Expires</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${invites.map((i) => html`<tr><td data-label="Email">${i.email}</td><td data-label="Role">${i.role === 'super_admin' ? 'Super Admin' : 'Admin'}</td><td data-label="Expires">${fmtDateTime(i.expires_at)}</td><td class="actions"><button class="btn sm secondary" type="button" data-admin="invite-revoke" data-id="${i.id}">Revoke</button></td></tr>`)}</tbody></table></section>` : ''}
        <section class="section-card"><h2>Administrators</h2><table class="tbl"><thead><tr><th>Administrator</th><th>Role</th><th>Status</th><th>Last sign-in</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
          ${admins.map((a) => html`<tr><td data-label="Administrator"><b>${a.name || a.email}</b><br><span class="small muted">${a.email}</span></td><td data-label="Role">${a.role === 'super_admin' ? html`<span class="badge super">Super Admin</span>` : html`<span class="badge on">Admin</span>`}</td><td data-label="Status"><span class="badge ${a.is_active ? 'on' : 'off'}">${a.is_active ? 'Active' : 'Deactivated'}</span></td><td data-label="Last sign-in">${a.last_login_at ? fmtDateTime(a.last_login_at) : 'Never'}</td>
          <td class="actions"><div class="btn-row"><button class="btn sm secondary" type="button" data-admin="admin-edit" data-id="${a.id}">Manage</button></div></td></tr>`)}</tbody></table></section>`, '/admin/admins');
    }, 'super'),
    after() {
      const f = $('#inv-form'); if (!f) return;
      const togglePerms = () => { $('#inv-perms').hidden = f.role.value === 'super_admin'; }; f.role.addEventListener('change', togglePerms);
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); setFieldError('email', ''); $('#inv-msg').hidden = true; $('#inv-result').hidden = true;
        const body = { email: f.email.value, name: f.name.value, role: f.role.value, permissions: $$('input[name=perm]:checked', f).map((x) => x.value) };
        try {
          const r = await aapi('/api/admin/admins/invite', { method: 'POST', body });
          const box = $('#inv-result'); box.hidden = false;
          box.innerHTML = html`<div class="notice warn"><b>Invitation created</b>Copy this link and send it to ${body.email} (for example on WhatsApp). It is shown only once and works for 72 hours.${r.email_delivered ? '' : ' Email delivery is not connected yet, so please send the link yourself.'}<div class="invite-link" id="inv-link">${r.invite_url}</div><button class="btn sm" type="button" data-admin="copy-invite">Copy link</button></div>`.s;
          f.reset(); togglePerms();
        } catch (err) { const er = err.data && err.data.errors; if (er && er.email) setFieldError('email', er.email); else formMsg($('#inv-msg'), errMsg(err)); }
      });
    },
  });
  function adminDialog(a) {
    const d = dlg();
    d.innerHTML = html`<div class="dlg-head"><h2 id="dlg-title">${a.name || a.email}</h2><button class="x" type="button" data-admin="close" aria-label="Close">×</button></div>
      <div class="dlg-body"><div id="ad-msg" class="notice" hidden role="alert"></div><p class="muted small">${a.email}${a.is_self ? ' (this is you)' : ''}</p>
      <form id="ad-form" novalidate>
        <div class="field"><label for="ad-name">Name</label><input id="ad-name" name="name" type="text" value="${a.name}" maxlength="80"></div>
        <div class="field"><label for="ad-role">Role</label><select id="ad-role" name="role" ${a.is_self ? raw('disabled') : ''}><option value="admin" ${a.role === 'admin' ? raw('selected') : ''}>Admin</option><option value="super_admin" ${a.role === 'super_admin' ? raw('selected') : ''}>Super Admin</option></select></div>
        <div id="ad-perms" ${a.role === 'super_admin' ? raw('hidden') : ''}><span class="lbl">Permissions</span>${permBoxes('aperm', a.permissions, ADMINS.permissions)}</div>
        <button class="btn" type="submit">Save changes</button></form>
      ${a.is_self ? '' : html`<hr><div class="btn-row">${a.is_active ? html`<button class="btn sm secondary" type="button" data-admin="admin-active" data-id="${a.id}" data-active="0">Deactivate</button>` : html`<button class="btn sm secondary" type="button" data-admin="admin-active" data-id="${a.id}" data-active="1">Reactivate</button>`}<button class="btn sm danger" type="button" data-admin="admin-remove" data-id="${a.id}">Remove administrator</button></div>`}</div>`.s;
    if (!d.open) d.showModal();
    const f = $('#ad-form');
    f.role.addEventListener('change', () => { $('#ad-perms').hidden = f.role.value === 'super_admin'; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: f.name.value, permissions: $$('input[name=aperm]:checked', f).map((x) => x.value) };
      if (!a.is_self) body.role = f.role.value;
      try { await aapi('/api/admin/admins/' + a.id, { method: 'PATCH', body }); toast('Saved'); closeDlg(); window.AYNM.render(); } catch (err) { formMsg($('#ad-msg'), errMsg(err)); }
    });
  }

  /* ---------------- accept an invitation (public link) ---------------- */
  register('/admin/invite', {
    title: 'Accept invitation',
    async render({ query }) {
      let inv = null; try { inv = await api('/api/admin/invite/check', { method: 'POST', body: { token: query.token || '' } }); } catch (e) { return authShell(html`<h1>Invitation</h1><div class="notice danger">${errMsg(e)}</div><p class="center"><a href="#/admin">Go to sign in</a></p>`); }
      return authShell(html`<h1>Welcome</h1><p class="muted">You have been invited as ${inv.role === 'super_admin' ? 'a Super Admin' : 'an administrator'} for <b>${inv.email}</b>. Choose your password to finish.</p><div id="auth-msg" class="notice" role="alert" hidden></div>
        <form id="invite-form" novalidate><div class="field"><label for="f-name">Your name</label><input id="f-name" name="name" type="text" autocomplete="name" value="${inv.name}" maxlength="80"></div>
        ${pwField('password', 'Password (at least 12 characters, letters and numbers)', 'new-password')}${pwField('password2', 'Confirm password', 'new-password')}<button class="btn block" type="submit">CREATE MY ACCOUNT</button></form>`);
    },
    after({ query }) {
      const f = $('#invite-form'); if (!f) return;
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); setFieldError('password2', '');
        if (f.password.value !== f.password2.value) return setFieldError('password2', 'The two passwords do not match.');
        try { await api('/api/admin/invite/accept', { method: 'POST', body: { token: query.token, name: f.name.value, password: f.password.value } }); toast('Account created. Please sign in.'); location.hash = '#/admin'; } catch (err) { formMsg($('#auth-msg'), errMsg(err)); }
      });
    },
  });

  /* ---------------- admin click handling ---------------- */
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-admin]'); if (!t) return; const a = t.dataset.admin; const id = t.dataset.id;
    try {
      if (a === 'logout') { await aapi('/api/admin/logout', { method: 'POST' }); S.admin = null; S.csrf = null; location.hash = '#/admin'; }
      else if (a === 'open') await openMember(id);
      else if (a === 'close') closeDlg();
      else if (a === 'page') { MQ.page = Number(t.dataset.p); loadMembers(); window.scrollTo(0, 0); }
      else if (a === 'reset-filters') { Object.assign(MQ, { q: '', state: '', lga: '', ward: '', polling_unit: '', status: '', demo: '', page: 1 }); window.AYNM.render(); }
      else if (a === 'export') { const p = { ...MQ }; delete p.page; location.href = '/api/admin/export.csv?' + qs(p); }
      else if (a === 'status') { await aapi(`/api/admin/members/${id}/status`, { method: 'POST', body: { status: t.dataset.s } }); toast('Status set to ' + t.dataset.s); await openMember(id); loadMembers(); }
      else if (a === 'edit') editForm(dlg()._member);
      else if (a === 'delete') { if (confirm('Permanently delete this registration and its photograph? This cannot be undone.')) { await aapi('/api/admin/members/' + id, { method: 'DELETE' }); closeDlg(); toast('Registration deleted'); loadMembers(); } }
      else if (a === 'nin-ask') { $('#nin-form').hidden = false; $('#nin-pw').focus(); }
      else if (a === 'nin-go') {
        try { const r = await aapi(`/api/admin/members/${id}/reveal-nin`, { method: 'POST', body: { password: $('#nin-pw').value } }); $('#nin-val').textContent = r.nin; $('#nin-pw').value = ''; $('#nin-form').hidden = true;
          clearTimeout(dlgTimer); dlgTimer = setTimeout(() => { const el = $('#nin-val'); if (el && dlg()._member) el.textContent = dlg()._member.nin_masked; }, 30000); toast('NIN visible for 30 seconds'); }
        catch (err) { const m = $('#nin-err'); m.textContent = errMsg(err); }
      }
      else if (a === 'lb-open') { if (t.dataset.level === 'lga') LQ.lga = t.dataset.name; else LQ.ward = t.dataset.name; browseLoc(); }
      else if (a === 'lb-up') { if (t.dataset.to === 'state') { LQ.lga = ''; LQ.ward = ''; } else LQ.ward = ''; browseLoc(); }
      else if (a === 'lb-clear') { if (confirm(`Remove the imported ${LQ.ward ? 'polling units for this ward' : 'wards and polling units for this LGA'}? Applicants will go back to typing them in until you import again.`)) { const r = await aapi('/api/admin/locations/clear', { method: 'POST', body: LQ }); toast(`${r.removed} row(s) removed`); LQ.ward = ''; if (!t.closest('#lb-crumbs')) { /* noop */ } browseLoc(); window.AYNM.render(); } }
      else if (a === 'copy-invite') { const ok = await window.AYNM.copyText($('#inv-link').textContent.trim()); toast(ok ? 'Link copied' : 'Could not copy. Please copy it by hand.', !ok); }
      else if (a === 'invite-revoke') { if (confirm('Revoke this invitation?')) { await aapi('/api/admin/invites/' + id, { method: 'DELETE' }); toast('Invitation revoked'); window.AYNM.render(); } }
      else if (a === 'admin-edit') { adminDialog(ADMINS.admins.find((x) => String(x.id) === String(id))); }
      else if (a === 'admin-active') { const on = t.dataset.active === '1'; if (on || confirm('Deactivate this administrator? They will be signed out immediately.')) { await aapi('/api/admin/admins/' + id, { method: 'PATCH', body: { is_active: on } }); toast(on ? 'Reactivated' : 'Deactivated'); closeDlg(); window.AYNM.render(); } }
      else if (a === 'admin-remove') { if (confirm('Permanently remove this administrator? This cannot be undone.')) { await aapi('/api/admin/admins/' + id, { method: 'DELETE' }); toast('Administrator removed'); closeDlg(); window.AYNM.render(); } }
      else if (a === 'logo-remove') { await aapi('/api/admin/logo', { method: 'DELETE' }); window.AYNM.applyConfig(await api('/api/config')); toast('Logo removed'); window.AYNM.render(); }
      else if (a === 'delete-demo') { if (confirm('Delete all DEMO DATA records?')) { const r = await aapi('/api/admin/demo/delete', { method: 'POST', body: {} }); toast(`${r.deleted} demo record(s) deleted`); window.AYNM.render(); } }
      else if (a === 'retention') {
        const dry = t.dataset.dry === '1'; if (!dry && !confirm('Permanently delete rejected registrations older than the retention period?')) return;
        const r = await aapi('/api/admin/retention/run', { method: 'POST', body: { dry_run: dry } });
        toast(!r.enabled ? 'Retention is off. Set a number of days above and save first.' : dry ? `${r.candidates} rejected record(s) older than ${r.days} days would be deleted.` : `${r.deleted} record(s) deleted.`);
      }
      else if (a === 'loc-import') {
        const csv = $('#loc-csv').value; if (!csv.trim()) return formMsg($('#loc-msg'), 'Please choose a file or paste CSV data first.');
        const dry = t.dataset.dry === '1'; if (!dry && !confirm('Import this data?')) return;
        const r = await aapi('/api/admin/locations/import', { method: 'POST', body: { csv, dry_run: dry, replace: $('#loc-replace').checked } });
        formMsg($('#loc-msg'), dry ? `File looks fine: ${r.valid_rows} valid row(s). ${r.problems.length ? 'Notes: ' + r.problems.join(' ') : ''}` : `Imported ${r.added} new row(s); ${r.skipped} skipped. ${r.problems.join(' ')}`, 'warn');
        if (!dry) setTimeout(() => window.AYNM.render(), 1500);
      }
    } catch (err) { if (err && err.status !== 401) toast(errMsg(err), true); if (a === 'loc-import') formMsg($('#loc-msg'), errMsg(err) + (err.data && err.data.problems ? ' ' + err.data.problems.join(' ') : '')); }
  });
  document.addEventListener('close', () => clearTimeout(dlgTimer), true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'nin-pw') { e.preventDefault(); const b = $('[data-admin=nin-go]'); if (b) b.click(); } });

  window.AYNM.start = function () { window.addEventListener('hashchange', window.AYNM.render); window.AYNM.render(); };
})();
