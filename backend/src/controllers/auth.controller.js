const pool = require('../../db/connection');
const { normalizePhoneNumber, validateName } = require('../utils/validation');
const { isWithinRateLimit } = require('../services/rateLimiter');
const {
  OTP_TTL_SECONDS,
  MAX_ATTEMPTS,
  generateOtp,
  hashOtp,
  otpMatches,
} = require('../services/otp');
const { getSmsProvider } = require('../services/smsProvider');
const { issueToken } = require('../services/tokens');

const REGISTRATION_WINDOW_MS = 15 * 60 * 1000;
const VISITOR_TOKEN_TTL_SECONDS = 12 * 60 * 60;

function configuredLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function ipRateLimitKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function invalidOtpResponse(res) {
  return res.status(400).json({
    success: false,
    code: 'INVALID_OR_EXPIRED_OTP',
    message: 'The code is invalid or expired',
  });
}

async function register(req, res) {
  const ipAllowed = await isWithinRateLimit(
    'otp-register-ip',
    ipRateLimitKey(req),
    configuredLimit('OTP_REGISTER_IP_MAX', 3000),
    REGISTRATION_WINDOW_MS
  ).catch((error) => {
    console.error('OTP registration rate limit failed:', error.message);
    return null;
  });

  if (ipAllowed === null) {
    return res.status(503).json({
      success: false,
      message: 'Registration is temporarily unavailable',
    });
  }

  if (!ipAllowed) {
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many registration requests. Try again later.',
    });
  }

  let name;
  let phoneNumber;
  try {
    name = validateName(req.body?.name, 'name');
    phoneNumber = normalizePhoneNumber(req.body?.phoneNumber);
    if (!phoneNumber) {
      throw new Error('phoneNumber must be an international number or Jordanian local number');
    }
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  const phoneAllowed = await isWithinRateLimit(
    'otp-register-phone',
    phoneNumber,
    3,
    REGISTRATION_WINDOW_MS
  ).catch((error) => {
    console.error('OTP phone rate limit failed:', error.message);
    return null;
  });

  if (phoneAllowed === null) {
    return res.status(503).json({
      success: false,
      message: 'Registration is temporarily unavailable',
    });
  }

  if (!phoneAllowed) {
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many codes requested for this phone number. Try again later.',
    });
  }

  let client;
  let verificationId;
  let visitorId;
  const otp = generateOtp();

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const visitorResult = await client.query(
      `
      INSERT INTO visitors (name, phone_number)
      VALUES ($1, $2)
      ON CONFLICT (phone_number)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id
      `,
      [name, phoneNumber]
    );
    visitorId = visitorResult.rows[0].id;

    await client.query(
      `
      UPDATE otp_verifications
      SET expires_at = CURRENT_TIMESTAMP
      WHERE visitor_id = $1
        AND verified_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      `,
      [visitorId]
    );

    const verificationResult = await client.query(
      `
      INSERT INTO otp_verifications (visitor_id, otp_hash, expires_at, pending_name)
      VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second'), $4)
      RETURNING id
      `,
      [visitorId, hashOtp(visitorId, otp), OTP_TTL_SECONDS, name]
    );
    verificationId = verificationResult.rows[0].id;

    await client.query('COMMIT');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('OTP registration failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Unable to start phone verification',
    });
  } finally {
    if (client) client.release();
  }

  try {
    const smsProvider = getSmsProvider();
    await smsProvider.sendOtp(phoneNumber, otp);
  } catch (error) {
    await pool.query(
      'UPDATE otp_verifications SET expires_at = CURRENT_TIMESTAMP WHERE id = $1',
      [verificationId]
    ).catch(() => { console.error('Unable to expire failed SMS verification'); });
    console.error('SMS delivery failed:', error.message);
    return res.status(503).json({
      success: false,
      code: 'SMS_UNAVAILABLE',
      message: 'Phone verification is temporarily unavailable',
    });
  }

  return res.status(202).json({
    success: true,
    message: 'If the number can receive messages, a verification code has been sent.',
    expiresInSeconds: OTP_TTL_SECONDS,
  });
}

async function verifyOtp(req, res) {
  const ipAllowed = await isWithinRateLimit(
    'otp-verify-ip',
    ipRateLimitKey(req),
    configuredLimit('OTP_VERIFY_IP_MAX', 6000),
    REGISTRATION_WINDOW_MS
  ).catch((error) => {
    console.error('OTP verification rate limit failed:', error.message);
    return null;
  });

  if (ipAllowed === null) {
    return res.status(503).json({
      success: false,
      message: 'Phone verification is temporarily unavailable',
    });
  }

  if (!ipAllowed) {
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many verification attempts. Try again later.',
    });
  }

  const phoneNumber = normalizePhoneNumber(req.body?.phoneNumber);
  const otp = req.body?.otp;
  if (!phoneNumber || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
    return invalidOtpResponse(res);
  }

  let client;
  let accessToken;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const visitorResult = await client.query(
      'SELECT id FROM visitors WHERE phone_number = $1 FOR UPDATE',
      [phoneNumber]
    );

    if (visitorResult.rowCount === 0) {
      await client.query('COMMIT');
      return invalidOtpResponse(res);
    }

    const visitorId = visitorResult.rows[0].id;
    const verificationResult = await client.query(
      `
      SELECT id, otp_hash, expires_at, verified_at, attempts, pending_name,
             expires_at <= clock_timestamp() AS expired
      FROM otp_verifications
      WHERE visitor_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [visitorId]
    );

    if (verificationResult.rowCount === 0) {
      await client.query('COMMIT');
      return invalidOtpResponse(res);
    }

    const verification = verificationResult.rows[0];
    if (verification.verified_at || verification.expired) {
      await client.query('COMMIT');
      return invalidOtpResponse(res);
    }

    if (verification.attempts >= MAX_ATTEMPTS) {
      await client.query('COMMIT');
      return res.status(429).json({
        success: false,
        code: 'OTP_ATTEMPTS_EXCEEDED',
        message: 'Too many incorrect codes. Request a new code.',
      });
    }

    await client.query(
      'UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1',
      [verification.id]
    );

    if (!otpMatches(visitorId, otp, verification.otp_hash)) {
      await client.query('COMMIT');
      return invalidOtpResponse(res);
    }

    // Validate token configuration before committing verification state.
    accessToken = issueToken({
      subject: visitorId,
      role: 'visitor',
      expiresInSeconds: VISITOR_TOKEN_TTL_SECONDS,
    });

    await client.query(
      'UPDATE otp_verifications SET verified_at = CURRENT_TIMESTAMP WHERE id = $1',
      [verification.id]
    );
    await client.query(
      'UPDATE visitors SET phone_verified = TRUE, name = COALESCE($2, name), updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [visitorId, verification.pending_name]
    );
    await client.query('COMMIT');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('OTP verification failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Unable to verify phone number',
    });
  } finally {
    if (client) client.release();
  }

  return res.status(200).json({
    success: true,
    accessToken,
    tokenType: 'Bearer',
    expiresInSeconds: VISITOR_TOKEN_TTL_SECONDS,
  });
}

module.exports = { register, verifyOtp };
