'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cfg = require('./lib/config');
const { db, tx, iso, lagosDate, lagosYear, STATES, getSettings, setSetting, DEFAULTS, loc, audit, PERMISSIONS, DEFAULT_ADMIN_PERMS, parsePerms, hasPerm } = require('./lib/db');
const sec = require('./lib/crypto');
const rl = require('./lib/ratelimit');
const mailer = require('./lib/mailer');
const locs = require('./lib/locations');
const { validateMember, decodeImage, maskNin, maskName, norm } = require('./lib/validate');

let sharp = null;
try { sharp = require('sharp'); } catch { /* optional: images are still validated and re-compressed by the browser */ }

const PUBLIC_DIR = path.join(cfg.root, 'public');
const COOKIE = cfg.cookieSecure ? '__Host-aynm_sid' : 'aynm_sid';
const IDLE_MS = 2 * 3600e3;
const ABS_MS = 12 * 3600e3;
const LAGOS = '+1 hours'; // Africa/Lagos has no DST

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; } }

/* ------------------------------------------------------------------ helpers */
function json(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'The submitted data is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); }
      catch { reject(new HttpError(400, 'Invalid request.')); }
    });
    req.on('error', reject);
  });
}
function clientIp(req) {
  if (cfg.trustProxy) { const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (x) return x; }
  return req.socket.remoteAddress || 'unknown';
}
function parseCookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
  return out;
}
function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (cfg.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function setCookie(res, value, maxAgeSec) {
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${cfg.cookieSecure ? '; Secure' : ''}`);
}
const requireStr = (v, name) => { if (typeof v !== 'string' || !v) throw new HttpError(400, `${name} is required.`); return v; };

/* ------------------------------------------------------------------ sessions */
function createSession(adminId, req) {
  const raw = sec.randomToken(32);
  const csrf = sec.randomToken(24);
  const now = Date.now();
  db.prepare('INSERT INTO sessions(id_hash,admin_id,csrf_token,created_at,last_seen_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?,?,?)')
    .run(sec.sha256(raw), adminId, csrf, iso(now), iso(now), iso(now + ABS_MS), clientIp(req), String(req.headers['user-agent'] || '').slice(0, 200));
  return { raw, csrf };
}
function getSession(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const row = db.prepare(`SELECT s.*, a.email, a.name, a.role, a.permissions, a.is_active FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.id_hash=?`).get(sec.sha256(raw));
  if (!row) return null;
  const now = Date.now();
  if (!row.is_active || Date.parse(row.expires_at) < now || Date.parse(row.last_seen_at) < now - IDLE_MS) {
    db.prepare('DELETE FROM sessions WHERE id_hash=?').run(row.id_hash);
    return null;
  }
  if (now - Date.parse(row.last_seen_at) > 60e3) db.prepare('UPDATE sessions SET last_seen_at=? WHERE id_hash=?').run(iso(now), row.id_hash);
  return { hash: row.id_hash, csrf: row.csrf_token, admin: { id: row.admin_id, email: row.email, name: row.name, role: row.role, permissions: row.role === 'super_admin' ? Object.keys(PERMISSIONS) : parsePerms(row.permissions) } };
}
const adminOut = (a) => ({ email: a.email, name: a.name, role: a.role, permissions: a.role === 'super_admin' ? Object.keys(PERMISSIONS) : (Array.isArray(a.permissions) ? a.permissions : parsePerms(a.permissions)) });
const destroyAdminSessions = (adminId) => db.prepare('DELETE FROM sessions WHERE admin_id=?').run(adminId);
setInterval(() => { try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(iso()); db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(iso(Date.now() - 86400e3)); } catch { /* */ } }, 3600e3).unref();

/* ------------------------------------------------------------------ photo storage */
async function processPhoto(buf, mime) {
  if (sharp) {
    try { return { buf: await sharp(buf).rotate().resize({ width: 900, height: 1200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(), mime: 'image/jpeg' }; }
    catch { throw new HttpError(422, 'That image could not be read.', { errors: { passport_photo: 'That image could not be read. Please upload a different JPG or PNG photograph.' } }); }
  }
  return { buf, mime };
}
function storePhoto(buf) {
  const name = crypto.randomUUID() + '.bin';
  fs.writeFileSync(path.join(cfg.photoDir, name), sec.encrypt(buf), { mode: 0o600 });
  return name;
}
function removePhoto(name) { if (name && /^[0-9a-f-]{36}\.bin$/.test(name)) { try { fs.unlinkSync(path.join(cfg.photoDir, name)); } catch { /* */ } } }

/* ------------------------------------------------------------------ members */
const MEMBER_LIST_COLS = 'id, registration_id, full_name, phone, email, gender, state, lga, ward, polling_unit, status, registration_date, created_at, is_demo, nin_last4, passport_photo IS NOT NULL AS has_photo';
function memberOut(r) {
  const { nin_last4, has_photo, ...rest } = r;
  return { ...rest, is_demo: !!r.is_demo, nin_masked: maskNin(nin_last4), has_photo: !!has_photo };
}
const REG_COLS = 'SELECT registration_id, full_name, registration_date, status, phone, state, lga, ward, polling_unit FROM members';
// What the applicant gets back about their own registration. Never includes the NIN or the date of birth.
const regOut = (r) => ({ registration_id: r.registration_id, full_name: r.full_name, registration_date: r.registration_date, status: r.status, phone: r.phone, state: r.state, lga: r.lga, ward: r.ward, polling_unit: r.polling_unit });
function nextRegistrationId() {
  const year = lagosYear();
  const prefix = /^[A-Z0-9]{2,10}$/.test(getSettings().id_prefix) ? getSettings().id_prefix : 'AYNM';
  const row = db.prepare('SELECT last_seq FROM registration_counters WHERE year=?').get(year);
  const seq = (row ? row.last_seq : 0) + 1;
  db.prepare('INSERT INTO registration_counters(year,last_seq) VALUES(?,?) ON CONFLICT(year) DO UPDATE SET last_seq=excluded.last_seq').run(year, seq);
  return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
}
function buildWhere(q) {
  const w = []; const p = [];
  const like = (s) => '%' + String(s).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  if (q.q) { const l = like(norm(q.q)); w.push("(full_name LIKE ? ESCAPE '\\' OR registration_id LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')"); p.push(l, l, l, l); }
  for (const f of ['state', 'lga', 'ward']) if (q[f]) { w.push(`${f} = ? COLLATE NOCASE`); p.push(norm(q[f])); }
  if (q.polling_unit) { w.push("polling_unit LIKE ? ESCAPE '\\'"); p.push(like(norm(q.polling_unit))); }
  if (['Pending', 'Approved', 'Rejected'].includes(q.status)) { w.push('status = ?'); p.push(q.status); }
  if (q.demo === 'hide') w.push('is_demo = 0'); else if (q.demo === 'only') w.push('is_demo = 1');
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p };
}
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return '"' + s.replace(/"/g, '""') + '"';
};

/* ------------------------------------------------------------------ routes */
const routes = [];
const route = (method, pattern, opts, handler) => {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts, handler });
};

/* ---- public ---- */
route('GET', '/api/config', (c) => {
  const s = getSettings();
  const open = s.registration_open === '1';
  return c.json(200, {
    org_name: s.org_name, org_tagline: s.org_tagline, org_description: s.org_description,
    about_purpose: s.about_purpose, about_membership: s.about_membership, about_org_info: s.about_org_info,
    phone: s.phone, email: s.email, address: s.address,
    social: { facebook: s.social_facebook, x: s.social_x, instagram: s.social_instagram, whatsapp: s.social_whatsapp, youtube: s.social_youtube },
    registration_open: open, id_prefix: s.id_prefix, max_passport_kb: parseInt(s.max_passport_kb, 10), min_age: parseInt(s.min_age, 10),
    colors: { primary: s.color_primary, accent: s.color_accent, dark: s.color_dark },
    logo_url: s.logo_file ? '/assets/' + s.logo_file : '/assets/logo-192.png', logo_large_url: s.logo_file ? '/assets/' + s.logo_file : '/assets/logo-512.png', strict_locations: s.strict_locations === '1', privacy_policy: s.privacy_policy,
  });
});
route('GET', '/api/locations/states', (c) => c.json(200, { states: STATES }));
route('GET', '/api/locations/lgas', (c) => c.json(200, { items: STATES.includes(c.query.state) ? loc.lgas(c.query.state) : [] }));
route('GET', '/api/locations/wards', (c) => c.json(200, { items: STATES.includes(c.query.state) ? loc.wards(c.query.state, norm(c.query.lga)) : [] }));
route('GET', '/api/locations/polling-units', (c) => {
  const r = rl.hit('pu:' + c.ip, 120, 60e3);
  if (!r.ok) throw new HttpError(429, 'Too many requests. Please slow down.');
  const { state, lga, ward, q } = c.query;
  if (!STATES.includes(state)) return c.json(200, { items: [], has_data: false });
  const items = loc.pus(state, norm(lga), norm(ward), norm(q).slice(0, 60), 1000);
  const has = items.length > 0 || loc.pus(state, norm(lga), norm(ward), '', 1).length > 0;
  return c.json(200, { items, has_data: has });
});

route('POST', '/api/register', { limit: 4e6 }, async (c) => {
  const lim = rl.hit('reg:' + c.ip, parseInt(process.env.RATE_REGISTER_PER_HOUR || '10', 10), 3600e3);
  if (!lim.ok) throw new HttpError(429, 'Too many registration attempts. Please try again later.', { retry_after: lim.retryAfter });
  const settings = getSettings();
  if (settings.registration_open !== '1') throw new HttpError(403, 'Registration is currently closed.');

  const idem = typeof c.body.idempotency_key === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(c.body.idempotency_key) ? c.body.idempotency_key : null;
  if (idem) {
    const ex = db.prepare(REG_COLS + ' WHERE idempotency_key=?').get(idem);
    if (ex) return c.json(200, { ...regOut(ex), duplicate_submission: true });
  }
  const { errors, clean } = validateMember(c.body, { settings, mode: 'create' });
  if (Object.keys(errors).length) throw new HttpError(422, 'Please correct the highlighted fields.', { errors });

  const ninHash = sec.hmacNin(clean.nin);
  if (db.prepare('SELECT 1 FROM members WHERE nin_hash=?').get(ninHash)) {
    throw new HttpError(409, 'A registration already exists for this NIN.', { errors: { nin: 'A registration already exists for this NIN. If you have your Registration ID, use Check Registration.' } });
  }
  const photo = await processPhoto(clean.photo.buf, clean.photo.mime);
  const photoName = storePhoto(photo.buf);
  try {
    const now = iso();
    const result = tx(() => {
      if (db.prepare('SELECT 1 FROM members WHERE nin_hash=?').get(ninHash)) throw new HttpError(409, 'duplicate', { errors: { nin: 'A registration already exists for this NIN. If you have your Registration ID, use Check Registration.' } });
      const rid = nextRegistrationId();
      db.prepare(`INSERT INTO members(registration_id,full_name,first_name,middle_name,last_name,phone,email,date_of_birth,gender,state,lga,ward,polling_unit,
        nin_encrypted,nin_last4,nin_hash,passport_photo,registration_date,status,consent_at,is_demo,idempotency_key,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Pending', ?,0,?,?,?)`)
        .run(rid, clean.full_name, clean.first_name, clean.middle_name || null, clean.last_name, clean.phone, clean.email || null, clean.date_of_birth, clean.gender,
          clean.state, clean.lga, clean.ward, clean.polling_unit, sec.encrypt(Buffer.from(clean.nin)), clean.nin.slice(-4), ninHash, photoName, lagosDate(), now, idem, now, now);
      return regOut({ registration_id: rid, full_name: clean.full_name, registration_date: lagosDate(), status: 'Pending', phone: clean.phone, state: clean.state, lga: clean.lga, ward: clean.ward, polling_unit: clean.polling_unit });
    });
    return c.json(201, result);
  } catch (err) {
    removePhoto(photoName);
    if (String(err.message).includes('UNIQUE') && idem) {
      const ex = db.prepare(REG_COLS + ' WHERE idempotency_key=?').get(idem);
      if (ex) return c.json(200, { ...regOut(ex), duplicate_submission: true });
    }
    throw err;
  }
});

