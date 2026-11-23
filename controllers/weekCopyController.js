'use strict';

/**
 * Copy a week of shifts (SL-LATER-31).
 *   GET  /api/admin/week-sheet/copy-preview?source_week=&target_week=
 *   POST /api/admin/week-sheet/copy  { source_week, target_week }
 * Staff/admin only; tenant scope comes from the request's shelter context.
 */

const WeekCopy = require('../models/WeekCopy');
const { isStaffOrAdmin } = require('../middleware/auth');
const { recordAudit } = require('../middleware/auditLog');
const { todayIso } = require('../utils/shelterTime');

function sendError(res, error, where) {
  console.error(`[WeekCopy] ${where} error:`, error.message);
  if (error.status === 400) return res.status(400).json({ error: error.message });
  if (error.status === 403) return res.status(403).json({ error: 'Forbidden' });
  if (error.status === 404) return res.status(404).json({ error: 'Not found' });
  return res.status(500).json({ error: 'Internal server error' });
}

async function getCopyPreview(req, res) {
  try {
    if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { source_week: sourceWeek, target_week: targetWeek } = req.query || {};
    const plan = await WeekCopy.planCopy(sourceWeek, targetWeek, { today: todayIso() });
    return res.status(200).json(plan);
  } catch (error) {
    return sendError(res, error, 'getCopyPreview');
  }
}

async function postCopyWeek(req, res) {
  try {
    if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { source_week: sourceWeek, target_week: targetWeek } = req.body || {};
    const result = await WeekCopy.executeCopy(sourceWeek, targetWeek, {
      createdBy: req.session?.userId || null,
      today: todayIso(),
    });
    try {
      await recordAudit(req, {
        action: 'week_sheet.copy',
        entityType: 'week_sheet',
        entityId: targetWeek,
        detail: {
          source_week: sourceWeek,
          target_week: targetWeek,
          created: result.counts.create,
          skipped: result.counts.skip,
          opportunity_ids: result.created.map((c) => c.opportunity_id),
        },
      });
    } catch (auditError) {
      console.error('[WeekCopy] audit error:', auditError.message);
    }
    return res.status(201).json(result);
  } catch (error) {
    return sendError(res, error, 'postCopyWeek');
  }
}

module.exports = {
  getCopyPreview,
  postCopyWeek,
};
