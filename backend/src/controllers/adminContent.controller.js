const pool = require('../../db/connection');

const {
  parsePositiveInteger,
  validateName,
  validateDescription,
  validateImageUrl,
} = require('../utils/validation');


async function eventExists(eventId) {
  const result = await pool.query(
    'SELECT 1 FROM events WHERE id = $1',
    [eventId]
  );

  return result.rowCount > 0;
}


function invalidId(res) {
  return res.status(400).json({
    success: false,
    message: 'Event and resource IDs must be positive integers'
  });
}


/* =========================================================
   CATEGORIES
========================================================= */

async function getCategories(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);

  if (!eventId) {
    return invalidId(res);
  }

  try {
    if (!(await eventExists(eventId))) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        event_id,
        name,
        description,
        display_order
      FROM categories
      WHERE event_id = $1
      ORDER BY display_order NULLS LAST, id
      `,
      [eventId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error(
      'Admin category listing failed:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to load categories'
    });
  }
}


async function createCategory(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const displayOrder = parsePositiveInteger(
    req.body?.displayOrder
  );

  if (!eventId) {
    return invalidId(res);
  }

  let name;
  let description;

  try {
    name = validateName(req.body?.name);
    description = validateDescription(
      req.body?.description
    );

    if (!displayOrder) {
      throw new Error(
        'displayOrder must be a positive integer'
      );
    }

  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  try {
    if (!(await eventExists(eventId))) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const result = await pool.query(
      `
      INSERT INTO categories (
        event_id,
        name,
        description,
        display_order
      )
      VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        event_id,
        name,
        description,
        display_order
      `,
      [
        eventId,
        name,
        description,
        displayOrder
      ]
    );

    return res.status(201).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error(
      'Admin category creation failed:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to create category'
    });
  }
}


async function updateCategory(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const categoryId = parsePositiveInteger(
    req.params.categoryId
  );

  if (!eventId || !categoryId) {
    return invalidId(res);
  }

  const body = req.body || {};

  const allowedFields = [
    'name',
    'description',
    'displayOrder'
  ];

  if (
    Object.keys(body).some(
      (field) => !allowedFields.includes(field)
    )
  ) {
    return res.status(400).json({
      success: false,
      message: 'Request contains an unsupported field'
    });
  }

  const values = [
    eventId,
    categoryId
  ];

  const assignments = [];

  try {
    if (Object.hasOwn(body, 'name')) {
      values.push(
        validateName(body.name)
      );

      assignments.push(
        `name = $${values.length}`
      );
    }

    if (Object.hasOwn(body, 'description')) {
      values.push(
        validateDescription(body.description)
      );

      assignments.push(
        `description = $${values.length}`
      );
    }

    if (Object.hasOwn(body, 'displayOrder')) {
      const displayOrder = parsePositiveInteger(
        body.displayOrder
      );

      if (!displayOrder) {
        throw new Error(
          'displayOrder must be a positive integer'
        );
      }

      values.push(displayOrder);

      assignments.push(
        `display_order = $${values.length}`
      );
    }

  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  if (assignments.length === 0) {
    return res.status(400).json({
      success: false,
      message:
        'Provide at least one category field to update'
    });
  }

  try {
    const result = await pool.query(
      `
      UPDATE categories
      SET
        ${assignments.join(', ')},
        updated_at = CURRENT_TIMESTAMP
      WHERE event_id = $1
        AND id = $2
      RETURNING
        id,
        event_id,
        name,
        description,
        display_order
      `,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error(
      'Admin category update failed:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to update category'
    });
  }
}


async function deleteCategory(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const categoryId = parsePositiveInteger(
    req.params.categoryId
  );

  if (!eventId || !categoryId) {
    return invalidId(res);
  }

  let client;

  try {
    client = await pool.connect();

    await client.query('BEGIN');

    const category = await client.query(
      `
      SELECT id
      FROM categories
      WHERE event_id = $1
        AND id = $2
      FOR UPDATE
      `,
      [
        eventId,
        categoryId
      ]
    );

    if (category.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const usage = await client.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM exhibitor_category_assignments
        WHERE event_id = $1
          AND category_id = $2
      ) AS in_use
      `,
      [
        eventId,
        categoryId
      ]
    );

    if (usage.rows[0].in_use) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        success: false,
        code: 'CATEGORY_IN_USE',
        message:
          'Remove this category from its exhibitors before deleting it'
      });
    }

    await client.query(
      `
      DELETE FROM categories
      WHERE event_id = $1
        AND id = $2
      `,
      [
        eventId,
        categoryId
      ]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Category deleted'
    });

  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }

    console.error(
      'Admin category deletion failed:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to delete category'
    });

  } finally {
    if (client) {
      client.release();
    }
  }
}