route('POST', '/api/check', (c) => {
  const lim = rl.hit('chk:' + c.ip, 30, 600e3);
  if (!lim.ok) throw new HttpError(429, 'Too many lookups. Please try again later.', { retry_after: lim.retryAfter });
  const id = norm(c.body.registration_id).toUpperCase();
  if (!id) throw new HttpError(422, 'Please enter your Registration ID.', { errors: { registration_id: 'Please enter your Registration ID.' } });
  if (!/^[A-Z0-9]{2,10}-\d{4}-\d{6}$/.test(id)) throw new HttpError(422, 'That Registration ID is not in the correct format, for example AYNM-2026-000001.', { errors: { registration_id: 'That Registration ID is not in the correct format, for example AYNM-2026-000001.' } });
  const m = db.prepare('SELECT registration_id, full_name, registration_date, status, is_demo FROM members WHERE registration_id=?').get(id);
  if (!m) throw new HttpError(404, 'No registration was found for that ID.');
  const mode = getSettings().public_name_display;
  return c.json(200, { registration_id: m.registration_id, name: mode === 'full' ? m.full_name : maskName(m.full_name), name_masked: mode !== 'full', registration_date: m.registration_date, status: m.status, demo: !!m.is_demo });
});

/* ---- admin auth ---- */
route('POST', '/api/admin/login', async (c) => {
  const email = norm(c.body.email).toLowerCase();
  const password = typeof c.body.password === 'string' ? c.body.password : '';
  const k1 = rl.hit('login-ip:' + c.ip, parseInt(process.env.RATE_LOGIN_PER_IP || '20', 10), 900e3);
  const k2 = rl.hit('login:' + c.ip + ':' + email, 5, 900e3);
  if (!k1.ok || !k2.ok) throw new HttpError(429, 'Too many sign-in attempts. Please wait and try again.', { retry_after: Math.max(k1.retryAfter || 0, k2.retryAfter || 0) });
  if (!email || !password || password.length > 300) throw new HttpError(400, 'Please enter your email and password.');
  const admin = db.prepare('SELECT * FROM admins WHERE email=? AND is_active=1').get(email);
  const ok = await sec.verifyPassword(password, admin ? admin.password_hash : sec.DUMMY_HASH);
  if (!admin || !ok) { audit(null, 'login_failed', email, null, c.ip); throw new HttpError(401, 'Incorrect email or password.'); }
  rl.reset('login:' + c.ip + ':' + email);
  const s = createSession(admin.id, c.req);
  db.prepare('UPDATE admins SET last_login_at=? WHERE id=?').run(iso(), admin.id);
  audit(admin, 'login', admin.email, null, c.ip);
  setCookie(c.res, s.raw, ABS_MS / 1000);
  return c.json(200, { admin: adminOut(admin), csrf: s.csrf });
});
route('POST', '/api/admin/logout', { auth: 'admin' }, (c) => {
  db.prepare('DELETE FROM sessions WHERE id_hash=?').run(c.session.hash);
  audit(c.admin, 'logout', c.admin.email, null, c.ip);
  setCookie(c.res, '', 0);
  return c.json(200, { ok: true });
});
route('GET', '/api/admin/session', (c) => {
  const s = getSession(c.req);
  return c.json(200, s ? { admin: adminOut(s.admin), csrf: s.csrf } : { admin: null });
});
route('GET', '/api/admin/me', { auth: 'admin' }, (c) => c.json(200, { admin: adminOut(c.admin), csrf: c.session.csrf }));

