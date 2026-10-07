const pool = require('../../db/connection');

function parseEventId(value) {
  const eventId = Number(value);

  return Number.isInteger(eventId) && eventId > 0 ? eventId : null;
}

async function eventExists(eventId) {
  const result = await pool.query(
    'SELECT 1 FROM events WHERE id = $1',
    [eventId]
  );

  return result.rowCount > 0;
}

async function getEvents(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT id, name, start_at, end_at, status
      FROM events
      ORDER BY start_at NULLS LAST, id
      `
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Failed to load events:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load events',
    });
  }
}

async function getEventCategories(req, res) {
  const eventId = parseEventId(req.params.eventId);

  if (eventId === null) {
    return res.status(400).json({
      success: false,
      message: 'eventId must be a positive integer',
    });
  }

  try {
    if (!(await eventExists(eventId))) {
      return res.status(404).json({
        success: false,
        message: 'Event not found',
      });
    }

    const result = await pool.query(
      `
      SELECT id, event_id, name, description, display_order
      FROM categories
      WHERE event_id = $1
      ORDER BY display_order NULLS LAST, id
      `,
      [eventId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error(`Failed to load categories for event ${eventId}:`, error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load event categories',
    });
  }
}

async function getEventExhibitors(req, res) {
  const eventId = parseEventId(req.params.eventId);

  if (eventId === null) {
    return res.status(400).json({
      success: false,
      message: 'eventId must be a positive integer',
    });
  }

  try {
    if (!(await eventExists(eventId))) {
      return res.status(404).json({
        success: false,
        message: 'Event not found',
      });
    }

    const result = await pool.query(
      `
      SELECT
        e.id,
        e.event_id,
        e.name,
        e.description,
        e.image_url,
        COUNT(c.id)::int AS "categoriesCount",
        COALESCE(
          json_agg(
            json_build_object('id', c.id, 'name', c.name)
            ORDER BY c.display_order NULLS LAST, c.id
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'::json
        ) AS categories
      FROM exhibitors e
      LEFT JOIN exhibitor_category_assignments eca
        ON eca.event_id = e.event_id
       AND eca.exhibitor_id = e.id
      LEFT JOIN categories c
        ON c.event_id = eca.event_id
       AND c.id = eca.category_id
      WHERE e.event_id = $1
      GROUP BY e.id, e.event_id, e.name, e.description, e.image_url
      ORDER BY e.name
      `,
      [eventId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error(`Failed to load exhibitors for event ${eventId}:`, error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load event exhibitors',
    });
  }
}

async function getVotingConfig(req, res) {
  const eventId = parseEventId(req.params.eventId);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID' });
  try {
    const result = await pool.query(
      `SELECT CASE
        WHEN COALESCE(s.voting_enabled, FALSE) = FALSE OR s.voting_start_at IS NULL OR s.voting_end_at IS NULL THEN 'closed'
        WHEN CURRENT_TIMESTAMP < s.voting_start_at THEN 'not_started'
        WHEN CURRENT_TIMESTAMP >= s.voting_end_at THEN 'closed'
        ELSE 'open' END AS status,
       COALESCE(TRIM(s.allowed_ip_ranges) <> '', FALSE) AS "requireNetworkCheck",
       COALESCE(s.location_enabled, FALSE) AS "requireLocation", 30 AS "resendAfterSeconds"
       FROM events e LEFT JOIN event_settings s ON s.event_id = e.id WHERE e.id = $1`, [eventId]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Event not found' });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Voting config failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to read the voting window' });
  }
}

module.exports = {
  getVotingConfig,
  getEvents,
  getEventCategories,
  getEventExhibitors,
};
