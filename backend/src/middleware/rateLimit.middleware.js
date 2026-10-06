function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createRateLimiter({ name, max, windowMs }) {
    const requests = new Map();

    return function rateLimit(req, res, next) {
        const now = Date.now();
        const key = req.ip || req.socket.remoteAddress || 'unknown';
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

        res.set('RateLimit-Limit', String(max));
        res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
        res.set('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
        if (entry.count > max) {
            return res.status(429).json({
                success: false,
                code: 'RATE_LIMITED',
                message: 'Too many requests. Please try again later.'
            });
        }
        return next();
    };
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
