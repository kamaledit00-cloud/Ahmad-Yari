'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');

// Minimal .env loader (no dependency). Real environment variables win.
(function loadEnv() {
  const f = path.join(root, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const dataDir = path.resolve(env.DATA_DIR || path.join(root, 'data-store'));
const photoDir = path.join(dataDir, 'private', 'photos');
const assetsDir = path.join(dataDir, 'assets');
for (const d of [dataDir, photoDir, assetsDir]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });

let keyHex = (env.NIN_ENCRYPTION_KEY || '').trim();
if (!keyHex) {
  if (isProd) throw new Error('NIN_ENCRYPTION_KEY is required in production. Generate one with: npm run gen-key');
  const kf = path.join(dataDir, '.dev-key');
  if (!fs.existsSync(kf)) fs.writeFileSync(kf, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  keyHex = fs.readFileSync(kf, 'utf8').trim();
  console.warn('[config] NIN_ENCRYPTION_KEY not set: using a local DEVELOPMENT key. Do not use this for real data.');
}
if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('NIN_ENCRYPTION_KEY must be exactly 64 hex characters.');
const master = Buffer.from(keyHex, 'hex');
const subkey = (label) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), label, 32));

module.exports = {
  root, isProd, dataDir, photoDir, assetsDir,
  port: parseInt(env.PORT || '3000', 10),
  publicOrigin: (env.PUBLIC_ORIGIN || '').replace(/\/+$/, ''),
  trustProxy: env.TRUST_PROXY === '1',
  cookieSecure: isProd || env.COOKIE_SECURE === '1',
  encKey: subkey('aynm-enc-v1'),
  hmacKey: subkey('aynm-hmac-v1'),
  bootstrapEmail: env.ADMIN_EMAIL || '',
  bootstrapPassword: env.ADMIN_PASSWORD || '',
};
