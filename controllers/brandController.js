'use strict';

const { pool } = require('../config/database');
const { currentShelterId, runWithShelter } = require('../utils/shelterContext');
const { assisiShelterId } = require('../middleware/shelter');

const LOGO_TYPES = new Set(['image/jpeg', 'image/png']);

async function readBrand() {
  const [rows] = await pool.execute(
    `SELECT name, logo_mime,
            (logo IS NOT NULL AND octet_length(logo) > 0) AS has_logo
       FROM shelters
      LIMIT 1`
  );
  return rows[0] || null;
}

async function inBrandContext(fn) {
  if (currentShelterId()) return fn();
  const id = await assisiShelterId();
  if (!id) return null;
  return runWithShelter(id, fn);
}

async function getBrand(req, res) {
  try {
    const row = await inBrandContext(readBrand);
    if (!row || !row.name) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({
      name: row.name,
      hasLogo: Boolean(row.has_logo),
    });
  } catch (error) {
    console.error('[Brand] getBrand error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getBrandLogo(req, res) {
  try {
    const row = await inBrandContext(async () => {
      const [rows] = await pool.execute(
        'SELECT logo, logo_mime FROM shelters LIMIT 1'
      );
      return rows[0] || null;
    });
    const mime = String(row && row.logo_mime || '').toLowerCase();
    if (!row || !row.logo || !LOGO_TYPES.has(mime)) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(row.logo);
  } catch (error) {
    console.error('[Brand] getBrandLogo error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getBrand,
  getBrandLogo,
};
