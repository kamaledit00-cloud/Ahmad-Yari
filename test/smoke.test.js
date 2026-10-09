'use strict';
// End-to-end API tests. Starts the real server against a temporary data directory.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aynm-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const SUPER = { email: 'super@example.test', password: 'Sup3rSecretPass99' };
const ADMIN = { email: 'staff@example.test', password: 'Staff3SecretPass99' };
let proc;

function tinyPng() {
  const crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((8 * 3 + 1) * 8, 120);
  for (let y = 0; y < 8; y++) raw[y * 25] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG_B64 = tinyPng().toString('base64');

async function call(method, url, { body, cookie, csrf, headers = {} } = {}) {
  const h = { 'X-Requested-With': 'aynm', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  if (csrf) h['X-CSRF-Token'] = csrf;
  const r = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : ct.startsWith('image/') ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, data, headers: r.headers };
}
async function login(creds) {
  const r = await call('POST', '/api/admin/login', { body: creds });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: r.data.csrf };
}
const validReg = (over = {}) => ({
  full_name: 'Test Person Example', first_name: 'Test', middle_name: 'Person', last_name: 'Example', phone: '08031234567', email: 'test@example.com',
  date_of_birth: '1990-05-20', gender: 'Female', state: 'Zamfara', lga: 'Bungudu', ward: 'Test Ward', polling_unit: 'Test PU 001',
  nin: '12345678901', passport_photo: { data: 'data:image/png;base64,' + PNG_B64 }, consent_accuracy: true, consent_privacy: true,
  idempotency_key: 'idem-' + Math.random().toString(36).slice(2) + Date.now(), ...over,
});

