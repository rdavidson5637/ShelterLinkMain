'use strict';

/**
 * Staff "this week" dashboard endpoint (SL-LATER-26).
 *   GET /api/admin/this-week
 */

const ThisWeek = require('../models/ThisWeek');
const { isStaffOrAdmin } = require('../middleware/auth');

async function getThisWeek(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const summary = await ThisWeek.getSummary();
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[ThisWeek] getThisWeek error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getThisWeek,
};
