'use strict';
const { STATES, loc } = require('./db');

const NAME_RE = /^[\p{L}][\p{L}\p{M}'’.\- ]*$/u;
const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const ci = (a, b) => a.toLowerCase() === b.toLowerCase();

function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+234')) d = '0' + d.slice(4);
  else if (d.startsWith('234') && d.length === 13) d = '0' + d.slice(3);
  return /^0[789][01]\d{8}$/.test(d) ? d : null;
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}
function ageOn(dob, now = new Date()) {
  let a = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) a--;
  return a;
}

function sniffImage(buf) {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

// Decodes a base64 / data-URL string. Returns { buf, mime } or { error }.
function decodeImage(input, { maxBytes, allowed }) {
  let b64 = typeof input === 'string' ? input : input && typeof input.data === 'string' ? input.data : '';
  b64 = b64.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { error: 'missing' };
  if (b64.length > Math.ceil(maxBytes * 1.4) + 8) return { error: 'size' };
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > maxBytes) return { error: 'size' };
  const mime = sniffImage(buf);
  if (!mime || !allowed.includes(mime)) return { error: 'type' };
  return { buf, mime };
}

/**
 * Validate a registration (mode "create") or an administrator edit (mode "edit").
 * Returns { errors, clean }. `errors` is { field: message } and is empty when valid.
 */
