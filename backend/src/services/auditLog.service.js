const pool = require('../../db/connection');

const AUDIT_EVENTS = Object.freeze([
    'OTP_REQUESTED',
    'OTP_DELIVERY_FAILED',
    'OTP_VERIFIED',
    'OTP_FAILED',
    'VOTE_SUCCESS',
    'VOTE_REJECTED',
    'ADMIN_LOGIN_SUCCESS',
    'ADMIN_LOGIN_FAILURE',
    'ADMIN_MUTATION',
]);
let lastStorageErrorLogAt = 0;

function positiveId(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function safeDetails(type, input) {
    const details = {};
    if (['VOTE_SUCCESS', 'VOTE_REJECTED'].includes(type)) {
        for (const field of ['eventId', 'categoryId', 'exhibitorId']) {
            const value = positiveId(input[field]);
            if (value) details[field] = value;
        }
    }
    if (['OTP_FAILED', 'VOTE_REJECTED'].includes(type) && typeof input.reason === 'string' && /^[A-Z0-9_]{1,64}$/.test(input.reason)) {
        details.reason = input.reason;
    }
    if (type === 'ADMIN_MUTATION') {
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(input.method)) details.method = input.method;
        if (typeof input.action === 'string' && input.action.length <= 100 && /^\/events\/:id\/(?:settings|location\/anchor|voting\/(?:open|close)|categories(?:\/:id)?|exhibitors(?:\/:id(?:\/photo)?)?|results(?:\/reset)?|export\.csv)$/.test(input.action)) {
            details.action = input.action;
        }
        const eventId = positiveId(input.eventId);
        if (eventId) details.eventId = eventId;
    }
    return details;
}

async function recordAuditEvent(type, input = {}) {
    if (!AUDIT_EVENTS.includes(type)) throw new TypeError(`Unsupported audit event: ${type}`);
    const actorType = type.startsWith('ADMIN_') ? 'admin' : type.startsWith('OTP_') || type.startsWith('VOTE_') ? 'visitor' : 'system';
    const actorId = type === 'ADMIN_LOGIN_SUCCESS' || type === 'ADMIN_MUTATION'
        ? positiveId(input.adminId)
        : null;
    const eventId = positiveId(input.eventId);
    const details = safeDetails(type, input);

    try {
        await pool.query(
            `INSERT INTO audit_logs (event_type, actor_type, actor_id, event_id, details)
             VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [type, actorType, actorId, eventId, JSON.stringify(details)]
        );
        return true;
    } catch (error) {
        // Do not include event details, user data, or provider errors in logs.
        const now = Date.now();
        if (now - lastStorageErrorLogAt >= 30_000) {
            lastStorageErrorLogAt = now;
            console.error('Audit event persistence failed:', error.code || 'AUDIT_STORAGE_ERROR');
        }
        return false;
    }
}

module.exports = { AUDIT_EVENTS, recordAuditEvent };
