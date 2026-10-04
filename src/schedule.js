// Shared schedule helpers. Activity code grammar matches the dashboard:
// "3 cln 1 Insp" = 3rd clean + partial inspection, "1 F Insp" = full annual inspection.

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LEGACY_YEAR = '2026'; // the only year the app supported before multi-year

function isValidYear(y) {
  const n = Number(y);
  return Number.isInteger(n) && n >= 2020 && n <= 2100;
}

function isValidSiteId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);
}

function decomposeCode(code) {
  if (!code) return { cleanNum: 0, partial: false, annual: false };
  const c = String(code).trim();
  const m = c.match(/(\d+)\s*cln/i);
  const remainder = c.replace(/\d+\s*cln/i, '').trim();
  const annual = /F\s*In(sp|ps)/i.test(remainder);
  const partial = !annual && /In(sp|ps)/i.test(remainder);
  return { cleanNum: m ? parseInt(m[1], 10) : 0, partial, annual };
}

function composeCode(cleanNum, partial, annual) {
  const parts = [];
  if (cleanNum > 0) parts.push(cleanNum + ' cln');
  if (annual) parts.push('1 F Insp');
  else if (partial) parts.push('1 Insp');
  return parts.join(' ');
}

// Keep only Jan..Dec string values
function cleanMonths(months) {
  const out = {};
  for (const m of MONTHS) {
    const v = months && months[m];
    out[m] = typeof v === 'string' ? v.trim() : '';
  }
  return out;
}

// Pulls the schedules a client sent. Older clients send a single-year "months" object.
function incomingSchedules(body) {
  const out = {};
  if (body.schedules && typeof body.schedules === 'object') {
    for (const [y, months] of Object.entries(body.schedules)) {
      if (isValidYear(y)) out[String(y)] = cleanMonths(months);
    }
  } else if (body.months && typeof body.months === 'object') {
    out[LEGACY_YEAR] = cleanMonths(body.months);
  }
  return out;
}

// Normalise stored data so every site exposes "schedules"
function normaliseData(data) {
  const d = { ...(data || {}) };
  if (!d.schedules && d.months) d.schedules = { [LEGACY_YEAR]: d.months };
  delete d.months;
  if (!d.schedules) d.schedules = {};
  return d;
}

module.exports = { MONTHS, isValidYear, isValidSiteId, decomposeCode, composeCode, incomingSchedules, normaliseData };
