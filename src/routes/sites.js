const express = require('express');
const { pool } = require('../db');
const authn = require('../middleware/authn');
const authz = require('../middleware/authz');
const { MONTHS, isValidYear, isValidSiteId, decomposeCode, composeCode, incomingSchedules, normaliseData } = require('../schedule');

const router = express.Router();
router.use(authn);

const SLA_FIELDS = ['sla_filename', 'sla_size', 'sla_uploaded_at', 'sla_mime'];

// Strip fields that are not part of the stored site JSON
function detailsFrom(body) {
  const d = { ...body };
  delete d.id; delete d.months; delete d.schedules; delete d._version;
  SLA_FIELDS.forEach(f => delete d[f]);
  return d;
}

function toClient(r) {
  return {
    id: r.id,
    ...normaliseData(r.data),
    sla_filename: r.sla_filename || null,
    sla_size: r.sla_size || null,
    sla_uploaded_at: r.sla_uploaded_at || null,
    sla_mime: r.sla_mime || null,
    _version: r.updated_at ? new Date(r.updated_at).toISOString() : null
  };
}

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, data, sla_filename, sla_size, sla_uploaded_at, sla_mime, updated_at FROM sites ORDER BY (data->>\'name\')'
  );
  res.json(rows.map(toClient));
});

router.post('/', authz('editor'), async (req, res) => {
  const site = req.body || {};
  const id = typeof site.id === 'string' ? site.id.trim() : String(site.id || '');
  if (!id || !site.name) return res.status(400).json({ error: 'id and name required' });
  if (!isValidSiteId(id)) return res.status(400).json({ error: 'Site ID may only contain letters, numbers, - and _' });
  const data = { ...detailsFrom(site), schedules: incomingSchedules(site) };
  const { rows } = await pool.query(
    'INSERT INTO sites (id, data) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id, data, sla_filename, sla_size, sla_uploaded_at, sla_mime, updated_at',
    [id, JSON.stringify(data)]
  );
  if (!rows.length) return res.status(409).json({ error: 'Site ID already exists' });
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id, after) VALUES ($1,$2,$3,$4,$5)',
    [req.user.sub, 'site.create', 'site', id, JSON.stringify(data)]
  );
  res.status(201).json(toClient(rows[0]));
});

// Apply one activity to many sites for one month of one year
router.post('/bulk-schedule', authz('editor'), async (req, res) => {
  const { year, month, activity, clean_num, site_ids } = req.body || {};
  if (!isValidYear(year)) return res.status(400).json({ error: 'Invalid year' });
  if (!MONTHS.includes(month)) return res.status(400).json({ error: 'Invalid month' });
  if (!['cln', 'insp', 'annual'].includes(activity)) return res.status(400).json({ error: 'Invalid activity' });
  if (!Array.isArray(site_ids) || !site_ids.length) return res.status(400).json({ error: 'site_ids required' });
  const cleanNum = parseInt(clean_num, 10);
  if (activity === 'cln' && !(cleanNum >= 1 && cleanNum <= 6)) return res.status(400).json({ error: 'Invalid clean number' });
  const y = String(year);

  const updated = await withTx(async client => {
    const { rows } = await client.query('SELECT id, data FROM sites WHERE id = ANY($1) FOR UPDATE', [site_ids.map(String)]);
    const out = [];
    for (const r of rows) {
      const data = normaliseData(r.data);
      const months = { ...Object.fromEntries(MONTHS.map(m => [m, ''])), ...(data.schedules[y] || {}) };
      const before = months[month] || '';
      const dec = decomposeCode(before);
      if (activity === 'cln') dec.cleanNum = cleanNum;
      else if (activity === 'insp') { dec.partial = true; dec.annual = false; }
      else { dec.annual = true; dec.partial = false; }
      months[month] = composeCode(dec.cleanNum, dec.partial, dec.annual);
      data.schedules[y] = months;
      const u = await client.query(
        'UPDATE sites SET data = $1, updated_at = now() WHERE id = $2 RETURNING id, data, sla_filename, sla_size, sla_uploaded_at, sla_mime, updated_at',
        [JSON.stringify(data), r.id]
      );
      await client.query(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, before, after) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.user.sub, 'site.bulk_schedule', 'site', r.id,
         JSON.stringify({ year: y, month, code: before }), JSON.stringify({ year: y, month, code: months[month] })]
      );
      out.push(toClient(u.rows[0]));
    }
    return out;
  });
  res.json({ ok: true, sites: updated });
});

