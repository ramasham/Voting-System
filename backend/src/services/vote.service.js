const pool = require('../../db/connection');
const venueAccess = require('../middleware/venueAccess.middleware');
const { parsePositiveInteger } = require('../utils/validation');

class VoteError extends Error {
    constructor(code, status, message) {
        super(message);
        this.name = 'VoteError';
        this.code = code;
        this.status = status;
    }
}

async function castVote({ eventId, categoryId, exhibitorId, visitorId, clientIp }) {
    eventId = parsePositiveInteger(eventId);
    categoryId = parsePositiveInteger(categoryId);
    exhibitorId = parsePositiveInteger(exhibitorId);
    visitorId = parsePositiveInteger(visitorId);

    if (!eventId || !categoryId || !exhibitorId || !visitorId) {
        throw new VoteError(
            'INVALID_VOTE',
            400,
            'eventId, categoryId, and exhibitorId must be positive integers'
        );
    }

    let client;
    let transactionStarted = false;

    try {
        client = await pool.connect();
        await client.query('BEGIN');
        transactionStarted = true;

        const eventResult = await client.query(
            'SELECT id FROM events WHERE id = $1',
            [eventId]
        );
        if (eventResult.rowCount === 0) {
            throw new VoteError('EVENT_NOT_FOUND', 404, 'Event not found');
        }

        const settingsResult = await client.query(
            `
            SELECT
                voting_enabled,
                allowed_ip_ranges,
                location_enabled,
                voting_start_at IS NOT NULL
                    AND CURRENT_TIMESTAMP >= voting_start_at AS window_started,
                voting_end_at IS NOT NULL
                    AND CURRENT_TIMESTAMP < voting_end_at AS window_not_ended
            FROM event_settings
            WHERE event_id = $1
            FOR SHARE
            `,
            [eventId]
        );
        if (settingsResult.rowCount === 0) {
            throw new VoteError(
                'VOTING_NOT_CONFIGURED',
                403,
                'Voting is not configured for this event'
            );
        }

        const settings = settingsResult.rows[0];
        if (settings.location_enabled) {
            throw new VoteError(
                'LOCATION_CHECK_UNAVAILABLE',
                503,
                'Location verification is enabled but is not supported by this server'
            );
        }

        if (!settings.allowed_ip_ranges || !clientIp) {
            throw new VoteError(
                'VENUE_ACCESS_UNAVAILABLE',
                503,
                'Venue access is not configured for this event'
            );
        }

        let ipAllowed;
        try {
            ipAllowed = venueAccess.ipIsAllowed(clientIp, settings.allowed_ip_ranges);
        } catch {
            throw new VoteError(
                'VENUE_ACCESS_UNAVAILABLE',
                503,
                'Venue access cannot be verified'
            );
        }
        if (!ipAllowed) {
            throw new VoteError(
                'OUTSIDE_VENUE',
                403,
                'Voting is only available inside the venue'
            );
        }

        if (
            !settings.voting_enabled ||
            !settings.window_started ||
            !settings.window_not_ended
        ) {
            throw new VoteError(
                'VOTING_CLOSED',
                403,
                'Voting is not open for this event'
            );
        }

        const visitorResult = await client.query(
            'SELECT phone_verified FROM visitors WHERE id = $1 FOR SHARE',
            [visitorId]
        );
        if (visitorResult.rowCount === 0 || !visitorResult.rows[0].phone_verified) {
            throw new VoteError(
                'PHONE_NOT_VERIFIED',
                403,
                'Verify your phone number before voting'
            );
        }

        const categoryResult = await client.query(
            'SELECT id FROM categories WHERE event_id = $1 AND id = $2',
            [eventId, categoryId]
        );
        if (categoryResult.rowCount === 0) {
            throw new VoteError('INVALID_CATEGORY', 400, 'Category not found in this event');
        }

        const exhibitorResult = await client.query(
            'SELECT id FROM exhibitors WHERE event_id = $1 AND id = $2',
            [eventId, exhibitorId]
        );
        if (exhibitorResult.rowCount === 0) {
            throw new VoteError('INVALID_EXHIBITOR', 400, 'Exhibitor not found in this event');
        }

        const assignmentResult = await client.query(
            `
            SELECT eca.exhibitor_id
            FROM exhibitor_category_assignments eca
            JOIN exhibitors e
              ON e.id = eca.exhibitor_id
             AND e.event_id = eca.event_id
            JOIN categories c
              ON c.id = eca.category_id
             AND c.event_id = eca.event_id
            WHERE eca.event_id = $1
              AND eca.category_id = $2
              AND eca.exhibitor_id = $3
            FOR SHARE OF eca, e, c
            `,
            [eventId, categoryId, exhibitorId]
        );
        if (assignmentResult.rowCount === 0) {
            throw new VoteError(
                'INVALID_CATEGORY_EXHIBITOR',
                400,
                'The exhibitor does not participate in this category and event'
            );
        }

        const voteResult = await client.query(
            `
            INSERT INTO votes (event_id, visitor_id, category_id, exhibitor_id)
            VALUES ($1, $2, $3, $4)
            RETURNING id, event_id, category_id, exhibitor_id, created_at
            `,
            [eventId, visitorId, categoryId, exhibitorId]
        );

        await client.query('COMMIT');
        transactionStarted = false;
        return voteResult.rows[0];
    } catch (error) {
        if (transactionStarted && client) {
            await client.query('ROLLBACK').catch(() => {});
        }

        if (error.code === '23505') {
            throw new VoteError(
                'DUPLICATE_VOTE',
                409,
                'You have already voted in this category'
            );
        }
        if (error.code === '23503') {
            throw new VoteError(
                'INVALID_CATEGORY_EXHIBITOR',
                400,
                'The selected category or exhibitor is invalid'
            );
        }
        throw error;
    } finally {
        if (client) client.release();
    }
}

module.exports = { VoteError, castVote };
