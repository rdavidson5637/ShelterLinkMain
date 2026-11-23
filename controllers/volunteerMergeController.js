'use strict';

/**
 * Staff merge of duplicate volunteers (SL-DAY-03).
 *   POST /api/admin/volunteers/merge/preview  { keep_user_id, duplicate_user_id }
 *   POST /api/admin/volunteers/merge          { keep_user_id, duplicate_user_id }
 * Staff/admin only. Tenant scope from the request shelter context.
 */

const VolunteerMerge = require('../models/VolunteerMerge');
const { isStaffOrAdmin } = require('../middleware/auth');
const { recordAudit } = require('../middleware/auditLog');

function sendError(res, error, where) {
  console.error(`[VolunteerMerge] ${where} error:`, error.message);
  if (error.status === 400) return res.status(400).json({ error: error.message });
  if (error.status === 403) return res.status(403).json({ error: 'Forbidden' });
  if (error.status === 404) return res.status(404).json({ error: 'Not found' });
  return res.status(500).json({ error: 'Internal server error' });
}

function idsFromBody(body = {}) {
  return {
    keepUserId: body.keep_user_id ?? body.keepUserId,
    duplicateUserId: body.duplicate_user_id ?? body.duplicateUserId,
  };
}

async function previewMerge(req, res) {
  try {
    if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { keepUserId, duplicateUserId } = idsFromBody(req.body);
    const preview = await VolunteerMerge.previewMerge(keepUserId, duplicateUserId);
    return res.status(200).json(preview);
  } catch (error) {
    return sendError(res, error, 'previewMerge');
  }
}

async function runMerge(req, res) {
  try {
    if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { keepUserId, duplicateUserId } = idsFromBody(req.body);
    const result = await VolunteerMerge.executeMerge(keepUserId, duplicateUserId);
    try {
      await recordAudit(req, {
        action: 'volunteer.merge',
        entityType: 'volunteer',
        entityId: result.keep.user_id,
        detail: {
          keep_user_id: result.keep.user_id,
          duplicate_user_id: result.duplicate.user_id,
          moved: result.moved,
        },
      });
      res.locals.auditWritten = true;
    } catch (auditError) {
      console.error('[VolunteerMerge] audit error:', auditError.message);
    }
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'runMerge');
  }
}

module.exports = {
  previewMerge,
  runMerge,
};
