exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS postgis');

  pgm.addColumns('event_settings', {
    location_zone: {
      type: 'geometry(MultiPolygon,4326)',
    },
    location_sample_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    location_ready_at: {
      type: 'timestamptz',
    },
  });

  pgm.createTable('event_location_samples', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    event_id: {
      type: 'integer',
      notNull: true,
      references: 'events(id)',
      onDelete: 'CASCADE',
    },
    source: {
      type: 'varchar(30)',
      notNull: true,
    },
    visitor_id: {
      type: 'integer',
      references: 'visitors(id)',
      onDelete: 'RESTRICT',
    },
    admin_id: {
      type: 'integer',
      references: 'admins(id)',
      onDelete: 'RESTRICT',
    },
    location: {
      type: 'geometry(Point,4326)',
      notNull: true,
    },
    accuracy_m: {
      type: 'double precision',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  pgm.addConstraint('event_location_samples', 'event_location_samples_valid_source', {
    check: `
      (source = 'organizer_anchor' AND visitor_id IS NULL AND admin_id IS NOT NULL)
      OR (source = 'network_visitor' AND visitor_id IS NOT NULL AND admin_id IS NULL)
    `,
  });

  pgm.addConstraint('event_location_samples', 'event_location_samples_valid_accuracy', {
    check: 'accuracy_m IS NULL OR (accuracy_m >= 0 AND accuracy_m <= 5000)',
  });

  pgm.createIndex('event_location_samples', ['event_id'], {
    name: 'event_location_samples_event_idx',
  });
  pgm.createIndex('event_location_samples', ['event_id'], {
    name: 'event_location_samples_one_anchor_per_event',
    unique: true,
    where: "source = 'organizer_anchor'",
  });
  pgm.createIndex('event_location_samples', ['event_id', 'visitor_id'], {
    name: 'event_location_samples_one_network_sample_per_visitor',
    unique: true,
    where: "source = 'network_visitor'",
  });
};

exports.down = (pgm) => {
  pgm.dropTable('event_location_samples');
  pgm.dropColumns('event_settings', ['location_zone', 'location_sample_count', 'location_ready_at']);
  // PostGIS may be used by other tables in the same database, so the extension stays installed.
};
