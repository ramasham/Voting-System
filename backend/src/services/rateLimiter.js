const crypto = require('node:crypto');
const pool = require('../../db/connection');

let nextCleanupAt = 0;

function rateLimitSecret() {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;

  if (!secret || secret.length < 32 || secret.startsWith('replace-me-')) {
    throw new Error('RATE_LIMIT_HMAC_SECRET must be set to a random secret of at least 32 characters');
  }

  return secret;
}

function opaqueKey(scope, value) {
  const digest = crypto
    .createHmac('sha256', rateLimitSecret())
    .update(String(value))
    .digest('hex');

  return `${scope}:${digest}`;
}

async function consumeRateLimit(scope, value, limit, windowMs) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError('Rate limits require a positive integer limit and window');
  }
  const key = opaqueKey(scope, value);
  const windowId = Math.floor(Date.now() / windowMs);
  const result = await pool.query(
    `
    INSERT INTO api_rate_limits (rate_limit_key, window_id, hits, expires_at)
    VALUES ($1, $2, 1, to_timestamp((($2::bigint + 1) * $3::bigint)::double precision / 1000))
    ON CONFLICT (rate_limit_key) DO UPDATE
    SET window_id = EXCLUDED.window_id,
        hits = CASE
          WHEN api_rate_limits.window_id = EXCLUDED.window_id
            THEN api_rate_limits.hits + 1
          ELSE 1
        END,
        expires_at = EXCLUDED.expires_at
    RETURNING hits
    `,
    [key, windowId, windowMs]
  );

  if (Date.now() >= nextCleanupAt) {
    nextCleanupAt = Date.now() + 60 * 60 * 1000;
    pool.query('DELETE FROM api_rate_limits WHERE expires_at < NOW()').catch((error) => {
      console.error('Rate limit cleanup failed:', error.message);
    });
  }

  const hits = result.rows[0].hits;
  return {
    allowed: hits <= limit,
    limit,
    remaining: Math.max(0, limit - hits),
    resetAt: (windowId + 1) * windowMs,
  };
}

async function isWithinRateLimit(scope, value, limit, windowMs) {
  return (await consumeRateLimit(scope, value, limit, windowMs)).allowed;
}

module.exports = { isWithinRateLimit, consumeRateLimit };
