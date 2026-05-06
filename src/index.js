require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const { runMigrations } = require('./db');
const { ensureAdminUser } = require('./auth');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/sites', require('./routes/sla'));
app.use('/api/sites', require('./routes/sites'));
app.use('/api/done', require('./routes/done'));
app.use('/api/audit', require('./routes/audit'));

// Catch-all: serve index.html for client-side routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  await runMigrations();
  await ensureAdminUser();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Forest Energy O&M server listening on port', port));
}

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
