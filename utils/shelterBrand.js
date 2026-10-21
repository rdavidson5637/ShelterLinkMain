'use strict';

const { pool } = require('../config/database');
const { currentShelterId } = require('./shelterContext');

async function currentShelterName() {
  try {
    const id = currentShelterId();
    if (!id) return '';
    const [rows] = await pool.execute(
      'SELECT name FROM shelters WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] && rows[0].name ? String(rows[0].name) : '';
  } catch (error) {
    console.error('[Brand] shelter name lookup failed:', error.message);
    return '';
  }
}

module.exports = { currentShelterName };
