'use strict';
console.log(require('crypto').randomBytes(32).toString('hex'));
console.error('^ Put this in NIN_ENCRYPTION_KEY. Back it up separately from the database. Losing it makes NINs and photos unrecoverable.');
