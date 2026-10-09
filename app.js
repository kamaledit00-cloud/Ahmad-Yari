/* AYNM portal frontend (no framework, no inline handlers/styles: compatible with a strict CSP). */
(function () {
  'use strict';

  /* ------------------------------------------------------------ tiny templating (auto-escaping) */
  class Raw { constructor(s) { this.s = s; } }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const raw = (s) => new Raw(s);
  const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : esc(v));
  const html = (s, ...v) => new Raw(s.reduce((a, x, i) => a + x + (i < v.length ? val(v[i]) : ''), ''));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const S = { config: null, csrf: null, admin: null, states: null };
  const NG = { timeZone: 'Africa/Lagos' };
  const fmtDate = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-NG', { ...NG, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));

  const ICONS = {
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    map: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    id: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 10h4M14 14h4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    building: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h2M13 9h2M9 13h2M13 13h2M10 21v-4h4v4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
  };
  const icon = (n) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`);

  /* ------------------------------------------------------------ api + ui helpers */
  async function api(path, { method = 'GET', body, admin = false } = {}) {
    const headers = { 'X-Requested-With': 'aynm' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (admin && S.csrf) headers['X-CSRF-Token'] = S.csrf;
    let res;
    try { res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
    catch { throw { status: 0, data: { error: 'Network problem. Please check your connection and try again.' } }; }
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      if (res.status === 401 && admin && S.admin) { S.admin = null; S.csrf = null; location.hash = '#/admin'; }
      throw { status: res.status, data };
    }
    return data;
  }
  let toastTimer;
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* */ } ta.remove(); return ok;
  }
  const paragraphs = (text, cls = '') => {
    const t = String(text || '').trim();
    if (!t) return html`<p class="placeholder">[Not yet provided]</p>`;
    return raw(t.split(/\n{2,}/).map((p) => `<p class="${/^\[.*\]$/.test(p.trim()) ? 'placeholder' : cls}">${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
  };
  const titleCase = (t) => String(t).toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
  const initials = (name) => String(name || 'AY').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const isPlaceholder = (s) => !s || /^\[.*\]$/.test(String(s).trim());

  function applyConfig(cfg) {
    S.config = cfg;
    const r = document.documentElement.style;
    r.setProperty('--primary', cfg.colors.primary); r.setProperty('--accent', cfg.colors.accent); r.setProperty('--dark', cfg.colors.dark);
    const m = $('meta[name=theme-color]'); if (m) m.setAttribute('content', cfg.colors.primary);
  }
  const logoEl = (cls = 'logo', large = false) => html`<img class="${cls}" src="${large ? S.config.logo_large_url : S.config.logo_url}" alt="${S.config.org_name} logo" width="${large ? 420 : 48}" height="${large ? 420 : 48}" decoding="async">`;
  const brandName = () => { const w = String(S.config.org_name).split(/\s+/); return { top: w.slice(0, 2).join(' '), bottom: w.slice(2).join(' ') }; };
  const brandText = () => { const b = brandName(); return html`<span class="brand-text"><b>${b.top}</b>${b.bottom ? html`<small>${b.bottom}</small>` : ''}</span>`; };

  /* ------------------------------------------------------------ router */
  const routes = {};
  const register = (path, def) => { routes[path] = def; };
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [p, qs] = h.split('?');
    return { path: (p.replace(/\/+$/, '') || '/'), query: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  const NAV = [['/', 'HOME'], ['/about', 'ABOUT'], ['/register', 'REGISTER'], ['/contact', 'CONTACT']];

  function publicLayout(inner, current) {
    const c = S.config;
    return html`
    <header class="site-header"><div class="wrap header-inner">
      <div class="bar">
        <a class="brand" href="#/" aria-label="${c.org_name} home">${logoEl()}${brandText()}</a>
        <button class="nav-toggle" type="button" data-action="toggle-nav" aria-expanded="false" aria-controls="site-nav" aria-label="Menu"><span></span></button>
      </div>
      <nav class="nav" id="site-nav" aria-label="Main">
        ${NAV.map(([p, label]) => html`<a href="#${p}" class="${p === '/register' ? 'cta' : ''}" ${current === p ? raw('aria-current="page"') : ''}>${label}</a>`)}
      </nav>
    </div></header>
    <main id="main" tabindex="-1">${inner}</main>
    <footer class="site-footer"><div class="wrap foot">
      <div class="foot-brand">${logoEl('logo')}<div><b>${c.org_name}</b><br>${c.org_tagline}</div></div>
      <div class="links"><a href="#/check">Check Registration</a><a href="#/privacy">Privacy Policy</a><a href="#/admin">Admin Login</a></div>
    </div></footer>`;
  }

  async function render() {
    const { path, query } = parseHash();
    const def = routes[path] || routes['/'];
    const app = $('#app');
    try {
      if (!S.config) applyConfig(await api('/api/config'));
      const out = await def.render({ query, path });
      app.innerHTML = out.s;
      if (def.after) def.after({ query, path });
    } catch (e) {
      app.innerHTML = `<div class="wrap section"><div class="notice danger"><b>Something went wrong</b>${esc((e && e.data && e.data.error) || 'Please refresh the page and try again.')}</div></div>`;
    }
    document.title = (def.title ? def.title + ' | ' : '') + (S.config ? S.config.org_name : 'Membership Portal');
    window.scrollTo(0, 0);
    const h1 = $('#main h1') || $('main h1') || $('h1');
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    observeReveal();
  }
  function observeReveal() {
    const els = $$('.reveal'); if (!els.length) return;
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
  }

  /* ------------------------------------------------------------ public pages */
  register('/', {
    title: 'Membership Registration Portal',
    render() {
      const c = S.config;
      return publicLayout(html`
      <section class="hero">
        <svg class="hero-pattern" aria-hidden="true" focusable="false"><defs><pattern id="geo" width="56" height="56" patternUnits="userSpaceOnUse"><path d="M28 4 52 28 28 52 4 28z" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M28 16 40 28 28 40 16 28z" fill="none" stroke="#fff" stroke-width="1"/><path d="M0 0h8M48 0h8M0 56h8M48 56h8" stroke="#fff" stroke-width="1.4"/></pattern></defs><rect width="100%" height="100%" fill="url(#geo)"/></svg>
        <div class="wrap">
          <div class="hero-text">
            <span class="eyebrow">Membership Registration Portal</span>
            <h1>${c.org_name}</h1>
            <p class="sub">Membership Registration Portal</p>
            <p class="lead">${c.org_description}</p>
            <p class="lead-sub">Individuals interested in joining the movement can register online in a few minutes. Each registration is reviewed and receives a unique Registration ID.</p>
            <ul class="pillars" aria-label="Our values"><li>Unity</li><li>Progress</li><li>Youth Empowerment</li></ul>
            <div class="btn-row"><a class="btn light" href="#/register">REGISTER NOW</a><a class="btn ghost-light" href="#/about">LEARN MORE</a>${c.social.whatsapp ? html`<a class="btn ghost-light" href="${c.social.whatsapp}" target="_blank" rel="noopener noreferrer">WHATSAPP US</a>` : ''}</div>
          </div>
          <div class="hero-logo">${logoEl('hero-logo-img', true)}</div>
        </div>
      </section>

      <section class="section" id="about-movement"><div class="wrap">
        <div class="section-head reveal"><h2>About the Movement</h2></div>
        <div class="card reveal"><div class="icon">${icon('building')}</div>${paragraphs(c.about_purpose)}<a href="#/about">Read more about the movement</a></div>
      </div></section>

      <section class="section alt"><div class="wrap">
        <div class="section-head reveal"><h2>Membership Registration</h2><p class="muted">Registration is done online in four short steps and works on any phone, tablet or computer.</p></div>
        <div class="cards c3">
          <div class="card reveal"><div class="icon">${icon('file')}</div><h3>Register online</h3><p>Complete the membership form with your personal, location and identification details.</p></div>
          <div class="card reveal"><div class="icon">${icon('shield')}</div><h3>Your information is protected</h3><p>The NIN is encrypted and never shown publicly. See the <a href="#/privacy">Privacy Policy</a> for details.</p></div>
          <div class="card reveal"><div class="icon">${icon('search')}</div><h3>Check your registration</h3><p>Use your Registration ID at any time to see the status of your registration.</p><a class="btn secondary sm" href="#/check">Check Registration</a></div>
        </div>
      </div></section>

      <section class="section"><div class="wrap">
        <div class="section-head reveal"><h2>How Registration Works</h2></div>
        <div class="cards c4">
          ${[['1', 'user', 'Personal information', 'Enter your name, phone number, date of birth and gender.'], ['2', 'map', 'Location', 'Select your State, Local Government Area, Ward and Polling Unit.'], ['3', 'id', 'Identification', 'Enter your NIN and upload a passport photograph.'], ['4', 'check', 'Review and submit', 'Confirm your details, submit, and receive your Registration ID.']].map(([n, ic, t, d]) => html`
          <div class="card reveal"><div class="step-num">${n}</div><h3>${t}</h3><p class="muted">${d}</p></div>`)}
        </div>
        <div class="btn-row reveal"><a class="btn" href="#/register">REGISTER NOW</a></div>
      </div></section>

      <section class="section alt"><div class="wrap">
        <div class="section-head reveal"><h2>Contact Information</h2></div>
        ${contactBlock()}
      </div></section>`, '/');
    },
  });

  function contactBlock() {
    const c = S.config;
    const none = html`<span class="muted">Not published yet</span>`;
    const tel = !c.phone ? none : /^\+?[\d\s()-]{7,}$/.test(c.phone) ? html`<a href="tel:${String(c.phone).replace(/[^\d+]/g, '')}">${c.phone}</a>` : c.phone;
    const mail = !c.email ? none : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) ? html`<a href="mailto:${c.email}">${c.email}</a>` : c.email;
    const soc = [['facebook', 'Facebook'], ['x', 'X (Twitter)'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'], ['youtube', 'YouTube']].filter(([k]) => c.social[k]);
    return html`<div class="cards c2">
      <div class="card reveal"><ul class="contact-list">
        <li><div class="icon">${icon('map')}</div><div><b>Office Address</b>${c.address || none}</div></li>
        <li><div class="icon">${icon('phone')}</div><div><b>Phone</b>${tel}</div></li>
        <li><div class="icon">${icon('mail')}</div><div><b>Email</b>${mail}</div></li>
      </ul></div>
      <div class="card reveal"><div class="icon">${icon('globe')}</div><h3>Social Media</h3>
        ${soc.length ? html`<div class="links">${soc.map(([k, l]) => html`<a href="${c.social[k]}" target="_blank" rel="noopener noreferrer">${l}</a>`)}</div>` : html`<p class="muted">No social media links have been published yet.</p>`}
      </div></div>`;
  }

  register('/about', {
    title: 'About',
    render() {
      const c = S.config;
      return publicLayout(html`
      <div class="page-head"><div class="wrap"><h1>About</h1><p>${c.org_tagline}</p></div></div>
      <section class="section"><div class="wrap prose">
        <h2>ABOUT THE MOVEMENT</h2>${paragraphs(c.org_description)}
        <h2>PURPOSE</h2>${paragraphs(c.about_purpose)}
        <h2>MEMBERSHIP</h2>${paragraphs(c.about_membership)}
        <h2>ORGANIZATIONAL INFORMATION</h2>${paragraphs(c.about_org_info)}
        <div class="btn-row"><a class="btn" href="#/register">REGISTER NOW</a><a class="btn secondary" href="#/contact">CONTACT</a></div>
      </div></section>`, '/about');
    },
  });

  register('/contact', {
    title: 'Contact',
    render() { return publicLayout(html`<div class="page-head"><div class="wrap"><h1>Contact</h1><p>How to reach the organization.</p></div></div><section class="section"><div class="wrap">${contactBlock()}</div></section>`, '/contact'); },
  });

  function renderPolicy(text) {
    const out = []; let buf = [];
    const flush = () => { if (buf.length) { const p = buf.join(' ').trim(); out.push(`<p class="${/\[.*\]/.test(p) ? 'placeholder' : ''}">${esc(p)}</p>`); buf = []; } };
    for (const line of String(text || '').split('\n')) {
      if (/^# /.test(line)) { flush(); out.push(`<h1>${esc(line.slice(2))}</h1>`); }
      else if (/^## /.test(line)) { flush(); out.push(`<h2>${esc(line.slice(3))}</h2>`); }
      else if (!line.trim()) flush(); else buf.push(line.trim());
    }
    flush(); return raw(out.join(''));
  }
  register('/privacy', {
    title: 'Privacy Policy',
    render() { return publicLayout(html`<section class="section"><div class="wrap prose">${renderPolicy(S.config.privacy_policy)}</div></section>`, '/privacy'); },
  });

  /* ---- check registration ---- */
  register('/check', {
    title: 'Check Registration',
    render() {
      return publicLayout(html`
      <div class="page-head"><div class="wrap"><h1>Check Registration</h1><p>Enter your Registration ID to see the status of your registration.</p></div></div>
      <section class="section"><div class="wrap prose">
        <form id="check-form" novalidate>
          <div class="field" id="fld-registration_id"><label for="f-registration_id">Registration ID <span class="req" aria-hidden="true">*</span></label>
            <input id="f-registration_id" name="registration_id" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${S.config.id_prefix}-${new Date().getFullYear()}-000001" aria-describedby="err-registration_id">
            <span class="err" id="err-registration_id" role="alert"></span></div>
          <button class="btn" type="submit">CHECK</button>
        </form>
        <div id="check-result" aria-live="polite"></div>
        <p class="muted small">For privacy, this page shows only your Registration ID, a partly hidden name, the registration date and the status.</p>
      </div></section>`, '/check');
    },
    after() {
      const form = $('#check-form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const out = $('#check-result'); out.innerHTML = ''; setFieldError('registration_id', '');
        const btn = $('button[type=submit]', form); btn.disabled = true;
        try {
          const r = await api('/api/check', { method: 'POST', body: { registration_id: form.registration_id.value } });
          out.innerHTML = html`<div class="result"><dl>
            <div><dt>Registration ID</dt><dd>${r.registration_id}</dd></div><div><dt>Name</dt><dd>${r.name}</dd></div>
            <div><dt>Registration Date</dt><dd>${fmtDate(r.registration_date)}</dd></div>
            <div><dt>Status</dt><dd><span class="badge ${r.status}">${r.status}</span>${r.demo ? html`<span class="badge demo">DEMO DATA</span>` : ''}</dd></div></dl></div>`.s;
        } catch (err) {
          if (err.data && err.data.errors && err.data.errors.registration_id) setFieldError('registration_id', err.data.errors.registration_id);
          else out.innerHTML = html`<div class="notice ${err.status === 404 ? 'warn' : 'danger'}" role="alert">${(err.data && err.data.error) || 'Something went wrong.'}</div>`.s;
        } finally { btn.disabled = false; }
      });
    },
  });
  function setFieldError(name, msg) {
    const f = document.getElementById('fld-' + name); const e = document.getElementById('err-' + name);
    if (!f || !e) return; f.classList.toggle('invalid', !!msg); e.textContent = msg || '';
    const inp = f.querySelector('input,select,textarea'); if (inp) inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  /* ------------------------------------------------------------ registration wizard */
  const STEPS = ['Personal Information', 'Location', 'Identification', 'Review', 'Complete'];
  const STEP_FIELDS = { 1: ['full_name', 'first_name', 'middle_name', 'last_name', 'phone', 'email', 'date_of_birth', 'gender'], 2: ['state', 'lga', 'ward', 'polling_unit'], 3: ['nin', 'passport_photo'], 4: ['consent_accuracy', 'consent_privacy'] };
  const fieldStep = (f) => Number(Object.keys(STEP_FIELDS).find((k) => STEP_FIELDS[k].includes(f)) || 1);
  const newReg = () => ({ step: 1, d: { gender: '' }, photo: null, key: uuid(), busy: false, loc: { lgas: [], wards: [], puHas: false, puItems: [] }, showNin: false });
  let REG = newReg();
  const NAME_RE = /^[\p{L}][\p{L}\p{M}'’.\- ]*$/u;

  function field({ name, label, type = 'text', required = true, hint = '', attrs = '', value }) {
    const v = value !== undefined ? value : REG.d[name] || '';
    return html`<div class="field" id="fld-${name}"><label for="f-${name}">${label}${required ? html` <span class="req" aria-hidden="true">*</span>` : html` <span class="muted small">(optional)</span>`}</label>
      <input id="f-${name}" name="${name}" type="${type}" value="${v}" ${raw(attrs)} aria-describedby="err-${name}${hint ? ' hint-' + name : ''}">
      ${hint ? html`<span class="hint" id="hint-${name}">${hint}</span>` : ''}<span class="err" id="err-${name}" role="alert"></span></div>`;
  }
  const selectField = ({ name, label, options, placeholder, disabled, required = true }) => html`<div class="field" id="fld-${name}"><label for="f-${name}">${label} ${required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>
    <select id="f-${name}" name="${name}" ${disabled ? raw('disabled') : ''} aria-describedby="err-${name}"><option value="">${placeholder}</option>${options.map((o) => html`<option value="${o}" ${REG.d[name] === o ? raw('selected') : ''}>${o}</option>`)}</select>
    <span class="err" id="err-${name}" role="alert"></span></div>`;

  function progress() {
    return html`<ol class="progress" aria-label="Registration progress">${STEPS.map((s, i) => { const n = i + 1; const cls = n < REG.step ? 'done' : n === REG.step ? 'current' : ''; return html`<li class="${cls}" ${n === REG.step ? raw('aria-current="step"') : ''}><i>${n < REG.step ? '✓' : n}</i><span>${s}</span></li>`; })}</ol>`;
  }

  function stepBody() {
    const cfgMin = S.config.min_age; const maxDob = new Date(Date.now() - cfgMin * 365.25 * 86400e3).toISOString().slice(0, 10);
    if (REG.step === 1) return html`<h2 class="step-title">Personal Information</h2>
      ${field({ name: 'full_name', label: 'Full Name', attrs: 'autocomplete="name" autocapitalize="words" maxlength="120"', hint: 'As it appears on your NIN slip or ID.' })}
      <div class="grid2 grid3">${field({ name: 'first_name', label: 'First Name', attrs: 'autocomplete="given-name" autocapitalize="words" maxlength="60"' })}
      ${field({ name: 'middle_name', label: 'Middle Name', required: false, attrs: 'autocomplete="additional-name" autocapitalize="words" maxlength="60"' })}
      ${field({ name: 'last_name', label: 'Last Name', attrs: 'autocomplete="family-name" autocapitalize="words" maxlength="60"' })}</div>
      <div class="grid2">${field({ name: 'phone', label: 'Phone Number', type: 'tel', attrs: 'inputmode="tel" autocomplete="tel" maxlength="20" placeholder="08012345678"' })}
      ${field({ name: 'email', label: 'Email Address', type: 'email', required: false, attrs: 'inputmode="email" autocomplete="email" maxlength="120" autocapitalize="none"' })}</div>
      <div class="grid2">${field({ name: 'date_of_birth', label: 'Date of Birth', type: 'date', attrs: `max="${maxDob}" min="1910-01-01" autocomplete="bday"`, hint: `You must be at least ${cfgMin} years old.` })}
      <div class="field" id="fld-gender"><span class="lbl" id="lbl-gender">Gender <span class="req" aria-hidden="true">*</span></span>
        <div class="choice" role="radiogroup" aria-labelledby="lbl-gender" aria-describedby="err-gender">${['Male', 'Female'].map((g) => html`<label><input type="radio" name="gender" value="${g}" ${REG.d.gender === g ? raw('checked') : ''}><span>${g}</span></label>`)}</div>
        <span class="err" id="err-gender" role="alert"></span></div></div>`;
    if (REG.step === 2) return step2();
    if (REG.step === 3) return html`<h2 class="step-title">Identification</h2>
      <div class="notice"><b>Why we ask for this</b>Your NIN and passport photograph are collected so the organization can identify you and avoid duplicate registrations. The NIN is encrypted when stored and is never shown publicly. See the <a href="#/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</div>
      <div class="field" id="fld-nin"><label for="f-nin">NIN Identification Number <span class="req" aria-hidden="true">*</span></label>
        <div class="with-btn"><input id="f-nin" name="nin" type="text" class="mask-input${REG.showNin ? ' show' : ''}" inputmode="numeric" pattern="[0-9]*" maxlength="11" autocomplete="off" autocorrect="off" spellcheck="false" value="${REG.d.nin || ''}" aria-describedby="err-nin hint-nin">
        <button class="btn secondary sm" type="button" data-reg="toggle-nin">${REG.showNin ? 'Hide' : 'Show'}</button></div>
        <span class="hint" id="hint-nin">11 digits. This portal records your NIN as entered and does not verify it against any national database.</span><span class="err" id="err-nin" role="alert"></span></div>
      <div class="field" id="fld-passport_photo"><span class="lbl">Passport Photograph <span class="req" aria-hidden="true">*</span></span>
        <div class="photo-box">
          ${REG.photo ? html`<img src="${REG.photo.dataUrl}" alt="Preview of your passport photograph"><p class="small muted">Optimised to ${Math.round(REG.photo.size / 1024)} KB</p>` : html`<p class="muted">Use a clear, recent, front-facing photo with a plain background. JPG, JPEG or PNG, up to ${S.config.max_passport_kb} KB (larger photos are shrunk automatically).</p>`}
          <div class="btn-row"><label class="btn secondary" for="photo-gallery">${REG.photo ? 'Change photo' : 'Choose photo'}</label><label class="btn secondary" for="photo-camera">Take photo</label>${REG.photo ? html`<button class="btn secondary" type="button" data-reg="remove-photo">Remove</button>` : ''}</div>
          <input id="photo-gallery" type="file" accept="image/jpeg,image/png" data-photo>
          <input id="photo-camera" type="file" accept="image/*" capture="user" data-photo>
        </div><span class="err" id="err-passport_photo" role="alert"></span></div>`;
    if (REG.step === 4) return review();
    return html``;
  }

  function step2() {
    const L = REG.loc; const d = REG.d; const strict = S.config.strict_locations;
    const unavailable = (name, label, why) => html`<div class="field" id="fld-${name}"><label for="f-${name}">${label} <span class="req" aria-hidden="true">*</span></label><select id="f-${name}" name="${name}" disabled aria-describedby="err-${name} hint-${name}"><option value="">${why}</option></select><span class="hint" id="hint-${name}">The official list is not available yet. Please try again later.</span><span class="err" id="err-${name}" role="alert"></span></div>`;
    const lgaField = !d.state ? selectField({ name: 'lga', label: 'Local Government Area', options: [], placeholder: 'Select your State first', disabled: true })
      : L.lgas.length ? selectField({ name: 'lga', label: 'Local Government Area', options: L.lgas, placeholder: 'Select your Local Government Area' })
      : strict ? unavailable('lga', 'Local Government Area', 'Not available yet')
      : field({ name: 'lga', label: 'Local Government Area', attrs: 'maxlength="80" autocapitalize="words"', hint: 'The official list for this State has not been loaded yet. Please type your Local Government Area.' });
    const wardField = !d.lga ? selectField({ name: 'ward', label: 'Ward', options: [], placeholder: 'Select your Local Government Area first', disabled: true })
      : L.wards.length ? selectField({ name: 'ward', label: 'Ward', options: L.wards, placeholder: 'Select your Ward' })
      : strict ? unavailable('ward', 'Ward', 'Not available yet')
      : field({ name: 'ward', label: 'Ward', attrs: 'maxlength="80" autocapitalize="words"', hint: 'The official Ward list is not available yet. Please type your Ward.' });
    const puField = !d.ward ? selectField({ name: 'polling_unit', label: 'Polling Unit', options: [], placeholder: 'Select your Ward first', disabled: true })
      : L.puHas ? selectField({ name: 'polling_unit', label: 'Polling Unit', options: L.puItems, placeholder: 'Select your Polling Unit' })
      : strict ? unavailable('polling_unit', 'Polling Unit', 'Not available yet')
      : field({ name: 'polling_unit', label: 'Polling Unit', attrs: 'maxlength="160" autocomplete="off"', hint: 'The official Polling Unit list is not available yet. Please type your Polling Unit.' });
    return html`<h2 class="step-title">Location</h2>
      ${selectField({ name: 'state', label: 'State', options: S.states, placeholder: 'Select your State' })}
      ${lgaField}${wardField}${puField}`;
  }

  function review() {
    const d = REG.d;
    const row = (k, v) => html`<div><dt>${k}</dt><dd>${v || html`<span class="muted">Not provided</span>`}</dd></div>`;
    const nin = d.nin ? '*******' + d.nin.slice(-4) : '';
    return html`<h2 class="step-title">Review your information</h2><p class="muted">Please check everything carefully before you submit.</p>
      <div class="review">
        <section><h3>Personal Information <button type="button" data-goto="1">Edit</button></h3><dl>${row('Full Name', d.full_name)}${row('First Name', d.first_name)}${row('Middle Name', d.middle_name)}${row('Last Name', d.last_name)}${row('Phone Number', d.phone)}${row('Email Address', d.email)}${row('Date of Birth', fmtDate(d.date_of_birth))}${row('Gender', d.gender)}</dl></section>
        <section><h3>Location <button type="button" data-goto="2">Edit</button></h3><dl>${row('State', d.state)}${row('Local Government Area', d.lga)}${row('Ward', d.ward)}${row('Polling Unit', d.polling_unit)}</dl></section>
        <section><h3>Identification <button type="button" data-goto="3">Edit</button></h3><dl>${row('NIN (partly hidden)', nin)}${row('Passport Photograph', REG.photo ? html`<img src="${REG.photo.dataUrl}" alt="Your passport photograph">` : '')}</dl></section>
      </div>
      <div class="field" id="fld-consent_accuracy"><label class="check"><input type="checkbox" name="consent_accuracy" ${d.consent_accuracy ? raw('checked') : ''} aria-describedby="err-consent_accuracy"><span>I confirm that the information provided is accurate and that I consent to the processing of my information for membership registration purposes.</span></label><span class="err" id="err-consent_accuracy" role="alert"></span></div>
      <div class="field" id="fld-consent_privacy"><label class="check"><input type="checkbox" name="consent_privacy" ${d.consent_privacy ? raw('checked') : ''} aria-describedby="err-consent_privacy"><span>I agree to the <a href="#/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label><span class="err" id="err-consent_privacy" role="alert"></span></div>`;
  }

  function actions() {
    if (REG.step === 4) return html`<div class="step-actions"><button class="btn secondary" type="button" data-reg="back">Back</button><button class="btn" type="button" data-reg="submit" id="submit-btn">${REG.busy ? html`<span class="spinner"></span> Submitting…` : 'SUBMIT REGISTRATION'}</button></div>`;
    return html`<div class="step-actions">${REG.step > 1 ? html`<button class="btn secondary" type="button" data-reg="back">Back</button>` : ''}<button class="btn" type="button" data-reg="next">Continue</button></div>`;
  }

  function drawStep() {
    $('#reg-progress').innerHTML = progress().s;
    $('#reg-body').innerHTML = stepBody().s;
    $('#reg-actions').innerHTML = actions().s;
    $('#reg-summary').className = 'error-summary'; $('#reg-summary').innerHTML = '';
  }

  register('/register', {
    title: 'Register',
    render() {
      const c = S.config;
      if (!c.registration_open) return publicLayout(html`<div class="page-head"><div class="wrap"><h1>Membership Registration</h1></div></div><section class="section"><div class="wrap prose"><div class="notice warn"><b>Registration is currently closed</b>Please check back later or see the <a href="#/contact">Contact</a> page.</div></div></section>`, '/register');
      return publicLayout(html`
        <div class="page-head"><div class="wrap"><h1>Membership Registration</h1><p>Complete the form below. Fields marked <span class="req" aria-hidden="true">*</span> are required.</p></div></div>
        <section class="section"><div class="wrap" ><div class="form-card" id="reg-card">
          <div id="reg-progress"></div>
          <div id="reg-summary" class="error-summary" role="alert" tabindex="-1"></div>
          <form id="reg-form" novalidate autocomplete="off"><div id="reg-body"></div><div id="reg-actions"></div></form>
        </div></div></section>`, '/register');
    },
    async after() {
      if (!S.config.registration_open) return;
      if (!S.states) S.states = (await api('/api/locations/states')).states;
      drawStep();
    },
  });

  /* ---- validation (mirrors the server; the server is the authority) ---- */
  function validateStep(step) {
    const d = REG.d; const e = {}; const n = (s) => String(s || '').trim();
    if (step === 1) {
      const nameOk = (v, max = 60) => v.length >= 2 && v.length <= max && NAME_RE.test(v);
      if (!n(d.full_name)) e.full_name = 'Please enter your full name.'; else if (!nameOk(n(d.full_name), 120)) e.full_name = 'Please enter a valid full name using letters only.';
      if (!n(d.first_name)) e.first_name = 'Please enter your first name.'; else if (!nameOk(n(d.first_name))) e.first_name = 'Please enter a valid first name using letters only.';
      if (n(d.middle_name) && !nameOk(n(d.middle_name))) e.middle_name = 'Please enter a valid middle name using letters only, or leave it blank.';
      if (!n(d.last_name)) e.last_name = 'Please enter your last name.'; else if (!nameOk(n(d.last_name))) e.last_name = 'Please enter a valid last name using letters only.';
      if (!e.full_name && !e.first_name && !e.last_name) { const l = n(d.full_name).toLowerCase(); if (!l.includes(n(d.first_name).toLowerCase()) || !l.includes(n(d.last_name).toLowerCase())) e.full_name = 'Your full name should include your first name and last name.'; }
      let ph = n(d.phone).replace(/[\s\-().]/g, ''); if (ph.startsWith('+234')) ph = '0' + ph.slice(4); else if (ph.startsWith('234') && ph.length === 13) ph = '0' + ph.slice(3);
      if (!n(d.phone)) e.phone = 'Please enter your phone number.'; else if (!/^0[789][01]\d{8}$/.test(ph)) e.phone = 'Please enter a valid Nigerian phone number, for example 08012345678.';
      if (n(d.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(n(d.email))) e.email = 'Please enter a valid email address, or leave it blank.';
      if (!n(d.date_of_birth)) e.date_of_birth = 'Please enter your date of birth.';
      else { const dob = new Date(d.date_of_birth + 'T00:00:00Z'); const now = new Date(); let age = now.getUTCFullYear() - dob.getUTCFullYear(); if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age--;
        if (isNaN(dob)) e.date_of_birth = 'Please enter a valid date of birth.'; else if (dob > now) e.date_of_birth = 'Date of birth cannot be in the future.'; else if (age < S.config.min_age) e.date_of_birth = `You must be at least ${S.config.min_age} years old to register.`; else if (age > 110) e.date_of_birth = 'Please enter a valid date of birth.'; }
      if (!d.gender) e.gender = 'Please select your gender.';
    }
    if (step === 2) {
      if (!d.state) e.state = 'Please select your State.';
      if (d.state && !n(d.lga)) e.lga = 'Please select your Local Government Area.';
      if (d.lga && !n(d.ward)) e.ward = 'Please select your Ward.';
      if (d.ward && !n(d.polling_unit)) e.polling_unit = 'Please select your Polling Unit.';
      if (d.ward && REG.loc.puHas && n(d.polling_unit) && !REG.loc.puItems.some((p) => p.toLowerCase() === n(d.polling_unit).toLowerCase())) e.polling_unit = 'Please select your Polling Unit from the list.';
      if (S.config.strict_locations && ((d.state && !REG.loc.lgas.length) || (d.lga && !REG.loc.wards.length) || (d.ward && !REG.loc.puHas))) e.state = e.state || 'The official location list for your selection is not available yet.';
    }
    if (step === 3) {
      const nin = String(d.nin || '').replace(/[\s-]/g, '');
      if (!nin) e.nin = 'Please enter your NIN.'; else if (!/^\d{11}$/.test(nin)) e.nin = 'Your NIN must be exactly 11 digits.';
      if (!REG.photo) e.passport_photo = 'Please upload a passport photograph.';
    }
    if (step === 4) {
      if (!d.consent_accuracy) e.consent_accuracy = 'Please confirm that your information is accurate and that you consent to its processing.';
      if (!d.consent_privacy) e.consent_privacy = 'Please agree to the Privacy Policy.';
    }
    return e;
  }
  function showErrors(errs) {
    $$('.field.invalid').forEach((f) => f.classList.remove('invalid'));
    $$('.err').forEach((x) => { x.textContent = ''; });
    const keys = Object.keys(errs); const sum = $('#reg-summary');
    keys.forEach((k) => setFieldError(k, errs[k]));
    if (keys.length) {
      sum.className = 'error-summary show notice danger';
      sum.innerHTML = html`<b>Please fix the following:</b><ul>${keys.map((k) => html`<li><a href="#" data-focus="${k}">${errs[k]}</a></li>`)}</ul>`.s;
      const first = document.querySelector(`#fld-${keys[0]} input, #fld-${keys[0]} select`);
      if (first) first.focus({ preventScroll: false });
    } else { sum.className = 'error-summary'; sum.innerHTML = ''; }
  }

  /* ---- location loading ---- */
  async function loadLgas() { REG.loc.lgas = REG.d.state ? (await api('/api/locations/lgas?state=' + encodeURIComponent(REG.d.state))).items : []; REG.loc.wards = []; REG.loc.puHas = false; REG.loc.puItems = []; }
  async function loadWards() { REG.loc.wards = REG.d.lga ? (await api(`/api/locations/wards?state=${encodeURIComponent(REG.d.state)}&lga=${encodeURIComponent(REG.d.lga)}`)).items : []; REG.loc.puHas = false; REG.loc.puItems = []; }
  async function loadPus() {
    if (!REG.d.ward) { REG.loc.puHas = false; REG.loc.puItems = []; return; }
    const r = await api(`/api/locations/polling-units?state=${encodeURIComponent(REG.d.state)}&lga=${encodeURIComponent(REG.d.lga)}&ward=${encodeURIComponent(REG.d.ward)}`);
    REG.loc.puHas = r.has_data; REG.loc.puItems = r.items;
  }

  /* ---- photo ---- */
  function loadImage(file) {
    return new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad')); }; img.src = url; });
  }
  const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
  async function compressPhoto(file) {
    const max = S.config.max_passport_kb * 1024; const img = await loadImage(file);
    let scale = Math.min(1, 900 / img.naturalWidth, 1200 / img.naturalHeight);
    for (let attempt = 0; attempt < 6; attempt++) {
      const w = Math.max(60, Math.round(img.naturalWidth * scale)); const h = Math.max(60, Math.round(img.naturalHeight * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) { const b = await toBlob(cv, q); if (b && b.size <= max * 0.92) return b; }
      scale *= 0.8;
    }
    throw new Error('toolarge');
  }
  const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  async function handlePhoto(file) {
    setFieldError('passport_photo', '');
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) { setFieldError('passport_photo', 'Please upload a JPG, JPEG or PNG image.'); return; }
    if (file.size > 25 * 1024 * 1024) { setFieldError('passport_photo', 'That file is too large. Please choose a smaller photo.'); return; }
    try { const blob = await compressPhoto(file); REG.photo = { dataUrl: await blobToDataUrl(blob), size: blob.size }; drawStep(); }
    catch (e) { setFieldError('passport_photo', e.message === 'toolarge' ? `Your photograph is too large. The maximum size is ${S.config.max_passport_kb} KB.` : 'That image could not be read. Please choose a different photo.'); }
  }

  /* ---- submit ---- */
  async function submitRegistration() {
    if (REG.busy) return;
    for (const s of [1, 2, 3, 4]) { const e = validateStep(s); if (Object.keys(e).length) { REG.step = s; drawStep(); showErrors(e); return; } }
    REG.busy = true; $('#reg-actions').innerHTML = actions().s;
    const d = REG.d;
    try {
      const r = await api('/api/register', { method: 'POST', body: { ...d, nin: String(d.nin).replace(/[\s-]/g, ''), passport_photo: { data: REG.photo.dataUrl }, consent_accuracy: !!d.consent_accuracy, consent_privacy: !!d.consent_privacy, idempotency_key: REG.key } });
      // The applicant's own device keeps the photo for this browser tab only (the stored copy on the server is private and encrypted).
      try { sessionStorage.setItem('aynm_done', JSON.stringify({ id: r.registration_id, name: r.full_name, date: r.registration_date, status: r.status, phone: r.phone, state: r.state, lga: r.lga, ward: r.ward, pu: r.polling_unit, photo: REG.photo.dataUrl })); }
      catch { sessionStorage.setItem('aynm_done', JSON.stringify({ id: r.registration_id, name: r.full_name, date: r.registration_date, status: r.status, phone: r.phone, state: r.state, lga: r.lga, ward: r.ward, pu: r.polling_unit })); }
      REG = newReg(); // wipes NIN, photo and personal data from memory
      location.hash = '#/success';
    } catch (err) {
      REG.busy = false; $('#reg-actions').innerHTML = actions().s;
      const errs = err.data && err.data.errors;
      if (errs && Object.keys(errs).length) { const first = Math.min(...Object.keys(errs).map(fieldStep)); REG.step = first; drawStep(); showErrors(errs); }
      else { const sum = $('#reg-summary'); sum.className = 'error-summary show notice danger'; sum.innerHTML = html`<b>Your registration was not submitted</b>${(err.data && err.data.error) || 'Please try again.'} Your information has been kept, so you can tap Submit again.`.s; sum.focus(); }
    }
  }

  /* ---- success ---- */
  register('/success', {
    title: 'Registration Successful',
    render() {
      let r = null; try { r = JSON.parse(sessionStorage.getItem('aynm_done') || 'null'); } catch { /* */ }
      if (!r) { location.hash = '#/'; return html``; }
      const c = S.config;
      const row = (k, v) => html`<div><dt>${k}</dt><dd>${v || '—'}</dd></div>`;
      return publicLayout(html`
      <div class="page-head no-print"><div class="wrap"><h1>Registration Successful</h1></div></div>
      <section class="section"><div class="wrap">
        <div class="success-top no-print"><div class="check-circle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div>
          <p class="success-msg"><b>Your membership registration has been received.</b></p>
          <p class="muted small">Keep your Registration ID safe. You will need it to check the status of your registration.</p></div>
        <article class="member-card" id="member-card" aria-label="Registration confirmation">
          <header class="mc-head">${logoEl('mc-logo')}<div><b>${c.org_name}</b><span>Membership Registration Confirmation</span></div></header>
          <div class="mc-body">
            <div class="mc-photo">${r.photo ? html`<img src="${r.photo}" alt="Passport photograph of ${r.name}">` : html`<div class="mc-nophoto">Photo</div>`}</div>
            <div class="mc-main">
              <h2 class="mc-name">${r.name}</h2>
              <p class="mc-id-label">Registration ID</p>
              <div class="reg-id" id="reg-id">${r.id}</div>
              <span class="badge ${r.status}">${r.status}</span> <span class="small muted">Awaiting review by the administrators</span>
            </div>
          </div>
          <dl class="mc-details">${row('Phone number', r.phone)}${row('State', r.state)}${row('Local Government', r.lga)}${row('Ward', r.ward)}${row('Polling Unit', r.pu)}${row('Registration date', fmtDate(r.date))}</dl>
          <footer class="mc-foot">This confirmation shows that a registration was received. It is not proof of membership approval. Check the status at any time with your Registration ID.</footer>
        </article>
        <div class="btn-row no-print mc-actions"><button class="btn" type="button" data-action="copy-id">Copy Registration ID</button><button class="btn secondary" type="button" data-action="print">Print / Save as PDF</button><a class="btn secondary" href="#/">Return to Homepage</a></div>
        <p class="small muted center no-print">To save a PDF, choose “Save as PDF” as the printer in the print window.</p>
      </div></section>`, '/success');
    },
  });

  /* ------------------------------------------------------------ global events */
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action],[data-reg],[data-goto],[data-focus]'); if (!t) return;
    if (t.dataset.action === 'toggle-nav') { const nav = $('#site-nav'); const open = nav.classList.toggle('open'); t.setAttribute('aria-expanded', String(open)); return; }
    if (t.dataset.action === 'copy-id') { const ok = await copyText($('#reg-id').textContent.trim()); toast(ok ? 'Registration ID copied' : 'Could not copy. Please copy it manually.', !ok); return; }
    if (t.dataset.action === 'print') { window.print(); return; }
    if (t.dataset.focus) { e.preventDefault(); const el = document.querySelector(`#fld-${t.dataset.focus} input, #fld-${t.dataset.focus} select`); if (el) el.focus(); return; }
    if (t.dataset.goto) { REG.step = Number(t.dataset.goto); drawStep(); window.scrollTo(0, 0); return; }
    const a = t.dataset.reg; if (!a) return;
    if (a === 'toggle-nin') { REG.showNin = !REG.showNin; const inp = $('#f-nin'); inp.classList.toggle('show', REG.showNin); t.textContent = REG.showNin ? 'Hide' : 'Show'; return; }
    if (a === 'remove-photo') { REG.photo = null; drawStep(); return; }
    if (a === 'back') { REG.step = Math.max(1, REG.step - 1); drawStep(); window.scrollTo(0, 0); return; }
    if (a === 'next') {
      const errs = validateStep(REG.step); showErrors(errs);
      if (Object.keys(errs).length) return;
      REG.step += 1; drawStep(); window.scrollTo(0, 0); const h = $('.step-title'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } return;
    }
    if (a === 'submit') { submitRegistration(); }
  });
  document.addEventListener('submit', (e) => { if (e.target.id === 'reg-form') { e.preventDefault(); const b = $('[data-reg=next],[data-reg=submit]'); if (b) b.click(); } });
  document.addEventListener('input', (e) => {
    const t = e.target; if (!t.closest || !t.closest('#reg-form')) return;
    if (t.name === 'nin') { t.value = t.value.replace(/\D/g, '').slice(0, 11); }
    if (t.type === 'checkbox') REG.d[t.name] = t.checked; else if (t.name) REG.d[t.name] = t.value;
    const fld = t.name && document.getElementById('fld-' + t.name);
    if (fld && fld.classList.contains('invalid') && !validateStep(REG.step)[t.name]) setFieldError(t.name, '');
  });
  document.addEventListener('focusout', (e) => {
    const t = e.target; if (!t.closest || !t.closest('#reg-form')) return;
    if (t.name === 'full_name') {
      const parts = t.value.trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2 && !REG.d.first_name && !REG.d.last_name) {
        REG.d.first_name = parts[0]; REG.d.last_name = parts[parts.length - 1]; REG.d.middle_name = parts.slice(1, -1).join(' ');
        for (const k of ['first_name', 'middle_name', 'last_name']) { const i = $(`#f-${k}`); if (i) i.value = REG.d[k]; }
      }
    }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target; if (!t.closest) return;
    if (t.matches('[data-photo]')) { await handlePhoto(t.files && t.files[0]); t.value = ''; return; }
    if (!t.closest('#reg-form')) return;
    if (t.type === 'radio') { REG.d[t.name] = t.value; setFieldError('gender', ''); return; }
    if (t.type === 'checkbox') { REG.d[t.name] = t.checked; if (t.checked) setFieldError(t.name, ''); return; }
    try {
      if (t.name === 'state') { REG.d.state = t.value; REG.d.lga = ''; REG.d.ward = ''; REG.d.polling_unit = ''; await loadLgas(); drawStep2(); }
      else if (t.name === 'polling_unit') { REG.d.polling_unit = t.value; setFieldError('polling_unit', ''); }
      else if (t.name === 'lga' && t.tagName === 'SELECT') { REG.d.lga = t.value; REG.d.ward = ''; REG.d.polling_unit = ''; await loadWards(); drawStep2(); }
      else if (t.name === 'ward' && t.tagName === 'SELECT') { REG.d.ward = t.value; REG.d.polling_unit = ''; await loadPus(''); drawStep2(); }
      else if (t.name === 'lga') { REG.d.lga = t.value.trim(); await loadWards(); drawStep2(true); }
      else if (t.name === 'ward') { REG.d.ward = t.value.trim(); await loadPus(''); drawStep2(true); }
    } catch { toast('Could not load locations. Please check your connection.', true); }
  });
  function drawStep2(keepFocus) {
    const active = document.activeElement && document.activeElement.name;
    $('#reg-body').innerHTML = stepBody().s;
    if (keepFocus && active) { const order = { lga: 'ward', ward: 'polling_unit' }; const el = $(`#f-${order[active] || active}`); if (el && !el.disabled) el.focus(); }
  }

  /* ------------------------------------------------------------ boot */
  window.AYNM = {
    html, raw, esc, $, $$, S, api, toast, fmtDate, fmtDateTime, icon, register, render, applyConfig, setFieldError, copyText, logoEl, brandText, initials,
    start() { window.addEventListener('hashchange', render); render(); },
  };
})();
