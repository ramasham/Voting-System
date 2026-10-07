const crypto = require('node:crypto');
const pool = require('../../db/connection');
const { parsePositiveInteger } = require('../utils/validation');

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function imageType(bytes) {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      && bytes.toString('ascii', 12, 16) === 'IHDR'
      && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0
      && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') {
    return 'image/png';
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    return 'image/jpeg';
  }
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF'
      && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) === bytes.length - 8
      && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) {
    return 'image/webp';
  }
  return null;
}

async function uploadExhibitorPhoto(req, res) {
  const eventId = parsePositiveInteger(req.params.eventId);
  const exhibitorId = parsePositiveInteger(req.params.exhibitorId);
  if (!eventId || !exhibitorId) {
    return res.status(400).json({ success: false, message: 'Event and exhibitor IDs must be positive integers' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(415).json({ success: false, message: 'Send PNG, JPEG, or WebP image bytes with their image Content-Type' });
  }
  if (req.body.length > MAX_PHOTO_BYTES) {
    return res.status(413).json({ success: false, message: 'Photos must be no larger than 2 MiB' });
  }
  const contentType = imageType(req.body);
  const declaredType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!contentType || contentType !== declaredType) {
    return res.status(415).json({ success: false, message: 'Image content must match a PNG, JPEG, or WebP Content-Type' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const exhibitor = await client.query(
      'SELECT id FROM exhibitors WHERE event_id = $1 AND id = $2 FOR UPDATE',
      [eventId, exhibitorId]
    );
    if (!exhibitor.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Exhibitor not found' });
    }
    await client.query(
      `INSERT INTO exhibitor_photos (exhibitor_id, content_type, image_data)
       VALUES ($1, $2, $3)
       ON CONFLICT (exhibitor_id) DO UPDATE SET content_type = EXCLUDED.content_type,
         image_data = EXCLUDED.image_data, updated_at = CURRENT_TIMESTAMP`,
      [exhibitorId, contentType, req.body]
    );
    const imageUrl = `/api/media/exhibitors/${exhibitorId}/photo`;
    await client.query(
      'UPDATE exhibitors SET image_url = $3, updated_at = CURRENT_TIMESTAMP WHERE event_id = $1 AND id = $2',
      [eventId, exhibitorId, imageUrl]
    );
    await client.query('COMMIT');
    return res.status(200).json({ success: true, data: { exhibitorId, imageUrl, contentType, bytes: req.body.length } });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Exhibitor photo upload failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to upload photo' });
  } finally {
    if (client) client.release();
  }
}

async function getExhibitorPhoto(req, res) {
  const exhibitorId = parsePositiveInteger(req.params.exhibitorId);
  if (!exhibitorId) return res.status(400).json({ success: false, message: 'exhibitorId must be a positive integer' });
  try {
    const result = await pool.query(
      'SELECT content_type, image_data FROM exhibitor_photos WHERE exhibitor_id = $1',
      [exhibitorId]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Photo not found' });
    const photo = result.rows[0];
    const etag = `"${crypto.createHash('sha256').update(photo.image_data).digest('hex')}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.setHeader('Content-Type', photo.content_type);
    return res.status(200).send(photo.image_data);
  } catch (error) {
    console.error('Exhibitor photo loading failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load photo' });
  }
}

module.exports = { MAX_PHOTO_BYTES, uploadExhibitorPhoto, getExhibitorPhoto };
