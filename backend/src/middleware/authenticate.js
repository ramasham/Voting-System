const { verifyToken } = require('../services/tokens');

function requireRole(role) {
  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+([^\s]+)$/i);

    if (!match) {
      return res.status(401).json({
        success: false,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'A valid bearer token is required',
      });
    }

    try {
      req.auth = verifyToken(match[1], role);
      return next();
    } catch {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'The access token is invalid or expired',
      });
    }
  };
}

module.exports = requireRole;