function validateMember(body, { settings, mode = 'create' }) {
  const e = {};
  const c = {};
  body = body || {};

  // --- names
  c.first_name = norm(body.first_name);
  c.middle_name = norm(body.middle_name);
  c.last_name = norm(body.last_name);
  c.full_name = norm(body.full_name);
  const nameOk = (v, max = 60) => v.length >= 2 && v.length <= max && NAME_RE.test(v);
  if (!c.full_name) e.full_name = 'Please enter your full name.';
  else if (!nameOk(c.full_name, 120)) e.full_name = 'Please enter a valid full name using letters only.';
  if (!c.first_name) e.first_name = 'Please enter your first name.';
  else if (!nameOk(c.first_name)) e.first_name = 'Please enter a valid first name using letters only.';
  if (c.middle_name && !nameOk(c.middle_name)) e.middle_name = 'Please enter a valid middle name using letters only, or leave it blank.';
  if (!c.last_name) e.last_name = 'Please enter your last name.';
  else if (!nameOk(c.last_name)) e.last_name = 'Please enter a valid last name using letters only.';
  if (!e.full_name && !e.first_name && !e.last_name) {
    const lower = c.full_name.toLowerCase();
    if (!lower.includes(c.first_name.toLowerCase()) || !lower.includes(c.last_name.toLowerCase())) {
      e.full_name = 'Your full name should include your first name and last name.';
    }
  }

  // --- contact
  const phone = normalizePhone(body.phone);
  if (!norm(body.phone)) e.phone = 'Please enter your phone number.';
  else if (!phone) e.phone = 'Please enter a valid Nigerian phone number, for example 08012345678.';
  else c.phone = phone;
  c.email = norm(body.email).toLowerCase();
  if (c.email && (c.email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email))) e.email = 'Please enter a valid email address, or leave it blank.';

  // --- DOB / gender
  const minAge = parseInt(settings.min_age, 10) || 18;
  const dob = validDate(norm(body.date_of_birth));
  if (!norm(body.date_of_birth)) e.date_of_birth = 'Please enter your date of birth.';
  else if (!dob) e.date_of_birth = 'Please enter a valid date of birth.';
  else if (dob > new Date()) e.date_of_birth = 'Date of birth cannot be in the future.';
  else if (ageOn(dob) < minAge) e.date_of_birth = `You must be at least ${minAge} years old to register.`;
  else if (ageOn(dob) > 110) e.date_of_birth = 'Please enter a valid date of birth.';
  else c.date_of_birth = norm(body.date_of_birth);
  c.gender = norm(body.gender);
  if (!c.gender) e.gender = 'Please select your gender.';
  else if (!['Male', 'Female'].includes(c.gender)) e.gender = 'Please select your gender.';

  // --- location (validated against official data when it exists; free text otherwise)
  const stateIn = norm(body.state);
  const state = STATES.find((s) => ci(s, stateIn));
  if (!stateIn) e.state = 'Please select your State.';
  else if (!state) e.state = 'Please select a valid State.';
  else c.state = state;

  const free = (v, label, max = 120) => {
    if (v.length > max || /[<>]/.test(v)) return `Please enter a valid ${label}.`;
    return null;
  };

  if (state) {
    const lgaIn = norm(body.lga);
    const lgas = loc.lgas(state);
    if (!lgaIn) e.lga = 'Please select your Local Government Area.';
    else if (lgas.length) {
      const m = lgas.find((x) => ci(x, lgaIn));
      if (!m) e.lga = 'Please select a valid Local Government Area for your State.'; else c.lga = m;
    } else if (free(lgaIn, 'Local Government Area', 80)) e.lga = free(lgaIn, 'Local Government Area', 80);
    else c.lga = lgaIn;

    if (c.lga) {
      const strict = settings.strict_locations === '1';
      const wardIn = norm(body.ward);
      const wards = loc.wards(state, c.lga);
      if (!wardIn) e.ward = 'Please select your Ward.';
      else if (wards.length) {
        const m = wards.find((x) => ci(x, wardIn));
        if (!m) e.ward = 'Please select a valid Ward for your Local Government Area.'; else c.ward = m;
      } else if (strict) e.ward = 'The Ward list for this Local Government Area is not available yet. Please try again later.';
      else if (free(wardIn, 'Ward', 80)) e.ward = free(wardIn, 'Ward', 80);
      else c.ward = wardIn;

      if (c.ward) {
        const puIn = norm(body.polling_unit);
        const pus = wards.length ? loc.pus(state, c.lga, c.ward, '', 100000) : [];
        if (!puIn) e.polling_unit = 'Please select your Polling Unit.';
        else if (pus.length) {
          const m = pus.find((x) => ci(x, puIn));
          if (!m) e.polling_unit = 'Please select your Polling Unit from the list.'; else c.polling_unit = m;
        } else if (strict) e.polling_unit = 'The Polling Unit list for this Ward is not available yet. Please try again later.';
        else if (free(puIn, 'Polling Unit', 160)) e.polling_unit = free(puIn, 'Polling Unit', 160);
        else c.polling_unit = puIn;
      }
    }
  } else {
    if (!norm(body.lga)) e.lga = 'Please select your Local Government Area.';
    if (!norm(body.ward)) e.ward = 'Please select your Ward.';
    if (!norm(body.polling_unit)) e.polling_unit = 'Please select your Polling Unit.';
  }

  if (mode === 'create') {
    // --- NIN (format only; this portal does not verify NINs against any national database)
    const nin = String(body.nin ?? '').replace(/[\s-]/g, '');
    if (!nin) e.nin = 'Please enter your NIN.';
    else if (!/^\d{11}$/.test(nin)) e.nin = 'Your NIN must be exactly 11 digits.';
    else c.nin = nin;

    // --- passport photo
    const maxBytes = (parseInt(settings.max_passport_kb, 10) || 500) * 1024;
    const img = decodeImage(body.passport_photo, { maxBytes, allowed: ['image/jpeg', 'image/png'] });
    if (img.error === 'missing') e.passport_photo = 'Please upload a passport photograph.';
    else if (img.error === 'size') e.passport_photo = `Your photograph is too large. The maximum size is ${Math.round(maxBytes / 1024)} KB.`;
    else if (img.error === 'type') e.passport_photo = 'Please upload a JPG, JPEG or PNG image.';
    else c.photo = img;

    // --- consent
    if (body.consent_accuracy !== true) e.consent_accuracy = 'Please confirm that your information is accurate and that you consent to its processing.';
    if (body.consent_privacy !== true) e.consent_privacy = 'Please agree to the Privacy Policy.';
  }
  return { errors: e, clean: c };
}

const maskNin = (last4) => '*******' + String(last4 || '').padStart(4, '*');
const maskName = (name) => String(name).split(' ').filter(Boolean).map((w) => w[0] + '*'.repeat(Math.min(Math.max(w.length - 1, 1), 5))).join(' ');

module.exports = { validateMember, normalizePhone, decodeImage, sniffImage, maskNin, maskName, norm };
