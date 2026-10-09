-- AYNM membership portal: SQLite schema (applied idempotently on start-up by lib/db.js).
-- Sensitive columns: members.nin_encrypted (AES-256-GCM), members.nin_hash (HMAC, duplicate check only),
-- members.passport_photo (name of an AES-256-GCM encrypted file in DATA_DIR/private/photos, never web-served).

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin','admin')),
  permissions   TEXT,                     -- comma-separated; only used for role 'admin' (super_admin has all)
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash      TEXT PRIMARY KEY,          -- SHA-256 of the cookie value
  admin_id     INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One-time invitations created by a super admin. The raw token is shown once and only its hash is stored.
CREATE TABLE IF NOT EXISTS admin_invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL COLLATE NOCASE,
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL CHECK (role IN ('super_admin','admin')),
  permissions TEXT NOT NULL DEFAULT '',
  created_by  INTEGER,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

CREATE TABLE IF NOT EXISTS registration_counters (
  year     INTEGER PRIMARY KEY,
  last_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id   TEXT NOT NULL UNIQUE,
  full_name         TEXT NOT NULL,
  first_name        TEXT NOT NULL,
  middle_name       TEXT,
  last_name         TEXT NOT NULL,
  phone             TEXT NOT NULL,
  email             TEXT,
  date_of_birth     TEXT NOT NULL,
  gender            TEXT NOT NULL CHECK (gender IN ('Male','Female')),
  state             TEXT NOT NULL,
  lga               TEXT NOT NULL,
  ward              TEXT NOT NULL,
  polling_unit      TEXT NOT NULL,
  nin_encrypted     BLOB NOT NULL,          -- nin (encrypted)
  nin_last4         TEXT NOT NULL,          -- for masked display only
  nin_hash          TEXT NOT NULL UNIQUE,   -- HMAC for duplicate detection
  passport_photo    TEXT,                   -- private encrypted file name
  registration_date TEXT NOT NULL,          -- YYYY-MM-DD (Africa/Lagos)
  status            TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  consent_at        TEXT NOT NULL,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  idempotency_key   TEXT UNIQUE,
  status_changed_at TEXT,
  status_changed_by INTEGER,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_state   ON members(state);
CREATE INDEX IF NOT EXISTS idx_members_lga     ON members(state, lga);
CREATE INDEX IF NOT EXISTS idx_members_ward    ON members(state, lga, ward);
CREATE INDEX IF NOT EXISTS idx_members_status  ON members(status);
CREATE INDEX IF NOT EXISTS idx_members_created ON members(created_at);
CREATE INDEX IF NOT EXISTS idx_members_phone   ON members(phone);

-- Official location data. Ships with LGAs for a few states; the admin imports wards and polling units (CSV).
CREATE TABLE IF NOT EXISTS locations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  state        TEXT NOT NULL,
  lga          TEXT NOT NULL,
  ward         TEXT,
  polling_unit TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_locations ON locations(state, lga, COALESCE(ward,''), COALESCE(polling_unit,''));
CREATE INDEX IF NOT EXISTS idx_locations_state ON locations(state, lga, ward);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER,
  admin_email TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
