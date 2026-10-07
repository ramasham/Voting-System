const pool = require('../../db/connection');
const ipaddr = require('ipaddr.js');
const { parsePositiveInteger, normalizeAllowedIpRanges, parseOptionalDate } = require('../utils/validation');
const { getResults: loadResults } = require('../modules/results/results.service');

const settingsColumns = `event_id, voting_start_at, voting_end_at, voting_enabled,
  allowed_ip_ranges, location_enabled, location_config,
  (location_zone IS NOT NULL) AS location_ready`;

function invalidEventId(res) {
  return res.status(400).json({ success: false, message: 'eventId must be a positive integer' });
}

function getCurrentNetwork(req, res) {
  try {
    // Express resolves req.ip using the configured trusted proxy. Return only
    // this address, never a broader network or a range supplied by the client.
    const address = ipaddr.process(req.ip);
    const ip = address.toString();
    const prefix = address.kind() === 'ipv4' ? 32 : 128;
    return res.status(200).json({ success: true, data: { ip, cidr: `${ip}/${prefix}` } });
  } catch {
    return res.status(503).json({
      success: false,
      code: 'NETWORK_UNAVAILABLE',
      message: 'Unable to identify the current network. Try again.',
    });
  }
}

async function ensureSettings(client, eventId) {
  await client.query(
    `INSERT INTO event_settings (event_id, voting_enabled, location_enabled)
     VALUES ($1, FALSE, FALSE) ON CONFLICT (event_id) DO NOTHING`,
    [eventId]
  );
}

async function getSettings(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);
  try {
    const event = await pool.query('SELECT id FROM events WHERE id = $1', [eventId]);
    if (!event.rowCount) return res.status(404).json({ success: false, message: 'Event not found' });
    await ensureSettings(pool, eventId);
    const result = await pool.query(`SELECT ${settingsColumns} FROM event_settings WHERE event_id = $1`, [eventId]);
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Admin settings read failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load event settings' });
  }
}

async function updateSettings(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);
  const body = req.body || {};
  const allowedFields = ['votingStartAt', 'votingEndAt', 'allowedIpRanges', 'locationEnabled'];
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
    return res.status(400).json({ success: false, message: 'Request contains an unsupported field' });
  }
  const assignments = [];
  const values = [eventId];
  const parsed = {};
  const add = (column, value) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };
  try {
    if (Object.hasOwn(body, 'votingStartAt')) {
      parsed.start = parseOptionalDate(body.votingStartAt);
      add('voting_start_at', parsed.start);
    }
    if (Object.hasOwn(body, 'votingEndAt')) {
      parsed.end = parseOptionalDate(body.votingEndAt);
      add('voting_end_at', parsed.end);
    }
    if (Object.hasOwn(body, 'allowedIpRanges')) add('allowed_ip_ranges', normalizeAllowedIpRanges(body.allowedIpRanges));
    if (Object.hasOwn(body, 'locationEnabled')) {
      if (typeof body.locationEnabled !== 'boolean') throw new Error('locationEnabled must be a boolean');
      add('location_enabled', body.locationEnabled);
    }
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
  if (!assignments.length) return res.status(400).json({ success: false, message: 'Provide at least one setting to update' });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const event = await client.query('SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE', [eventId]);
    if (!event.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    await ensureSettings(client, eventId);
    const existing = await client.query(
      'SELECT voting_start_at, voting_end_at FROM event_settings WHERE event_id = $1 FOR UPDATE', [eventId]
    );
    const start = Object.hasOwn(parsed, 'start') ? parsed.start : existing.rows[0].voting_start_at;
    const end = Object.hasOwn(parsed, 'end') ? parsed.end : existing.rows[0].voting_end_at;
    if (start && end && new Date(start) >= new Date(end)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, code: 'INVALID_VOTING_WINDOW', message: 'Voting end time must be after its start time' });
    }
    const result = await client.query(
      `UPDATE event_settings SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE event_id = $1 RETURNING ${settingsColumns}`, values
    );
    await client.query('COMMIT');
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23514') {
      return res.status(400).json({ success: false, code: 'INVALID_VOTING_WINDOW', message: 'Voting end time must be after its start time' });
    }
    console.error('Admin settings update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to update event settings' });
  } finally {
    if (client) client.release();
  }
}

