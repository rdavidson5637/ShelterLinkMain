'use strict';

const DaySheet = require('../models/DaySheet');
const { recordAudit } = require('../middleware/auditLog');
const { isStaffOrAdmin } = require('../middleware/auth');
const { todayIso } = require('../utils/shelterTime');

async function getDaySheet(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const date = (req.query && req.query.date) || todayIso();

    if (!DaySheet.isValidDateOnly(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const sheet = await DaySheet.getForDate(date);

    try {
      await recordAudit(req, {
        action: 'day_sheet.view',
        entityType: 'day_sheet',
        entityId: date,
        detail: {
          date,
          opportunity_count: sheet.opportunities.length,
        },
      });
    } catch (auditError) {
      console.error('[DaySheet] audit error:', auditError.message);
    }

    return res.status(200).json(sheet);
  } catch (error) {
    console.error('[DaySheet] getDaySheet error:', error.message);
    if (/date must be/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getDaySheet,
};