before(async () => {
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), NODE_ENV: 'test', ADMIN_EMAIL: SUPER.email, ADMIN_PASSWORD: SUPER.password, NIN_ENCRYPTION_KEY: 'a'.repeat(64), SKIP_LOCATION_SEED: '1', RATE_REGISTER_PER_HOUR: '1000', RATE_LOGIN_PER_IP: '1000' };
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    proc.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/create-admin.js', ADMIN.email, 'Staff', 'admin'], { cwd: root, env: { ...env, ADMIN_PASSWORD: ADMIN.password }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
after(() => { proc && proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('public config, locations and static pages', async () => {
  const cfg = await call('GET', '/api/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.data.org_name, 'AHMAD YARI NORTHERN MOVEMENT');
  assert.ok(!/to be provided|\[/.test(cfg.data.org_description + cfg.data.about_purpose + cfg.data.about_membership + cfg.data.about_org_info + cfg.data.privacy_policy), 'no placeholder text');
  assert.ok(!('retention_days' in cfg.data));
  const st = await call('GET', '/api/locations/states');
  assert.equal(st.data.states.length, 20);
  for (const south of ['Lagos', 'Rivers', 'Oyo', 'Enugu', 'Anambra']) assert.ok(!st.data.states.includes(south), south);
  for (const north of ['Kano', 'Borno', 'Plateau', 'Federal Capital Territory', 'Zamfara', 'Kwara']) assert.ok(st.data.states.includes(north), north);
  assert.equal((await call('GET', '/api/locations/lgas?state=Borno')).data.items.length, 27);
  assert.equal((await call('GET', '/api/locations/lgas?state=Kano')).data.items.length, 44);
  const lg = await call('GET', '/api/locations/lgas?state=Zamfara');
  assert.ok(lg.data.items.includes('Bungudu') && lg.data.items.length === 14);
  assert.ok(!lg.data.items.includes('Gusau ') && !lg.data.items.includes('Kano Municipal'), 'only LGAs of the chosen state');
  assert.deepEqual((await call('GET', '/api/locations/lgas?state=Lagos')).data.items, []);
  const home = await call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
});

test('path traversal and private files are not served', async () => {
  for (const p of ['/..%2fserver.js', '/%2e%2e/server.js', '/lib/config.js', '/../.env.example', '/assets/..%2f..%2fserver.js', '/private/photos/x.bin']) {
    const r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => { res.resume(); resolve(res.statusCode); }));
    assert.equal(r, 404, p);
  }
});

test('registration validation returns clear messages', async () => {
  const r = await call('POST', '/api/register', { body: { consent_accuracy: false } });
  assert.equal(r.status, 422);
  assert.equal(r.data.errors.full_name, 'Please enter your full name.');
  assert.equal(r.data.errors.state, 'Please select your State.');
  assert.equal(r.data.errors.passport_photo, 'Please upload a passport photograph.');
  const bad = await call('POST', '/api/register', { body: validReg({ nin: '123', phone: '12345', date_of_birth: '2015-01-01', lga: 'Nowhere', email: 'nope' }) });
  assert.equal(bad.status, 422);
  assert.match(bad.data.errors.nin, /11 digits/);
  assert.ok(bad.data.errors.phone && bad.data.errors.date_of_birth && bad.data.errors.lga && bad.data.errors.email);
  const notImg = await call('POST', '/api/register', { body: validReg({ passport_photo: { data: Buffer.from('<script>alert(1)</script>').toString('base64') } }) });
  assert.match(notImg.data.errors.passport_photo, /JPG, JPEG or PNG/);
  const big = await call('POST', '/api/register', { body: validReg({ passport_photo: { data: Buffer.concat([tinyPng(), Buffer.alloc(600 * 1024)]).toString('base64') } }) });
  assert.match(big.data.errors.passport_photo, /too large/);
});

test('CSRF-style requests without the custom header are blocked', async () => {
  const r = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  const r2 = await fetch(BASE + '/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'aynm', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(r2.status, 403);
});

let firstId; let firstKey;
test('registration succeeds, IDs are unique, duplicates and retries are handled', async () => {
  const body = validReg(); firstKey = body.idempotency_key;
  const r = await call('POST', '/api/register', { body });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.registration_id, /^AYNM-\d{4}-\d{6}$/);
  assert.equal(r.data.status, 'Pending');
  assert.ok(!JSON.stringify(r.data).includes('12345678901'));
  firstId = r.data.registration_id;
  const retry = await call('POST', '/api/register', { body });
  assert.equal(retry.data.registration_id, firstId);
  assert.equal(retry.data.duplicate_submission, true);
  const dup = await call('POST', '/api/register', { body: validReg() });
  assert.equal(dup.status, 409);
  assert.ok(dup.data.errors.nin);
  const second = await call('POST', '/api/register', { body: validReg({ nin: '98765432109', phone: '+2348051234567' }) });
  assert.equal(second.status, 201);
  assert.notEqual(second.data.registration_id, firstId);
  assert.ok(second.data.registration_id.endsWith('000002'));
});

test('public check shows only safe fields', async () => {
  const r = await call('POST', '/api/check', { body: { registration_id: firstId.toLowerCase() } });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data).sort(), ['demo', 'name', 'name_masked', 'registration_date', 'registration_id', 'status']);
  assert.equal(r.data.name, 'T*** P***** E*****');
  const text = JSON.stringify(r.data);
  for (const secret of ['12345678901', '0803', 'test@example.com', '1990']) assert.ok(!text.includes(secret));
  assert.equal((await call('POST', '/api/check', { body: { registration_id: 'AYNM-2026-999999' } })).status, 404);
  assert.equal((await call('POST', '/api/check', { body: { registration_id: "x' OR 1=1" } })).status, 422);
});

test('admin endpoints require authentication', async () => {
  for (const [m, u] of [['GET', '/api/admin/members'], ['GET', '/api/admin/stats'], ['GET', '/api/admin/export.csv'], ['GET', '/api/admin/members/1/photo'], ['GET', '/api/admin/settings']]) {
    assert.equal((await call(m, u)).status, 401, u);
  }
});

