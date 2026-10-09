# AHMAD YARI NORTHERN MOVEMENT: Membership Registration Portal

A working full-stack membership registration and organization-information site: public pages, a 4-step registration form, unique Registration IDs, public status check, and a secured admin area (dashboard, member management, CSV export, settings, location import, audit log).

**Stack (and why it differs from your suggestion).** Node.js 22 (built-in HTTP server) + SQLite (`node:sqlite`) + vanilla JavaScript/CSS, with **zero required npm dependencies**. It was built in a sandbox without package-registry access, so React/Tailwind/Postgres could not be installed or tested. Everything below was actually run and tested. The data layer is isolated in `lib/db.js` + `db/schema.sql` if you later want PostgreSQL; `sharp` is an optional dependency for server-side image re-encoding.


## What changed in version 2 (rename, branding, Northern states, admin roles)
- **Name:** now AHMAD YARI NORTHERN MOVEMENT everywhere. On start-up, an existing database is migrated safely: stored settings that still contain the old name or the old placeholder texts are updated; text you wrote yourself is kept.
- **Branding:** the official logo is the default logo (header, footer, homepage, confirmation card) and the favicon (`public/favicon.ico`, `public/assets/*`, `public/site.webmanifest`). Uploading a different logo in Admin > Settings replaces it; removing the upload brings the official logo back.
- **States:** only the Northern states are offered: 19 states plus the FCT (North West, North East and North Central). LGA lists are built in for all of them.
- **Location chain:** State > LGA > Ward > Polling Unit, each list showing only the children of the parent chosen, and each child resets when its parent changes.
- **Location data:** the portal ships with `data/northern-locations.csv.gz`, built from the supplied *Northern Nigeria Electoral Dataset* (93,191 polling units, 419 LGAs and about 4,600 wards across the 19 Northern states and the FCT). It is loaded automatically the first time the server starts, and the official-list requirement is switched on (Settings > "Require official lists"). Names follow the source file, with spacing and capitalisation tidied; each polling unit shows its code, e.g. `KADUSA I/PRIMARY SCHOOL (36/05/01/003)`, so identical names stay distinct. **The source file states it is not an independently verified INEC publication: check it against current INEC records before relying on it.** To change it: Admin > Locations (import a CSV, or remove entries), or `npm run import:locations -- file.csv`; to rebuild the bundled file from a new dataset: `npm run build:locations -- path/to/Northern_Nigeria_Polling_Units.csv`. Set `SKIP_LOCATION_SEED=1` to stop the first-start load.
- **Confirmation card:** shows the applicant's photo, name, Registration ID, phone, State, LGA, Ward, Polling Unit and date. It never shows the NIN, date of birth or email. It prints cleanly (Print / Save as PDF). The photo is kept only in that browser tab for the confirmation page.
- **Admin roles:** Super Admin has full control. A Super Admin invites other administrators (one-time link valid 72 hours, shown once), chooses their permissions (view members, approve/reject/edit, export, delete, locations, settings, audit log), can change permissions at any time, deactivate, reactivate or remove them. The last active Super Admin cannot be removed or deactivated, and nobody can lock themselves out. Permissions are checked on the server for every route, not only hidden in the interface.
- The first Super Admin is still the account created with `npm run create-admin` (or `ADMIN_EMAIL`/`ADMIN_PASSWORD` on first start). No password is stored in the source code.

Invitation emails use `lib/mailer.js`. Until a real mail driver is connected, the link is shown to the Super Admin on screen (to send by WhatsApp or email yourself) and printed in the server log.

## Run it locally
```bash
node -v                      # must be 22.5 or newer
npm install --omit=dev       # optional: installs sharp (image re-encoding). The app runs without it.
npm run create-admin -- you@example.com "Your Name" super_admin   # prompts for a password (12+ chars)
npm run seed:demo            # optional: 5 records labelled DEMO DATA
npm start                    # http://localhost:3000
```
Development mode generates a local encryption key in `data-store/.dev-key`. Never use that for real data.

## Tests
`npm test` starts the real server on a temporary database and runs end-to-end API tests (validation, CSRF, auth, roles, rate limiting, encryption at rest, NIN reveal and audit, CSV safety, location import, public-check privacy).

## Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV=production` | yes (prod) | Secure cookies, HSTS, requires the key below |
| `NIN_ENCRYPTION_KEY` | **yes (prod)** | 64 hex chars (`npm run gen-key`). Encrypts NINs and passport photos; keys the duplicate-NIN hash. **Back it up separately; if lost, that data is unrecoverable.** |
| `PUBLIC_ORIGIN` | yes (prod) | Your `https://` URL. Used for reset links and Origin checks |
| `DATA_DIR` | recommended | Persistent folder for database, encrypted photos, logo |
| `PORT` | no | Default 3000 |
| `TRUST_PROXY=1` | behind a proxy | Reads the real client IP for rate limiting |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | optional | Creates the first super admin on first start. Remove afterwards |
| `MAIL_DRIVER` | see below | `console` only prints reset links to the log |

## Production deployment
1. Use a host that gives you a **persistent disk** (a VPS, Render/Railway/Fly volume, etc.). SQLite and photo files live in `DATA_DIR`; serverless/ephemeral file systems will lose data.
2. Put it behind HTTPS (Caddy or nginx with Let's Encrypt, or the platform's TLS). Set `TRUST_PROXY=1` only if the proxy is yours.
3. Set the variables above, run `npm install --omit=dev`, `npm run create-admin`, then `npm start` under a process manager (systemd, pm2, or Docker).
4. **Back up `DATA_DIR` and the encryption key**, separately.
5. Sign in, open **Admin > Settings**, and complete the organization details, contact details, About text and Privacy Policy.

## Database schema
See `db/schema.sql`. Tables: `members` (all requested fields; `nin` is stored as `nin_encrypted` + `nin_last4` + `nin_hash`; `passport_photo` is the name of a private encrypted file), `admins`, `sessions`, `password_resets`, `registration_counters`, `locations`, `settings`, `audit_log`.

## Security design (what is implemented)
- NIN: AES-256-GCM at rest, masked everywhere (`*******1234`), full value only via a **super-admin-only** action that re-asks for the password, auto-hides after 30 s, and is audit-logged. Never in URLs, public pages, CSV or logs.
- Passport photos: type checked by file signature, size-limited, compressed in the browser (and re-encoded server-side if `sharp` is installed, which strips metadata), stored **encrypted** outside the web root, served only to signed-in admins with `no-store`.
- Admin auth: scrypt password hashing, random server-side sessions (HttpOnly, SameSite=Strict, `__Host-` prefix in production, 2 h idle / 12 h absolute), CSRF token + custom header + Origin check, role-based access (`super_admin`, `admin`), password reset tokens that are hashed, single-use and expire in 30 minutes.
- Rate limits: login (per IP and per account), registration, lookups, resets. In-memory: fine for one server process.
- Strict Content-Security-Policy (no inline scripts or styles), all dynamic output escaped, parameterised SQL everywhere, CSV formula-injection neutralised.
- Duplicate protection: one registration per NIN (HMAC check) and an idempotency key so a double-tap or retry cannot create two records.
- Audit log of admin actions (never contains NIN, passwords or photos).

## Things you must still configure or decide
1. **Real email for password reset.** `lib/mailer.js` only logs the link. Connect SMTP or an email API; until then, super admins can reset via `npm run create-admin -- email "Name" super_admin` (an existing email updates the password).
2. **Check the location data.** The bundled ward and polling-unit data comes from the supplied dataset and is unverified (see above). If someone's polling unit is missing, add it in Admin > Locations or turn off the official-list requirement in Settings so that they can type it.
3. **NIN verification.** No verification service is connected and none is claimed; the form says the NIN is recorded as entered.
4. **Privacy Policy, retention and legal review.** The default policy is a template with `[bracketed]` items to complete. Have it reviewed against the data-protection rules that apply to you (for Nigeria, including the Nigeria Data Protection Act 2023).
5. **Logo, colours, contact details, About text.** All placeholders, editable in Admin > Settings.
6. **Retention.** Configurable days for *Rejected* registrations; deletion is run on demand (Settings button or `npm run purge`), never silently. Approved/Pending records are never auto-deleted.
7. Delete the DEMO DATA before launch (Admin > Dashboard > Delete all demo data).
8. Scaling beyond one server process: move the rate limiter to Redis and the database to PostgreSQL.

## Design choices worth knowing
- Registration IDs are sequential (as requested), so the public **Check Registration** page shows the name **partly hidden** by default (`A**** Y**** B****`); otherwise anyone could walk the ID sequence and read member names. Switch to full name in Settings if you accept that.
- Minimum age is configurable (default 18).
- Email is optional on the form; everything else requested is required.
- "Download confirmation" uses the browser's Print dialog (Save as PDF).
- "Excel export" is a UTF-8 CSV that Excel opens directly.
