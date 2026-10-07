const crypto = require('node:crypto');

const ISSUER = 'maker-collective-voting';

function secretFor(role) {
  if (!['admin', 'visitor'].includes(role)) throw new Error('Invalid token role');
  const envName = role === 'admin' ? 'ADMIN_TOKEN_SECRET' : 'VISITOR_TOKEN_SECRET';
  const secret = process.env[envName];

  if (!secret || secret.length < 32 || secret.startsWith('replace-me-')) {
    throw new Error(`${envName} must be set to a random secret of at least 32 characters`);
  }

  return secret;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signature(input, secret) {
  return crypto.createHmac('sha256', secret).update(input).digest();
}

function issueToken({ subject, role, expiresInSeconds }) {
  if (!Number.isSafeInteger(Number(subject)) || Number(subject) < 1 ||
      !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 1) {
    throw new Error('Invalid token claims');
  }
  const secret = secretFor(role);
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: ISSUER,
    sub: String(subject),
    role,
    iat: now,
    exp: now + expiresInSeconds,
  });
  const unsignedToken = `${header}.${payload}`;
  const signed = signature(unsignedToken, secret).toString('base64url');

  return `${unsignedToken}.${signed}`;
}

function verifyToken(token, expectedRole) {
  if (typeof token !== 'string' || token.length > 4096) {
    throw new Error('Invalid token');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token');
  }

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid token');
  }

  if (!header || !payload || header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new Error('Invalid token');
  }

  const expectedSignature = signature(`${parts[0]}.${parts[1]}`, secretFor(expectedRole));
  const actualSignature = Buffer.from(parts[2], 'base64url');

  if (
    actualSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error('Invalid token');
  }

  const subjectId = Number(payload.sub);
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.iss !== ISSUER ||
    payload.role !== expectedRole ||
    !Number.isSafeInteger(subjectId) ||
    subjectId < 1 ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= now ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > now + 60 ||
    payload.exp <= payload.iat
  ) {
    throw new Error('Invalid token');
  }

  return { id: subjectId, role: expectedRole, expiresAt: payload.exp };
}

module.exports = { issueToken, verifyToken };
