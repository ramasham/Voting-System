const pool = require('../../db/connection');
const {
  parsePositiveInteger,
  normalizeAllowedIpRanges,
  parseOptionalDate,
} = require('../utils/validation');

function invalidEventId(res) {
  return res.status(400).json({ success: false, message: 'eventId must be a positive integer' });
}

async function eventExists(eventId) {
  const result = await pool.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
  return result.rowCount > 0;
}

async function ensureSettings(eventId) {
  await pool.query(
    `INSERT INTO event_settings (event_id, voting_enabled, location_enabled)
     VALUES ($1, FALSE, FALSE)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId]
  );

  const result = await pool.query(
    `SELECT event_id, voting_start_at, voting_end_at, voting_enabled,
            allowed_ip_ranges, location_enabled, location_config,
            location_sample_count, location_ready_at IS NOT NULL AS location_ready
     FROM event_settings
     WHERE event_id = $1`,
    [eventId]
  );

  return result.rows[0];
}

async function getSettings(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);

  try {
    if (!(await eventExists(eventId))) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    const settings = await ensureSettings(eventId);
    return res.status(200).json({ success: true, data: settings });
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
  if (
    Object.hasOwn(body, 'locationEnabled') &&
    typeof body.locationEnabled !== 'boolean'
  ) {
    return res.status(400).json({ success: false, message: 'locationEnabled must be a boolean' });
  }

  const assignments = [];
  const values = [eventId];
  try {
    if (Object.hasOwn(body, 'votingStartAt')) {
      values.push(parseOptionalDate(body.votingStartAt));
      assignments.push(`voting_start_at = $${values.length}`);
    }
    if (Object.hasOwn(body, 'votingEndAt')) {
      values.push(parseOptionalDate(body.votingEndAt));
      assignments.push(`voting_end_at = $${values.length}`);
    }
    if (Object.hasOwn(body, 'allowedIpRanges')) {
      values.push(normalizeAllowedIpRanges(body.allowedIpRanges));
      assignments.push(`allowed_ip_ranges = $${values.length}`);
    }
    if (Object.hasOwn(body, 'locationEnabled')) {
      values.push(body.locationEnabled);
      assignments.push(`location_enabled = $${values.length}`);
      if (!body.locationEnabled) assignments.push('location_config = NULL');
    }
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  if (assignments.length === 0) {
    return res.status(400).json({ success: false, message: 'Provide at least one setting to update' });
  }

  try {
    if (!(await eventExists(eventId))) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    await ensureSettings(eventId);
    const existing = await pool.query(
      'SELECT voting_start_at, voting_end_at FROM event_settings WHERE event_id = $1',
      [eventId]
    );
    const current = existing.rows[0];
    const startValue = Object.hasOwn(body, 'votingStartAt')
      ? parseOptionalDate(body.votingStartAt)
      : current.voting_start_at;
    const endValue = Object.hasOwn(body, 'votingEndAt')
      ? parseOptionalDate(body.votingEndAt)
      : current.voting_end_at;

    if (startValue && endValue && new Date(startValue) >= new Date(endValue)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_VOTING_WINDOW',
        message: 'Voting end time must be after its start time',
      });
    }

    assignments.push('updated_at = CURRENT_TIMESTAMP');
    const updated = await pool.query(
      `UPDATE event_settings
       SET ${assignments.join(', ')}
       WHERE event_id = $1
       RETURNING event_id, voting_start_at, voting_end_at, voting_enabled,
                 allowed_ip_ranges, location_enabled, location_config,
                 location_sample_count, location_ready_at IS NOT NULL AS location_ready`,
      values
    );

    return res.status(200).json({ success: true, data: updated.rows[0] });
  } catch (error) {
    if (error.code === '23514') {
      return res.status(400).json({
        success: false,
        code: 'INVALID_VOTING_WINDOW',
        message: 'Voting end time must be after its start time',
      });
    }
    console.error('Admin settings update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to update event settings' });
  }
}

async function openVoting(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);

  try {
    const eventResult = await pool.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
    if (eventResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const opened = await pool.query(
      `UPDATE event_settings
       SET voting_enabled = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE event_id = $1
         AND voting_start_at IS NOT NULL
         AND voting_end_at IS NOT NULL
         AND allowed_ip_ranges IS NOT NULL
         AND BTRIM(allowed_ip_ranges) <> ''
         AND (location_enabled = FALSE OR location_zone IS NOT NULL)
         AND CURRENT_TIMESTAMP >= voting_start_at
         AND CURRENT_TIMESTAMP < voting_end_at
       RETURNING event_id, voting_start_at, voting_end_at, voting_enabled`,
      [eventId]
    );

    if (opened.rowCount > 0) {
      return res.status(200).json({ success: true, data: opened.rows[0] });
    }

    const settingsResult = await pool.query(
      `SELECT voting_start_at, voting_end_at, allowed_ip_ranges, location_enabled,
              location_zone IS NOT NULL AS location_ready
       FROM event_settings WHERE event_id = $1`,
      [eventId]
    );

    if (settingsResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Event settings not found' });
    }

    const settings = settingsResult.rows[0];
    if (!settings.voting_start_at || !settings.voting_end_at) {
      return res.status(409).json({
        success: false,
        code: 'VOTING_WINDOW_REQUIRED',
        message: 'Set a voting start and end time before opening voting',
      });
    }
    if (!settings.allowed_ip_ranges || settings.allowed_ip_ranges.trim() === '') {
      return res.status(409).json({
        success: false,
        code: 'VENUE_RANGES_REQUIRED',
        message: 'Set the venue IP ranges before opening voting',
      });
    }
    if (settings.location_enabled) {
      if (!settings.location_ready) {
        return res.status(409).json({
          success: false,
          code: 'LOCATION_ZONE_NOT_READY',
          message: 'Collect the organizer anchor and at least two trusted network samples before opening voting',
        });
      }
    }
    return res.status(409).json({
      success: false,
      code: 'OUTSIDE_VOTING_WINDOW',
      message: 'Voting can only be opened during its configured time window',
    });
  } catch (error) {
    console.error('Opening voting failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to open voting' });
  }
}

async function closeVoting(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);

  try {
    const result = await pool.query(
      `UPDATE event_settings
       SET voting_enabled = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE event_id = $1
       RETURNING event_id, voting_enabled`,
      [eventId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Event settings not found' });
    }
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Closing voting failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to close voting' });
  }
}

async function loadResults(eventId) {
  const event = await pool.query('SELECT id, name FROM events WHERE id = $1', [eventId]);
  if (event.rowCount === 0) return null;

  const result = await pool.query(
    `SELECT categories.id AS category_id,
            categories.name AS category_name,
            categories.display_order,
            exhibitors.id AS exhibitor_id,
            exhibitors.name AS exhibitor_name,
            COUNT(votes.id)::integer AS vote_count
     FROM categories
     LEFT JOIN exhibitors
       ON exhibitors.category_id = categories.id
      AND exhibitors.event_id = categories.event_id
     LEFT JOIN votes
       ON votes.event_id = categories.event_id
      AND votes.category_id = categories.id
      AND votes.exhibitor_id = exhibitors.id
     WHERE categories.event_id = $1
     GROUP BY categories.id, categories.name, categories.display_order,
              exhibitors.id, exhibitors.name
     ORDER BY categories.display_order NULLS LAST, categories.id,
              COUNT(votes.id) DESC, exhibitors.name NULLS LAST`,
    [eventId]
  );

  const categoryMap = new Map();
  for (const row of result.rows) {
    if (!categoryMap.has(row.category_id)) {
      categoryMap.set(row.category_id, {
        categoryId: row.category_id,
        category: row.category_name,
        exhibitors: [],
      });
    }
    if (row.exhibitor_id !== null) {
      categoryMap.get(row.category_id).exhibitors.push({
        exhibitorId: row.exhibitor_id,
        exhibitor: row.exhibitor_name,
        votes: row.vote_count,
      });
    }
  }

  return {
    eventId: event.rows[0].id,
    event: event.rows[0].name,
    categories: [...categoryMap.values()],
  };
}

async function getResults(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);

  try {
    const data = await loadResults(eventId);
    if (!data) return res.status(404).json({ success: false, message: 'Event not found' });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Results query failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load results' });
  }
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportResults(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidEventId(res);

  try {
    const data = await loadResults(eventId);
    if (!data) return res.status(404).json({ success: false, message: 'Event not found' });

    const rows = [['category_id', 'category', 'exhibitor_id', 'exhibitor', 'votes']];
    for (const category of data.categories) {
      if (category.exhibitors.length === 0) {
        rows.push([category.categoryId, category.category, '', '', 0]);
      } else {
        for (const exhibitor of category.exhibitors) {
          rows.push([
            category.categoryId,
            category.category,
            exhibitor.exhibitorId,
            exhibitor.exhibitor,
            exhibitor.votes,
          ]);
        }
      }
    }

    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="event-${eventId}-results.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Results export failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to export results' });
  }
}

module.exports = {
  getSettings,
  updateSettings,
  openVoting,
  closeVoting,
  getResults,
  exportResults,
};
