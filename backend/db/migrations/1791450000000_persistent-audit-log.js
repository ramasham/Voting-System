exports.up = (pgm) => {
  pgm.createTable('audit_logs', {
    id: { type: 'bigserial', primaryKey: true },
    event_type: { type: 'varchar(40)', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') },
    actor_type: { type: 'varchar(20)', notNull: true },
    actor_id: { type: 'integer' },
    event_id: { type: 'integer' },
    details: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
  });

  pgm.addConstraint('audit_logs', 'audit_logs_valid_type', {
    check: `event_type IN (
      'OTP_REQUESTED', 'OTP_DELIVERY_FAILED', 'OTP_VERIFIED', 'OTP_FAILED',
      'VOTE_SUCCESS', 'VOTE_REJECTED', 'ADMIN_LOGIN_SUCCESS', 'ADMIN_LOGIN_FAILURE',
      'ADMIN_MUTATION'
    )`,
  });
  pgm.addConstraint('audit_logs', 'audit_logs_valid_actor', {
    check: `actor_type IN ('admin', 'visitor', 'system') AND (actor_id IS NULL OR actor_type = 'admin')`,
  });
  pgm.createIndex('audit_logs', ['occurred_at'], { name: 'audit_logs_occurred_at_idx' });
  pgm.createIndex('audit_logs', ['event_type', 'occurred_at'], { name: 'audit_logs_type_occurred_at_idx' });
  pgm.createIndex('audit_logs', ['event_id', 'occurred_at'], { name: 'audit_logs_event_occurred_at_idx' });
};

exports.down = (pgm) => {
  pgm.dropTable('audit_logs');
};
