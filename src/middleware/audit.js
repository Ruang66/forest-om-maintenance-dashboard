const { pool } = require('../db');

module.exports = function auditLog(action, entityType, getEntityId, getBefore, getAfter) {
  return async (req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = async function(body) {
      if (res.statusCode < 400) {
        try {
          const before = getBefore ? await getBefore(req) : null;
          const after = getAfter ? getAfter(req, body) : null;
          const entityId = getEntityId ? getEntityId(req, body) : null;
          await pool.query(
            'INSERT INTO audit_log (user_id, action, entity_type, entity_id, before, after) VALUES ($1,$2,$3,$4,$5,$6)',
            [req.user?.sub || null, action, entityType, entityId,
             before ? JSON.stringify(before) : null,
             after ? JSON.stringify(after) : null]
          );
        } catch (e) {
          console.error('Audit log error:', e.message);
        }
      }
      return origJson(body);
    };
    next();
  };
};
