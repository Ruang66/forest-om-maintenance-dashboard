const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const authn = require('../middleware/authn');
const authz = require('../middleware/authz');
const { isValidSiteId } = require('../schedule');

const router = express.Router();
router.use(authn);

const ALLOWED_MIME = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const slaDir = () => process.env.SLA_PATH || '/data/sla';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = slaDir();
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

// Reject unknown or unsafe site IDs before multer writes anything to disk
async function requireSite(req, res, next) {
  if (!isValidSiteId(req.params.id)) return res.status(400).json({ error: 'Invalid site ID' });
  const { rows } = await pool.query('SELECT sla_filename FROM sites WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Save the plant before uploading its SLA' });
  req.previousSla = rows[0].sla_filename;
  next();
}

function contentDisposition(filename) {
  const ascii = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

router.get('/:id/sla', async (req, res) => {
  const { rows } = await pool.query('SELECT sla_filename, sla_mime FROM sites WHERE id = $1', [req.params.id]);
  if (!rows[0] || !rows[0].sla_filename) return res.status(404).json({ error: 'No SLA file' });
  const ext = path.extname(rows[0].sla_filename);
  const filePath = path.join(slaDir(), req.params.id + ext);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  res.setHeader('Content-Type', rows[0].sla_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(rows[0].sla_filename));
  fs.createReadStream(filePath).pipe(res);
});

router.post('/:id/sla', authz('editor'), requireSite, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // A replacement with a different extension would otherwise leave the old file behind
  const prev = req.previousSla;
  if (prev && path.extname(prev).toLowerCase() !== path.extname(req.file.originalname).toLowerCase()) {
    fs.unlink(path.join(slaDir(), req.params.id + path.extname(prev)), () => {});
  }
  const { rows } = await pool.query(
    'UPDATE sites SET sla_filename=$1, sla_size=$2, sla_uploaded_at=now(), sla_mime=$3, updated_at=now() WHERE id=$4 RETURNING sla_uploaded_at, updated_at',
    [req.file.originalname, req.file.size, req.file.mimetype, req.params.id]
  );
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4)',
    [req.user.sub, 'sla.upload', 'site', req.params.id]
  );
  res.json({ ok: true, filename: req.file.originalname, size: req.file.size, mime: req.file.mimetype,
    uploaded_at: rows[0].sla_uploaded_at, _version: new Date(rows[0].updated_at).toISOString() });
});

router.delete('/:id/sla', authz('editor'), async (req, res) => {
  const { rows } = await pool.query('SELECT sla_filename FROM sites WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Site not found' });
  if (rows[0].sla_filename) {
    const ext = path.extname(rows[0].sla_filename);
    fs.unlink(path.join(slaDir(), req.params.id + ext), () => {});
  }
  const upd = await pool.query(
    'UPDATE sites SET sla_filename=NULL, sla_size=NULL, sla_uploaded_at=NULL, sla_mime=NULL, updated_at=now() WHERE id=$1 RETURNING updated_at',
    [req.params.id]
  );
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4)',
    [req.user.sub, 'sla.delete', 'site', req.params.id]
  );
  res.json({ ok: true, _version: new Date(upd.rows[0].updated_at).toISOString() });
});

module.exports = router;
