const test = require('node:test');
const assert = require('node:assert/strict');

// Explicitly opt in. All writes use temporary tables on one PostGIS connection.
test('admin location establishes a fixed venue without visitor samples', {
  skip: process.env.RUN_POSTGIS_TESTS !== '1',
}, async (t) => {
  const pool = require('../../db/connection');
  const verification = require('../../src/services/locationVerification');
  const controller = require('../../src/controllers/location.controller');
  const migration = require('../../db/migrations/1791460800000_admin-location-ready');
  const client = await pool.connect();
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  const point = { latitude: 31.95, longitude: 35.91, accuracy: 15 };
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const settings = { location_enabled: true, location_ready: true };
  const access = (coordinates) => verification.checkVenueAccess(client, {
    eventId: 1, settings, coordinates, clientIp: '203.0.113.8',
  });
  const runMigration = async (direction) => {
    const statements = [];
    migration[direction]({ sql: (sql) => statements.push(sql) });
    for (const sql of statements) await client.query(sql);
  };

  try {
    await client.query(`
      CREATE TEMP TABLE events (id integer PRIMARY KEY);
      CREATE TEMP TABLE visitors (id integer PRIMARY KEY, phone_verified boolean NOT NULL);
      CREATE TEMP TABLE event_settings (
        event_id integer PRIMARY KEY, voting_enabled boolean DEFAULT FALSE,
        location_enabled boolean DEFAULT FALSE, allowed_ip_ranges text,
        location_sample_count integer DEFAULT 0, location_zone geometry(MultiPolygon,4326),
        location_ready_at timestamptz, updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TEMP TABLE event_location_samples (
        id bigserial PRIMARY KEY, event_id integer NOT NULL, source varchar(30),
        visitor_id integer, admin_id integer, location geometry(Point,4326), accuracy_m double precision,
        created_at timestamptz DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX ON event_location_samples (event_id) WHERE source = 'organizer_anchor';
      CREATE UNIQUE INDEX ON event_location_samples (event_id, visitor_id) WHERE source = 'network_visitor';
    `);
    const isolated = await client.query(`
      SELECT bool_and(c.relnamespace = pg_my_temp_schema()) AS isolated
      FROM pg_class c WHERE c.oid IN (
        'events'::regclass, 'visitors'::regclass,
        'event_settings'::regclass, 'event_location_samples'::regclass
      )
    `);
    assert.equal(isolated.rows[0].isolated, true, 'Every test table must be temporary');
    await client.query(`
      INSERT INTO events VALUES (1), (2), (3), (4), (5);
      INSERT INTO visitors VALUES (7, TRUE), (8, TRUE), (9, FALSE);
    `);
    pool.connect = async () => ({ query: client.query.bind(client), release() {} });
    pool.query = client.query.bind(client);

    await t.test('one admin capture is ready and permits GPS without Wi-Fi', async () => {
      const res = response();
      await controller.captureOrganizerAnchor({
        params: { eventId: '1' }, auth: { id: 12 }, body: point,
      }, res);
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.locationReady, true);
      assert.equal(res.body.data.trustedSampleCount, 1);
      assert.equal(res.body.data.minimumSamples, 1);
      assert.equal(res.body.data.radiusMeters, 100);
      assert.equal((await access(point)).method, 'location');
      assert.equal((await access({ ...point, latitude: point.latitude + 0.0007 })).allowed, true);
      assert.equal((await access({ ...point, latitude: point.latitude + 0.0012 })).code, 'OUTSIDE_VENUE');
      assert.equal((await access({ ...point, accuracy: 101 })).code, 'LOCATION_INACCURATE');
      const status = response();
      await controller.getLocationStatus({ params: { eventId: '1' } }, status);
      assert.equal(status.body.data.location_ready, true);
      assert.equal(status.body.data.minimum_samples, 1);
      assert.equal(status.body.data.radius_meters, 100);
    });

    await t.test('visitor samples cannot move or expand the admin zone', async () => {
      await client.query("UPDATE event_settings SET allowed_ip_ranges = '192.0.2.0/24' WHERE event_id = 1");
      const zone = async () => (await client.query(
        'SELECT ST_AsEWKB(location_zone) AS zone FROM event_settings WHERE event_id = 1'
      )).rows[0].zone;
      const initial = await zone();
      for (const [id, offset] of [[7, 0.01], [8, 0.02]]) {
        const visitorPoint = { ...point, latitude: point.latitude + offset };
        const res = response();
        await controller.captureTrustedNetworkSample({
          params: { eventId: '1' }, auth: { id }, ip: '192.0.2.4', body: visitorPoint,
        }, res);
        assert.equal(res.statusCode, 201);
        assert.equal(res.body.data.locationReady, true);
        assert.deepEqual(await zone(), initial);
        assert.equal((await access(visitorPoint)).code, 'OUTSIDE_VENUE');
      }
    });

    await t.test('repeated admin captures replace the anchor and move the venue zone immediately', async () => {
      const originalSettings = (await client.query(
        'SELECT voting_enabled, allowed_ip_ranges FROM event_settings WHERE event_id = 1'
      )).rows[0];
      let previous = point;
      for (const [offset, accuracy, adminId] of [[0.004, 8, 13], [-0.004, 4, 14], [-0.004, 7, 15]]) {
        const current = { ...point, latitude: point.latitude + offset, accuracy };
        const before = (await client.query(
          "SELECT created_at FROM event_location_samples WHERE event_id = 1 AND source = 'organizer_anchor'"
        )).rows[0].created_at;
        const res = response();
        await controller.captureOrganizerAnchor({
          params: { eventId: '1' }, auth: { id: adminId }, body: current,
        }, res);
        assert.equal(res.statusCode, 201);
        assert.equal(res.body.data.locationReady, true);
        assert.equal(res.body.data.trustedSampleCount, 3, 'Recapturing does not add another sample');
        assert.equal(res.body.data.radiusMeters, 100);
        assert.equal((await access(current)).method, 'location');
        assert.equal((await access({ ...current, latitude: current.latitude + 0.0007 })).allowed, true);
        assert.equal((await access({ ...current, latitude: current.latitude + 0.0012 })).code, 'OUTSIDE_VENUE');
        assert.equal((await access(point)).code, 'OUTSIDE_VENUE');
        if (previous.latitude !== current.latitude) {
          assert.equal((await access(previous)).code, 'OUTSIDE_VENUE');
        }
        const stored = await client.query(`
          SELECT admin_id, ST_X(location) AS longitude, ST_Y(location) AS latitude,
                 accuracy_m, created_at
          FROM event_location_samples WHERE event_id = 1 AND source = 'organizer_anchor'
        `);
        assert.equal(stored.rowCount, 1);
        assert.equal(stored.rows[0].admin_id, adminId);
        assert.equal(stored.rows[0].longitude, current.longitude);
        assert.equal(stored.rows[0].latitude, current.latitude);
        assert.equal(stored.rows[0].accuracy_m, current.accuracy);
        assert.ok(stored.rows[0].created_at >= before);
        assert.deepEqual((await client.query(
          'SELECT voting_enabled, allowed_ip_ranges FROM event_settings WHERE event_id = 1'
        )).rows[0], originalSettings);
        previous = current;
      }
    });

    await t.test('invalid recaptures preserve the approved venue', async () => {
      const zone = async () => (await client.query(
        'SELECT ST_AsEWKB(location_zone) AS zone FROM event_settings WHERE event_id = 1'
      )).rows[0].zone;
      const initial = await zone();
      for (const [body, code] of [
        [{ ...point, latitude: 91 }, 'INVALID_LOCATION'],
        [{ ...point, accuracy: 101 }, 'LOCATION_INACCURATE'],
      ]) {
        const res = response();
        await controller.captureOrganizerAnchor({
          params: { eventId: '1' }, auth: { id: 12 }, body,
        }, res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, code);
        assert.deepEqual(await zone(), initial);
      }
    });

    await t.test('capture accuracy and trusted visitor uniqueness checks remain enforced', async () => {
      for (const [eventId, accuracy, code] of [
        ['2', 101, 'LOCATION_INACCURATE'],
      ]) {
        const res = response();
        await controller.captureOrganizerAnchor({
          params: { eventId }, auth: { id: 12 }, body: { ...point, accuracy },
        }, res);
        assert.equal(res.body.code, code);
      }
      for (const [id, ip, accuracy, code] of [
        [7, '192.0.2.4', 15, 'LOCATION_SAMPLE_ALREADY_SUBMITTED'],
        [9, '192.0.2.4', 15, 'PHONE_NOT_VERIFIED'],
        [8, '203.0.113.8', 15, 'TRUSTED_NETWORK_REQUIRED'],
        [8, '192.0.2.4', 101, 'LOCATION_INACCURATE'],
      ]) {
        const res = response();
        await controller.captureTrustedNetworkSample({
          params: { eventId: '1' }, auth: { id }, ip, body: { ...point, accuracy },
        }, res);
        assert.equal(res.body.code, code);
      }
    });

    await t.test('visitor positions alone cannot establish a ready zone', async () => {
      await client.query("INSERT INTO event_settings (event_id, location_enabled, allowed_ip_ranges) VALUES (3, TRUE, '192.0.2.0/24')");
      const res = response();
      await controller.captureTrustedNetworkSample({
        params: { eventId: '3' }, auth: { id: 7 }, ip: '192.0.2.4', body: point,
      }, res);
      assert.equal(res.body.code, 'LOCATION_ANCHOR_REQUIRED');
      for (const visitorId of [7, 8, 9]) {
        await verification.insertSample(client, {
          eventId: 3, source: 'network_visitor', visitorId, coordinates: point,
        });
      }
      const zone = await verification.rebuildEventZone(client, 3);
      assert.equal(zone.location_sample_count, 3);
      assert.equal(zone.location_ready, false);
    });

    await t.test('migration readies existing admin anchors and preserves enabled and voting flags', async () => {
      await client.query(`
        INSERT INTO event_settings (event_id, voting_enabled, location_enabled)
        VALUES (2, TRUE, FALSE), (4, FALSE, TRUE), (5, FALSE, TRUE)
      `);
      for (const eventId of [2, 4, 5]) {
        await verification.insertSample(client, {
          eventId, source: 'organizer_anchor', adminId: 12,
          coordinates: { ...point, accuracy: eventId === 5 ? 500 : 15 },
        });
      }
      for (const [visitorId, offset] of [[7, 0.00005], [8, -0.00005]]) {
        await verification.insertSample(client, {
          eventId: 4, source: 'network_visitor', visitorId,
          coordinates: { ...point, latitude: point.latitude + offset },
        });
      }
      // Reproduce the previous ready zone and a lone, unready admin anchor.
      await runMigration('down');
      await runMigration('up');
      const result = await client.query(`
        SELECT event_id, voting_enabled, location_enabled, location_sample_count,
               location_zone IS NOT NULL AS ready,
               ST_Covers(location_zone, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS within_radius
        FROM event_settings ORDER BY event_id
      `, [point.longitude, point.latitude + 0.0007]);
      const byId = Object.fromEntries(result.rows.map((row) => [row.event_id, row]));
      assert.equal(byId[2].ready, true);
      assert.equal(byId[2].location_sample_count, 1);
      assert.equal(byId[2].location_enabled, false);
      assert.equal(byId[2].voting_enabled, true);
      assert.equal(byId[3].ready, false);
      assert.equal(byId[4].ready, true);
      assert.equal(byId[4].within_radius, true);
      assert.equal(byId[5].ready, false);
      assert.equal((await verification.rebuildEventZone(client, 5)).location_ready, false);
    });

    await t.test('migration rollback restores the former three-sample requirement', async () => {
      await runMigration('down');
      const result = await client.query(`
        SELECT event_id, location_zone IS NOT NULL AS ready
        FROM event_settings ORDER BY event_id
      `);
      const ready = Object.fromEntries(result.rows.map((row) => [row.event_id, row.ready]));
      assert.equal(ready[1], false, 'Faraway visitor samples do not form an anchor cluster');
      assert.equal(ready[2], false, 'One anchor is insufficient under the former policy');
      assert.equal(ready[3], false, 'Visitors alone cannot establish a venue');
      assert.equal(ready[4], true, 'The anchor and two nearby visitors form the former zone');
    });
  } finally {
    pool.connect = originalConnect;
    pool.query = originalQuery;
    await client.query('ROLLBACK').catch(() => {});
    await client.query('DISCARD TEMP');
    client.release();
    await pool.end();
  }
});
