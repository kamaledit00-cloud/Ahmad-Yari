'use strict';
// Location data (State > LGA > Ward > Polling Unit): validation, import and first-start seeding.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cfg = require('./config');
const { db, tx, iso, STATES, setSetting } = require('./db');
const { parseCsv } = require('./csv');

const norm = (s) => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim();
const SEED_FILE = path.join(cfg.root, 'data', 'northern-locations.csv.gz');

// Reads .csv or .csv.gz into text.
function readText(file) {
  const buf = fs.readFileSync(file);
  return (buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString('utf8').replace(/^\ufeff/, '');
}

// Validates CSV text with header: state,lga,ward,polling_unit (ward and polling_unit optional).
function validateRows(text) {
  const rows = parseCsv(String(text).replace(/^\ufeff/, '')).filter((r) => r.some((x) => x.trim()));
  if (rows.length < 2) return { error: 'The file has no data rows.' };
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const idx = { state: header.indexOf('state'), lga: header.indexOf('lga'), ward: header.indexOf('ward'), pu: header.indexOf('polling_unit') };
  if (idx.state < 0 || idx.lga < 0) return { error: 'The first row must be a header with at least: state, lga (and optionally ward, polling_unit).' };
  const problems = []; const valid = []; const statesInFile = new Set();
  const note = (m) => { if (problems.length < 20) problems.push(m); };
  rows.slice(1).forEach((r, i) => {
    const sIn = norm(r[idx.state]); const state = STATES.find((s) => s.toLowerCase() === sIn.toLowerCase());
    const lga = norm(r[idx.lga]); const ward = idx.ward >= 0 ? norm(r[idx.ward]) : ''; const pu = idx.pu >= 0 ? norm(r[idx.pu]) : '';
    if (!state) return note(`Row ${i + 2}: "${sIn}" is not one of the Northern states served by this portal.`);
    if (!lga || lga.length > 80 || ward.length > 80 || pu.length > 160 || /[<>]/.test(lga + ward + pu)) return note(`Row ${i + 2}: invalid or missing value.`);
    if (pu && !ward) return note(`Row ${i + 2}: a polling unit needs a ward.`);
    statesInFile.add(state); valid.push([state, lga, ward || null, pu || null]);
  });
  return { valid, problems, statesInFile, total: rows.length - 1 };
}

// Writes validated rows. With replace=true, existing rows for the states in the file are removed first.
function applyRows(valid, statesInFile, replace) {
  let added = 0;
  tx(() => {
    if (replace) for (const s of statesInFile) db.prepare('DELETE FROM locations WHERE state=?').run(s);
    const ins = db.prepare('INSERT OR IGNORE INTO locations(state,lga,ward,polling_unit) VALUES(?,?,?,?)');
    for (const v of valid) added += Number(ins.run(...v).changes);
  });
  return added;
}

// On the very first start, load the bundled Northern-states dataset (unless disabled or data already exists).
function seedIfNeeded() {
  if (process.env.SKIP_LOCATION_SEED === '1') return { skipped: 'SKIP_LOCATION_SEED is set' };
  if (db.prepare("SELECT 1 FROM settings WHERE key='locations_seeded'").get()) return { skipped: 'already handled' };
  if (db.prepare('SELECT 1 FROM locations WHERE ward IS NOT NULL LIMIT 1').get()) { setSetting('locations_seeded', 'existing-data ' + iso()); return { skipped: 'ward data already present' }; }
  if (!fs.existsSync(SEED_FILE)) return { skipped: 'no bundled file' };
  const r = validateRows(readText(SEED_FILE));
  if (r.error || !r.valid.length) return { skipped: r.error || 'empty file' };
  const added = applyRows(r.valid, r.statesInFile, true);
  setSetting('locations_seeded', iso());
  // Official lists now exist for every state served, so make them mandatory (an administrator can switch this off in Settings).
  if (!db.prepare("SELECT 1 FROM settings WHERE key='strict_locations'").get()) setSetting('strict_locations', '1');
  return { seeded: added, states: r.statesInFile.size, problems: r.problems.length };
}

module.exports = { readText, validateRows, applyRows, seedIfNeeded, SEED_FILE, norm };
