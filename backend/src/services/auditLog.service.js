const AUDIT_EVENTS = Object.freeze([
    'OTP_REQUEST',
    'OTP_VERIFIED',
    'OTP_FAILED',
    'VOTE_ATTEMPT',
    'VOTE_SUCCESS',
    'VOTE_REJECTED',
    'ADMIN_LOGIN',
    'VOTING_OPENED',
    'VOTING_CLOSED'
]);

/** Database persistence can be added here once the audit schema is available. */
async function recordAuditEvent(type, details = {}) {
    if (!AUDIT_EVENTS.includes(type)) throw new TypeError(`Unsupported audit event: ${type}`);

    const event = {
        type,
        occurredAt: new Date().toISOString(),
        details
    };

    if (process.env.NODE_ENV !== 'production') {
        console.info('[audit]', JSON.stringify(event));
    }
    // TODO: Persist this event through Prisma after the database schema is finalized.
    return event;
}

module.exports = { AUDIT_EVENTS, recordAuditEvent };
