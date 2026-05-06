const express = require('express');
const { pool } = require('../db');
const authn = require('../middleware/authn');
const authz = require('../middleware/authz');

const router = express.Router();
router.use(authn);

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, data, sla_filename, sla_size, sla_uploaded_at, sla_mime FROM sites ORDER BY (data->>\'name\')'
  );
  const sites = rows.map(r => ({
    id: r.id,
    ...r.data,
    sla_filename: r.sla_filename || null,
    sla_size: r.sla_size || null,
    sla_uploaded_at: r.sla_uploaded_at || null,
    sla_mime: r.sla_mime || null
  }));
  res.json(sites);
});

router.post('/', authz('editor'), async (req, res) => {
  const site = req.body;
  if (!site.id || !site.name) return res.status(400).json({ error: 'id and name required' });
  const { id, sla_filename, sla_size, sla_uploaded_at, sla_mime, ...data } = site;
  const { rowCount } = await pool.query(
    'INSERT INTO sites (id, data) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [id, JSON.stringify(data)]
  );
  if (!rowCount) return res.status(409).json({ error: 'Site ID already exists' });
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id, after) VALUES ($1,$2,$3,$4,$5)',
    [req.user.sub, 'site.create', 'site', id, JSON.stringify(site)]
  );
  res.status(201).json({ ok: true, id });
});

router.put('/:id', authz('editor'), async (req, res) => {
  const site = req.body;
  const { id, sla_filename, sla_size, sla_uploaded_at, sla_mime, ...data } = site;
  const before = await pool.query('SELECT data FROM sites WHERE id = $1', [req.params.id]);
  const { rowCount } = await pool.query(
    'UPDATE sites SET data = $1, updated_at = now() WHERE id = $2',
    [JSON.stringify(data), req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Site not found' });
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id, before, after) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.user.sub, 'site.update', 'site', req.params.id,
     JSON.stringify(before.rows[0]?.data), JSON.stringify(data)]
  );
  res.json({ ok: true });
});

router.delete('/:id', authz('editor'), async (req, res) => {
  const before = await pool.query('SELECT data FROM sites WHERE id = $1', [req.params.id]);
  const { rowCount } = await pool.query('DELETE FROM sites WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Site not found' });
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id, before) VALUES ($1,$2,$3,$4,$5)',
    [req.user.sub, 'site.delete', 'site', req.params.id, JSON.stringify(before.rows[0]?.data)]
  );
  res.json({ ok: true });
});

module.exports = router;
