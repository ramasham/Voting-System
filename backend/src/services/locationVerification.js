const MIN_LOCATION_SAMPLES = 1;
const VENUE_RADIUS_METERS = 100;
const MAX_LOCATION_ACCURACY_METERS = 100;
const { ipIsAllowed } = require('../utils/validation');
const { verifyPresentationPass } = require('./presentationAccess');

function parseCoordinates(body) {
  const latitude = body?.latitude;
  const longitude = body?.longitude;
  const accuracy = body?.accuracy;

  if (
    typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    return null;
  }

  if (
    accuracy !== undefined &&
    (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 5000)
  ) {
    return null;
  }

  return { latitude, longitude, accuracy: accuracy ?? null };
}

async function insertSample(client, { eventId, source, visitorId, adminId, coordinates }) {
  await client.query(
    `INSERT INTO event_location_samples
       (event_id, source, visitor_id, admin_id, location, accuracy_m)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7)`,
    [
      eventId,
      source,
      visitorId ?? null,
      adminId ?? null,
      coordinates.longitude,
      coordinates.latitude,
      coordinates.accuracy,
    ]
  );
}

async function rebuildEventZone(client, eventId) {
  const result = await client.query(
    `WITH zone AS (
       SELECT ST_Multi(
                ST_Buffer(location::geography, $2)::geometry
              )::geometry(MultiPolygon,4326) AS geofence
       FROM event_location_samples
       WHERE event_id = $1 AND source = 'organizer_anchor' AND admin_id IS NOT NULL
         AND (accuracy_m IS NULL OR accuracy_m <= $3)
     ), sample_total AS (
       SELECT COUNT(*)::integer AS total
       FROM event_location_samples
       WHERE event_id = $1
     )
     UPDATE event_settings AS settings
     SET location_sample_count = sample_total.total,
         location_zone = zone.geofence,
         location_ready_at = CASE
           WHEN zone.geofence IS NULL THEN NULL
           ELSE COALESCE(settings.location_ready_at, CURRENT_TIMESTAMP)
         END,
         updated_at = CURRENT_TIMESTAMP
     FROM sample_total
     LEFT JOIN zone ON TRUE
     WHERE settings.event_id = $1
     RETURNING settings.location_sample_count,
               settings.location_zone IS NOT NULL AS location_ready`,
    [eventId, VENUE_RADIUS_METERS, MAX_LOCATION_ACCURACY_METERS]
  );

  return result.rows[0];
}

async function checkVenueAccess(client, { eventId, settings, clientIp, coordinates, presentationPass }) {
  const reject = (code, status, message) => ({ allowed: false, code, status, message });
  if (verifyPresentationPass(presentationPass, eventId)) return { allowed: true, method: 'presentation' };
  const hasRanges = typeof settings.allowed_ip_ranges === 'string' && settings.allowed_ip_ranges.trim() !== '';
  if (hasRanges && clientIp) {
    try {
      if (ipIsAllowed(clientIp, settings.allowed_ip_ranges)) return { allowed: true, method: 'network' };
    } catch {
      return reject('VENUE_ACCESS_UNAVAILABLE', 503, 'Venue network configuration is invalid');
    }
  }

  if (settings.location_enabled && settings.location_ready) {
    const location = parseCoordinates(coordinates);
    if (!location) {
      return reject('LOCATION_REQUIRED', 403, 'Connect to the event network or provide your device location');
    }
    if (location.accuracy !== null && location.accuracy > MAX_LOCATION_ACCURACY_METERS) {
      return reject('LOCATION_INACCURATE', 403, 'Location accuracy is insufficient; connect to the event network');
    }
    const result = await client.query(
      `SELECT ST_Covers(location_zone, ST_SetSRID(ST_MakePoint($2, $3), 4326)) AS inside
       FROM event_settings
       WHERE event_id = $1 AND location_enabled = TRUE AND location_zone IS NOT NULL`,
      [eventId, location.longitude, location.latitude]
    );
    if (result.rows[0]?.inside === true) return { allowed: true, method: 'location' };
    return reject('OUTSIDE_VENUE', 403, 'Voting is only available inside the venue');
  }

  if (settings.location_enabled && !settings.location_ready && coordinates) {
    return reject('LOCATION_NOT_READY', 503, 'The admin must record the venue location before location access is available; connect to the event network and try again');
  }

  if (!hasRanges) {
    return reject('VENUE_ACCESS_NOT_CONFIGURED', 503, 'Venue access is not configured for this event');
  }
  return reject('OUTSIDE_VENUE', 403, 'Voting is only available inside the venue');
}

module.exports = {
  MIN_LOCATION_SAMPLES,
  VENUE_RADIUS_METERS,
  MAX_LOCATION_ACCURACY_METERS,
  parseCoordinates,
  insertSample,
  rebuildEventZone,
  checkVenueAccess,
};
