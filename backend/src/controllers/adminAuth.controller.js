const pool = require('../../db/connection');
const { isWithinRateLimit } = require('../services/rateLimiter');
const { verifyPassword } = require('../services/passwords');
const { issueToken } = require('../services/tokens');
const totp = require('../services/totp');
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
      SELECT id, password_hash, mfa_enabled, mfa_secret, mfa_last_counter
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
      if (!admin.mfa_secret || !totp.available()) {
        return res.status(503).json({ success: false, code: 'MFA_UNAVAILABLE', message: 'Authenticator verification is unavailable' });
      }
      if (!req.body?.mfaCode) {
        return res.status(401).json({ success: false, code: 'MFA_REQUIRED', message: 'Enter the code from your authenticator app' });
      }
      const counter = totp.matchCounter(totp.unseal(admin.mfa_secret), req.body.mfaCode, admin.mfa_last_counter);
      if (counter === null) {
        return res.status(401).json({ success: false, code: 'INVALID_MFA_CODE', message: 'Use a fresh authenticator code' });
      }
      const consumed = await pool.query(
        'UPDATE admins SET mfa_last_counter = $2 WHERE id = $1 AND mfa_last_counter < $2 AND mfa_enabled = TRUE AND mfa_secret = $3 RETURNING id',
        [admin.id, counter, admin.mfa_secret]
      );
      if (!consumed.rowCount) {
        return res.status(401).json({ success: false, code: 'INVALID_MFA_CODE', message: 'Use a fresh authenticator code' });
      }
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

async function me(req, res) {
  try {
    const result = await pool.query('SELECT id, username, mfa_enabled FROM admins WHERE id = $1', [req.auth.id]);
    if (!result.rowCount) return res.status(401).json({ success: false, code: 'INVALID_TOKEN', message: 'Account unavailable' });
    return res.json({ success: true, data: { ...result.rows[0], mfa_available: totp.available() } });
  } catch (error) {
    console.error('Admin profile failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load your account' });
  }
}

async function setupMfa(req, res) {
  if (!totp.available()) return res.status(503).json({ success: false, code: 'MFA_UNAVAILABLE', message: 'Authenticator setup is unavailable' });
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length > 128) return res.status(400).json({ success: false, message: 'Enter your current password' });
  try {
    if (!(await isWithinRateLimit('admin-mfa-setup', req.auth.id, 10, 15 * 60 * 1000))) {
      return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' });
    }
    const result = await pool.query('SELECT username, password_hash, mfa_enabled FROM admins WHERE id = $1', [req.auth.id]);
    const admin = result.rows[0];
    if (!admin || !(await verifyPassword(password, admin.password_hash))) return res.status(401).json({ success: false, code: 'INVALID_CREDENTIALS', message: 'Password is incorrect' });
    if (admin.mfa_enabled) return res.status(409).json({ success: false, message: 'MFA is already enabled' });
    const secret = totp.generateSecret();
    const saved = await pool.query(
      `UPDATE admins SET mfa_pending_secret = $2, mfa_pending_until = CURRENT_TIMESTAMP + INTERVAL '10 minutes'
       WHERE id = $1 AND mfa_enabled = FALSE RETURNING id`, [req.auth.id, totp.seal(secret)]
    );
    if (!saved.rowCount) return res.status(409).json({ success: false, message: 'MFA is already enabled' });
    const issuer = 'The Maker Collective';
    return res.json({ success: true, data: { secret, otpauthUrl: `otpauth://totp/${encodeURIComponent(`${issuer}:${admin.username}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30` } });
  } catch (error) {
    console.error('MFA setup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to set up an authenticator' });
  }
}

async function confirmMfa(req, res) {
  try {
    if (!(await isWithinRateLimit('admin-mfa-confirm', req.auth.id, 10, 15 * 60 * 1000))) {
      return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' });
    }
    const result = await pool.query(
      `SELECT mfa_pending_secret FROM admins WHERE id = $1 AND mfa_enabled = FALSE
       AND mfa_pending_until > CURRENT_TIMESTAMP`, [req.auth.id]
    );
    const pending = result.rows[0]?.mfa_pending_secret;
    if (!pending) return res.status(409).json({ success: false, code: 'MFA_SETUP_EXPIRED', message: 'Start authenticator setup again' });
    const counter = totp.matchCounter(totp.unseal(pending), req.body?.code);
    if (counter === null) return res.status(400).json({ success: false, code: 'INVALID_MFA_CODE', message: 'Authenticator code is incorrect' });
    const enabled = await pool.query(
      `UPDATE admins SET mfa_enabled = TRUE, mfa_secret = mfa_pending_secret, mfa_last_counter = $3,
       mfa_pending_secret = NULL, mfa_pending_until = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND mfa_enabled = FALSE AND mfa_pending_secret = $2
       AND mfa_pending_until > CURRENT_TIMESTAMP RETURNING id`, [req.auth.id, pending, counter]
    );
    if (!enabled.rowCount) return res.status(409).json({ success: false, code: 'MFA_SETUP_EXPIRED', message: 'Start authenticator setup again' });
    return res.json({ success: true, data: { mfa_enabled: true } });
  } catch (error) {
    console.error('MFA confirmation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to enable your authenticator' });
  }
}

module.exports = { login, me, setupMfa, confirmMfa };