async function openVoting(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const event = await client.query('SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE', [eventId]);
    if (!event.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    await ensureSettings(client, eventId);
    const result = await client.query(
      `SELECT ${settingsColumns}, CURRENT_TIMESTAMP < voting_end_at AS window_not_ended
       FROM event_settings WHERE event_id = $1 FOR UPDATE`, [eventId]
    );
    const settings = result.rows[0];
    let rejection;
    if (!settings.voting_start_at || !settings.voting_end_at) {
      rejection = ['VOTING_WINDOW_REQUIRED', 'Set a voting start and end time before opening voting'];
    } else if (!settings.window_not_ended) {
      rejection = ['OUTSIDE_VOTING_WINDOW', 'The configured voting window has ended'];
    } else if (!settings.allowed_ip_ranges?.trim() && !(settings.location_enabled && settings.location_ready)) {
      rejection = ['VENUE_ACCESS_REQUIRED', 'Configure venue IP ranges or a ready location geofence before opening voting'];
    }
    if (!rejection) {
      const categories = await client.query(
        `SELECT c.id, EXISTS (
          SELECT 1 FROM exhibitor_category_assignments eca
          WHERE eca.event_id = c.event_id AND eca.category_id = c.id
         ) AS has_exhibitors FROM categories c WHERE c.event_id = $1`, [eventId]
      );
      if (categories.rowCount !== 3) {
        rejection = ['THREE_CATEGORIES_REQUIRED', 'Configure exactly three award categories before opening voting'];
      } else if (categories.rows.some((category) => !category.has_exhibitors)) {
        rejection = ['CATEGORY_EXHIBITORS_REQUIRED', 'Assign at least one exhibitor to every category before opening voting'];
      }
    }
    if (rejection) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: rejection[0], message: rejection[1] });
    }
    // Administrators may enable a future schedule; vote acceptance uses database time.
    const opened = await client.query(
      `UPDATE event_settings SET voting_enabled = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE event_id = $1 RETURNING ${settingsColumns}`, [eventId]
    );
    await client.query('COMMIT');
    return res.status(200).json({ success: true, data: opened.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Opening voting failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to open voting' });
  } finally {
    if (client) client.release();
  }
}

async function closeVoting(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);
  try {
    const result = await pool.query(
      `UPDATE event_settings SET voting_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE event_id = $1 RETURNING event_id, voting_enabled`, [eventId]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Event settings not found' });
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Closing voting failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to close voting' });
  }
}

async function resetResults(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const event = await client.query('SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE', [eventId]);
    if (!event.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    // Conflicts with the shared settings lock held throughout castVote.
    const settings = await client.query('SELECT voting_enabled FROM event_settings WHERE event_id = $1 FOR UPDATE', [eventId]);
    if (settings.rows[0]?.voting_enabled) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: 'VOTING_MUST_BE_CLOSED', message: 'Close voting before resetting results' });
    }
    const deleted = await client.query('DELETE FROM votes WHERE event_id = $1', [eventId]);
    await client.query('COMMIT');
    // The database notification trigger refreshes dashboards across API instances.
    return res.status(200).json({ success: true, data: { eventId, deletedVotes: deleted.rowCount } });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Results reset failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to reset results' });
  } finally {
    if (client) client.release();
  }
}

/* =========================================================
   GET RESULTS
========================================================= */

async function getResults(req, res) {
  const eventId = parsePositiveInteger(
    req.params.eventId
  );

  if (!eventId) {
    return invalidEventId(res);
  }

  try {
    const data = await loadResults(eventId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error(
      'Results query failed:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to load results'
    });
  }
}


/* =========================================================
   CSV EXPORT
========================================================= */

function csvCell(value) {
  let text =
    value === null ||
    value === undefined
      ? ''
      : String(value);

  if (/^\s*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}


async function exportResults(req, res) {
  const eventId = parsePositiveInteger(
    req.params.eventId
  );

  if (!eventId) {
    return invalidEventId(res);
  }

  try {
    const data = await loadResults(eventId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const rows = [[
      'category_id',
      'category',
      'exhibitor_id',
      'exhibitor',
      'votes'
    ]];

    for (const category of data.categories) {
      if (category.exhibitors.length === 0) {
        rows.push([
          category.categoryId,
          category.category,
          '',
          '',
          0
        ]);

      } else {
        for (
          const exhibitor
          of category.exhibitors
        ) {
          rows.push([
            category.categoryId,
            category.category,
            exhibitor.exhibitorId,
            exhibitor.exhibitor,
            exhibitor.votes
          ]);
        }
      }
    }

    const csv = rows
      .map(
        (row) =>
          row.map(csvCell).join(',')
      )
      .join('\r\n');

    res.setHeader(
      'Content-Type',
      'text/csv; charset=utf-8'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="event-${eventId}-results.csv"`
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res.status(200).send(csv);

  } catch (error) {
    console.error(
      'Results export failed:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to export results'
    });
  }
}


module.exports = {
  getCurrentNetwork,
  getSettings,
  updateSettings,
  openVoting,
  closeVoting,
  getResults,
  exportResults,
  resetResults,
};