// Copy one year's plan into another year, only for sites with nothing planned in the target year.
// Never overwrites existing plans and never copies done ticks.
router.post('/copy-year', authz('editor'), async (req, res) => {
  const { from, to } = req.body || {};
  if (!isValidYear(from) || !isValidYear(to) || String(from) === String(to)) return res.status(400).json({ error: 'Invalid years' });
  const f = String(from), t = String(to);
  const isEmpty = months => !months || MONTHS.every(m => !String(months[m] || '').trim());

  const copied = await withTx(async client => {
    const { rows } = await client.query('SELECT id, data FROM sites FOR UPDATE');
    const out = [];
    for (const r of rows) {
      const data = normaliseData(r.data);
      if (isEmpty(data.schedules[f]) || !isEmpty(data.schedules[t])) continue;
      data.schedules[t] = { ...data.schedules[f] };
      const u = await client.query(
        'UPDATE sites SET data = $1, updated_at = now() WHERE id = $2 RETURNING id, data, sla_filename, sla_size, sla_uploaded_at, sla_mime, updated_at',
        [JSON.stringify(data), r.id]
      );
      await client.query(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, after) VALUES ($1,$2,$3,$4,$5)',
        [req.user.sub, 'site.copy_year', 'site', r.id, JSON.stringify({ from: f, to: t, months: data.schedules[t] })]
      );
      out.push(toClient(u.rows[0]));
    }
    return out;
  });
  res.json({ ok: true, count: copied.length, sites: copied });
});

// Updates details and merges schedules per year, so saving one year never touches another.
router.put('/:id', authz('editor'), async (req, res) => {
  const body = req.body || {};
  const result = await withTx(async client => {
    const { rows } = await client.query('SELECT data, updated_at FROM sites WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0]) return { status: 404, body: { error: 'Site not found' } };
    const current = normaliseData(rows[0].data);
    const currentVersion = rows[0].updated_at ? new Date(rows[0].updated_at).toISOString() : null;
    if (body._version && currentVersion && body._version !== currentVersion) {
      return { status: 409, body: { error: 'Someone else changed this site since you opened it. Refresh and try again.' } };
    }
    const next = {
      ...current,
      ...detailsFrom(body),
      schedules: { ...current.schedules, ...incomingSchedules(body) }
    };
    const u = await client.query(
      'UPDATE sites SET data = $1, updated_at = now() WHERE id = $2 RETURNING id, data, sla_filename, sla_size, sla_uploaded_at, sla_mime, updated_at',
      [JSON.stringify(next), req.params.id]
    );
    await client.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, before, after) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.sub, 'site.update', 'site', req.params.id, JSON.stringify(current), JSON.stringify(next)]
    );
    return { status: 200, body: toClient(u.rows[0]) };
  });
  res.status(result.status).json(result.body);
});

router.delete('/:id', authz('editor'), async (req, res) => {
  const before = await pool.query('SELECT data, sla_filename FROM sites WHERE id = $1', [req.params.id]);
  if (!before.rows[0]) return res.status(404).json({ error: 'Site not found' });
  // Keep the done ticks in the audit record so a deleted site can be restored
  const done = await pool.query('SELECT year, month_idx, component, done_at, done_by FROM done_records WHERE site_id = $1', [req.params.id]);
  const { rowCount } = await pool.query('DELETE FROM sites WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Site not found' });
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id, before) VALUES ($1,$2,$3,$4,$5)',
    [req.user.sub, 'site.delete', 'site', req.params.id,
     JSON.stringify({ data: before.rows[0].data, sla_filename: before.rows[0].sla_filename, done_records: done.rows })]
  );
  res.json({ ok: true });
});

module.exports = router;
