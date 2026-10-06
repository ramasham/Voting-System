exports.up = (pgm) => {
  // 1. Events
  pgm.createTable('events', {
    id: {
      type: 'serial',
      primaryKey: true,
    },

    name: {
      type: 'varchar(255)',
      notNull: true,
    },

    start_at: {
      type: 'timestamp',
    },

    end_at: {
      type: 'timestamp',
    },

    status: {
      type: 'varchar(50)',
      notNull: true,
    },

    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },

    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 2. Visitors
  pgm.createTable('visitors', {
    id: {
      type: 'serial',
      primaryKey: true,
    },

    name: {
      type: 'varchar(255)',
      notNull: true,
    },

    phone_number: {
      type: 'varchar(30)',
      notNull: true,
      unique: true,
    },

    phone_verified: {
      type: 'boolean',
      notNull: true,
      default: false,
    },

    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },

    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 3. Categories
  pgm.createTable('categories', {
    id: {
      type: 'serial',
      primaryKey: true,
    },

    event_id: {
      type: 'integer',
      notNull: true,
      references: 'events(id)',
      onDelete: 'CASCADE',
    },

    name: {
      type: 'varchar(255)',
      notNull: true,
    },

    description: {
      type: 'text',
    },

    display_order: {
      type: 'integer',
    },

    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },

    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 4. Exhibitors
  pgm.createTable('exhibitors', {
    id: {
      type: 'serial',
      primaryKey: true,
    },

    event_id: {
      type: 'integer',
      notNull: true,
      references: 'events(id)',
      onDelete: 'CASCADE',
    },

    category_id: {
      type: 'integer',
      notNull: true,
      references: 'categories(id)',
      onDelete: 'CASCADE',
    },

    name: {
      type: 'varchar(255)',
      notNull: true,
    },

    description: {
      type: 'text',
    },

    image_url: {
      type: 'varchar(500)',
    },

    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },

    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 5. Votes
  pgm.createTable('votes', {
    id: {
      type: 'serial',
      primaryKey: true,
    },

    event_id: {
      type: 'integer',
      notNull: true,
      references: 'events(id)',
      onDelete: 'CASCADE',
    },

    visitor_id: {
      type: 'integer',
      notNull: true,
      references: 'visitors(id)',
      onDelete: 'CASCADE',
    },

    category_id: {
      type: 'integer',
      notNull: true,
      references: 'categories(id)',
      onDelete: 'CASCADE',
    },

    exhibitor_id: {
      type: 'integer',
      notNull: true,
      references: 'exhibitors(id)',
      onDelete: 'CASCADE',
    },

    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // Prevent a visitor from voting more than once
  // in the same category for the same event.
  pgm.addConstraint(
    'votes',
    'unique_visitor_category_per_event',
    {
      unique: ['event_id', 'visitor_id', 'category_id'],
    }
  );

  // 6. OTP Verifications
  pgm.createTable('otp_verifications', {
    id: {
      type: 'serial',
      primaryKey: true,
    },

    visitor_id: {
      type: 'integer',
      notNull: true,
      references: 'visitors(id)',
      onDelete: 'CASCADE',
    },

    otp_hash: {
      type: 'varchar(255)',
      notNull: true,
    },

    expires_at: {
      type: 'timestamp',
      notNull: true,
    },

    verified_at: {
      type: 'timestamp',
    },

    attempts: {
      type: 'integer',
      notNull: true,
      default: 0,
    },

    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 7. Admins
  pgm.createTable('admins', {
    id: {
      type: 'serial',
      primaryKey: true,
    },

    username: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },

    password_hash: {
      type: 'varchar(255)',
      notNull: true,
    },

    mfa_enabled: {
      type: 'boolean',
      notNull: true,
      default: false,
    },

    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },

    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 8. Event Settings
  pgm.createTable('event_settings', {
    id: {
      type: 'serial',
      primaryKey: true,
    },

    event_id: {
      type: 'integer',
      notNull: true,
      unique: true,
      references: 'events(id)',
      onDelete: 'CASCADE',
    },

    voting_start_at: {
      type: 'timestamp',
    },

    voting_end_at: {
      type: 'timestamp',
    },

    voting_enabled: {
      type: 'boolean',
      notNull: true,
      default: false,
    },

    allowed_ip_ranges: {
      type: 'text',
    },

    location_enabled: {
      type: 'boolean',
      notNull: true,
      default: false,
    },

    location_config: {
      type: 'text',
    },

    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },

    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });
};

exports.down = (pgm) => {
  // Drop in reverse dependency order.
  pgm.dropTable('event_settings');
  pgm.dropTable('admins');
  pgm.dropTable('otp_verifications');
  pgm.dropTable('votes');
  pgm.dropTable('exhibitors');
  pgm.dropTable('categories');
  pgm.dropTable('visitors');
  pgm.dropTable('events');
};