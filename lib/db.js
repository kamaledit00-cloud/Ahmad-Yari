'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const dbFile = path.join(cfg.dataDir, 'aynm.sqlite');
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(path.join(cfg.root, 'db', 'schema.sql'), 'utf8'));
try { fs.chmodSync(dbFile, 0o600); } catch { /* ignore on platforms without chmod */ }

/* ---------- migrations (safe to run on every start; never delete member data) ---------- */
const DEFAULT_ADMIN_PERMS = 'members_view,members_manage,members_export';
if (!db.prepare("PRAGMA table_info(admins)").all().some((c) => c.name === 'permissions')) {
  db.exec('ALTER TABLE admins ADD COLUMN permissions TEXT');
}
// Administrators created before permissions existed keep exactly what they could do before.
db.prepare("UPDATE admins SET permissions = ? WHERE role = 'admin' AND permissions IS NULL").run(DEFAULT_ADMIN_PERMS);

const STATES = JSON.parse(fs.readFileSync(path.join(cfg.root, 'data', 'states.json'), 'utf8'));
const SEED_LGAS = JSON.parse(fs.readFileSync(path.join(cfg.root, 'data', 'lgas.json'), 'utf8'));

const PERMISSIONS = {
  members_view: 'View dashboard statistics, members and photos',
  members_manage: 'Approve, reject and edit members',
  members_export: 'Export members to CSV',
  members_delete: 'Delete members',
  locations_manage: 'Manage location data (import wards and polling units)',
  settings_manage: 'Change website settings, logo and retention',
  audit_view: 'View the audit log',
};
const parsePerms = (s) => String(s || '').split(',').map((x) => x.trim()).filter((x) => x in PERMISSIONS);
const hasPerm = (admin, p) => !!admin && (admin.role === 'super_admin' || (admin.permissions || []).includes(p));

const iso = (d = new Date()) => new Date(d).toISOString();
const lagosDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(d); // YYYY-MM-DD
const lagosYear = () => parseInt(lagosDate().slice(0, 4), 10);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; }
}

/* ---------- settings ---------- */
const DEFAULT_PRIVACY = `# Privacy Policy

This policy explains how AHMAD YARI NORTHERN MOVEMENT ("the Organization") handles personal information submitted through this membership registration portal.

## 1. Information we collect
When you register, we collect your full name (first, middle and last name), phone number, email address (optional), date of birth, gender, State, Local Government Area, Ward, Polling Unit, National Identification Number (NIN) and a passport photograph. We also record the date and time of your registration and your consent.

## 2. Why we collect it
Your personal and location details are used to create and manage your membership record and to contact you about your registration. Your NIN and passport photograph are collected so the Organization can identify you and make sure each person registers only once. This portal does not connect to any national identity database, so your NIN is recorded as you enter it and is not verified by this portal.

## 3. How information is stored
Records are kept in the portal's database. NINs are encrypted before they are stored. Passport photographs are stored as encrypted files in private storage and are not available through public web addresses. The portal is intended to be used over a secure HTTPS connection.

## 4. Who can access your information
Only authorised administrators who sign in to the portal can view membership records, and each administrator can see only what they have been given permission to see. Viewing a full NIN is limited to the senior administrator (Super Admin) and every such action is recorded in an audit log. The public Check Registration page shows only a registration ID, a partly hidden name, the registration date and the status.

## 5. Protection of sensitive information
NINs are hidden by default in the administration area. Access to the administration area requires a password, sessions expire automatically, and administrator actions are logged. No system is completely secure, and absolute security cannot be guaranteed.

## 6. Passport photographs
Photographs must be JPG, JPEG or PNG images and are resized and compressed when you upload them. They are used to identify members and can be viewed only by authorised administrators. After you register, your photograph is shown on your confirmation page on your own device only.

## 7. NIN handling
Your NIN is never shown on public pages, is never placed in a web address, and is shown in full to an administrator only through a controlled action that requires their password and is logged.

## 8. Data retention
Membership records are kept for as long as they are needed for membership purposes. The administrators may delete rejected registrations after a set number of days, and may delete any record when it is no longer needed.

## 9. Your rights
You may ask the Organization to show you the information it holds about you, to correct it, or to delete it. To make a request, contact the Organization using the details on the Contact page and quote your Registration ID. Where the law that applies to the Organization gives you additional rights, the Organization will respect them.

## 10. Contact for privacy concerns
For questions about this policy or about your information, please contact the Organization using the details on the Contact page.
`;

