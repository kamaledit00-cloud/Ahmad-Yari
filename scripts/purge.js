'use strict';
// Usage: npm run purge            (dry run: shows what would be deleted)
//        npm run purge -- --yes   (deletes Rejected records older than the configured retention days)
const { runRetention } = require('../server');
const dry = !process.argv.includes('--yes');
const r = runRetention(dry, null, 'cli');
console.log(r.enabled ? `${dry ? 'DRY RUN: ' : ''}${r.candidates} rejected record(s) older than ${r.days} days${dry ? ' would be deleted. Re-run with --yes.' : ' deleted.'}` : 'Retention is off (retention_days = 0). Configure it in Admin > Settings.');
process.exit(0);