route('POST', '/api/admin/forgot', async (c) => {
  const lim = rl.hit('forgot:' + c.ip, 5, 3600e3);
  if (!lim.ok) throw new HttpError(429, 'Too many requests. Please try again later.');
  const email = norm(c.body.email).toLowerCase();
  const generic = { ok: true, message: 'If an administrator account exists for that email, password reset instructions have been sent.' };
  const admin = email ? db.prepare('SELECT * FROM admins WHERE email=? AND is_active=1').get(email) : null;
  if (admin) {
    const token = sec.randomToken(32);
    db.prepare('INSERT INTO password_resets(token_hash,admin_id,expires_at) VALUES(?,?,?)').run(sec.sha256(token), admin.id, iso(Date.now() + 30 * 60e3));
    const base = baseUrl(c.req);
    try { await mailer.send({ to: admin.email, subject: 'Reset your administrator password', text: `Use this link within 30 minutes to choose a new password:\n${base}/#/admin/reset?token=${token}\n\nIf you did not request this, ignore this message.` }); }
    catch (e) { console.error('[mailer] failed:', e.message); }
    audit(admin, 'password_reset_requested', admin.email, null, c.ip);
  }
  return c.json(200, generic);
});
route('POST', '/api/admin/reset', async (c) => {
  const lim = rl.hit('reset:' + c.ip, 10, 3600e3);
  if (!lim.ok) throw new HttpError(429, 'Too many attempts. Please try again later.');
  const token = requireStr(c.body.token, 'Token');
  const problem = sec.passwordProblem(c.body.password);
  if (problem) throw new HttpError(422, problem);
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL').get(sec.sha256(token));
  if (!row || Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
  const hash = await sec.hashPassword(c.body.password);
  tx(() => {
    db.prepare('UPDATE admins SET password_hash=?, updated_at=? WHERE id=?').run(hash, iso(), row.admin_id);
    db.prepare('UPDATE password_resets SET used_at=? WHERE token_hash=?').run(iso(), row.token_hash);
    destroyAdminSessions(row.admin_id);
  });
  const admin = db.prepare('SELECT id,email FROM admins WHERE id=?').get(row.admin_id);
  audit(admin, 'password_reset_completed', admin.email, null, c.ip);
  return c.json(200, { ok: true });
});
route('POST', '/api/admin/change-password', { auth: 'admin' }, async (c) => {
  const lim = rl.hit('chpw:' + c.admin.id, 5, 900e3);
  if (!lim.ok) throw new HttpError(429, 'Too many attempts. Please wait.');
  const row = db.prepare('SELECT * FROM admins WHERE id=?').get(c.admin.id);
  if (!(await sec.verifyPassword(String(c.body.current_password || ''), row.password_hash))) throw new HttpError(403, 'Your current password is incorrect.');
  const problem = sec.passwordProblem(c.body.new_password);
  if (problem) throw new HttpError(422, problem);
  db.prepare('UPDATE admins SET password_hash=?, updated_at=? WHERE id=?').run(await sec.hashPassword(c.body.new_password), iso(), c.admin.id);
  db.prepare('DELETE FROM sessions WHERE admin_id=? AND id_hash<>?').run(c.admin.id, c.session.hash);
  audit(c.admin, 'password_changed', c.admin.email, null, c.ip);
  return c.json(200, { ok: true });
});

/* ---- admin stats ---- */
route('GET', '/api/admin/stats', { auth: 'admin', perm: 'members_view' }, (c) => {
  const demoFilter = c.query.demo === 'hide' ? 'WHERE is_demo=0' : '';
  const and = demoFilter ? 'AND is_demo=0' : '';
  const count = (sql, ...p) => db.prepare(sql).get(...p).c;
  const today = lagosDate();
  const t = new Date(today + 'T00:00:00Z');
  const dow = (t.getUTCDay() + 6) % 7; // Monday=0
  const weekStart = new Date(t.getTime() - dow * 86400e3).toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const top = (col, extra = '') => db.prepare(`SELECT ${col} AS label, COUNT(*) AS value FROM members ${demoFilter} GROUP BY ${extra || col} ORDER BY value DESC, label LIMIT 10`).all();
  const since = new Date(t.getTime() - 29 * 86400e3).toISOString().slice(0, 10);
  const perDay = new Map(db.prepare(`SELECT date(created_at,'${LAGOS}') d, COUNT(*) c FROM members WHERE date(created_at,'${LAGOS}') >= ? ${and} GROUP BY d`).all(since).map((r) => [r.d, r.c]));
  const series = [];
  for (let i = 0; i < 30; i++) { const d = new Date(t.getTime() - (29 - i) * 86400e3).toISOString().slice(0, 10); series.push({ date: d, count: perDay.get(d) || 0 }); }
  return c.json(200, {
    totals: {
      total: count(`SELECT COUNT(*) c FROM members ${demoFilter}`),
      pending: count(`SELECT COUNT(*) c FROM members WHERE status='Pending' ${and}`),
      approved: count(`SELECT COUNT(*) c FROM members WHERE status='Approved' ${and}`),
      rejected: count(`SELECT COUNT(*) c FROM members WHERE status='Rejected' ${and}`),
      today: count(`SELECT COUNT(*) c FROM members WHERE date(created_at,'${LAGOS}') = ? ${and}`, today),
      week: count(`SELECT COUNT(*) c FROM members WHERE date(created_at,'${LAGOS}') >= ? ${and}`, weekStart),
      month: count(`SELECT COUNT(*) c FROM members WHERE date(created_at,'${LAGOS}') >= ? ${and}`, monthStart),
      demo: count('SELECT COUNT(*) c FROM members WHERE is_demo=1'),
    },
    recent: db.prepare(`SELECT id, registration_id, full_name, state, lga, status, created_at, is_demo FROM members ${demoFilter} ORDER BY created_at DESC, id DESC LIMIT 8`).all().map((r) => ({ ...r, is_demo: !!r.is_demo })),
    by_state: top('state'),
    by_lga: top("lga || ' (' || state || ')'", 'state, lga'),
    by_ward: top("ward || ' (' || lga || ')'", 'state, lga, ward'),
    over_time: series,
  });
});

/* ---- admin members ---- */
route('GET', '/api/admin/members', { auth: 'admin', perm: 'members_view' }, (c) => {
  const page = Math.max(1, parseInt(c.query.page, 10) || 1);
  const per = Math.min(100, Math.max(5, parseInt(c.query.per, 10) || 25));
  const { where, params } = buildWhere(c.query);
  const total = db.prepare(`SELECT COUNT(*) c FROM members ${where}`).get(...params).c;
  const rows = db.prepare(`SELECT ${MEMBER_LIST_COLS} FROM members ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, per, (page - 1) * per);
  return c.json(200, { items: rows.map(memberOut), total, page, per, pages: Math.max(1, Math.ceil(total / per)) });
});
route('GET', '/api/admin/members/:id', { auth: 'admin', perm: 'members_view' }, (c) => {
  const r = db.prepare(`SELECT ${MEMBER_LIST_COLS}, first_name, middle_name, last_name, date_of_birth, consent_at, status_changed_at FROM members WHERE id=?`).get(c.params.id);
  if (!r) throw new HttpError(404, 'Member not found.');
  audit(c.admin, 'view_member', r.registration_id, null, c.ip);
  return c.json(200, { member: memberOut(r) });
});
route('PATCH', '/api/admin/members/:id', { auth: 'admin', perm: 'members_manage' }, (c) => {
  const r = db.prepare('SELECT * FROM members WHERE id=?').get(c.params.id);
  if (!r) throw new HttpError(404, 'Member not found.');
  const { errors, clean } = validateMember(c.body, { settings: getSettings(), mode: 'edit' });
  if (Object.keys(errors).length) throw new HttpError(422, 'Please correct the highlighted fields.', { errors });
  const fields = ['full_name', 'first_name', 'middle_name', 'last_name', 'phone', 'email', 'date_of_birth', 'gender', 'state', 'lga', 'ward', 'polling_unit'];
  const changed = fields.filter((f) => (r[f] || '') !== (clean[f] || ''));
  db.prepare(`UPDATE members SET ${fields.map((f) => f + '=?').join(',')}, updated_at=? WHERE id=?`).run(...fields.map((f) => clean[f] || null), iso(), r.id);
  audit(c.admin, 'edit_member', r.registration_id, 'fields: ' + (changed.join(', ') || 'none'), c.ip);
  return c.json(200, { ok: true, changed });
});
route('POST', '/api/admin/members/:id/status', { auth: 'admin', perm: 'members_manage' }, (c) => {
  const status = c.body.status;
  if (!['Pending', 'Approved', 'Rejected'].includes(status)) throw new HttpError(422, 'Invalid status.');
  const r = db.prepare('SELECT id, registration_id, status FROM members WHERE id=?').get(c.params.id);
  if (!r) throw new HttpError(404, 'Member not found.');
  db.prepare('UPDATE members SET status=?, status_changed_at=?, status_changed_by=?, updated_at=? WHERE id=?').run(status, iso(), c.admin.id, iso(), r.id);
  audit(c.admin, 'set_status', r.registration_id, `${r.status} -> ${status}`, c.ip);
  return c.json(200, { ok: true, status });
});
route('DELETE', '/api/admin/members/:id', { auth: 'admin', perm: 'members_delete' }, (c) => {
  const r = db.prepare('SELECT id, registration_id, passport_photo FROM members WHERE id=?').get(c.params.id);
  if (!r) throw new HttpError(404, 'Member not found.');
  db.prepare('DELETE FROM members WHERE id=?').run(r.id);
  removePhoto(r.passport_photo);
  audit(c.admin, 'delete_member', r.registration_id, null, c.ip);
  return c.json(200, { ok: true });
});
route('POST', '/api/admin/members/:id/reveal-nin', { auth: 'super' }, async (c) => {
  const lim = rl.hit('reveal:' + c.admin.id, 10, 600e3);
  if (!lim.ok) throw new HttpError(429, 'Too many attempts. Please wait.');
  const me = db.prepare('SELECT password_hash FROM admins WHERE id=?').get(c.admin.id);
  if (!(await sec.verifyPassword(String(c.body.password || ''), me.password_hash))) { audit(c.admin, 'reveal_nin_denied', c.params.id, 'wrong password', c.ip); throw new HttpError(403, 'Incorrect password.'); }
  const r = db.prepare('SELECT registration_id, nin_encrypted FROM members WHERE id=?').get(c.params.id);
  if (!r) throw new HttpError(404, 'Member not found.');
  audit(c.admin, 'reveal_nin', r.registration_id, null, c.ip);
  return c.json(200, { nin: sec.decrypt(r.nin_encrypted).toString('utf8') });
});
route('GET', '/api/admin/members/:id/photo', { auth: 'admin', perm: 'members_view' }, (c) => {
  const r = db.prepare('SELECT registration_id, passport_photo FROM members WHERE id=?').get(c.params.id);
  if (!r || !r.passport_photo || !/^[0-9a-f-]{36}\.bin$/.test(r.passport_photo)) throw new HttpError(404, 'No photograph on file.');
  let buf;
  try { buf = sec.decrypt(fs.readFileSync(path.join(cfg.photoDir, r.passport_photo))); } catch { throw new HttpError(404, 'Photograph unavailable.'); }
  audit(c.admin, 'view_photo', r.registration_id, null, c.ip);
  c.res.writeHead(200, { 'Content-Type': buf[0] === 0x89 ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline', 'Content-Length': buf.length });
  c.res.end(buf);
});
route('GET', '/api/admin/export.csv', { auth: 'admin', perm: 'members_export' }, (c) => {
  const { where, params } = buildWhere(c.query);
  const rows = db.prepare(`SELECT registration_id, full_name, first_name, middle_name, last_name, phone, email, date_of_birth, gender, state, lga, ward, polling_unit, nin_last4, status, registration_date, created_at, is_demo FROM members ${where} ORDER BY created_at DESC, id DESC`).all(...params);
  const head = ['registration_id', 'full_name', 'first_name', 'middle_name', 'last_name', 'phone', 'email', 'date_of_birth', 'gender', 'state', 'lga', 'ward', 'polling_unit', 'nin_masked', 'status', 'registration_date', 'created_at', 'demo_data'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      csvCell(r.registration_id), csvCell(r.full_name), csvCell(r.first_name), csvCell(r.middle_name), csvCell(r.last_name),
      '="' + String(r.phone).replace(/[^0-9]/g, '') + '"', // keeps the leading zero in Excel
      csvCell(r.email), csvCell(r.date_of_birth), csvCell(r.gender), csvCell(r.state), csvCell(r.lga), csvCell(r.ward), csvCell(r.polling_unit),
      csvCell(maskNin(r.nin_last4)), csvCell(r.status), csvCell(r.registration_date), csvCell(r.created_at), csvCell(r.is_demo ? 'DEMO DATA' : ''),
    ].join(','));
  }
  audit(c.admin, 'export_csv', null, `${rows.length} rows`, c.ip);
  const body = '\ufeff' + lines.join('\r\n') + '\r\n';
  c.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="members-${lagosDate()}.csv"`, 'Cache-Control': 'no-store' });
  c.res.end(body);
});

