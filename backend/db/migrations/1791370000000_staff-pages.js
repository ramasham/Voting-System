exports.up = (pgm) => {
  pgm.addColumns('admins', {
    mfa_secret: { type: 'text' },
    mfa_pending_secret: { type: 'text' },
    mfa_pending_until: { type: 'timestamptz' },
    mfa_last_counter: { type: 'bigint', notNull: true, default: -1 },
  });
};

exports.down = (pgm) => {
  // Disabling MFA deliberately requires operator intervention before rollback.
  pgm.sql(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admins WHERE mfa_enabled) THEN
      RAISE EXCEPTION 'Disable admin MFA before rolling back its secret storage';
    END IF;
  END $$;`);
  pgm.dropColumns('admins', ['mfa_secret', 'mfa_pending_secret', 'mfa_pending_until', 'mfa_last_counter']);
};
