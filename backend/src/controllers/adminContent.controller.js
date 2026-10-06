const pool = require('../../db/connection');
const {
  parsePositiveInteger,
  validateName,
  validateDescription,
  validateImageUrl,
} = require('../utils/validation');

async function eventExists(eventId) {
  const result = await pool.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
  return result.rowCount > 0;
}

function invalidId(res) {
  return res.status(400).json({ success: false, message: 'Event and resource IDs must be positive integers' });
}

async function getCategories(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidId(res);

  try {
    if (!(await eventExists(eventId))) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const result = await pool.query(
      `SELECT id, event_id, name, description, display_order
       FROM categories
       WHERE event_id = $1
       ORDER BY display_order NULLS LAST, id`,
      [eventId]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Admin category listing failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load categories' });
  }
}

async function createCategory(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const displayOrder = parsePositiveInteger(req.body?.displayOrder);
  if (!eventId) return invalidId(res);

  let name;
  let description;
  try {
    name = validateName(req.body?.name);
    description = validateDescription(req.body?.description);
    if (!displayOrder) throw new Error('displayOrder must be a positive integer');
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  try {
    if (!(await eventExists(eventId))) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const result = await pool.query(
      `INSERT INTO categories (event_id, name, description, display_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, event_id, name, description, display_order`,
      [eventId, name, description, displayOrder]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Admin category creation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to create category' });
  }
}

async function updateCategory(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const categoryId = parsePositiveInteger(req.params.categoryId);
  if (!eventId || !categoryId) return invalidId(res);

  const body = req.body || {};
  const allowedFields = ['name', 'description', 'displayOrder'];
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
    return res.status(400).json({ success: false, message: 'Request contains an unsupported field' });
  }

  const values = [eventId, categoryId];
  const assignments = [];
  try {
    if (Object.hasOwn(body, 'name')) {
      values.push(validateName(body.name));
      assignments.push(`name = $${values.length}`);
    }
    if (Object.hasOwn(body, 'description')) {
      values.push(validateDescription(body.description));
      assignments.push(`description = $${values.length}`);
    }
    if (Object.hasOwn(body, 'displayOrder')) {
      const displayOrder = parsePositiveInteger(body.displayOrder);
      if (!displayOrder) throw new Error('displayOrder must be a positive integer');
      values.push(displayOrder);
      assignments.push(`display_order = $${values.length}`);
    }
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  if (assignments.length === 0) {
    return res.status(400).json({ success: false, message: 'Provide at least one category field to update' });
  }

  try {
    const result = await pool.query(
      `UPDATE categories
       SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE event_id = $1 AND id = $2
       RETURNING id, event_id, name, description, display_order`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Admin category update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to update category' });
  }
}

async function deleteCategory(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const categoryId = parsePositiveInteger(req.params.categoryId);
  if (!eventId || !categoryId) return invalidId(res);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const category = await client.query(
      'SELECT id FROM categories WHERE event_id = $1 AND id = $2 FOR UPDATE',
      [eventId, categoryId]
    );
    if (category.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const usage = await client.query(
      `SELECT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = $1 AND category_id = $2) AS in_use`,
      [eventId, categoryId]
    );
    if (usage.rows[0].in_use) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        code: 'CATEGORY_IN_USE',
        message: 'Move or remove this category’s exhibitors before deleting it',
      });
    }

    await client.query('DELETE FROM categories WHERE event_id = $1 AND id = $2', [eventId, categoryId]);
    await client.query('COMMIT');
    return res.status(200).json({ success: true, message: 'Category deleted' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Admin category deletion failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to delete category' });
  } finally {
    if (client) client.release();
  }
}

async function getExhibitors(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  if (!eventId) return invalidId(res);

  try {
    if (!(await eventExists(eventId))) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const result = await pool.query(
      `SELECT exhibitors.id, exhibitors.event_id, exhibitors.name,
              exhibitors.description, exhibitors.image_url,
              categories.id AS category_id, categories.name AS category_name
       FROM exhibitors
       JOIN categories
         ON categories.id = exhibitors.category_id
        AND categories.event_id = exhibitors.event_id
       WHERE exhibitors.event_id = $1
       ORDER BY categories.display_order NULLS LAST, categories.id, exhibitors.name`,
      [eventId]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Admin exhibitor listing failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load exhibitors' });
  }
}

async function createExhibitor(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const categoryId = parsePositiveInteger(req.body?.categoryId);
  if (!eventId || !categoryId) return invalidId(res);

  let name;
  let description;
  let imageUrl;
  try {
    name = validateName(req.body?.name);
    description = validateDescription(req.body?.description);
    imageUrl = validateImageUrl(req.body?.imageUrl);
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  try {
    const category = await pool.query(
      'SELECT id FROM categories WHERE event_id = $1 AND id = $2',
      [eventId, categoryId]
    );
    if (category.rowCount === 0) {
      return res.status(400).json({ success: false, message: 'categoryId must belong to this event' });
    }

    const result = await pool.query(
      `INSERT INTO exhibitors (event_id, category_id, name, description, image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, event_id, category_id, name, description, image_url`,
      [eventId, categoryId, name, description, imageUrl]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Admin exhibitor creation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to create exhibitor' });
  }
}

async function updateExhibitor(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const exhibitorId = parsePositiveInteger(req.params.exhibitorId);
  if (!eventId || !exhibitorId) return invalidId(res);

  const body = req.body || {};
  const allowedFields = ['categoryId', 'name', 'description', 'imageUrl'];
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
    return res.status(400).json({ success: false, message: 'Request contains an unsupported field' });
  }

  const values = [eventId, exhibitorId];
  const assignments = [];
  try {
    if (Object.hasOwn(body, 'categoryId')) {
      const categoryId = parsePositiveInteger(body.categoryId);
      if (!categoryId) throw new Error('categoryId must be a positive integer');
      values.push(categoryId);
      assignments.push(`category_id = $${values.length}`);
    }
    if (Object.hasOwn(body, 'name')) {
      values.push(validateName(body.name));
      assignments.push(`name = $${values.length}`);
    }
    if (Object.hasOwn(body, 'description')) {
      values.push(validateDescription(body.description));
      assignments.push(`description = $${values.length}`);
    }
    if (Object.hasOwn(body, 'imageUrl')) {
      values.push(validateImageUrl(body.imageUrl));
      assignments.push(`image_url = $${values.length}`);
    }
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  if (assignments.length === 0) {
    return res.status(400).json({ success: false, message: 'Provide at least one exhibitor field to update' });
  }

  try {
    if (Object.hasOwn(body, 'categoryId')) {
      const category = await pool.query(
        'SELECT id FROM categories WHERE event_id = $1 AND id = $2',
        [eventId, parsePositiveInteger(body.categoryId)]
      );
      if (category.rowCount === 0) {
        return res.status(400).json({ success: false, message: 'categoryId must belong to this event' });
      }
    }

    const result = await pool.query(
      `UPDATE exhibitors
       SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE event_id = $1 AND id = $2
       RETURNING id, event_id, category_id, name, description, image_url`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Exhibitor not found' });
    }
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(400).json({ success: false, message: 'categoryId must belong to this event' });
    }
    console.error('Admin exhibitor update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to update exhibitor' });
  }
}

async function deleteExhibitor(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const exhibitorId = parsePositiveInteger(req.params.exhibitorId);
  if (!eventId || !exhibitorId) return invalidId(res);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const exhibitor = await client.query(
      'SELECT id FROM exhibitors WHERE event_id = $1 AND id = $2 FOR UPDATE',
      [eventId, exhibitorId]
    );
    if (exhibitor.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Exhibitor not found' });
    }

    const votes = await client.query(
      'SELECT EXISTS (SELECT 1 FROM votes WHERE event_id = $1 AND exhibitor_id = $2) AS has_votes',
      [eventId, exhibitorId]
    );
    if (votes.rows[0].has_votes) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        code: 'EXHIBITOR_HAS_VOTES',
        message: 'An exhibitor with recorded votes cannot be deleted',
      });
    }

    await client.query('DELETE FROM exhibitors WHERE event_id = $1 AND id = $2', [eventId, exhibitorId]);
    await client.query('COMMIT');
    return res.status(200).json({ success: true, message: 'Exhibitor deleted' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Admin exhibitor deletion failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to delete exhibitor' });
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getExhibitors,
  createExhibitor,
  updateExhibitor,
  deleteExhibitor,
};