const DEFAULTS = {
  org_name: 'AHMAD YARI NORTHERN MOVEMENT',
  org_tagline: 'Unity, Progress and Youth Empowerment across Northern Nigeria.',
  org_description: 'Ahmad Yari Northern Movement is a grassroots movement committed to supporting President Bola Ahmed Tinubu\'s second-term bid and strengthening the All Progressives Congress (APC) across Northern Nigeria through organized, peaceful and lawful democratic participation. Its values are Unity, Progress and Youth Empowerment.',
  about_purpose: 'The purpose of this portal is to let individuals join the movement by registering online, and to help the organization keep an accurate, secure record of its members.\n\nThe movement\'s stated values are Unity, Progress and Youth Empowerment. It works through organized, peaceful and lawful democratic participation in Northern Nigeria.',
  about_membership: 'Membership is open to eligible individuals who register through this portal. Each person registers once, using their own details: full name, phone number, date of birth, gender, location (State, Local Government Area, Ward and Polling Unit), NIN and a passport photograph.\n\nAfter you submit, you receive a unique Registration ID. Your registration is reviewed by the administrators and its status shows as Pending, Approved or Rejected. You can check the status at any time on the Check Registration page.',
  about_org_info: 'Ahmad Yari Northern Movement operates this portal to manage membership registration. Personal information is collected only for membership purposes and is handled as described in the Privacy Policy.\n\nFor questions about membership or about your registration, please use the details on the Contact page.',
  phone: '',
  email: '',
  address: '',
  social_facebook: '', social_x: '', social_instagram: '', social_whatsapp: '', social_youtube: '',
  registration_open: '1',
  strict_locations: '0',
  id_prefix: 'AYNM',
  max_passport_kb: '500',
  min_age: '18',
  retention_days: '0',
  public_name_display: 'masked',
  color_primary: '#0B7A3E',
  color_accent: '#D9A521',
  color_dark: '#0B1633',
  logo_file: '',
  privacy_policy: DEFAULT_PRIVACY,
};

function getSettings() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) if (r.key in DEFAULTS) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, String(value), iso());
}

/* ---------- locations ---------- */
// Seed LGA lists for every state that has no location rows yet. States that already have data
// (for example an administrator's own import) are never touched.
tx(() => {
  const has = db.prepare('SELECT 1 FROM locations WHERE state=? LIMIT 1');
  const ins = db.prepare('INSERT OR IGNORE INTO locations(state,lga) VALUES(?,?)');
  for (const [s, list] of Object.entries(SEED_LGAS)) if (!has.get(s)) for (const l of list) ins.run(s, l);
});

// One-time content migration: the organization was renamed, and the earlier default texts were placeholders.
// Only values that still equal an old default (or contain the old name) are changed; custom text is kept.
const OLD_PLACEHOLDERS = {
  org_tagline: ['A digital platform for membership registration and organizational information.'],
  org_description: ['[Organization description to be provided]'],
  about_purpose: ['[Purpose statement to be provided]'],
  about_membership: ['[Membership criteria and details to be provided]'],
  about_org_info: ['[Organizational information to be provided]'],
  phone: ['[Phone number to be provided]'], email: ['[Email address to be provided]'], address: ['[Office address to be provided]'],
  color_primary: ['#0B6B3A'], color_accent: ['#C8A24A'], color_dark: ['#0E1A14'],
};
tx(() => {
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    let v = r.value;
    if (OLD_PLACEHOLDERS[r.key] && OLD_PLACEHOLDERS[r.key].includes(v)) v = DEFAULTS[r.key];
    v = v.replace(/AHMAD YARI NORTHWEST( MOVEMENT)?/g, 'AHMAD YARI NORTHERN$1').replace(/Ahmad Yari Northwest( Movement)?/g, 'Ahmad Yari Northern$1');
    if (r.key === 'privacy_policy' && /\[Administrator:/.test(v)) v = DEFAULTS.privacy_policy; // untouched template
    if (v !== r.value) db.prepare('UPDATE settings SET value=?, updated_at=? WHERE key=?').run(v, new Date().toISOString(), r.key);
  }
});

const loc = {
  lgas: (state) => db.prepare('SELECT DISTINCT lga FROM locations WHERE state=? ORDER BY lga COLLATE NOCASE').all(state).map((r) => r.lga),
  wards: (state, lga) => db.prepare('SELECT DISTINCT ward FROM locations WHERE state=? AND lga=? AND ward IS NOT NULL ORDER BY ward COLLATE NOCASE').all(state, lga).map((r) => r.ward),
  pus: (state, lga, ward, q = '', limit = 50) => {
    const like = '%' + String(q).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    return db.prepare(`SELECT DISTINCT polling_unit FROM locations WHERE state=? AND lga=? AND ward=? AND polling_unit IS NOT NULL
      AND polling_unit LIKE ? ESCAPE '\\' ORDER BY polling_unit COLLATE NOCASE LIMIT ?`).all(state, lga, ward, like, limit).map((r) => r.polling_unit);
  },
};

function audit(admin, action, target, detail, ip) {
  db.prepare('INSERT INTO audit_log(admin_id,admin_email,action,target,detail,ip,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(admin ? admin.id : null, admin ? admin.email : null, action, target == null ? null : String(target), detail == null ? null : String(detail).slice(0, 500), ip || null, iso());
}

module.exports = { db, tx, iso, PERMISSIONS, DEFAULT_ADMIN_PERMS, parsePerms, hasPerm, lagosDate, lagosYear, STATES, SEED_LGAS, getSettings, setSetting, DEFAULTS, loc, audit };
