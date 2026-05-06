const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const authn = require('../middleware/authn');
const authz = require('../middleware/authz');

const router = express.Router();
router.use(authn);

const ALLOWED_MIME = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = process.env.SLA_PATH || '/data/sla';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, req.params.id + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

router.get('/:id/sla', async (req, res) => {
  const { rows } = await pool.query('SELECT sla_filename, sla_mime FROM sites WHERE id = $1', [req.params.id]);
  if (!rows[0] || !rows[0].sla_filename) return res.status(404).json({ error: 'No SLA file' });
  const ext = path.extname(rows[0].sla_filename);
  const filePath = path.join(process.env.SLA_PATH || '/data/sla', req.params.id + ext);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  res.setHeader('Content-Type', rows[0].sla_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="' + rows[0].sla_filename + '"');
  fs.createReadStream(filePath).pipe(res);
});

router.post('/:id/sla', authz('editor'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  await pool.query(
    'UPDATE sites SET sla_filename=$1, sla_size=$2, sla_uploaded_at=now(), sla_mime=$3, updated_at=now() WHERE id=$4',
    [req.file.originalname, req.file.size, req.file.mimetype, req.params.id]
  );
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4)',
    [req.user.sub, 'sla.upload', 'site', req.params.id]
  );
  res.json({ ok: true, filename: req.file.originalname, size: req.file.size, mime: req.file.mimetype });
});

router.delete('/:id/sla', authz('editor'), async (req, res) => {
  const { rows } = await pool.query('SELECT sla_filename FROM sites WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Site not found' });
  if (rows[0].sla_filename) {
    const ext = path.extname(rows[0].sla_filename);
    const filePath = path.join(process.env.SLA_PATH || '/data/sla', req.params.id + ext);
    fs.unlink(filePath, () => {});
  }
  await pool.query(
    'UPDATE sites SET sla_filename=NULL, sla_size=NULL, sla_uploaded_at=NULL, sla_mime=NULL WHERE id=$1',
    [req.params.id]
  );
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4)',
    [req.user.sub, 'sla.delete', 'site', req.params.id]
  );
  res.json({ ok: true });
});

module.exports = router;
