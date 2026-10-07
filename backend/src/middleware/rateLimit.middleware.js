const { consumeRateLimit } = require('../services/rateLimiter');

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createRateLimiter({ name, max, windowMs }) {
  const consume = (key) => consumeRateLimit(name, key, max, windowMs);

  async function rateLimit(req, res, next) {
    try {
      // Venue Wi-Fi commonly places every attendee behind the same public IP.
      // Authenticated requests therefore share a quota by identity across HTTP
      // and WebSocket, independent of which API process serves the request.
      const key = req.auth ? `${req.auth.role}:${req.auth.id}` : `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
      const result = await consume(key);
      res.set('RateLimit-Limit', String(result.limit));
      res.set('RateLimit-Remaining', String(result.remaining));
      res.set('RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
      if (!result.allowed) {
        res.set('Retry-After', String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
        return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' });
      }
      return next();
    } catch (error) {
      console.error('API rate limit failed:', error.message);
      return res.status(503).json({ success: false, code: 'RATE_LIMIT_UNAVAILABLE', message: 'Requests are temporarily unavailable' });
    }
  }
  rateLimit.consume = consume;
  return rateLimit;
}

const otpRateLimit = createRateLimiter({
  name: 'otp',
  max: positiveNumber(process.env.OTP_RATE_LIMIT_MAX, 3000),
  windowMs: positiveNumber(process.env.OTP_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
});
const adminLoginRateLimit = createRateLimiter({
  name: 'admin-login',
  max: positiveNumber(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX, 30),
  windowMs: positiveNumber(process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
});
const voteRateLimit = createRateLimiter({
  name: 'vote',
  max: positiveNumber(process.env.VOTE_RATE_LIMIT_MAX, 30),
  windowMs: positiveNumber(process.env.VOTE_RATE_LIMIT_WINDOW_MS, 60 * 1000),
});

module.exports = { createRateLimiter, otpRateLimit, adminLoginRateLimit, voteRateLimit };
