'use strict';
// Inserts clearly labelled DEMO DATA records (is_demo = 1) for testing. Safe to delete from Admin > Dashboard.
const zlib = require('zlib');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const { db, tx, iso, lagosDate, lagosYear } = require('../lib/db');
const sec = require('../lib/crypto');

function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
// Neutral grey 96x120 placeholder (silhouette-like), generated without any image library.
function placeholderPng() {
  const w = 96, h = 120; const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) {
    const head = (x - 48) ** 2 + (y - 45) ** 2 < 24 ** 2; const body = y > 80 && ((x - 48) ** 2) / 1600 + ((y - 125) ** 2) / 1600 < 1; const v = head || body ? 150 : 215;
    const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = v; raw[o + 1] = v; raw[o + 2] = v; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const demo = [
  ['Demo Memberone Testa', 'Demo', 'Memberone', 'Testa', 'Zamfara', 'Bungudu', 'Male', '1990-03-14', 'Pending'],
  ['Demo Membertwo Testb', 'Demo', 'Membertwo', 'Testb', 'Zamfara', 'Gusau', 'Female', '1994-07-02', 'Approved'],
  ['Demo Memberthree Testc', 'Demo', 'Memberthree', 'Testc', 'Kano', 'Dala', 'Male', '1988-11-23', 'Approved'],
  ['Demo Memberfour Testd', 'Demo', 'Memberfour', 'Testd', 'Katsina', 'Daura', 'Female', '2000-01-30', 'Rejected'],
  ['Demo Memberfive Teste', 'Demo', 'Memberfive', 'Teste', 'Kaduna', 'Zaria', 'Male', '1985-09-09', 'Pending'],
];
const existing = db.prepare('SELECT COUNT(*) c FROM members WHERE is_demo=1').get().c;
if (existing) { console.log(`Demo data already present (${existing} records). Delete it in Admin > Dashboard first.`); process.exit(0); }
const photo = placeholderPng();
tx(() => {
  demo.forEach((d, i) => {
    const year = lagosYear();
    const row = db.prepare('SELECT last_seq FROM registration_counters WHERE year=?').get(year); const seq = (row ? row.last_seq : 0) + 1;
    db.prepare('INSERT INTO registration_counters(year,last_seq) VALUES(?,?) ON CONFLICT(year) DO UPDATE SET last_seq=excluded.last_seq').run(year, seq);
    const nin = '0000000000' + (i + 1); // obviously fake
    const pname = crypto.randomUUID() + '.bin'; fs.writeFileSync(path.join(cfg.photoDir, pname), sec.encrypt(photo), { mode: 0o600 });
    const created = iso(Date.now() - i * 26 * 3600e3);
    db.prepare(`INSERT INTO members(registration_id,full_name,first_name,middle_name,last_name,phone,email,date_of_birth,gender,state,lga,ward,polling_unit,nin_encrypted,nin_last4,nin_hash,passport_photo,registration_date,status,consent_at,is_demo,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(`AYNM-${year}-${String(seq).padStart(6, '0')}`, d[0], d[1], d[2], d[3], '0800000000' + i, `demo${i + 1}@example.invalid`, d[7], d[6], d[4], d[5],
      'DEMO WARD ' + (i + 1), 'DEMO POLLING UNIT ' + (i + 1), sec.encrypt(Buffer.from(nin)), nin.slice(-4), sec.hmacNin(nin), pname, lagosDate(new Date(created)), d[8], created, created, created);
  });
});
console.log('Inserted 5 DEMO DATA records (fake NINs 00000000001-00000000005, example.invalid emails).');
