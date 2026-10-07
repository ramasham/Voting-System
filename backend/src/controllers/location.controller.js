const pool = require('../../db/connection');
const { parsePositiveInteger } = require('../utils/validation');
const locationVerification = require('../services/locationVerification');
const venueAccess = require('../middleware/venueAccess.middleware');

function invalidEventId(res) {
  return res.status(400).json({
    success: false,
    code: 'INVALID_EVENT_ID',
    message: 'eventId must be a positive integer',
  });
}

async function getLocationStatus(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);

  try {
    const result = await pool.query(
      `SELECT events.id AS event_id,
              COALESCE(event_settings.location_enabled, FALSE) AS location_enabled,
              COALESCE(event_settings.location_sample_count, 0) AS trusted_sample_count,
              COALESCE(event_settings.location_zone IS NOT NULL, FALSE) AS location_ready
       FROM events
       LEFT JOIN event_settings ON event_settings.event_id = events.id
       WHERE events.id = $1`,
      [eventId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...result.rows[0],
        minimum_samples: locationVerification.MIN_CLUSTER_SAMPLES,
      },
    });
  } catch (error) {
    console.error(`Location status read failed for event ${eventId}:`, error.message);
    return res.status(500).json({ success: false, message: 'Unable to load event location status' });
  }
}

async function captureOrganizerAnchor(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);

  const coordinates = locationVerification.parseCoordinates(req.body);
  if (!coordinates) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_LOCATION',
      message: 'Provide valid latitude and longitude values and optional accuracy in meters',
    });
  }

  if (coordinates.accuracy > locationVerification.MAX_LOCATION_ACCURACY_METERS) {
    return res.status(400).json({ success: false, code: 'LOCATION_INACCURATE', message: 'Use a location with accuracy of 100 meters or better' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const event = await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    if (event.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    await client.query(
      `INSERT INTO event_settings (event_id, voting_enabled, location_enabled)
       VALUES ($1, FALSE, TRUE)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId]
    );
    await client.query('SELECT event_id FROM event_settings WHERE event_id = $1 FOR UPDATE', [eventId]);

    await locationVerification.insertSample(client, {
      eventId,
      source: 'organizer_anchor',
      adminId: req.auth.id,
      coordinates,
    });
    const zone = await locationVerification.rebuildEventZone(client, eventId);
    await client.query(
      `UPDATE event_settings
       SET location_enabled = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE event_id = $1`,
      [eventId]
    );

    await client.query('COMMIT');
    return res.status(201).json({
      success: true,
      data: {
        eventId,
        anchorCaptured: true,
        locationReady: zone.location_ready,
        trustedSampleCount: zone.location_sample_count,
        minimumSamples: locationVerification.MIN_CLUSTER_SAMPLES,
      },
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        code: 'LOCATION_ANCHOR_ALREADY_SET',
        message: 'An organizer location anchor has already been recorded for this event',
      });
    }

    console.error(`Organizer location anchor failed for event ${eventId}:`, error.message);
    return res.status(500).json({ success: false, message: 'Unable to record organizer location' });
  } finally {
    if (client) client.release();
  }
}

async function captureTrustedNetworkSample(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);

  const coordinates = locationVerification.parseCoordinates(req.body);
  if (!coordinates) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_LOCATION',
      message: 'Provide valid latitude and longitude values and optional accuracy in meters',
    });
  }

  if (coordinates.accuracy > locationVerification.MAX_LOCATION_ACCURACY_METERS) {
    return res.status(400).json({ success: false, code: 'LOCATION_INACCURATE', message: 'Use a location with accuracy of 100 meters or better' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const event = await client.query('SELECT id FROM events WHERE id = $1 FOR KEY SHARE', [eventId]);
    if (event.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const settingsResult = await client.query(
      `SELECT allowed_ip_ranges, location_enabled
       FROM event_settings
       WHERE event_id = $1
       FOR UPDATE`,
      [eventId]
    );

    if (settingsResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(503).json({
        success: false,
        code: 'VENUE_ACCESS_NOT_CONFIGURED',
        message: 'Venue access is not configured for this event',
      });
    }

    const settings = settingsResult.rows[0];
    if (!settings.location_enabled) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        code: 'LOCATION_VERIFICATION_DISABLED',
        message: 'Location verification has not been enabled for this event',
      });
    }
    if (
      !settings.allowed_ip_ranges || !req.ip ||
      !venueAccess.ipIsAllowed(req.ip, settings.allowed_ip_ranges)
    ) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        code: 'TRUSTED_NETWORK_REQUIRED',
        message: 'Trusted location samples can only be submitted from the event network',
      });
    }

    const visitor = await client.query('SELECT phone_verified FROM visitors WHERE id = $1 FOR SHARE', [req.auth.id]);
    if (!visitor.rows[0]?.phone_verified) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, code: 'PHONE_NOT_VERIFIED', message: 'Verify your phone number before submitting a location sample' });
    }

    const anchorResult = await client.query(
      `SELECT 1
       FROM event_location_samples
       WHERE event_id = $1 AND source = 'organizer_anchor'
       LIMIT 1`,
      [eventId]
    );
    if (anchorResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        code: 'LOCATION_ANCHOR_REQUIRED',
        message: 'The organizer must record the initial event location before trusted samples are accepted',
      });
    }

    await locationVerification.insertSample(client, {
      eventId,
      source: 'network_visitor',
      visitorId: req.auth.id,
      coordinates,
    });
    const zone = await locationVerification.rebuildEventZone(client, eventId);

    await client.query('COMMIT');
    return res.status(201).json({
      success: true,
      data: {
        eventId,
        sampleAccepted: true,
        locationReady: zone.location_ready,
        trustedSampleCount: zone.location_sample_count,
        minimumSamples: locationVerification.MIN_CLUSTER_SAMPLES,
      },
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        code: 'LOCATION_SAMPLE_ALREADY_SUBMITTED',
        message: 'You have already submitted a trusted location sample for this event',
      });
    }

    console.error(`Trusted location sample failed for event ${eventId}:`, error.message);
    return res.status(500).json({ success: false, message: 'Unable to record trusted location sample' });
  } finally {
    if (client) client.release();
  }
}

module.exports = { getLocationStatus, captureOrganizerAnchor, captureTrustedNetworkSample };