/* =========================================================
   EXHIBITORS
========================================================= */

async function getExhibitors(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);

  if (!eventId) {
    return invalidId(res);
  }

  try {
    if (!(await eventExists(eventId))) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const result = await pool.query(
      `
      SELECT
        e.id,
        e.event_id,
        e.name,
        e.description,
        e.image_url,

        COUNT(c.id)::int AS "categoriesCount",

        COALESCE(
          json_agg(
            json_build_object(
              'id', c.id,
              'name', c.name
            )
            ORDER BY
              c.display_order NULLS LAST,
              c.id
          )
          FILTER (
            WHERE c.id IS NOT NULL
          ),
          '[]'::json
        ) AS categories

      FROM exhibitors e

      LEFT JOIN exhibitor_category_assignments eca
        ON eca.exhibitor_id = e.id
       AND eca.event_id = e.event_id

      LEFT JOIN categories c
        ON c.id = eca.category_id
       AND c.event_id = e.event_id

      WHERE e.event_id = $1

      GROUP BY
        e.id,
        e.event_id,
        e.name,
        e.description,
        e.image_url

      ORDER BY e.name
      `,
      [eventId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error(
      'Admin exhibitor listing failed:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to load exhibitors'
    });
  }
}


async function createExhibitor(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);

  if (!eventId) {
    return invalidId(res);
  }

  const rawCategoryIds = req.body?.categoryIds;

  if (
    !Array.isArray(rawCategoryIds) ||
    rawCategoryIds.length === 0
  ) {
    return res.status(400).json({
      success: false,
      message: 'categoryIds must be a non-empty array'
    });
  }

  const categoryIds = [
    ...new Set(
      rawCategoryIds.map(
        (id) => parsePositiveInteger(id)
      )
    )
  ];

  if (
    categoryIds.length === 0 ||
    categoryIds.some((id) => !id)
  ) {
    return res.status(400).json({
      success: false,
      message:
        'All categoryIds must be positive integers'
    });
  }

  let name;
  let description;
  let imageUrl;

  try {
    name = validateName(req.body?.name);

    description = validateDescription(
      req.body?.description
    );

    imageUrl = validateImageUrl(
      req.body?.imageUrl
    );

  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  let client;

  try {
    client = await pool.connect();

    await client.query('BEGIN');

    const categories = await client.query(
      `
      SELECT id
      FROM categories
      WHERE event_id = $1
        AND id = ANY($2::int[])
      `,
      [
        eventId,
        categoryIds
      ]
    );

    if (
      categories.rowCount !== categoryIds.length
    ) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        success: false,
        message:
          'All categoryIds must belong to this event'
      });
    }

    const exhibitorResult = await client.query(
      `
      INSERT INTO exhibitors (
        event_id,
        name,
        description,
        image_url
      )
      VALUES ($1, $2, $3, $4)

      RETURNING
        id,
        event_id,
        name,
        description,
        image_url
      `,
      [
        eventId,
        name,
        description,
        imageUrl
      ]
    );

    const exhibitor = exhibitorResult.rows[0];

    await client.query(
      `
      INSERT INTO exhibitor_category_assignments (
        event_id,
        exhibitor_id,
        category_id
      )

      SELECT
        $1,
        $2,
        unnest($3::int[])
      `,
      [
        eventId,
        exhibitor.id,
        categoryIds
      ]
    );

    const categoriesResult = await client.query(
      `
      SELECT
        id,
        name
      FROM categories
      WHERE event_id = $1
        AND id = ANY($2::int[])
      ORDER BY
        display_order NULLS LAST,
        id
      `,
      [
        eventId,
        categoryIds
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,

      data: {
        ...exhibitor,

        categoriesCount:
          categoriesResult.rowCount,

        categories:
          categoriesResult.rows
      }
    });

  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }

    console.error(
      'Admin exhibitor creation failed:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to create exhibitor'
    });

  } finally {
    if (client) {
      client.release();
    }
  }
}


