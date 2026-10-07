const { isWithinRateLimit } = require('../services/rateLimiter');

async function adminApiRateLimit(req, res, next) {
  try {
    const allowed = await isWithinRateLimit(
      'admin-api',
      req.auth ? `admin:${req.auth.id}` : req.ip || req.socket?.remoteAddress || 'unknown',
      300,
      60 * 1000
    );

    if (!allowed) {
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
      });
    }

    return next();
  } catch (error) {
    console.error('Admin API rate limit failed:', error.message);
    return res.status(503).json({ success: false, message: 'Admin API is temporarily unavailable' });
  }
}

module.exports = adminApiRateLimit;
