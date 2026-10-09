'use strict';
// Usage: npm run import:locations                 (re-imports the bundled data/northern-locations.csv.gz)
//        npm run import:locations -- my-file.csv  (any CSV or .csv.gz with header state,lga,ward,polling_unit)
// Existing rows for the states in the file are replaced. Add --dry-run to only check the file.
const path = require('path');
const locs = require('../lib/locations');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const file = args.find((a) => !a.startsWith('--')) || locs.SEED_FILE;
const r = locs.validateRows(locs.readText(path.resolve(file)));
if (r.error) { console.error(r.error); process.exit(1); }
console.log(`${file}: ${r.valid.length} valid rows for ${r.statesInFile.size} states; ${r.total - r.valid.length} skipped.`);
r.problems.forEach((p) => console.log('  - ' + p));
if (dry) process.exit(0);
console.log(`Imported ${locs.applyRows(r.valid, r.statesInFile, true)} rows (existing rows for those states were replaced).`);
process.exit(0);
