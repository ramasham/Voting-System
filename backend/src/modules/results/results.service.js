const pool = require('../../../db/connection');

async function getResults(eventId) {
    const event = await pool.query('SELECT id, name FROM events WHERE id = $1', [eventId]);
    if (event.rowCount === 0) return null;

    const result = await pool.query(
        `SELECT c.id AS category_id, c.name AS category_name, c.display_order,
                e.id AS exhibitor_id, e.name AS exhibitor_name, e.image_url,
                COUNT(v.id)::integer AS vote_count
         FROM categories c
         LEFT JOIN exhibitor_category_assignments eca
           ON eca.event_id = c.event_id AND eca.category_id = c.id
         LEFT JOIN exhibitors e ON e.id = eca.exhibitor_id AND e.event_id = eca.event_id
         LEFT JOIN votes v
           ON v.event_id = c.event_id AND v.category_id = c.id AND v.exhibitor_id = e.id
         WHERE c.event_id = $1
         GROUP BY c.id, c.name, c.display_order, e.id, e.name, e.image_url
         ORDER BY c.display_order NULLS LAST, c.id, COUNT(v.id) DESC, e.name NULLS LAST, e.id`,
        [eventId]
    );
    const categories = new Map();
    for (const row of result.rows) {
        if (!categories.has(row.category_id)) {
            categories.set(row.category_id, {
                categoryId: row.category_id,
                category: row.category_name,
                exhibitors: [],
            });
        }
        if (row.exhibitor_id !== null) {
            categories.get(row.category_id).exhibitors.push({
                exhibitorId: row.exhibitor_id,
                exhibitor: row.exhibitor_name,
                imageUrl: row.image_url,
                votes: row.vote_count,
            });
        }
    }
    return {
        eventId: event.rows[0].id,
        event: event.rows[0].name,
        categories: [...categories.values()],
        updatedAt: new Date().toISOString(),
    };
}

module.exports = { getResults };
