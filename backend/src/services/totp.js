const crypto = require('node:crypto');

// RFC 6238: HMAC-SHA1, 30-second steps, six digits for authenticator apps.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function encodeSecret(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; output += ALPHABET[(value >>> bits) & 31]; }
  }
  if (bits) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}
function decodeSecret(secret) {
  if (!/^[A-Z2-7]{16,128}$/.test(secret)) throw new Error('Invalid authenticator secret');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of secret) {
    value = (value << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}
function codeAt(secret, counter, digits = 6) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  const hash = crypto.createHmac('sha1', decodeSecret(secret)).update(bytes).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
function matchCounter(secret, code, lastCounter = -1, now = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const counter of [current, current - 1, current + 1]) {
    if (counter < 0 || counter <= Number(lastCounter)) continue;
    if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(codeAt(secret, counter)))) return counter;
  }
  return null;
}
function encryptionKey() {
  const hex = process.env.MFA_ENCRYPTION_KEY;
  if (!hex || !/^[a-f0-9]{64}$/i.test(hex)) throw new Error('MFA_ENCRYPTION_KEY must contain 64 random hexadecimal characters');
  return Buffer.from(hex, 'hex');
}
function available() {
  try { encryptionKey(); return true; } catch { return false; }
}
function seal(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from('maker-collective-admin-mfa-v1'));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}
function unseal(value) {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAAD(Buffer.from('maker-collective-admin-mfa-v1'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
module.exports = { encodeSecret, codeAt, matchCounter, available, seal, unseal,
  generateSecret: () => encodeSecret(crypto.randomBytes(20)) };
