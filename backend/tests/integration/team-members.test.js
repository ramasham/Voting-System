const test = require('node:test');
const assert = require('node:assert/strict');

// Opt in with an explicit test database. Every modified table is temporary.
test('team members migrate and persist through project CRUD and visitor reads', {
  skip: process.env.RUN_POSTGRES_TESTS !== '1',
}, async (t) => {
  assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL explicitly');
  const { Pool } = require('pg');
  const testPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const client = await testPool.connect();
  const appPool = require('../../db/connection');
  const content = require('../../src/controllers/adminContent.controller');
  const events = require('../../src/controllers/events.controller');
  const migration = require('../../db/migrations/1791470000000_exhibitor-team-members');
  const { MigrationBuilder } = await import('node-pg-migrate');
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const runMigration = async (direction) => {
    const pgm = new MigrationBuilder(client, undefined, false, console);
    migration[direction](pgm);
    await client.query(pgm.getSql());
  };
  const params = { eventId: '1', exhibitorId: '2' };
  const names = ['عضو تجريبي', "Test O'Neil, Jr."];

  try {
    await client.query(`
      CREATE TEMP TABLE events (id integer PRIMARY KEY);
      CREATE TEMP TABLE categories (
        id integer PRIMARY KEY, event_id integer, name text, display_order integer
      );
      CREATE TEMP TABLE exhibitors (
        id serial PRIMARY KEY, event_id integer, name text, description text,
        image_url text, updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TEMP TABLE exhibitor_category_assignments (
        event_id integer, exhibitor_id integer, category_id integer,
        UNIQUE (event_id, exhibitor_id, category_id)
      );
      INSERT INTO events VALUES (1), (2);
      INSERT INTO categories VALUES (1, 1, 'Category one', 1), (2, 2, 'Other event', 1);
      INSERT INTO exhibitors (event_id, name) VALUES (1, 'Existing project');
      INSERT INTO exhibitor_category_assignments VALUES (1, 1, 1);
    `);
    const isolated = await client.query(`
      SELECT bool_and(c.relnamespace = pg_my_temp_schema()) AS isolated
      FROM pg_class c WHERE c.oid IN (
        'events'::regclass, 'categories'::regclass, 'exhibitors'::regclass,
        'exhibitor_category_assignments'::regclass
      )
    `);
    assert.equal(isolated.rows[0].isolated, true);
    t.mock.method(appPool, 'connect', async () => ({ query: client.query.bind(client), release() {} }));
    t.mock.method(appPool, 'query', client.query.bind(client));

    await runMigration('up');
    const existing = await client.query('SELECT name, team_members FROM exhibitors WHERE id = 1');
    assert.deepEqual(existing.rows[0], { name: 'Existing project', team_members: [] });

    const created = response();
    await content.createExhibitor({ params, body: {
      name: 'Test project', categoryIds: [1], teamMembers: names.map((name) => ` ${name} `),
    } }, created);
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.body.data.team_members, names);
    assert.equal(created.body.data.id, 2);

    for (const handler of [content.getExhibitors, events.getEventExhibitors]) {
      const res = response();
      await handler({ params }, res);
      assert.equal(res.statusCode, 200);
      const project = res.body.data.find((item) => item.id === 2);
      assert.deepEqual(project.team_members, names);
      assert.deepEqual(project.categories, [{ id: 1, name: 'Category one' }]);
    }

    const renamed = response();
    await content.updateExhibitor({ params, body: { name: 'Renamed project' } }, renamed);
    assert.equal(renamed.statusCode, 200);
    assert.deepEqual(renamed.body.data.team_members, names, 'Omitted names are preserved');

    const categoryOnly = response();
    await content.updateExhibitor({ params, body: { categoryIds: [1] } }, categoryOnly);
    assert.equal(categoryOnly.statusCode, 200);
    assert.deepEqual(categoryOnly.body.data.team_members, names);

    const updated = response();
    await content.updateExhibitor({ params, body: { teamMembers: [...names].reverse() } }, updated);
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(updated.body.data.team_members, [...names].reverse());

    const wrongEvent = response();
    await content.updateExhibitor({ params: { ...params, eventId: '2' }, body: { teamMembers: [] } }, wrongEvent);
    assert.equal(wrongEvent.statusCode, 404);
    const stored = await client.query('SELECT team_members FROM exhibitors WHERE id = 2');
    assert.deepEqual(stored.rows[0].team_members, [...names].reverse());

    const cleared = response();
    await content.updateExhibitor({ params, body: { teamMembers: [] } }, cleared);
    assert.equal(cleared.statusCode, 200);
    assert.deepEqual(cleared.body.data.team_members, []);

    const noNames = response();
    await content.createExhibitor({ params, body: { name: 'Optional names', categoryIds: [1] } }, noNames);
    assert.equal(noNames.statusCode, 201);
    assert.deepEqual(noNames.body.data.team_members, []);

    await runMigration('down');
    const preserved = await client.query('SELECT name FROM exhibitors ORDER BY id');
    assert.deepEqual(preserved.rows.map((row) => row.name), [
      'Existing project', 'Renamed project', 'Optional names',
    ]);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.query('DISCARD TEMP');
    client.release();
    await testPool.end();
    await appPool.end();
  }
});
