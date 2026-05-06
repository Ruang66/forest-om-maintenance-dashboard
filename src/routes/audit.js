const express = require('express');
const { pool } = require('../db');
const authn = require('../middleware/authn');
const authz = require('../middleware/authz');

const router = express.Router();
router.use(authn, authz('editor'));

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
  const { rows } = await pool.query(
    `SELECT a.id, u.email AS user_email, a.action, a.entity_type, a.entity_id, a.before, a.after, a.at
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.at DESC
     LIMIT $1`,
    [limit]
  );
  res.json(rows);
});

module.exports = router;