/* ---- admin settings ---- */
const TEXT_LIMITS = { org_name: 120, org_tagline: 300, org_description: 4000, about_purpose: 4000, about_membership: 4000, about_org_info: 4000, phone: 80, email: 120, address: 400, privacy_policy: 30000 };
route('GET', '/api/admin/settings', { auth: 'admin', perm: 'settings_manage' }, (c) => c.json(200, { settings: getSettings(), logo_url: getSettings().logo_file ? '/assets/' + getSettings().logo_file : '' }));
route('PUT', '/api/admin/settings', { auth: 'admin', perm: 'settings_manage', limit: 200e3 }, (c) => {
  const b = c.body; const changed = []; const errors = {};
  const apply = (k, v) => { if (getSettings()[k] !== v) { setSetting(k, v); changed.push(k); } };
  for (const [k, max] of Object.entries(TEXT_LIMITS)) {
    if (typeof b[k] !== 'string') continue;
    const v = k === 'privacy_policy' ? b[k].replace(/\r\n/g, '\n') : b[k].trim();
    if (v.length > max) errors[k] = `Too long (max ${max} characters).`;
    else if (k === 'org_name' && !v) errors[k] = 'Organization name is required.';
    else apply(k, v);
  }
  for (const k of ['social_facebook', 'social_x', 'social_instagram', 'social_whatsapp', 'social_youtube']) {
    if (typeof b[k] !== 'string') continue;
    const v = b[k].trim();
    if (v && !/^https:\/\/[^\s<>"']{3,300}$/i.test(v)) errors[k] = 'Enter a full link starting with https:// (or leave blank).'; else apply(k, v);
  }
  if (b.strict_locations !== undefined) apply('strict_locations', b.strict_locations === true || b.strict_locations === '1' ? '1' : '0');
  if (b.registration_open !== undefined) apply('registration_open', b.registration_open === true || b.registration_open === '1' ? '1' : '0');
  if (b.id_prefix !== undefined) { const v = String(b.id_prefix).trim().toUpperCase(); if (!/^[A-Z0-9]{2,10}$/.test(v)) errors.id_prefix = 'Use 2 to 10 letters or numbers.'; else apply('id_prefix', v); }
  if (b.max_passport_kb !== undefined) { const n = parseInt(b.max_passport_kb, 10); if (!(n >= 50 && n <= 2000)) errors.max_passport_kb = 'Enter a size between 50 and 2000 KB.'; else apply('max_passport_kb', String(n)); }
  if (b.min_age !== undefined) { const n = parseInt(b.min_age, 10); if (!(n >= 16 && n <= 100)) errors.min_age = 'Enter an age between 16 and 100.'; else apply('min_age', String(n)); }
  if (b.retention_days !== undefined) { const n = parseInt(b.retention_days, 10); if (!(n >= 0 && n <= 3650)) errors.retention_days = 'Enter 0 (off) or a number of days up to 3650.'; else apply('retention_days', String(n)); }
  if (b.public_name_display !== undefined) { if (!['masked', 'full'].includes(b.public_name_display)) errors.public_name_display = 'Invalid choice.'; else apply('public_name_display', b.public_name_display); }
  for (const k of ['color_primary', 'color_accent', 'color_dark']) {
    if (b[k] === undefined) continue;
    if (!/^#[0-9a-fA-F]{6}$/.test(String(b[k]))) errors[k] = 'Use a colour like #0B6B3A.'; else apply(k, String(b[k]).toUpperCase());
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'Some settings need attention.', { errors });
  audit(c.admin, 'update_settings', null, changed.join(', ') || 'no changes', c.ip);
  return c.json(200, { ok: true, changed });
});
route('POST', '/api/admin/logo', { auth: 'admin', perm: 'settings_manage', limit: 2e6 }, (c) => {
  const img = decodeImage(c.body.data, { maxBytes: 1024 * 1024, allowed: ['image/png', 'image/jpeg', 'image/webp'] });
  if (img.error) throw new HttpError(422, img.error === 'size' ? 'Logo must be 1 MB or smaller.' : 'Please upload a PNG, JPG or WebP logo.');
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[img.mime];
  const name = `logo-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(cfg.assetsDir, name), img.buf);
  const old = getSettings().logo_file;
  if (old && /^logo-[0-9a-f]{12}\.(png|jpg|webp)$/.test(old)) { try { fs.unlinkSync(path.join(cfg.assetsDir, old)); } catch { /* */ } }
  setSetting('logo_file', name);
  audit(c.admin, 'upload_logo', name, null, c.ip);
  return c.json(200, { logo_url: '/assets/' + name });
});
route('DELETE', '/api/admin/logo', { auth: 'admin', perm: 'settings_manage' }, (c) => {
  const old = getSettings().logo_file;
  if (old && /^logo-[0-9a-f]{12}\.(png|jpg|webp)$/.test(old)) { try { fs.unlinkSync(path.join(cfg.assetsDir, old)); } catch { /* */ } }
  setSetting('logo_file', '');
  audit(c.admin, 'remove_logo', old, null, c.ip);
  return c.json(200, { ok: true });
});

/* ---- locations import ---- */
route('GET', '/api/admin/locations/summary', { auth: 'admin', perm: 'locations_manage' }, (c) => {
  const rows = new Map(db.prepare(`SELECT state, COUNT(DISTINCT lga) lgas, COUNT(DISTINCT CASE WHEN ward IS NOT NULL THEN lga||'|'||ward END) wards, COUNT(polling_unit) polling_units FROM locations GROUP BY state`).all().map((r) => [r.state, r]));
  return c.json(200, { items: STATES.map((st) => rows.get(st) || { state: st, lgas: 0, wards: 0, polling_units: 0 }) });
});
// Drill-down: state -> LGAs -> wards -> polling units, with counts.
route('GET', '/api/admin/locations/browse', { auth: 'admin', perm: 'locations_manage' }, (c) => {
  const state = norm(c.query.state); const lga = norm(c.query.lga); const ward = norm(c.query.ward);
  if (!STATES.includes(state)) throw new HttpError(422, 'Choose a State.');
  if (!lga) return c.json(200, { level: 'lga', items: db.prepare(`SELECT lga AS name, COUNT(DISTINCT ward) AS wards, COUNT(polling_unit) AS polling_units FROM locations WHERE state=? GROUP BY lga ORDER BY lga COLLATE NOCASE`).all(state) });
  if (!ward) return c.json(200, { level: 'ward', items: db.prepare(`SELECT ward AS name, COUNT(polling_unit) AS polling_units FROM locations WHERE state=? AND lga=? AND ward IS NOT NULL GROUP BY ward ORDER BY ward COLLATE NOCASE`).all(state, lga) });
  const items = db.prepare(`SELECT polling_unit AS name FROM locations WHERE state=? AND lga=? AND ward=? AND polling_unit IS NOT NULL ORDER BY polling_unit COLLATE NOCASE LIMIT 2000`).all(state, lga, ward);
  return c.json(200, { level: 'polling_unit', items });
});
// Remove imported ward / polling-unit data for one LGA (or one ward). The LGA itself always stays.
route('POST', '/api/admin/locations/clear', { auth: 'admin', perm: 'locations_manage' }, (c) => {
  const state = norm(c.body.state); const lga = norm(c.body.lga); const ward = norm(c.body.ward);
  if (!STATES.includes(state) || !lga) throw new HttpError(422, 'Choose a State and an LGA.');
  let removed;
  tx(() => {
    removed = Number(ward ? db.prepare('DELETE FROM locations WHERE state=? AND lga=? AND ward=?').run(state, lga, ward).changes
      : db.prepare('DELETE FROM locations WHERE state=? AND lga=? AND ward IS NOT NULL').run(state, lga).changes);
    db.prepare('INSERT OR IGNORE INTO locations(state,lga) VALUES(?,?)').run(state, lga);
  });
  audit(c.admin, 'clear_locations', `${state} / ${lga}${ward ? ' / ' + ward : ''}`, `${removed} rows`, c.ip);
  return c.json(200, { removed });
});
route('POST', '/api/admin/locations/import', { auth: 'admin', perm: 'locations_manage', limit: 20e6 }, (c) => {
  const r = locs.validateRows(requireStr(c.body.csv, 'CSV data'));
  if (r.error) throw new HttpError(422, r.error);
  if (!r.valid.length) throw new HttpError(422, 'No valid rows were found.', { problems: r.problems });
  if (c.body.dry_run) return c.json(200, { dry_run: true, valid_rows: r.valid.length, states: [...r.statesInFile], problems: r.problems });
  const added = locs.applyRows(r.valid, r.statesInFile, c.body.replace === true);
  audit(c.admin, 'import_locations', null, `${r.valid.length} valid rows, ${added} new, replace=${c.body.replace === true}`, c.ip);
  return c.json(200, { added, valid_rows: r.valid.length, skipped: r.total - r.valid.length, problems: r.problems });
});

/* ---- retention / demo / audit ---- */
function runRetention(dry, admin, ip) {
  const days = parseInt(getSettings().retention_days, 10) || 0;
  if (days <= 0) return { enabled: false, candidates: 0, deleted: 0 };
  const cutoff = iso(Date.now() - days * 86400e3);
  const rows = db.prepare(`SELECT id, registration_id, passport_photo FROM members WHERE status='Rejected' AND COALESCE(status_changed_at, updated_at) < ?`).all(cutoff);
  if (dry) return { enabled: true, days, candidates: rows.length, deleted: 0 };
  for (const r of rows) { db.prepare('DELETE FROM members WHERE id=?').run(r.id); removePhoto(r.passport_photo); }
  audit(admin, 'retention_purge', null, `${rows.length} rejected records older than ${days} days`, ip);
  return { enabled: true, days, candidates: rows.length, deleted: rows.length };
}
route('POST', '/api/admin/retention/run', { auth: 'admin', perm: 'settings_manage' }, (c) => c.json(200, runRetention(c.body.dry_run !== false, c.admin, c.ip)));
route('POST', '/api/admin/demo/delete', { auth: 'admin', perm: 'settings_manage' }, (c) => {
  const rows = db.prepare('SELECT id, passport_photo FROM members WHERE is_demo=1').all();
  for (const r of rows) { db.prepare('DELETE FROM members WHERE id=?').run(r.id); removePhoto(r.passport_photo); }
  audit(c.admin, 'delete_demo_data', null, `${rows.length} records`, c.ip);
  return c.json(200, { deleted: rows.length });
});
route('GET', '/api/admin/audit', { auth: 'admin', perm: 'audit_view' }, (c) => {
  const rows = db.prepare('SELECT id, admin_email, action, target, detail, ip, created_at FROM audit_log ORDER BY id DESC LIMIT 300').all();
  return c.json(200, { items: rows });
});


/* ---- administrator management (super admin only) ---- */
const lastActiveSuper = (excludeId) => db.prepare("SELECT COUNT(*) c FROM admins WHERE role='super_admin' AND is_active=1 AND id<>?").get(excludeId).c === 0;
function baseUrl(req) {
  if (cfg.publicOrigin) return cfg.publicOrigin;
  const host = String(req.headers.host || '').replace(/[^a-zA-Z0-9.:\-]/g, '');
  return `${cfg.cookieSecure ? 'https' : 'http'}://${host || 'localhost:' + cfg.port}`;
}
const findInvite = (token) => (typeof token === 'string' && token.length >= 20 && token.length <= 100
  ? db.prepare('SELECT * FROM admin_invites WHERE token_hash=? AND used_at IS NULL AND expires_at > ?').get(sec.sha256(token), iso()) : null);
const cleanPerms = (arr) => parsePerms((Array.isArray(arr) ? arr : []).join(',')).join(',');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

route('GET', '/api/admin/admins', { auth: 'super' }, (c) => {
  const admins = db.prepare('SELECT id, email, name, role, permissions, is_active, last_login_at, created_at FROM admins ORDER BY id').all()
    .map((a) => ({ ...a, is_active: !!a.is_active, permissions: a.role === 'super_admin' ? Object.keys(PERMISSIONS) : parsePerms(a.permissions), is_self: a.id === c.admin.id }));
  const invites = db.prepare('SELECT id, email, name, role, permissions, created_at, expires_at FROM admin_invites WHERE used_at IS NULL AND expires_at > ? ORDER BY id DESC').all(iso())
    .map((i) => ({ ...i, permissions: i.role === 'super_admin' ? Object.keys(PERMISSIONS) : parsePerms(i.permissions) }));
  return c.json(200, { admins, invites, permissions: PERMISSIONS });
});
route('POST', '/api/admin/admins/invite', { auth: 'super' }, async (c) => {
  const email = norm(c.body.email).toLowerCase(); const name = norm(c.body.name).slice(0, 80);
  const role = c.body.role === 'super_admin' ? 'super_admin' : 'admin';
  if (!EMAIL_RE.test(email) || email.length > 120) throw new HttpError(422, 'Please enter a valid email address.', { errors: { email: 'Please enter a valid email address.' } });
  if (db.prepare('SELECT 1 FROM admins WHERE email=?').get(email)) throw new HttpError(409, 'An administrator with this email already exists.', { errors: { email: 'An administrator with this email already exists.' } });
  const perms = role === 'super_admin' ? '' : cleanPerms(c.body.permissions);
  const token = sec.randomToken(32); const expires = iso(Date.now() + 72 * 3600e3);
  tx(() => {
    db.prepare('DELETE FROM admin_invites WHERE email=? AND used_at IS NULL').run(email);
    db.prepare('INSERT INTO admin_invites(token_hash,email,name,role,permissions,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(sec.sha256(token), email, name, role, perms, c.admin.id, iso(), expires);
  });
  const url = `${baseUrl(c.req)}/#/admin/invite?token=${token}`;
  let delivered = false;
  try { delivered = (await mailer.send({ to: email, subject: 'You have been invited as an administrator', text: `You have been invited to administer the membership portal.\nOpen this link within 72 hours to set your password:\n${url}` })).delivered; } catch (e) { console.error('[mailer] failed:', e.message); }
  audit(c.admin, 'invite_admin', email, `role=${role}; permissions=${perms || 'none'}`, c.ip);
  return c.json(201, { invite_url: url, expires_at: expires, email_delivered: delivered });
});
route('DELETE', '/api/admin/invites/:id', { auth: 'super' }, (c) => {
  const r = db.prepare('SELECT email FROM admin_invites WHERE id=?').get(c.params.id);
  if (!r) throw new HttpError(404, 'Invitation not found.');
  db.prepare('DELETE FROM admin_invites WHERE id=?').run(c.params.id);
  audit(c.admin, 'revoke_invite', r.email, null, c.ip);
  return c.json(200, { ok: true });
});
route('PATCH', '/api/admin/admins/:id', { auth: 'super' }, (c) => {
  const t = db.prepare('SELECT * FROM admins WHERE id=?').get(c.params.id);
  if (!t) throw new HttpError(404, 'Administrator not found.');
  const self = t.id === c.admin.id; const b = c.body; const changed = [];
  if (b.role !== undefined) {
    if (!['admin', 'super_admin'].includes(b.role)) throw new HttpError(422, 'Invalid role.');
    if (self && b.role !== t.role) throw new HttpError(403, 'You cannot change your own role.');
    if (b.role !== t.role) {
      if (t.role === 'super_admin' && lastActiveSuper(t.id)) throw new HttpError(409, 'There must always be at least one active Super Admin.');
      db.prepare('UPDATE admins SET role=?, updated_at=? WHERE id=?').run(b.role, iso(), t.id); changed.push('role');
    }
  }
  if (b.permissions !== undefined) { db.prepare('UPDATE admins SET permissions=?, updated_at=? WHERE id=?').run(cleanPerms(b.permissions), iso(), t.id); changed.push('permissions'); }
  if (b.name !== undefined) { db.prepare('UPDATE admins SET name=?, updated_at=? WHERE id=?').run(norm(b.name).slice(0, 80), iso(), t.id); changed.push('name'); }
  if (b.is_active !== undefined) {
    const active = b.is_active === true;
    if (self && !active) throw new HttpError(403, 'You cannot deactivate your own account.');
    if (!active && t.role === 'super_admin' && lastActiveSuper(t.id)) throw new HttpError(409, 'There must always be at least one active Super Admin.');
    db.prepare('UPDATE admins SET is_active=?, updated_at=? WHERE id=?').run(active ? 1 : 0, iso(), t.id); changed.push(active ? 'activated' : 'deactivated');
    if (!active) destroyAdminSessions(t.id);
  }
  audit(c.admin, 'update_admin', t.email, changed.join(', ') || 'no changes', c.ip);
  return c.json(200, { ok: true, changed });
});
route('DELETE', '/api/admin/admins/:id', { auth: 'super' }, (c) => {
  const t = db.prepare('SELECT * FROM admins WHERE id=?').get(c.params.id);
  if (!t) throw new HttpError(404, 'Administrator not found.');
  if (t.id === c.admin.id) throw new HttpError(403, 'You cannot remove your own account.');
  if (t.role === 'super_admin' && lastActiveSuper(t.id)) throw new HttpError(409, 'There must always be at least one active Super Admin.');
  db.prepare('DELETE FROM admins WHERE id=?').run(t.id);
  audit(c.admin, 'remove_admin', t.email, null, c.ip);
  return c.json(200, { ok: true });
});
// Public: an invited person checks and accepts their invitation.
route('POST', '/api/admin/invite/check', (c) => {
  const lim = rl.hit('invchk:' + c.ip, 20, 900e3);
  if (!lim.ok) throw new HttpError(429, 'Too many attempts. Please try again later.');
  const inv = findInvite(c.body.token);
  if (!inv) throw new HttpError(400, 'This invitation link is invalid or has expired. Please ask the Super Admin for a new one.');
  return c.json(200, { email: inv.email, name: inv.name, role: inv.role });
});
route('POST', '/api/admin/invite/accept', async (c) => {
  const lim = rl.hit('invacc:' + c.ip, 10, 3600e3);
  if (!lim.ok) throw new HttpError(429, 'Too many attempts. Please try again later.');
  const inv = findInvite(c.body.token);
  if (!inv) throw new HttpError(400, 'This invitation link is invalid or has expired. Please ask the Super Admin for a new one.');
  const problem = sec.passwordProblem(c.body.password);
  if (problem) throw new HttpError(422, problem);
  if (db.prepare('SELECT 1 FROM admins WHERE email=?').get(inv.email)) throw new HttpError(409, 'An account with this email already exists.');
  const name = norm(c.body.name).slice(0, 80) || inv.name;
  const hash = await sec.hashPassword(c.body.password);
  let id;
  tx(() => {
    id = Number(db.prepare('INSERT INTO admins(email,name,password_hash,role,permissions) VALUES(?,?,?,?,?)').run(inv.email, name, hash, inv.role, inv.permissions).lastInsertRowid);
    db.prepare('UPDATE admin_invites SET used_at=? WHERE id=?').run(iso(), inv.id);
  });
  audit({ id, email: inv.email }, 'accept_invite', inv.email, `role=${inv.role}`, c.ip);
  return c.json(200, { ok: true });
});

/* ------------------------------------------------------------------ static files */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveFile(res, file, cache) {
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': cache });
  res.end(data);
}
function serveStatic(req, res, pathname) {
  if (pathname.startsWith('/assets/') && /^logo-[0-9a-f]{12}\.(png|jpg|webp)$/.test(pathname.slice(8))) {
    // administrator-uploaded logo lives in DATA_DIR/assets (not in public/)
    const f = path.join(cfg.assetsDir, pathname.slice(8));
    if (!fs.existsSync(f)) return false;
    serveFile(res, f, 'public, max-age=86400'); return true;
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return false; }
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.includes('\0') || rel.includes('..')) return false;
  const f = path.join(PUBLIC_DIR, rel);
  if (!f.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return false;
  serveFile(res, f, rel.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache');
  return true;
}

/* ------------------------------------------------------------------ dispatcher */
const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const ip = clientIp(req);
  try {
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      if (serveStatic(req, res, pathname)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found');
    }
    let matched = null; let params = {}; let pathExists = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathExists = true;
      if (r.method !== req.method) continue;
      matched = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      break;
    }
    if (!matched) throw new HttpError(pathExists ? 405 : 404, pathExists ? 'Method not allowed.' : 'Not found.');

    const unsafe = !['GET', 'HEAD'].includes(req.method);
    if (unsafe) {
      // CSRF defence 1: custom header (cannot be sent cross-site without a CORS pre-flight, which we never grant)
      if (req.headers['x-requested-with'] !== 'aynm') throw new HttpError(403, 'Request blocked.');
      // CSRF defence 2: Origin must match this site when the browser sends it
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try { const o = new URL(origin); ok = cfg.publicOrigin ? o.origin === cfg.publicOrigin : o.host === req.headers.host; } catch { /* */ }
        if (!ok) throw new HttpError(403, 'Request blocked.');
      }
    }
    const ctx = { req, res, ip, params, query: Object.fromEntries(url.searchParams), body: {}, session: null, admin: null, json: (s, o, h) => json(res, s, o, h) };
    if (matched.opts.auth) {
      const s = getSession(req);
      if (!s) throw new HttpError(401, 'Please sign in.');
      if (unsafe && !sec.safeEqual(req.headers['x-csrf-token'] || '', s.csrf)) throw new HttpError(403, 'Session check failed. Please refresh the page.');
      if (matched.opts.auth === 'super' && s.admin.role !== 'super_admin') throw new HttpError(403, 'You do not have permission to do this.');
      if (matched.opts.perm && !hasPerm(s.admin, matched.opts.perm)) throw new HttpError(403, 'You do not have permission to do this.');
      ctx.session = s; ctx.admin = s.admin;
    }
    if (unsafe) ctx.body = await readBody(req, matched.opts.limit || 64e3);
    await matched.handler(ctx);
  } catch (err) {
    if (err instanceof HttpError) {
      const headers = err.extra && err.extra.retry_after ? { 'Retry-After': String(err.extra.retry_after) } : {};
      if (!res.headersSent) json(res, err.status, { error: err.message, ...err.extra }, headers);
    } else {
      console.error('[error]', req.method, req.url, err && err.stack || err);
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  }
});
server.headersTimeout = 20e3; server.requestTimeout = 60e3; server.keepAliveTimeout = 5e3;

/* ------------------------------------------------------------------ bootstrap */
async function bootstrapAdmin() {
  if (db.prepare('SELECT COUNT(*) c FROM admins').get().c > 0) return;
  if (!cfg.bootstrapEmail || !cfg.bootstrapPassword) { console.warn('[setup] No administrator exists yet. Run: npm run create-admin'); return; }
  const problem = sec.passwordProblem(cfg.bootstrapPassword);
  if (problem) { console.error('[setup] ADMIN_PASSWORD rejected: ' + problem); return; }
  db.prepare('INSERT INTO admins(email,name,password_hash,role) VALUES(?,?,?,?)').run(cfg.bootstrapEmail.toLowerCase(), 'Administrator', await sec.hashPassword(cfg.bootstrapPassword), 'super_admin');
  console.log(`[setup] Super admin created: ${cfg.bootstrapEmail}. Remove ADMIN_EMAIL / ADMIN_PASSWORD from the environment now.`);
}
if (require.main === module) {
  bootstrapAdmin().then(() => {
    try { const sd = locs.seedIfNeeded(); if (sd.seeded) console.log(`[setup] Loaded ${sd.seeded} polling-unit records for ${sd.states} states from data/northern-locations.csv.gz`); } catch (e) { console.error('[setup] Location data could not be loaded:', e.message); }
    if (cfg.isProd && !cfg.publicOrigin) console.warn('[setup] PUBLIC_ORIGIN is not set. Set it to your https URL for correct reset links and Origin checks.');
    server.listen(cfg.port, () => console.log(`AYNM portal listening on port ${cfg.port} (${cfg.isProd ? 'production' : 'development'}; image optimiser: ${sharp ? 'sharp' : 'browser-side only'})`));
  });
}
module.exports = { server, runRetention };
