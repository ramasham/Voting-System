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
        exhibitors.id,
        exhibitors.event_id,
        exhibitors.name,
        exhibitors.description,
        exhibitors.image_url,
        categories.id AS category_id,
        categories.name AS category_name
      FROM exhibitors
      JOIN categories
        ON categories.id = exhibitors.category_id
       AND categories.event_id = exhibitors.event_id
      WHERE exhibitors.event_id = $1
      ORDER BY categories.display_order NULLS LAST, categories.id, exhibitors.name
      `,
      [eventId]
    );

    const exhibitors = result.rows.map((row) => ({
      id: row.id,
      event_id: row.event_id,
      name: row.name,
      description: row.description,
      image_url: row.image_url,
      category: {
        id: row.category_id,
        name: row.category_name,
      },
    }));

    return res.status(200).json({
      success: true,
      data: exhibitors,
    });
  } catch (error) {
    console.error(`Failed to load exhibitors for event ${eventId}:`, error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load event exhibitors',
    });
  }
}

module.exports = {
  getEvents,
  getEventCategories,
  getEventExhibitors,
};
