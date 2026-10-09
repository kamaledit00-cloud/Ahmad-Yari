'use strict';
// Usage: npm run create-admin -- you@example.com "Full Name" super_admin|admin [permission,permission,...]
// Permissions (role admin only): members_view, members_manage, members_export, members_delete, locations_manage, settings_manage, audit_view
// The password is read from the ADMIN_PASSWORD env var or prompted (hidden). It is never stored in plain text.
const readline = require('readline');
const { db, DEFAULT_ADMIN_PERMS, parsePerms } = require('../lib/db');
const sec = require('../lib/crypto');

function ask(q, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(q); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}
(async () => {
  const [email, name = '', role = 'admin', permArg] = process.argv.slice(2);
  const perms = role === 'super_admin' ? '' : (permArg !== undefined ? parsePerms(permArg).join(',') : DEFAULT_ADMIN_PERMS);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('Usage: npm run create-admin -- email@example.com "Full Name" super_admin|admin [permissions]'); process.exit(1); }
  if (!['super_admin', 'admin'].includes(role)) { console.error('Role must be super_admin or admin.'); process.exit(1); }
  const password = process.env.ADMIN_PASSWORD || await ask('Password (min 12 chars, letters and numbers): ', true);
  const problem = sec.passwordProblem(password);
  if (problem) { console.error(problem); process.exit(1); }
  const hash = await sec.hashPassword(password);
  const existing = db.prepare('SELECT id FROM admins WHERE email=?').get(email.toLowerCase());
  if (existing) { db.prepare('UPDATE admins SET password_hash=?, name=?, role=?, permissions=?, is_active=1, updated_at=? WHERE id=?').run(hash, name, role, perms, new Date().toISOString(), existing.id); console.log('Updated existing administrator.'); }
  else { db.prepare('INSERT INTO admins(email,name,password_hash,role,permissions) VALUES(?,?,?,?,?)').run(email.toLowerCase(), name, hash, role, perms); console.log(`Created ${role}: ${email}`); }
})();
