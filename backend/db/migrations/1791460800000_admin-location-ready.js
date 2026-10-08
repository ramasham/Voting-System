exports.up = (pgm) => {
  // Existing admin anchors become ready without requiring another capture.
  // Visitor coordinates never determine the approved venue's centre or radius.
  pgm.sql(`
    UPDATE event_settings AS settings
    SET location_zone = ST_Multi(
          ST_Buffer(anchor.location::geography, 100)::geometry
        )::geometry(MultiPolygon,4326),
        location_sample_count = (
          SELECT COUNT(*) FROM event_location_samples
          WHERE event_id = settings.event_id
        ),
        location_ready_at = COALESCE(settings.location_ready_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    FROM event_location_samples AS anchor
    WHERE anchor.event_id = settings.event_id
      AND anchor.source = 'organizer_anchor' AND anchor.admin_id IS NOT NULL
      AND (anchor.accuracy_m IS NULL OR anchor.accuracy_m <= 100)
  `);
};

exports.down = (pgm) => {
  // Restore the former three-sample policy when reverting the application.
  pgm.sql(`
    WITH clustered AS (
      SELECT event_id, source, location,
             ST_ClusterDBSCAN(ST_Transform(location, 3857), 75, 3)
               OVER (PARTITION BY event_id ORDER BY id) AS cluster_id
      FROM event_location_samples
    ), anchor_clusters AS (
      SELECT event_id, cluster_id FROM clustered
      WHERE source = 'organizer_anchor' AND cluster_id IS NOT NULL
    ), zones AS (
      SELECT clustered.event_id, ST_Multi(
        ST_Buffer(ST_ConcaveHull(ST_Collect(clustered.location), 0.8)::geography, 30)::geometry
      )::geometry(MultiPolygon,4326) AS geofence
      FROM clustered
      JOIN anchor_clusters USING (event_id, cluster_id)
      GROUP BY clustered.event_id, clustered.cluster_id
      HAVING COUNT(*) >= 3
    )
    UPDATE event_settings AS settings
    SET location_zone = zones.geofence,
        location_ready_at = CASE
          WHEN zones.geofence IS NULL THEN NULL
          ELSE COALESCE(settings.location_ready_at, CURRENT_TIMESTAMP)
        END,
        updated_at = CURRENT_TIMESTAMP
    FROM events LEFT JOIN zones ON zones.event_id = events.id
    WHERE settings.event_id = events.id
  `);
};
