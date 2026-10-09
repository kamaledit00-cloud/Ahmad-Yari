'use strict';
// Converts the "Northern Nigeria Polling Units" dataset CSV into the portal's import format
// (state,lga,ward,polling_unit) and writes data/northern-locations.csv.gz.
// Usage: node scripts/build-locations.js path/to/Northern_Nigeria_Polling_Units.csv [out.csv.gz]
// Names are kept as they appear in the source file; only spacing and capitalisation are tidied, and the
// polling-unit code is appended to each polling unit so that units with identical names stay distinct.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseCsv, csvLine } = require('../lib/csv');

const STATES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'states.json'), 'utf8'));
const src = process.argv[2];
const out = process.argv[3] || path.join(__dirname, '..', 'data', 'northern-locations.csv.gz');
if (!src) { console.error('Usage: node scripts/build-locations.js path/to/Northern_Nigeria_Polling_Units.csv [out.csv.gz]'); process.exit(1); }

const clean = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').replace(/\s+\.\s+/g, ' ').trim();
const ROMAN = /^(i{1,3}|iv|vi{0,3}|ix|x)$/i;
function title(s) {
  const t = clean(s).toLowerCase().replace(/(^|[\s/\-(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  const words = t.split(' ');
  return words.length > 1 ? words.map((w) => (ROMAN.test(w) ? w.toUpperCase() : w)).join(' ') : t;
}
const stateName = (s) => { const k = clean(s).toLowerCase(); if (k === 'fct') return 'Federal Capital Territory'; return STATES.find((x) => x.toLowerCase() === k); };

const rows = parseCsv(fs.readFileSync(src, 'utf8').replace(/^\ufeff/, ''));
const h = rows[0].map((x) => x.trim().toLowerCase()); const ix = (n) => h.indexOf(n);
const need = ['state', 'lg', 'ward', 'code', 'location']; for (const n of need) if (ix(n) < 0) { console.error(`Column "${n}" not found in ${src}`); process.exit(1); }
const seen = new Set(); const lines = [csvLine(['state', 'lga', 'ward', 'polling_unit'])]; const skipped = []; const perState = {};
for (const r of rows.slice(1)) {
  if (!r.some((x) => x.trim())) continue;
  const state = stateName(r[ix('state')]); const lga = title(r[ix('lg')]); const ward = title(r[ix('ward')]);
  const name = clean(r[ix('location')]).toUpperCase(); const code = clean(r[ix('code')]);
  if (!state || !lga || !ward || !name || !code) { skipped.push(code || '(no code)'); continue; }
  const pu = `${name} (${code})`; const key = [state, lga, ward, pu].join('|');
  if (seen.has(key)) continue; seen.add(key);
  lines.push(csvLine([state, lga, ward, pu])); perState[state] = (perState[state] || 0) + 1;
}
fs.writeFileSync(out, zlib.gzipSync(Buffer.from(lines.join('\n') + '\n'), { level: 9 }));
console.log(`Wrote ${lines.length - 1} polling units to ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB). Skipped rows: ${skipped.length}`);
console.log(Object.entries(perState).sort().map(([s, n]) => `${s}: ${n}`).join('\n'));
