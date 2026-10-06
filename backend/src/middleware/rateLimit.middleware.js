function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createRateLimiter({ name, max, windowMs }) {
    const requests = new Map();

    function consume(key, now = Date.now()) {
        const current = requests.get(key);
        const entry = !current || now >= current.resetAt
            ? { count: 0, resetAt: now + windowMs }
            : current;

        entry.count += 1;
        requests.set(key, entry);

        // Opportunistically remove expired entries without a background timer.
        if (requests.size > 1000) {
            for (const [ip, record] of requests) {
                if (now >= record.resetAt) requests.delete(ip);
            }
        }

        return {
            allowed: entry.count <= max,
            limit: max,
            remaining: Math.max(0, max - entry.count),
            resetAt: entry.resetAt
        };
    }

    function rateLimit(req, res, next) {
        const result = consume(req.ip || req.socket.remoteAddress || 'unknown');

        res.set('RateLimit-Limit', String(result.limit));
        res.set('RateLimit-Remaining', String(result.remaining));
        res.set('RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
        if (!result.allowed) {
            return res.status(429).json({
                success: false,
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please try again later.'
            });
        }
        return next();
    }

    rateLimit.consume = consume;
    return rateLimit;
}

const otpRateLimit = createRateLimiter({
    name: 'otp',
    max: positiveNumber(process.env.OTP_RATE_LIMIT_MAX, 5),
    windowMs: positiveNumber(process.env.OTP_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000)
});
const adminLoginRateLimit = createRateLimiter({
    name: 'admin login',
    max: positiveNumber(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX, 5),
    windowMs: positiveNumber(process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000)
});
const voteRateLimit = createRateLimiter({
    name: 'vote',
    max: positiveNumber(process.env.VOTE_RATE_LIMIT_MAX, 30),
    windowMs: positiveNumber(process.env.VOTE_RATE_LIMIT_WINDOW_MS, 60 * 1000)
});

module.exports = { createRateLimiter, otpRateLimit, adminLoginRateLimit, voteRateLimit };
