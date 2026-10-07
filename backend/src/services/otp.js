const crypto = require('node:crypto');

const OTP_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;

function otpSecret() {
  const secret = process.env.OTP_HMAC_SECRET;

  if (!secret || secret.length < 32 || secret.startsWith('replace-me-')) {
    throw new Error('OTP_HMAC_SECRET must be set to a random secret of at least 32 characters');
  }

  return secret;
}

function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashOtp(visitorId, otp) {
  return crypto
    .createHmac('sha256', otpSecret())
    .update(`${visitorId}:${otp}`)
    .digest('hex');
}

function otpMatches(visitorId, otp, storedHash) {
  if (typeof otp !== 'string' || !/^\d{6}$/.test(otp) ||
      typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/i.test(storedHash)) {
    return false;
  }

  const candidate = Buffer.from(hashOtp(visitorId, otp), 'hex');
  const expected = Buffer.from(storedHash, 'hex');

  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

module.exports = {
  OTP_TTL_SECONDS,
  MAX_ATTEMPTS,
  generateOtp,
  hashOtp,
  otpMatches,
};
