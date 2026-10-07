const pool = require('../connection');

const eventDetails = {
  name: 'Maker Collective 2026',
  startAt: '2026-10-15T09:00:00+03:00',
  endAt: '2026-10-15T18:00:00+03:00',
};

const categorySeeds = [
  {
    displayOrder: 1,
    name: 'A',
    description: 'Award category A.',
  },
  {
    displayOrder: 2,
    name: 'B',
    description: 'Award category B.',
  },
  {
    displayOrder: 3,
    name: 'C',
    description: 'Award category C.',
  },
];

const exhibitorSeeds = [
  {
    categoryOrders: [1],
    name: 'Smart Irrigation System',
    description: 'A sensor-based system that waters plants when the soil is dry.',
  },
  {
    categoryOrders: [1],
    name: 'Recycled Plastic Filament Maker',
    description: 'A machine that turns recycled plastic into 3D-printer filament.',
  },
  {
    categoryOrders: [2, 3],
    name: 'Gesture-Controlled Robot',
    description: 'A small robot controlled by hand movements.',
  },
  {
    categoryOrders: [2],
    name: 'AI Plant Health Assistant',
    description: 'A prototype that uses images to identify common plant problems.',
  },
  {
    categoryOrders: [3],
    name: 'Interactive LED Art Wall',
    description: 'A colorful display that responds to visitors’ movement.',
  },
  {
    categoryOrders: [3],
    name: 'Assistive Grip Adapter',
    description: 'A 3D-printed aid designed to make everyday tools easier to hold.',
  },
];

async function findOrCreateEvent(client) {
  const existing = await client.query(
    `
    SELECT id
    FROM events
    WHERE name = $1
    ORDER BY id
    LIMIT 1
    `,
    [eventDetails.name]
  );

  if (existing.rowCount > 0) {
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `
    INSERT INTO events (name, start_at, end_at, status)
    VALUES ($1, $2, $3, $4)
    RETURNING id
    `,
    [eventDetails.name, eventDetails.startAt, eventDetails.endAt, 'upcoming']
  );

  return inserted.rows[0].id;
}

async function upsertCategory(client, eventId, category) {
  const existing = await client.query(
    `
    SELECT id
    FROM categories
    WHERE event_id = $1 AND display_order = $2
    ORDER BY id
    LIMIT 1
    `,
    [eventId, category.displayOrder]
  );

  if (existing.rowCount > 0) {
    const categoryId = existing.rows[0].id;

    await client.query(
      `
      UPDATE categories
      SET name = $1, description = $2
      WHERE id = $3
      `,
      [category.name, category.description, categoryId]
    );

    return categoryId;
  }

  const inserted = await client.query(
    `
    INSERT INTO categories (event_id, name, description, display_order)
    VALUES ($1, $2, $3, $4)
    RETURNING id
    `,
    [eventId, category.name, category.description, category.displayOrder]
  );

  return inserted.rows[0].id;
}

async function upsertExhibitor(client, eventId, categoryIds, exhibitor) {
  const existing = await client.query(
    `
    SELECT id
    FROM exhibitors
    WHERE event_id = $1 AND name = $2
    ORDER BY id
    LIMIT 1
    `,
    [eventId, exhibitor.name]
  );

  if (existing.rowCount > 0) {
    await client.query(
      `
      UPDATE exhibitors
      SET description = $1, updated_at = CURRENT_TIMESTAMP
      WHERE event_id = $2 AND id = $3
      `,
      [exhibitor.description, eventId, existing.rows[0].id]
    );
  } else {
    await client.query(
      `
      INSERT INTO exhibitors (event_id, name, description)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [eventId, exhibitor.name, exhibitor.description]
    );
  }

  const exhibitorResult = await client.query(
    `
    SELECT id
    FROM exhibitors
    WHERE event_id = $1 AND name = $2
    ORDER BY id
    LIMIT 1
    `,
    [eventId, exhibitor.name]
  );

  const exhibitorId = exhibitorResult.rows[0].id;
  for (const categoryId of categoryIds) {
    await client.query(
      `
      INSERT INTO exhibitor_category_assignments (
        event_id,
        exhibitor_id,
        category_id
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (event_id, exhibitor_id, category_id) DO NOTHING
      `,
      [eventId, exhibitorId, categoryId]
    );
  }
}

async function ensureEventSettings(client, eventId) {
  const existing = await client.query(
    'SELECT id FROM event_settings WHERE event_id = $1',
    [eventId]
  );

  if (existing.rowCount > 0) {
    return;
  }

  await client.query(
    `
    INSERT INTO event_settings (
      event_id,
      voting_start_at,
      voting_end_at,
      voting_enabled,
      allowed_ip_ranges,
      location_enabled,
      location_config
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [eventId, '2026-10-15T10:00:00+03:00', '2026-10-15T17:00:00+03:00', false, null, false, null]
  );
}

async function seed() {
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const eventId = await findOrCreateEvent(client);
    const categoryIds = new Map();

    for (const category of categorySeeds) {
      const categoryId = await upsertCategory(client, eventId, category);
      categoryIds.set(category.displayOrder, categoryId);
    }

    for (const exhibitor of exhibitorSeeds) {
      const assignedCategoryIds = exhibitor.categoryOrders.map(
        (order) => categoryIds.get(order)
      );
      await upsertExhibitor(client, eventId, assignedCategoryIds, exhibitor);
    }

    await ensureEventSettings(client, eventId);
    await client.query('COMMIT');

    console.log('Initial data is ready.');
    console.log('Event ID:', eventId);
    console.log(`Categories: ${categorySeeds.length}`);
    console.log(`Sample exhibitors: ${exhibitorSeeds.length}`);
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }

    console.error('Failed to seed initial data:');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (client) {
      client.release();
    }

    await pool.end();
  }
}

seed();