async function updateExhibitor(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);

  const exhibitorId = parsePositiveInteger(
    req.params.exhibitorId
  );

  if (!eventId || !exhibitorId) {
    return invalidId(res);
  }

  const body = req.body || {};

  const allowedFields = [
    'categoryIds',
    'name',
    'description',
    'imageUrl'
  ];

  if (
    Object.keys(body).some(
      (field) => !allowedFields.includes(field)
    )
  ) {
    return res.status(400).json({
      success: false,
      message:
        'Request contains an unsupported field'
    });
  }

  if (Object.keys(body).length === 0) {
    return res.status(400).json({
      success: false,
      message:
        'Provide at least one exhibitor field to update'
    });
  }

  let categoryIds;

  if (Object.hasOwn(body, 'categoryIds')) {

    if (
      !Array.isArray(body.categoryIds)
    ) {
      return res.status(400).json({
        success: false,
        message:
          'categoryIds must be an array'
      });
    }

    categoryIds = [
      ...new Set(
        body.categoryIds.map(
          (id) => parsePositiveInteger(id)
        )
      )
    ];

    if (
      categoryIds.some((id) => !id)
    ) {
      return res.status(400).json({
        success: false,
        message:
          'All categoryIds must be positive integers'
      });
    }
  }

  const values = [
    eventId,
    exhibitorId
  ];

  const assignments = [];

  try {
    if (Object.hasOwn(body, 'name')) {
      values.push(
        validateName(body.name)
      );

      assignments.push(
        `name = $${values.length}`
      );
    }

    if (Object.hasOwn(body, 'description')) {
      values.push(
        validateDescription(body.description)
      );

      assignments.push(
        `description = $${values.length}`
      );
    }

    if (Object.hasOwn(body, 'imageUrl')) {
      values.push(
        validateImageUrl(body.imageUrl)
      );

      assignments.push(
        `image_url = $${values.length}`
      );
    }

  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  let client;

  try {
    client = await pool.connect();

    await client.query('BEGIN');

    const exhibitorCheck = await client.query(
      `
      SELECT id
      FROM exhibitors
      WHERE event_id = $1
        AND id = $2
      FOR UPDATE
      `,
      [
        eventId,
        exhibitorId
      ]
    );

    if (exhibitorCheck.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        success: false,
        message: 'Exhibitor not found'
      });
    }


    /* -----------------------------------------
       Update category assignments
    ----------------------------------------- */

    if (categoryIds) {
      const categories = await client.query(
        `
        SELECT id
        FROM categories
        WHERE event_id = $1
          AND id = ANY($2::int[])
        `,
        [
          eventId,
          categoryIds
        ]
      );

      if (
        categories.rowCount !==
        categoryIds.length
      ) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          success: false,
          message:
            'All categoryIds must belong to this event'
        });
      }


      const currentResult = await client.query(
        `
        SELECT category_id
        FROM exhibitor_category_assignments
        WHERE event_id = $1
          AND exhibitor_id = $2
        `,
        [
          eventId,
          exhibitorId
        ]
      );


      const currentCategoryIds =
        currentResult.rows.map(
          (row) => row.category_id
        );


      const removedCategoryIds =
        currentCategoryIds.filter(
          (id) => !categoryIds.includes(id)
        );


      if (removedCategoryIds.length > 0) {

        const voteCheck = await client.query(
          `
          SELECT EXISTS (
            SELECT 1
            FROM votes
            WHERE event_id = $1
              AND exhibitor_id = $2
              AND category_id = ANY($3::int[])
          ) AS has_votes
          `,
          [
            eventId,
            exhibitorId,
            removedCategoryIds
          ]
        );


        if (voteCheck.rows[0].has_votes) {
          await client.query('ROLLBACK');

          return res.status(409).json({
            success: false,
            code:
              'CATEGORY_ASSIGNMENT_HAS_VOTES',

            message:
              'Cannot remove a category from an exhibitor after votes have been recorded for that category'
          });
        }


        await client.query(
          `
          DELETE FROM exhibitor_category_assignments

          WHERE event_id = $1
            AND exhibitor_id = $2
            AND category_id = ANY($3::int[])
          `,
          [
            eventId,
            exhibitorId,
            removedCategoryIds
          ]
        );
      }


      await client.query(
        `
        INSERT INTO exhibitor_category_assignments (
          event_id,
          exhibitor_id,
          category_id
        )

        SELECT
          $1,
          $2,
          unnest($3::int[])

        ON CONFLICT (
          event_id,
          exhibitor_id,
          category_id
        )
        DO NOTHING
        `,
        [
          eventId,
          exhibitorId,
          categoryIds
        ]
      );
    }


    /* -----------------------------------------
       Update exhibitor information
    ----------------------------------------- */

    let exhibitor;

    if (assignments.length > 0) {

      const updateResult = await client.query(
        `
        UPDATE exhibitors

        SET
          ${assignments.join(', ')},
          updated_at = CURRENT_TIMESTAMP

        WHERE event_id = $1
          AND id = $2

        RETURNING
          id,
          event_id,
          name,
          description,
          image_url
        `,
        values
      );

      exhibitor = updateResult.rows[0];

    } else {

      const result = await client.query(
        `
        SELECT
          id,
          event_id,
          name,
          description,
          image_url

        FROM exhibitors

        WHERE event_id = $1
          AND id = $2
        `,
        [
          eventId,
          exhibitorId
        ]
      );

      exhibitor = result.rows[0];
    }


    /* -----------------------------------------
       Return categories + count
    ----------------------------------------- */

    const categoriesResult = await client.query(
      `
      SELECT
        c.id,
        c.name

      FROM exhibitor_category_assignments eca

      JOIN categories c
        ON c.id = eca.category_id
       AND c.event_id = eca.event_id

      WHERE eca.event_id = $1
        AND eca.exhibitor_id = $2

      ORDER BY
        c.display_order NULLS LAST,
        c.id
      `,
      [
        eventId,
        exhibitorId
      ]
    );


    await client.query('COMMIT');


    return res.status(200).json({
      success: true,

      data: {
        ...exhibitor,

        categoriesCount:
          categoriesResult.rowCount,

        categories:
          categoriesResult.rows
      }
    });

  } catch (error) {

    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }

    console.error(
      'Admin exhibitor update failed:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to update exhibitor'
    });

  } finally {

    if (client) {
      client.release();
    }
  }
}


