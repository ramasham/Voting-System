const pool = require('../../db/connection');
const { parsePositiveInteger } = require('../utils/validation');
const venueAccess = require('../middleware/venueAccess.middleware');

async function castVote(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const categoryId = parsePositiveInteger(req.body?.categoryId);
  const exhibitorId = parsePositiveInteger(req.body?.exhibitorId);

  if (!eventId || !categoryId || !exhibitorId) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_VOTE',
      message: 'eventId, categoryId, and exhibitorId must be positive integers',
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const eventResult = await client.query(
      'SELECT id FROM events WHERE id = $1',
      [eventId]
    );

    if (eventResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const settingsResult = await client.query(
      `
      SELECT voting_enabled, voting_start_at, voting_end_at,
             allowed_ip_ranges, location_enabled,
             voting_start_at IS NOT NULL AND CURRENT_TIMESTAMP >= voting_start_at AS window_started,
             voting_end_at IS NOT NULL AND CURRENT_TIMESTAMP < voting_end_at AS window_not_ended
      FROM event_settings
      WHERE event_id = $1
      FOR SHARE
      `,
      [eventId]
    );

    if (settingsResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        code: 'VOTING_NOT_CONFIGURED',
        message: 'Voting is not configured for this event',
      });
    }

    const settings = settingsResult.rows[0];
    if (settings.location_enabled) {
      await client.query('ROLLBACK');
      return res.status(503).json({
        success: false,
        code: 'LOCATION_CHECK_UNAVAILABLE',
        message: 'Location verification is enabled but is not supported by this server',
      });
    }
    if (
      !settings.allowed_ip_ranges ||
      !req.ip ||
      !venueAccess.ipIsAllowed(req.ip, settings.allowed_ip_ranges)
    ) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        code: 'OUTSIDE_VENUE',
        message: 'Voting is only available inside the venue',
      });
    }

    if (!settings.voting_enabled || !settings.window_started || !settings.window_not_ended) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        code: 'VOTING_CLOSED',
        message: 'Voting is not open for this event',
      });
    }

    const visitorResult = await client.query(
      'SELECT phone_verified FROM visitors WHERE id = $1 FOR SHARE',
      [req.auth.id]
    );

    if (visitorResult.rowCount === 0 || !visitorResult.rows[0].phone_verified) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        code: 'PHONE_VERIFICATION_REQUIRED',
        message: 'Verify your phone number before voting',
      });
    }

    const selectionResult = await client.query(
      `
      SELECT exhibitors.id
      FROM exhibitors
      JOIN categories
        ON categories.id = exhibitors.category_id
       AND categories.event_id = exhibitors.event_id
      WHERE exhibitors.id = $1
        AND exhibitors.event_id = $2
        AND exhibitors.category_id = $3
      FOR SHARE OF exhibitors, categories
      `,
      [exhibitorId, eventId, categoryId]
    );

    if (selectionResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        code: 'INVALID_CATEGORY_EXHIBITOR',
        message: 'The exhibitor does not belong to this category and event',
      });
    }

    const voteResult = await client.query(
      `
      INSERT INTO votes (event_id, visitor_id, category_id, exhibitor_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, event_id, category_id, exhibitor_id, created_at
      `,
      [eventId, req.auth.id, categoryId, exhibitorId]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      data: voteResult.rows[0],
    });
  } catch (error) {
    if (error instanceof VoteError) {
      return res.status(error.status).json({
        success: false,
        code: restErrorCode(error.code),
        message: error.message
      });
    }

    console.error('Vote creation failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Unable to record vote'
    });
  }
}

module.exports = { castVote: castVoteController };
