const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const authn = require('../middleware/authn');
const authz = require('../middleware/authz');

const router = express.Router();
router.use(authn, authz('admin'));

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, role, created_at, last_login_at, invite_expires_at IS NOT NULL AND invite_expires_at > now() AS pending_invite FROM users ORDER BY created_at'
  );
  res.json(rows);
});

router.post('/invite', async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) return res.status(400).json({ error: 'email and role required' });
  if (!['admin','editor','viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (existing.rows.length) return res.status(409).json({ error: 'User already exists' });

  const token = uuidv4();
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO users (email, role, invite_token, invite_expires_at) VALUES ($1,$2,$3,$4)',
    [email.toLowerCase().trim(), role, token, expires]
  );

  const baseUrl = process.env.BASE_URL || ('http://localhost:' + (process.env.PORT || 3000));
  const link = baseUrl + '/set-password.html?token=' + token;
  console.log('INVITE LINK for', email, ':', link);
  res.json({ invite_link: link });
});

router.patch('/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['admin','editor','viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (req.params.id === req.user.sub) return res.status(400).json({ error: 'Cannot change your own role' });
  const { rowCount } = await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  if (req.params.id === req.user.sub) return res.status(400).json({ error: 'Cannot delete yourself' });
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

module.exports = router;
