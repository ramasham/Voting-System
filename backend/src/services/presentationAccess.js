const crypto = require('node:crypto');
const { parsePositiveInteger } = require('../utils/validation');

const PRESENTATION_TTL_SECONDS = 30 * 60;

function signingKey() {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith('replace-me-')) {
    throw new Error('A valid admin token secret is required for presentation access');
  }
  // Separate presentation approvals from login tokens signed with this secret.
  return crypto.createHmac('sha256', secret).update('mc2026:presentation-access:v1').digest();
}

function issuePresentationPass(eventId, adminId) {
  eventId = parsePositiveInteger(eventId);
  adminId = parsePositiveInteger(adminId);
  if (!eventId || !adminId) throw new Error('Invalid presentation approval');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    purpose: 'presentation-voting', eventId, adminId, iat: now,
    exp: now + PRESENTATION_TTL_SECONDS, nonce: crypto.randomBytes(16).toString('hex'),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyPresentationPass(token, eventId) {
  try {
    const id = parsePositiveInteger(eventId);
    if (!id) return false;
    if (typeof token !== 'string' || token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
    const [payload, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', signingKey()).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    return claims.purpose === 'presentation-voting'
      && claims.eventId === id
      && parsePositiveInteger(claims.adminId) !== null
      && Number.isSafeInteger(claims.iat) && claims.iat <= now
      && Number.isSafeInteger(claims.exp) && claims.exp > now
      && claims.exp - claims.iat === PRESENTATION_TTL_SECONDS;
  } catch {
    return false;
  }
}

function presentationCookieName(eventId) {
  const id = parsePositiveInteger(eventId);
  if (!id) throw new Error('Invalid presentation event');
  return `mc2026_presentation_${id}`;
}

function readPresentationPass(req, eventId) {
  const id = parsePositiveInteger(eventId);
  if (!id || typeof req.headers?.cookie !== 'string') return undefined;
  const name = presentationCookieName(id);
  const matches = req.headers.cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  // Ambiguous cookies must not authorize a browser.
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}

module.exports = {
  PRESENTATION_TTL_SECONDS, issuePresentationPass, verifyPresentationPass,
  presentationCookieName, readPresentationPass,
};