async function deleteExhibitor(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);

  const exhibitorId = parsePositiveInteger(
    req.params.exhibitorId
  );

  if (!eventId || !exhibitorId) {
    return invalidId(res);
  }

  let client;

  try {
    client = await pool.connect();

    await client.query('BEGIN');

    const exhibitor = await client.query(
      `
      SELECT id
      FROM exhibitors
      WHERE event_id = $1
        AND id = $2
      FOR UPDATE
      `,
      [
        eventId,
        exhibitorId
      ]
    );

    if (exhibitor.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        success: false,
        message: 'Exhibitor not found'
      });
    }

    const votes = await client.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM votes
        WHERE event_id = $1
          AND exhibitor_id = $2
      ) AS has_votes
      `,
      [
        eventId,
        exhibitorId
      ]
    );

    if (votes.rows[0].has_votes) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        success: false,
        code: 'EXHIBITOR_HAS_VOTES',
        message:
          'An exhibitor with recorded votes cannot be deleted'
      });
    }

    await client.query(
      `
      DELETE FROM exhibitors
      WHERE event_id = $1
        AND id = $2
      `,
      [
        eventId,
        exhibitorId
      ]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Exhibitor deleted'
    });

  } catch (error) {

    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }

    console.error(
      'Admin exhibitor deletion failed:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to delete exhibitor'
    });

  } finally {

    if (client) {
      client.release();
    }
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
