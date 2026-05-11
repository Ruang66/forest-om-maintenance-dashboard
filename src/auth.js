const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = '30d';

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

async function ensureAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.warn('ADMIN_EMAIL not set - skipping admin bootstrap');
    return;
  }
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (rows.length > 0) return;

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword) {
    const hash = await hashPassword(adminPassword);
    await pool.query(
      'INSERT INTO users (email, role, password_hash) VALUES ($1, $2, $3)',
      [adminEmail, 'admin', hash]
    );
    console.log('\n==============================================');
    console.log('Admin account created for:', adminEmail);
    console.log('==============================================\n');
  } else {
    const token = uuidv4();
    const expires = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO users (email, role, invite_token, invite_expires_at) VALUES ($1, $2, $3, $4)',
      [adminEmail, 'admin', token, expires]
    );
    const baseUrl = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000);
    console.log('\n==============================================');
    console.log('ADMIN SETUP LINK (expires in 72 hours):');
    console.log(baseUrl + '/set-password.html?token=' + token);
    console.log('==============================================\n');
  }
}

module.exports = { signToken, verifyToken, hashPassword, checkPassword, ensureAdminUser };