test('login: wrong password rejected, rate limited after repeated failures', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/admin/login', { body: { email: 'ghost@example.test', password: 'wrong-password-1' } })).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { body: { email: 'ghost@example.test', password: 'wrong-password-1' } })).status, 429);
});

test('super admin: list, search, filter, detail, masked NIN, photo, status, edit', async () => {
  const s = await login(SUPER);
  const list = await call('GET', '/api/admin/members?q=Test%20Person', { cookie: s.cookie });
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 2);
  const m = list.data.items.find((x) => x.registration_id === firstId);
  assert.equal(m.nin_masked, '*******8901');
  assert.ok(!JSON.stringify(list.data).includes('12345678901'));
  assert.equal((await call('GET', '/api/admin/members?state=Kano', { cookie: s.cookie })).data.total, 0);
  assert.equal((await call('GET', '/api/admin/members?status=Pending&lga=Bungudu&ward=Test%20Ward&polling_unit=PU%20001', { cookie: s.cookie })).data.total, 2);
  const detail = await call('GET', `/api/admin/members/${m.id}`, { cookie: s.cookie });
  assert.equal(detail.data.member.date_of_birth, '1990-05-20');
  assert.ok(!('nin' in detail.data.member));
  const photo = await call('GET', `/api/admin/members/${m.id}/photo`, { cookie: s.cookie });
  assert.equal(photo.status, 200);
  assert.ok(Buffer.isBuffer(photo.data) && (photo.data[0] === 0x89 || photo.data[0] === 0xff), 'photo decrypts to a PNG/JPEG');
  assert.match(photo.headers.get('cache-control'), /no-store/);
  // stored files are encrypted, not raw PNGs
  const file = fs.readdirSync(path.join(dataDir, 'private', 'photos'))[0];
  const first = fs.readFileSync(path.join(dataDir, 'private', 'photos', file))[0];
  assert.ok(first !== 0x89 && first !== 0xff || true); // (random IV byte; real check is the next line)
  assert.ok(!fs.readFileSync(path.join(dataDir, 'private', 'photos', file)).includes(Buffer.from('IHDR')), 'stored photo is encrypted');
  // CSRF token required
  assert.equal((await call('POST', `/api/admin/members/${m.id}/status`, { cookie: s.cookie, body: { status: 'Approved' } })).status, 403);
  const ok = await call('POST', `/api/admin/members/${m.id}/status`, { cookie: s.cookie, csrf: s.csrf, body: { status: 'Approved' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('POST', '/api/check', { body: { registration_id: firstId } })).data.status, 'Approved');
  const edit = await call('PATCH', `/api/admin/members/${m.id}`, { cookie: s.cookie, csrf: s.csrf, body: { ...validReg(), full_name: 'Test Person Edited', last_name: 'Edited' } });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  assert.deepEqual(edit.data.changed.sort(), ['full_name', 'last_name']);
});

test('NIN reveal requires super admin + password and is audited; admin role is restricted', async () => {
  const s = await login(SUPER); const a = await login(ADMIN);
  const id = (await call('GET', '/api/admin/members?q=' + firstId, { cookie: s.cookie })).data.items[0].id;
  assert.equal((await call('POST', `/api/admin/members/${id}/reveal-nin`, { cookie: s.cookie, csrf: s.csrf, body: { password: 'nope-nope-nope1' } })).status, 403);
  const rev = await call('POST', `/api/admin/members/${id}/reveal-nin`, { cookie: s.cookie, csrf: s.csrf, body: { password: SUPER.password } });
  assert.equal(rev.data.nin, '12345678901');
  assert.equal((await call('POST', `/api/admin/members/${id}/reveal-nin`, { cookie: a.cookie, csrf: a.csrf, body: { password: ADMIN.password } })).status, 403);
  assert.equal((await call('DELETE', `/api/admin/members/${id}`, { cookie: a.cookie, csrf: a.csrf })).status, 403);
  assert.equal((await call('GET', '/api/admin/settings', { cookie: a.cookie })).status, 403);
  assert.equal((await call('GET', '/api/admin/audit', { cookie: a.cookie })).status, 403);
  assert.equal((await call('GET', '/api/admin/members', { cookie: a.cookie })).status, 200);
  const audit = (await call('GET', '/api/admin/audit', { cookie: s.cookie })).data.items.map((x) => x.action);
  for (const act of ['login', 'reveal_nin', 'reveal_nin_denied', 'set_status', 'edit_member']) assert.ok(audit.includes(act), act);
});

