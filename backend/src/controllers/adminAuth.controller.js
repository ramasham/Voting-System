const pool = require('../../db/connection');
const { isWithinRateLimit } = require('../services/rateLimiter');
const { verifyPassword } = require('../services/passwords');
const { issueToken } = require('../services/tokens');
const { recordAuditEvent } = require('../services/auditLog.service');

const ADMIN_TOKEN_TTL_SECONDS = 30 * 60;
const DUMMY_PASSWORD_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;

async function login(req, res) {
  const username = typeof req.body?.username === 'string'
    ? req.body.username.trim().toLowerCase()
    : '';
  const password = req.body?.password;

  if (!username || username.length > 255 || typeof password !== 'string' || password.length > 128) {
    return res.status(400).json({
      success: false,
      message: 'A valid username and password are required',
    });
  }

  let withinLimit;
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const [ipAllowed, accountAllowed] = await Promise.all([
      isWithinRateLimit('admin-login-ip', ip, 30, 15 * 60 * 1000),
      isWithinRateLimit('admin-login-account', username, 10, 15 * 60 * 1000),
    ]);
    withinLimit = ipAllowed && accountAllowed;
  } catch (error) {
    console.error('Admin login rate limit failed:', error.message);
    return res.status(503).json({ success: false, message: 'Admin login is temporarily unavailable' });
  }

  if (!withinLimit) {
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Try again later.',
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, password_hash, mfa_enabled
      FROM admins
      WHERE username = $1
      `,
      [username]
    );

    const admin = result.rows[0];
    const passwordHash = admin?.password_hash || DUMMY_PASSWORD_HASH;
    const passwordIsValid = await verifyPassword(password, passwordHash);

    if (!admin || !passwordIsValid) {
      await recordAuditEvent('ADMIN_LOGIN_FAILURE');
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Username or password is incorrect',
      });
    }

    if (admin.mfa_enabled) {
      return res.status(403).json({
        success: false,
        code: 'MFA_NOT_CONFIGURED',
        message: 'This account requires MFA, which is not configured by this API yet',
      });
    }

    const accessToken = issueToken({
      subject: admin.id,
      role: 'admin',
      expiresInSeconds: ADMIN_TOKEN_TTL_SECONDS,
    });
    await recordAuditEvent('ADMIN_LOGIN_SUCCESS', { adminId: admin.id });

    return res.status(200).json({
      success: true,
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds: ADMIN_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    console.error('Admin login failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Unable to log in',
    });
  }
}

module.exports = { login };
