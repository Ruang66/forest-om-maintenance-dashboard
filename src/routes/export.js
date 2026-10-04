const express = require('express');
const { pool } = require('../db');
const authn = require('../middleware/authn');
const authz = require('../middleware/authz');

const router = express.Router();
router.use(authn, authz('editor'));

// Full backup of the planning data, straight from the database
router.get('/', async (req, res) => {
  const sites = await pool.query('SELECT id, data, sla_filename, sla_size, sla_uploaded_at, sla_mime, updated_at FROM sites ORDER BY id');
  const done = await pool.query(
    `SELECT d.site_id, d.year, d.month_idx, d.component, d.done_at, u.email AS done_by
     FROM done_records d LEFT JOIN users u ON u.id = d.done_by
     ORDER BY d.site_id, d.year, d.month_idx, d.component`
  );
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="fe_om_backup_${stamp}.json"`);
  res.json({ exported_at: new Date().toISOString(), sites: sites.rows, done_records: done.rows });
});

module.exports = router;