test('stats and CSV export (no full NIN, formula-injection safe)', async () => {
  const s = await login(SUPER);
  const inj = await call('POST', '/api/register', { body: validReg({ nin: '11122233344', email: '+evil@example.com' }) });
  assert.equal(inj.status, 201);
  const nameInj = await call('POST', '/api/register', { body: validReg({ nin: '11122233355', full_name: '=cmd Danger Formula', first_name: 'Danger', last_name: 'Formula' }) });
  assert.equal(nameInj.status, 422);
  const st = await call('GET', '/api/admin/stats', { cookie: s.cookie });
  assert.equal(st.data.totals.total, 3);
  assert.equal(st.data.totals.today, 3);
  assert.equal(st.data.by_state[0].label, 'Zamfara');
  assert.equal(st.data.over_time.length, 30);
  const csv = await call('GET', '/api/admin/export.csv?state=Zamfara', { cookie: s.cookie });
  assert.equal(csv.status, 200);
  assert.ok(!csv.data.includes('12345678901') && !csv.data.includes('98765432109'));
  assert.ok(csv.data.includes('*******8901'));
  assert.ok(csv.data.includes("\"'+evil@example.com\""), 'formula-like cell is neutralised');
});

test('settings, logo upload, closing registration', async () => {
  const s = await login(SUPER);
  const bad = await call('PUT', '/api/admin/settings', { cookie: s.cookie, csrf: s.csrf, body: { color_primary: 'red', id_prefix: 'x', social_facebook: 'javascript:alert(1)' } });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.errors.color_primary && bad.data.errors.id_prefix && bad.data.errors.social_facebook);
  const ok = await call('PUT', '/api/admin/settings', { cookie: s.cookie, csrf: s.csrf, body: { phone: '+234 000 000 0000', public_name_display: 'full' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/config')).data.phone, '+234 000 000 0000');
  assert.equal((await call('POST', '/api/check', { body: { registration_id: firstId } })).data.name, 'Test Person Edited');
  const logo = await call('POST', '/api/admin/logo', { cookie: s.cookie, csrf: s.csrf, body: { data: PNG_B64 } });
  assert.equal(logo.status, 200);
  assert.equal((await call('GET', logo.data.logo_url)).status, 200);
  assert.equal((await call('POST', '/api/admin/logo', { cookie: s.cookie, csrf: s.csrf, body: { data: Buffer.from('<svg onload=alert(1)>').toString('base64') } })).status, 422);
  await call('PUT', '/api/admin/settings', { cookie: s.cookie, csrf: s.csrf, body: { registration_open: false } });
  assert.equal((await call('POST', '/api/register', { body: validReg({ nin: '55566677788' }) })).status, 403);
  await call('PUT', '/api/admin/settings', { cookie: s.cookie, csrf: s.csrf, body: { registration_open: true } });
});

test('location import enables ward / polling-unit validation', async () => {
  const s = await login(SUPER);
  const csv = 'state,lga,ward,polling_unit\nZamfara,Bungudu,Ward Alpha,PU Alpha 001\nZamfara,Bungudu,Ward Alpha,PU Alpha 002\nZamfara,Bungudu,Ward Beta,PU Beta 001\nAtlantis,X,Y,Z\n';
  const r = await call('POST', '/api/admin/locations/import', { cookie: s.cookie, csrf: s.csrf, body: { csv } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 3);
  assert.equal(r.data.problems.length, 1);
  assert.deepEqual((await call('GET', '/api/locations/wards?state=Zamfara&lga=Bungudu')).data.items, ['Ward Alpha', 'Ward Beta']);
  assert.deepEqual((await call('GET', '/api/locations/polling-units?state=Zamfara&lga=Bungudu&ward=Ward%20Alpha&q=002')).data.items, ['PU Alpha 002']);
  const bad = await call('POST', '/api/register', { body: validReg({ nin: '22233344455', ward: 'Made Up Ward' }) });
  assert.match(bad.data.errors.ward, /valid Ward/);
  const bad2 = await call('POST', '/api/register', { body: validReg({ nin: '22233344455', ward: 'ward alpha', polling_unit: 'PU Beta 001' }) });
  assert.match(bad2.data.errors.polling_unit, /from the list/);
  const good = await call('POST', '/api/register', { body: validReg({ nin: '22233344455', ward: 'ward alpha', polling_unit: 'pu alpha 001' }) });
  assert.equal(good.status, 201, JSON.stringify(good.data));
});

test('forgot password never reveals whether an account exists; logout kills session', async () => {
  const a = await call('POST', '/api/admin/forgot', { body: { email: 'ghost@example.test' } });
  const b = await call('POST', '/api/admin/forgot', { body: { email: SUPER.email } });
  assert.deepEqual(a.data, b.data);
  assert.equal((await call('POST', '/api/admin/reset', { body: { token: 'bogus', password: 'NewPassword12345' } })).status, 400);
  const s = await login(ADMIN);
  assert.equal((await call('POST', '/api/admin/logout', { cookie: s.cookie, csrf: s.csrf })).status, 200);
  assert.equal((await call('GET', '/api/admin/me', { cookie: s.cookie })).status, 401);
  assert.equal((await call('GET', '/api/admin/session')).data.admin, null);
  assert.equal((await call('GET', '/api/admin/session', { cookie: s.cookie })).data.admin, null);
});

test('homepage assets: logo, favicon, manifest, no leftover old name', async () => {
  for (const p of ['/assets/logo-512.png', '/assets/logo-192.png', '/favicon.ico', '/assets/favicon-32.png', '/assets/apple-touch-icon.png', '/site.webmanifest']) {
    const r = await fetch(BASE + p); assert.equal(r.status, 200, p); await r.arrayBuffer();
  }
  const sa = await login(SUPER); await call('DELETE', '/api/admin/logo', { cookie: sa.cookie, csrf: sa.csrf });
  const cfg = (await call('GET', '/api/config')).data;
  assert.equal(cfg.logo_url, '/assets/logo-192.png'); assert.equal(cfg.logo_large_url, '/assets/logo-512.png');
  const page = (await call('GET', '/')).data;
  assert.match(page, /rel="icon"/); assert.match(page, /NORTHERN MOVEMENT/); assert.doesNotMatch(page, /NORTHWEST/i);
  for (const f of ['index.html', 'app.js', 'admin.js', 'styles.css', 'site.webmanifest']) assert.doesNotMatch(fs.readFileSync(path.join(root, 'public', f), 'utf8'), /northwest/i, f);
});

test('only Northern states can be registered; response carries the applicant summary but no NIN', async () => {
  const south = await call('POST', '/api/register', { body: validReg({ nin: '30000000001', state: 'Lagos', lga: 'Ikeja' }) });
  assert.equal(south.status, 422); assert.ok(south.data.errors.state);
  const ne = await call('POST', '/api/register', { body: validReg({ nin: '30000000002', state: 'Borno', lga: 'Maiduguri', ward: 'W1', polling_unit: 'PU1' }) });
  assert.equal(ne.status, 201, JSON.stringify(ne.data));
  assert.deepEqual(Object.keys(ne.data).sort(), ['full_name', 'lga', 'phone', 'polling_unit', 'registration_date', 'registration_id', 'state', 'status', 'ward']);
  assert.ok(!JSON.stringify(ne.data).includes('30000000002'));
  const wrongLga = await call('POST', '/api/register', { body: validReg({ nin: '30000000003', state: 'Borno', lga: 'Bungudu' }) });
  assert.match(wrongLga.data.errors.lga, /valid Local Government/);
});

let invitedLink; let staff2 = { email: 'viewer@example.test', password: 'Viewer3Password99' };
test('super admin invites an admin with limited permissions; invitation is single-use', async () => {
  const s = await login(SUPER); const a = await login(ADMIN);
  assert.equal((await call('GET', '/api/admin/admins', { cookie: a.cookie })).status, 403);
  assert.equal((await call('POST', '/api/admin/admins/invite', { cookie: a.cookie, csrf: a.csrf, body: { email: staff2.email } })).status, 403);
  assert.equal((await call('POST', '/api/admin/admins/invite', { cookie: s.cookie, csrf: s.csrf, body: { email: 'not-an-email' } })).status, 422);
  assert.equal((await call('POST', '/api/admin/admins/invite', { cookie: s.cookie, csrf: s.csrf, body: { email: ADMIN.email } })).status, 409);
  const inv = await call('POST', '/api/admin/admins/invite', { cookie: s.cookie, csrf: s.csrf, body: { email: staff2.email, name: 'Viewer One', role: 'admin', permissions: ['members_view', 'bogus_permission'] } });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  assert.match(inv.data.invite_url, /#\/admin\/invite\?token=/);
  invitedLink = new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token');
  const list = await call('GET', '/api/admin/admins', { cookie: s.cookie });
  assert.equal(list.data.invites.length, 1); assert.deepEqual(list.data.invites[0].permissions, ['members_view']);
  assert.ok(!JSON.stringify(list.data).includes(invitedLink), 'raw token is never stored or listed');
  assert.ok(!JSON.stringify(list.data).includes('password_hash'));
  assert.equal((await call('POST', '/api/admin/invite/check', { body: { token: 'x'.repeat(30) } })).status, 400);
  assert.equal((await call('POST', '/api/admin/invite/check', { body: { token: invitedLink } })).data.email, staff2.email);
  assert.equal((await call('POST', '/api/admin/invite/accept', { body: { token: invitedLink, password: 'short', name: 'x' } })).status, 422);
  assert.equal((await call('POST', '/api/admin/invite/accept', { body: { token: invitedLink, password: staff2.password, name: 'Viewer One' } })).status, 200);
  assert.equal((await call('POST', '/api/admin/invite/accept', { body: { token: invitedLink, password: staff2.password } })).status, 400);
});

test('permissions are enforced per route and can be changed live', async () => {
  const s = await login(SUPER); const v = await login(staff2);
  assert.deepEqual((await call('GET', '/api/admin/session', { cookie: v.cookie })).data.admin.permissions, ['members_view']);
  assert.equal((await call('GET', '/api/admin/members', { cookie: v.cookie })).status, 200);
  assert.equal((await call('GET', '/api/admin/stats', { cookie: v.cookie })).status, 200);
  const id = (await call('GET', '/api/admin/members?per=5', { cookie: v.cookie })).data.items[0].id;
  assert.equal((await call('GET', `/api/admin/members/${id}/photo`, { cookie: v.cookie })).status, 200);
  for (const [m, u, b] of [['POST', `/api/admin/members/${id}/status`, { status: 'Approved' }], ['PATCH', `/api/admin/members/${id}`, validReg()], ['DELETE', `/api/admin/members/${id}`], ['POST', `/api/admin/members/${id}/reveal-nin`, { password: staff2.password }], ['PUT', '/api/admin/settings', { phone: '1' }], ['POST', '/api/admin/locations/import', { csv: 'state,lga\nKano,Dala' }], ['POST', '/api/admin/admins/invite', { email: 'q@example.test' }]]) {
    assert.equal((await call(m, u, { cookie: v.cookie, csrf: v.csrf, body: b })).status, 403, m + ' ' + u);
  }
  assert.equal((await call('GET', '/api/admin/export.csv', { cookie: v.cookie })).status, 403);
  assert.equal((await call('GET', '/api/admin/audit', { cookie: v.cookie })).status, 403);
  const adminId = (await call('GET', '/api/admin/admins', { cookie: s.cookie })).data.admins.find((x) => x.email === staff2.email).id;
  assert.equal((await call('PATCH', `/api/admin/admins/${adminId}`, { cookie: s.cookie, csrf: s.csrf, body: { permissions: ['members_view', 'members_export'] } })).status, 200);
  assert.equal((await call('GET', '/api/admin/export.csv', { cookie: v.cookie })).status, 200, 'takes effect without signing in again');
});

test('deactivate, reactivate, remove; you cannot lock yourself out or remove the last super admin', async () => {
  const s = await login(SUPER); const v = await login(staff2);
  const admins = (await call('GET', '/api/admin/admins', { cookie: s.cookie })).data.admins;
  const me = admins.find((x) => x.email === SUPER.email); const other = admins.find((x) => x.email === staff2.email);
  assert.equal((await call('PATCH', `/api/admin/admins/${me.id}`, { cookie: s.cookie, csrf: s.csrf, body: { is_active: false } })).status, 403);
  assert.equal((await call('PATCH', `/api/admin/admins/${me.id}`, { cookie: s.cookie, csrf: s.csrf, body: { role: 'admin' } })).status, 403);
  assert.equal((await call('DELETE', `/api/admin/admins/${me.id}`, { cookie: s.cookie, csrf: s.csrf })).status, 403);
  assert.equal((await call('PATCH', `/api/admin/admins/${other.id}`, { cookie: s.cookie, csrf: s.csrf, body: { is_active: false } })).status, 200);
  assert.equal((await call('GET', '/api/admin/members', { cookie: v.cookie })).status, 401, 'session ends immediately');
  assert.equal((await call('POST', '/api/admin/login', { body: staff2 })).status, 401, 'cannot sign in while deactivated');
  await call('PATCH', `/api/admin/admins/${other.id}`, { cookie: s.cookie, csrf: s.csrf, body: { is_active: true } });
  // promote a second super admin, then the first may be demoted/removed by them but never the last one
  assert.equal((await call('PATCH', `/api/admin/admins/${other.id}`, { cookie: s.cookie, csrf: s.csrf, body: { role: 'super_admin' } })).status, 200);
  const s2 = await login(staff2);
  assert.equal((await call('DELETE', `/api/admin/admins/${me.id}`, { cookie: s2.cookie, csrf: s2.csrf })).status, 200);
  const only = (await call('GET', '/api/admin/admins', { cookie: s2.cookie })).data.admins.find((x) => x.email === staff2.email);
  assert.equal((await call('PATCH', `/api/admin/admins/${only.id}`, { cookie: s2.cookie, csrf: s2.csrf, body: { role: 'admin' } })).status, 403);
  // restore the original super admin via the invite flow so later tests keep working
  const inv = await call('POST', '/api/admin/admins/invite', { cookie: s2.cookie, csrf: s2.csrf, body: { email: SUPER.email, role: 'super_admin' } });
  const tok = new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token');
  assert.equal((await call('POST', '/api/admin/invite/accept', { body: { token: tok, password: SUPER.password, name: 'Owner' } })).status, 200);
  const s3 = await login(SUPER);
  assert.equal((await call('DELETE', `/api/admin/admins/${only.id}`, { cookie: s3.cookie, csrf: s3.csrf })).status, 200);
});

test('location browser, clear, and strict official-list mode', async () => {
  const s = await login(SUPER);
  const top = await call('GET', '/api/admin/locations/browse?state=Zamfara', { cookie: s.cookie });
  assert.equal(top.data.level, 'lga'); assert.ok(top.data.items.find((i) => i.name === 'Bungudu').wards >= 2);
  const wards = await call('GET', '/api/admin/locations/browse?state=Zamfara&lga=Bungudu', { cookie: s.cookie });
  assert.deepEqual(wards.data.items.map((i) => i.name), ['Ward Alpha', 'Ward Beta']);
  const pus = await call('GET', '/api/admin/locations/browse?state=Zamfara&lga=Bungudu&ward=Ward%20Alpha', { cookie: s.cookie });
  assert.deepEqual(pus.data.items.map((i) => i.name), ['PU Alpha 001', 'PU Alpha 002']);
  assert.equal((await call('GET', '/api/admin/locations/browse?state=Lagos', { cookie: s.cookie })).status, 422);
  // strict mode blocks free text where no official list exists (Gombe has none), allows listed values
  await call('PUT', '/api/admin/settings', { cookie: s.cookie, csrf: s.csrf, body: { strict_locations: true } });
  assert.equal((await call('GET', '/api/config')).data.strict_locations, true);
  const blocked = await call('POST', '/api/register', { body: validReg({ nin: '40000000001', state: 'Gombe', lga: 'Gombe', ward: 'Anything', polling_unit: 'Anything' }) });
  assert.equal(blocked.status, 422); assert.match(blocked.data.errors.ward, /not available yet/);
  const ok = await call('POST', '/api/register', { body: validReg({ nin: '40000000002', ward: 'Ward Beta', polling_unit: 'PU Beta 001' }) });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  await call('PUT', '/api/admin/settings', { cookie: s.cookie, csrf: s.csrf, body: { strict_locations: false } });
  const cleared = await call('POST', '/api/admin/locations/clear', { cookie: s.cookie, csrf: s.csrf, body: { state: 'Zamfara', lga: 'Bungudu' } });
  assert.equal(cleared.data.removed, 3);
  assert.ok((await call('GET', '/api/locations/lgas?state=Zamfara')).data.items.includes('Bungudu'), 'LGA remains after clearing its wards');
  assert.deepEqual((await call('GET', '/api/locations/wards?state=Zamfara&lga=Bungudu')).data.items, []);
});

test('old database is migrated without losing data (admins keep their access, old name replaced)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aynm-mig-'));
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(path.join(dir, 'aynm.sqlite'));
  old.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE admins(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('super_admin','admin')), is_active INTEGER NOT NULL DEFAULT 1, last_login_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    INSERT INTO admins(email,password_hash,role) VALUES('old@example.test','x','admin'),('boss@example.test','x','super_admin');
    INSERT INTO settings(key,value) VALUES('org_name','AHMAD YARI NORTHWEST MOVEMENT'),('org_description','[Organization description to be provided]'),('phone','+234 800 111 2222'),('color_primary','#0B6B3A');`);
  old.close();
  const out = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', "const d=require('./lib/db');console.log(JSON.stringify({s:d.getSettings(),a:d.db.prepare('SELECT email,role,permissions FROM admins ORDER BY id').all(),states:d.db.prepare('SELECT COUNT(DISTINCT state) c FROM locations').get().c}))"], { cwd: root, env: { ...process.env, DATA_DIR: dir, NIN_ENCRYPTION_KEY: 'b'.repeat(64) }, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const r = JSON.parse(out.stdout.trim().split('\n').pop());
  assert.equal(r.s.org_name, 'AHMAD YARI NORTHERN MOVEMENT');
  assert.doesNotMatch(r.s.org_description, /to be provided/);
  assert.equal(r.s.phone, '+234 800 111 2222', 'custom values are kept');
  assert.equal(r.s.color_primary, '#0B7A3E');
  assert.equal(r.a[0].permissions, 'members_view,members_manage,members_export', 'existing admin keeps previous abilities');
  assert.equal(r.states, 20);
  fs.rmSync(dir, { recursive: true, force: true });
});
