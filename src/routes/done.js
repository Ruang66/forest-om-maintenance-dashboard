const express = require('express');
const { pool } = require('../db');
const authn = require('../middleware/authn');
const authz = require('../middleware/authz');
const { isValidYear } = require('../schedule');

const router = express.Router();
router.use(authn);

// Returns done state as flat key map: { "siteId::year::monthIdx::comp": { at, by } }
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.site_id, d.year, d.month_idx, d.component, d.done_at, u.email AS done_by
     FROM done_records d LEFT JOIN users u ON u.id = d.done_by`
  );
  const done = {};
  for (const r of rows) {
    done[`${r.site_id}::${r.year}::${r.month_idx}::${r.component}`] = { at: r.done_at, by: r.done_by || null };
  }
  res.json(done);
});

router.post('/', authz('editor'), async (req, res) => {
  const { site_id, month_idx, component, done } = req.body || {};
  // Clients from before multi-year support do not send a year; they only knew 2026
  const year = req.body && req.body.year != null ? Number(req.body.year) : 2026;
  const m = Number(month_idx);
  if (!site_id || !Number.isInteger(m) || m < 0 || m > 11 || !component) return res.status(400).json({ error: 'site_id, month_idx (0-11), component required' });
  if (!['cln', 'insp'].includes(component)) return res.status(400).json({ error: 'component must be cln or insp' });
  if (!isValidYear(year)) return res.status(400).json({ error: 'Invalid year' });
  const key = `${site_id}::${year}::${m}::${component}`;

  if (done) {
    const { rows } = await pool.query(
      `INSERT INTO done_records (site_id, year, month_idx, component, done_at, done_by)
       VALUES ($1,$2,$3,$4,now(),$5)
       ON CONFLICT (site_id, year, month_idx, component) DO UPDATE SET done_at = now(), done_by = $5
       RETURNING done_at`,
      [site_id, year, m, component, req.user.sub]
    );
    await pool.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4)',
      [req.user.sub, 'done.tick', 'done', key]
    );
    return res.json({ ok: true, at: rows[0].done_at, by: req.user.email });
  }

  const { rows } = await pool.query(
    'DELETE FROM done_records WHERE site_id=$1 AND year=$2 AND month_idx=$3 AND component=$4 RETURNING done_at, done_by',
    [site_id, year, m, component]
  );
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id, before) VALUES ($1,$2,$3,$4,$5)',
    [req.user.sub, 'done.untick', 'done', key, rows[0] ? JSON.stringify(rows[0]) : null]
  );
  res.json({ ok: true });
});

module.exports = router;
