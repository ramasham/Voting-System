const pool = require('../../db/connection');
const { checkVenueAccess } = require('./locationVerification');
const { parsePositiveInteger } = require('../utils/validation');

class VoteError extends Error {
    constructor(code, status, message) {
        super(message);
        this.name = 'VoteError';
        this.code = code;
        this.status = status;
    }
}

async function getVisitorVotes({ eventId, visitorId }) {
    eventId = parsePositiveInteger(eventId);
    visitorId = parsePositiveInteger(visitorId);
    if (!eventId || !visitorId) {
        throw new VoteError('INVALID_VOTE', 400, 'eventId and visitorId must be positive integers');
    }
    const event = await pool.query('SELECT id FROM events WHERE id = $1', [eventId]);
    if (event.rowCount === 0) throw new VoteError('EVENT_NOT_FOUND', 404, 'Event not found');
    const result = await pool.query(
        `SELECT id, event_id, category_id, exhibitor_id, created_at
         FROM votes WHERE event_id = $1 AND visitor_id = $2 ORDER BY category_id`,
        [eventId, visitorId]
    );
    return result.rows;
}

async function castVote({ eventId, categoryId, exhibitorId, visitorId, clientIp, coordinates, presentationPass }) {
    eventId = parsePositiveInteger(eventId);
    categoryId = parsePositiveInteger(categoryId);
    exhibitorId = parsePositiveInteger(exhibitorId);
    visitorId = parsePositiveInteger(visitorId);

    if (!eventId || !categoryId || !exhibitorId || !visitorId) {
        throw new VoteError('INVALID_VOTE', 400, 'eventId, categoryId, and exhibitorId must be positive integers');
    }

    let client;
    let transactionStarted = false;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        transactionStarted = true;

        const eventResult = await client.query('SELECT id FROM events WHERE id = $1 FOR KEY SHARE', [eventId]);
        if (eventResult.rowCount === 0) throw new VoteError('EVENT_NOT_FOUND', 404, 'Event not found');

        // The shared settings lock serializes voting against admin close/reset operations.
        const settingsResult = await client.query(
            `SELECT voting_enabled, allowed_ip_ranges, location_enabled,
                    location_zone IS NOT NULL AS location_ready,
                    voting_start_at IS NOT NULL
                        AND clock_timestamp() >= voting_start_at AS window_started,
                    voting_end_at IS NOT NULL
                        AND clock_timestamp() < voting_end_at AS window_not_ended
             FROM event_settings WHERE event_id = $1 FOR SHARE`,
            [eventId]
        );
        if (settingsResult.rowCount === 0) {
            throw new VoteError('VOTING_NOT_CONFIGURED', 403, 'Voting is not configured for this event');
        }

        // Serialize requests for the same verified number, including requests on other servers.
        const visitorResult = await client.query(
            'SELECT phone_verified FROM visitors WHERE id = $1 FOR UPDATE', [visitorId]
        );
        if (visitorResult.rowCount === 0 || !visitorResult.rows[0].phone_verified) {
            throw new VoteError('PHONE_NOT_VERIFIED', 403, 'Verify your phone number before voting');
        }

        const previousVotes = await client.query(
            `SELECT id, event_id, category_id, exhibitor_id, created_at
             FROM votes WHERE event_id = $1 AND visitor_id = $2`,
            [eventId, visitorId]
        );
        const previous = previousVotes.rows.find((vote) => vote.category_id === categoryId);
        if (previous) {
            if (previous.exhibitor_id !== exhibitorId) {
                throw new VoteError('DUPLICATE_VOTE', 409, 'You have already voted in this category');
            }
            // Returning a receipt is safe after voting closes and handles a lost success response.
            await client.query('COMMIT');
            transactionStarted = false;
            return { ...previous, replayed: true };
        }
        if (previousVotes.rowCount >= 3) {
            throw new VoteError('VOTE_LIMIT_REACHED', 409, 'You may cast at most three votes per event');
        }

        const settings = settingsResult.rows[0];
        const venue = await checkVenueAccess(client, { eventId, settings, clientIp, coordinates, presentationPass });
        if (!venue.allowed) throw new VoteError(venue.code, venue.status, venue.message);

        if (!settings.voting_enabled || !settings.window_started || !settings.window_not_ended) {
            throw new VoteError('VOTING_CLOSED', 403, 'Voting is not open for this event');
        }

        // Lock parent content before the assignment, matching admin edits/deletes.
        const category = await client.query(
            'SELECT id FROM categories WHERE event_id = $1 AND id = $2 FOR SHARE',
            [eventId, categoryId]
        );
        const exhibitor = await client.query(
            'SELECT id FROM exhibitors WHERE event_id = $1 AND id = $2 FOR SHARE',
            [eventId, exhibitorId]
        );
        if (category.rowCount === 0 || exhibitor.rowCount === 0) {
            throw new VoteError('INVALID_CATEGORY_EXHIBITOR', 400,
                'The exhibitor does not participate in this category and event');
        }
        const assignmentResult = await client.query(
            `SELECT eca.exhibitor_id
             FROM exhibitor_category_assignments eca
             JOIN exhibitors e ON e.id = eca.exhibitor_id AND e.event_id = eca.event_id
             JOIN categories c ON c.id = eca.category_id AND c.event_id = eca.event_id
             WHERE eca.event_id = $1 AND eca.category_id = $2 AND eca.exhibitor_id = $3
             FOR SHARE OF eca`,
            [eventId, categoryId, exhibitorId]
        );
        if (assignmentResult.rowCount === 0) {
            throw new VoteError('INVALID_CATEGORY_EXHIBITOR', 400,
                'The exhibitor does not participate in this category and event');
        }

        const voteResult = await client.query(
            `INSERT INTO votes (event_id, visitor_id, category_id, exhibitor_id)
             SELECT $1, $2, $3, $4 FROM event_settings
             WHERE event_id = $1 AND voting_enabled
               AND clock_timestamp() >= voting_start_at
               AND clock_timestamp() < voting_end_at
             RETURNING id, event_id, category_id, exhibitor_id, created_at`,
            [eventId, visitorId, categoryId, exhibitorId]
        );
        if (voteResult.rowCount === 0) {
            throw new VoteError('VOTING_CLOSED', 403, 'Voting is not open for this event');
        }
        // A database trigger emits the results notification only when this transaction commits.
        await client.query('COMMIT');
        transactionStarted = false;
        return { ...voteResult.rows[0], replayed: false };
    } catch (error) {
        if (transactionStarted && client) await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') {
            throw new VoteError('DUPLICATE_VOTE', 409, 'You have already voted in this category');
        }
        if (error.code === '23503') {
            throw new VoteError('INVALID_CATEGORY_EXHIBITOR', 400, 'The selected category or exhibitor is invalid');
        }
        throw error;
    } finally {
        if (client) client.release();
    }
}

module.exports = { VoteError, castVote, getVisitorVotes };
