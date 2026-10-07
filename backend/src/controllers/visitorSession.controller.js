const pool = require('../../db/connection');

async function me(req, res) {
  try {
    const result = await pool.query('SELECT id, name FROM visitors WHERE id = $1 AND phone_verified = TRUE', [req.auth.id]);
    if (!result.rowCount) return res.status(401).json({ success: false, code: 'INVALID_TOKEN', message: 'Verify your phone again' });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Visitor session read failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to restore your session' });
  }
}
module.exports = { me };
