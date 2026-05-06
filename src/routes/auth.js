const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { signToken, hashPassword, checkPassword } = require('../auth');
const authn = require('../middleware/authn');

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  const user = rows[0];
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await checkPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

router.post('/set-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE invite_token = $1 AND invite_expires_at > now()',
    [token]
  );
  if (!rows[0]) return res.status(400).json({ error: 'Invalid or expired invite token' });
  const user = rows[0];
  const hash = await hashPassword(password);
  await pool.query(
    'UPDATE users SET password_hash = $1, invite_token = NULL, invite_expires_at = NULL, last_login_at = now() WHERE id = $2',
    [hash, user.id]
  );
  const jwt = signToken(user);
  res.json({ token: jwt, user: { id: user.id, email: user.email, role: user.role } });
});

router.get('/me', authn, async (req, res) => {
  const { rows } = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [req.user.sub]);
  if (!rows[0]) return res.status(401).json({ error: 'User not found' });
  res.json(rows[0]);
});

module.exports = router;
