const ROLE_RANK = { viewer: 0, editor: 1, admin: 2 };

module.exports = function authz(minRole) {
  return (req, res, next) => {
    const userRank = ROLE_RANK[req.user?.role] ?? -1;
    const required = ROLE_RANK[minRole] ?? 99;
    if (userRank < required) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
};
