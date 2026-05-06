const express = require('express');
const { pool } = require('../db');
const authn = require('../middleware/authn');
const authz = require('../middleware/authz');

const router = express.Router();
router.use(authn);

// Returns done state as flat key map: { "siteId::monthIdx::comp": { at: ISO } }
router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT site_id, month_idx, component, done_at FROM done_records');
  const done = {};
  for (const r of rows) {
    done[`${r.site_id}::${r.month_idx}::${r.component}`] = { at: r.done_at };
  }
  res.json(done);
});

router.post('/', authz('editor'), async (req, res) => {
  const { site_id, month_idx, component, done } = req.body;
  if (!site_id || month_idx == null || !component) return res.status(400).json({ error: 'site_id, month_idx, component required' });
  if (!['cln','insp'].includes(component)) return res.status(400).json({ error: 'component must be cln or insp' });

  if (done) {
    await pool.query(
      `INSERT INTO done_records (site_id, month_idx, component, done_at, done_by)
       VALUES ($1,$2,$3,now(),$4)
       ON CONFLICT (site_id, month_idx, component) DO UPDATE SET done_at = now(), done_by = $4`,
      [site_id, month_idx, component, req.user.sub]
    );
    await pool.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4)',
      [req.user.sub, 'done.tick', 'done', `${site_id}::${month_idx}::${component}`]
    );
  } else {
    await pool.query(
      'DELETE FROM done_records WHERE site_id=$1 AND month_idx=$2 AND component=$3',
      [site_id, month_idx, component]
    );
    await pool.query(
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4)',
      [req.user.sub, 'done.untick', 'done', `${site_id}::${month_idx}::${component}`]
    );
  }
  res.json({ ok: true });
});

module.exports = router;
