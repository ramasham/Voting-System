const pool = require('../../db/connection');
const { parsePositiveInteger, ipIsAllowed } = require('../utils/validation');
const { checkVenueAccess } = require('../services/locationVerification');

async function venueAccess(req, res, next) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) {
    return res.status(400).json({ success: false, code: 'INVALID_EVENT_ID', message: 'A valid eventId is required for venue access' });
  }

  try {
    const result = await pool.query(
      `SELECT allowed_ip_ranges, location_enabled, location_zone IS NOT NULL AS location_ready
       FROM event_settings WHERE event_id = $1`,
      [eventId]
    );
    if (result.rowCount === 0) {
      return res.status(503).json({ success: false, code: 'VENUE_ACCESS_NOT_CONFIGURED', message: 'Venue access is not configured for this event' });
    }

    const access = await checkVenueAccess(pool, {
      eventId,
      settings: result.rows[0],
      clientIp: req.ip,
      coordinates: req.body?.location,
    });
    if (!access.allowed) {
      return res.status(access.status).json({ success: false, code: access.code, message: access.message });
    }
    return next();
  } catch (error) {
    console.error('Venue access check failed:', error.message);
    return res.status(503).json({ success: false, code: 'VENUE_ACCESS_UNAVAILABLE', message: 'Unable to verify venue access right now' });
  }
}

module.exports = venueAccess;
module.exports.ipIsAllowed = ipIsAllowed;
