exports.up = (pgm) => {
  pgm.addColumns('exhibitors', {
    team_members: {
      type: 'text[]',
      notNull: true,
      default: pgm.func("'{}'::text[]"),
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('exhibitors', 'team_members');
};
