exports.up = (pgm) => {
  pgm.createTable('exhibitor_category_assignments', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    event_id: {
      type: 'integer',
      notNull: true,
    },
    exhibitor_id: {
      type: 'integer',
      notNull: true,
    },
    category_id: {
      type: 'integer',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // The assignments and vote FK depend on these ordered unique keys.
  pgm.addConstraint('exhibitor_category_assignments', 'exhibitor_category_assignments_event_exhibitor_category_unique', {
    unique: ['event_id', 'exhibitor_id', 'category_id'],
  });
  pgm.addConstraint('exhibitor_category_assignments', 'exhibitor_category_assignments_event_category_exhibitor_unique', {
    unique: ['event_id', 'category_id', 'exhibitor_id'],
  });
  pgm.addConstraint('exhibitors', 'exhibitors_event_id_id_unique', {
    unique: ['event_id', 'id'],
  });

  pgm.addConstraint('exhibitor_category_assignments', 'exhibitor_category_assignments_exhibitor_event_fkey', {
    foreignKeys: {
      columns: ['event_id', 'exhibitor_id'],
      references: '"exhibitors" (event_id, id)',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('exhibitor_category_assignments', 'exhibitor_category_assignments_category_event_fkey', {
    foreignKeys: {
      columns: ['event_id', 'category_id'],
      references: '"categories" (event_id, id)',
      onDelete: 'CASCADE',
    },
  });

  pgm.sql(`
    INSERT INTO exhibitor_category_assignments (event_id, exhibitor_id, category_id)
    SELECT event_id, id, category_id
    FROM exhibitors;

    ALTER TABLE votes
      DROP CONSTRAINT votes_exhibitor_must_belong_to_category;

    DROP INDEX exhibitors_event_category_idx;

    ALTER TABLE exhibitors
      DROP CONSTRAINT exhibitors_category_id_fkey,
      DROP CONSTRAINT exhibitors_category_must_belong_to_event,
      DROP CONSTRAINT exhibitors_event_category_id_unique,
      DROP COLUMN category_id;

    ALTER TABLE votes
      ADD CONSTRAINT votes_exhibitor_must_belong_to_category
      FOREIGN KEY (event_id, category_id, exhibitor_id)
      REFERENCES exhibitor_category_assignments (event_id, category_id, exhibitor_id);
  `);

  pgm.createIndex('exhibitor_category_assignments', ['event_id', 'category_id'], {
    name: 'exhibitor_category_assignments_event_category_idx',
  });
};

exports.down = (pgm) => {
  // A rollback can restore the old one-category shape only when every exhibitor
  // has exactly one assignment. Fail before changing anything otherwise.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM exhibitors e
        LEFT JOIN exhibitor_category_assignments eca
          ON eca.event_id = e.event_id
         AND eca.exhibitor_id = e.id
        GROUP BY e.event_id, e.id
        HAVING COUNT(eca.category_id) <> 1
      ) THEN
        RAISE EXCEPTION 'Cannot roll back multi-category exhibitors: every exhibitor must have exactly one category assignment';
      END IF;
    END;
    $$;

    ALTER TABLE votes
      DROP CONSTRAINT votes_exhibitor_must_belong_to_category;

    ALTER TABLE exhibitors
      ADD COLUMN category_id integer;

    UPDATE exhibitors e
    SET category_id = eca.category_id
    FROM exhibitor_category_assignments eca
    WHERE eca.event_id = e.event_id
      AND eca.exhibitor_id = e.id;

    ALTER TABLE exhibitors
      ALTER COLUMN category_id SET NOT NULL,
      ADD CONSTRAINT exhibitors_category_id_fkey
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      ADD CONSTRAINT exhibitors_event_category_id_unique
        UNIQUE (event_id, category_id, id),
      ADD CONSTRAINT exhibitors_category_must_belong_to_event
        FOREIGN KEY (event_id, category_id)
        REFERENCES categories (event_id, id) ON DELETE CASCADE;

    ALTER TABLE votes
      ADD CONSTRAINT votes_exhibitor_must_belong_to_category
      FOREIGN KEY (event_id, category_id, exhibitor_id)
      REFERENCES exhibitors (event_id, category_id, id) ON DELETE CASCADE;
  `);

  pgm.dropIndex('exhibitor_category_assignments', ['event_id', 'category_id'], {
    name: 'exhibitor_category_assignments_event_category_idx',
  });
  pgm.dropTable('exhibitor_category_assignments');
  pgm.dropConstraint('exhibitors', 'exhibitors_event_id_id_unique');
  pgm.createIndex('exhibitors', ['event_id', 'category_id'], {
    name: 'exhibitors_event_category_idx',
  });
};
