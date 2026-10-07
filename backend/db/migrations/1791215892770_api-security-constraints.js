exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE events
      ALTER COLUMN start_at TYPE timestamptz
      USING start_at AT TIME ZONE 'Asia/Amman';
    ALTER TABLE events
      ALTER COLUMN end_at TYPE timestamptz
      USING end_at AT TIME ZONE 'Asia/Amman';
    ALTER TABLE event_settings
      ALTER COLUMN voting_start_at TYPE timestamptz
      USING voting_start_at AT TIME ZONE 'Asia/Amman';
    ALTER TABLE event_settings
      ALTER COLUMN voting_end_at TYPE timestamptz
      USING voting_end_at AT TIME ZONE 'Asia/Amman';

    ALTER TABLE categories
      ADD CONSTRAINT categories_event_id_id_unique UNIQUE (event_id, id);

    ALTER TABLE exhibitors
      ADD CONSTRAINT exhibitors_event_category_id_unique
      UNIQUE (event_id, category_id, id);

    ALTER TABLE exhibitors
      ADD CONSTRAINT exhibitors_category_must_belong_to_event
      FOREIGN KEY (event_id, category_id)
      REFERENCES categories (event_id, id)
      ON DELETE CASCADE;

    ALTER TABLE votes
      ADD CONSTRAINT votes_category_must_belong_to_event
      FOREIGN KEY (event_id, category_id)
      REFERENCES categories (event_id, id)
      ON DELETE CASCADE;

    ALTER TABLE votes
      ADD CONSTRAINT votes_exhibitor_must_belong_to_category
      FOREIGN KEY (event_id, category_id, exhibitor_id)
      REFERENCES exhibitors (event_id, category_id, id)
      ON DELETE CASCADE;

    ALTER TABLE event_settings
      ADD CONSTRAINT event_settings_valid_voting_window
      CHECK (
        voting_start_at IS NULL OR
        voting_end_at IS NULL OR
        voting_end_at > voting_start_at
      );
  `);

  pgm.createTable('api_rate_limits', {
    rate_limit_key: {
      type: 'varchar(255)',
      primaryKey: true,
    },

    window_id: {
      type: 'bigint',
      notNull: true,
    },

    hits: {
      type: 'integer',
      notNull: true,
      default: 0,
    },

    expires_at: {
      type: 'timestamptz',
      notNull: true,
    },
  });

  pgm.createIndex('otp_verifications', ['visitor_id', 'created_at'], {
    name: 'otp_verifications_visitor_created_idx',
  });
  pgm.createIndex('categories', ['event_id', 'display_order'], {
    name: 'categories_event_display_order_idx',
  });
  pgm.createIndex('exhibitors', ['event_id', 'category_id'], {
    name: 'exhibitors_event_category_idx',
  });
  pgm.createIndex('votes', ['event_id', 'category_id', 'exhibitor_id'], {
    name: 'votes_event_category_exhibitor_idx',
  });
  pgm.createIndex('api_rate_limits', ['expires_at'], {
    name: 'api_rate_limits_expires_idx',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('api_rate_limits', ['expires_at'], {
    name: 'api_rate_limits_expires_idx',
  });
  pgm.dropIndex('votes', ['event_id', 'category_id', 'exhibitor_id'], {
    name: 'votes_event_category_exhibitor_idx',
  });
  pgm.dropIndex('exhibitors', ['event_id', 'category_id'], {
    name: 'exhibitors_event_category_idx',
  });
  pgm.dropIndex('categories', ['event_id', 'display_order'], {
    name: 'categories_event_display_order_idx',
  });
  pgm.dropIndex('otp_verifications', ['visitor_id', 'created_at'], {
    name: 'otp_verifications_visitor_created_idx',
  });
  pgm.dropTable('api_rate_limits');

  pgm.sql(`
    ALTER TABLE votes
      DROP CONSTRAINT votes_exhibitor_must_belong_to_category;
    ALTER TABLE votes
      DROP CONSTRAINT votes_category_must_belong_to_event;
    ALTER TABLE event_settings
      DROP CONSTRAINT event_settings_valid_voting_window;
    ALTER TABLE exhibitors
      DROP CONSTRAINT exhibitors_category_must_belong_to_event;
    ALTER TABLE exhibitors
      DROP CONSTRAINT exhibitors_event_category_id_unique;
    ALTER TABLE categories
      DROP CONSTRAINT categories_event_id_id_unique;

    ALTER TABLE event_settings
      ALTER COLUMN voting_end_at TYPE timestamp
      USING voting_end_at AT TIME ZONE 'Asia/Amman';
    ALTER TABLE event_settings
      ALTER COLUMN voting_start_at TYPE timestamp
      USING voting_start_at AT TIME ZONE 'Asia/Amman';
    ALTER TABLE events
      ALTER COLUMN end_at TYPE timestamp
      USING end_at AT TIME ZONE 'Asia/Amman';
    ALTER TABLE events
      ALTER COLUMN start_at TYPE timestamp
      USING start_at AT TIME ZONE 'Asia/Amman';
  `);
};
