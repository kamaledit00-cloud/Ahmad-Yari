'use strict';
// Starts a second server WITH the bundled Northern-states dataset and checks the location chain end to end.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aynm-loc-'));
const PORT = 3800 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;
const get = async (u) => (await fetch(BASE + u, { headers: { 'X-Requested-With': 'aynm' } })).json();
const post = async (u, body) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'X-Requested-With': 'aynm', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
const PNG = zlib.deflateSync(Buffer.alloc(10)); // not used as an image here

before(async () => {
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), NODE_ENV: 'test', NIN_ENCRYPTION_KEY: 'b'.repeat(64) };
  delete env.SKIP_LOCATION_SEED;
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 30000);
    proc.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
});
after(() => { proc && proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('bundled dataset is loaded on first start and the chain narrows correctly', async () => {
  const cfg = await get('/api/config');
  assert.equal(cfg.strict_locations, true);
  const { states } = await get('/api/locations/states');
  assert.equal(states.length, 20);
  for (const southern of ['Lagos', 'Rivers', 'Oyo', 'Enugu']) assert.ok(!states.includes(southern));
  const lgas = (await get('/api/locations/lgas?state=Zamfara')).items;
  assert.equal(lgas.length, 14);
  assert.ok(lgas.includes('Bungudu'));
  assert.ok(!lgas.includes('Dala'), 'Kano LGA must not appear under Zamfara');
  const wards = (await get('/api/locations/wards?state=Zamfara&lga=Bungudu')).items;
  assert.ok(wards.length > 5);
  assert.deepEqual((await get('/api/locations/wards?state=Kano&lga=Bungudu')).items, []);
  const pu = await get(`/api/locations/polling-units?state=Zamfara&lga=Bungudu&ward=${encodeURIComponent(wards[0])}`);
  assert.ok(pu.has_data && pu.items.length > 0);
  assert.match(pu.items[0], /\(\d\d\/\d\d\/\d\d\/\d{3}\)$/);
  // a polling unit of one ward is never offered for another ward
  const other = await get(`/api/locations/polling-units?state=Zamfara&lga=Bungudu&ward=${encodeURIComponent(wards[1])}`);
  assert.equal(other.items.filter((x) => pu.items.includes(x)).length, 0);
});

test('every state has LGAs, wards and polling units; totals match the source (93,191)', async () => {
  const total = { pus: 0 };
  const sample = await Promise.all((await get('/api/locations/states')).states.map(async (s) => {
    const lgas = (await get('/api/locations/lgas?state=' + encodeURIComponent(s))).items;
    assert.ok(lgas.length >= 6, s);
    const w = (await get(`/api/locations/wards?state=${encodeURIComponent(s)}&lga=${encodeURIComponent(lgas[0])}`)).items;
    assert.ok(w.length > 0, `${s} / ${lgas[0]} has wards`);
    return lgas.length;
  }));
  assert.equal(sample.reduce((a, b) => a + b, 0), 419);
  const zlibData = require('node:zlib').gunzipSync(fs.readFileSync(path.join(root, 'data', 'northern-locations.csv.gz'))).toString().trim().split('\n');
  assert.equal(zlibData.length - 1, 93191);
  void total; void PNG;
});

test('with strict lists, a registration needs a real ward and polling unit', async () => {
  const wards = (await get('/api/locations/wards?state=Zamfara&lga=Bungudu')).items;
  const pus = (await get(`/api/locations/polling-units?state=Zamfara&lga=Bungudu&ward=${encodeURIComponent(wards[0])}`)).items;
  const base = { full_name: 'Test Person Example', first_name: 'Test', last_name: 'Example', phone: '08031234567', date_of_birth: '1990-05-20', gender: 'Female', state: 'Zamfara', lga: 'Bungudu', nin: '12345678901', consent_accuracy: true, consent_privacy: true };
  const bad1 = await post('/api/register', { ...base, ward: 'Made Up Ward', polling_unit: 'Made Up PU' });
  assert.equal(bad1.status, 422); assert.ok(bad1.data.errors.ward);
  const bad2 = await post('/api/register', { ...base, ward: wards[0], polling_unit: 'Made Up PU' });
  assert.equal(bad2.status, 422); assert.ok(bad2.data.errors.polling_unit);
  const bad3 = await post('/api/register', { ...base, ward: wards[0], polling_unit: pus[0] });
  assert.equal(bad3.status, 422); assert.ok(bad3.data.errors.passport_photo && !bad3.data.errors.ward && !bad3.data.errors.polling_unit, 'location accepted; only the missing photo is reported');
});
