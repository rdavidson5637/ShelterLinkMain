'use strict';

const AuditLog = require('../models/AuditLog');
const { isStaffOrAdmin } = require('./auth');

/**
 * Infer a sensible action / entity from the request path.
 * e.g. PUT /api/opportunities/12 → { action: 'opportunity.update', entityType: 'opportunity', entityId: '12' }
 */
function inferFromRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const segments = path.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  const resource = segments[0] || 'unknown';
  const idCandidate = segments.find((s, i) => i > 0 && /^\d+$/.test(s));

  const methodVerb =
    method === 'POST'
      ? 'create'
      : method === 'PUT' || method === 'PATCH'
        ? 'update'
        : method === 'DELETE'
          ? 'delete'
          : method.toLowerCase();

  // Prefer more specific nested actions when present.
  let action = `${resource}.${methodVerb}`;
  if (segments.includes('approval')) action = 'volunteer.approval';
  else if (segments.includes('approve')) action = 'hours.approve';
  else if (segments.includes('no-show') && segments.includes('contacted')) {
    action = 'application.no_show_contacted';
  }
  else if (segments.includes('no-show')) action = 'application.no_show';
  else if (segments.includes('export') || resource === 'export') action = `export.${segments[1] || 'data'}`;
  else if (segments.includes('erase')) action = 'gdpr.erase';
  else if (segments.includes('gdpr') && method === 'GET') action = 'gdpr.export';
  else if (resource === 'admin' && segments[1] === 'settings' && segments[2] === 'retention') {
    action = 'shelter.settings.retention';
  }
  else if (segments.includes('retention')) action = 'gdpr.retention';
  else if (resource === 'admin' && segments[1] === 'invites') {
    action = segments.includes('revoke') ? 'invite.revoke' : 'invite.create';
  }
  else if (segments.includes('trusted') && resource === 'admin') action = 'volunteer.trusted';
  else if (resource === 'admin' && segments[1] === 'settings' && segments[2] === 'booking') {
    action = 'booking_policy.update';
  }
  else if (resource === 'admin' && segments[1] === 'settings' && segments[2] === 'brand') {
    action = segments[3] === 'logo' ? 'shelter.brand.logo' : 'shelter.brand.update';
  }
  else if (resource === 'admin' && segments[1] === 'settings' && segments[2] === 'privacy-contact') {
    action = 'shelter.privacy_contact.update';
  }
  else if (resource === 'admin' && segments[1] === 'setup-checklist' && segments.includes('dismiss')) {
    action = 'shelter.setup_checklist.dismiss';
  }
  else if (segments.includes('qualifications') && resource === 'admin') {
    action = method === 'POST' ? 'volunteer.qualification.award' : 'volunteer.qualification.revoke';
  }
  else if (resource === 'admin' && segments[1] === 'volunteers' && segments.includes('merge')) {
    action = segments.includes('preview') ? 'volunteer.merge.preview' : 'volunteer.merge';
  }
  else if (segments.includes('milestones') && resource === 'admin' && method === 'POST') {
    action = 'volunteer.milestone.email';
  }
  else if (resource === 'admin' && segments[1] === 'volunteers' && segments.includes('buddy')) {
    if (method === 'PUT') action = 'volunteer.buddy.assign';
    else if (method === 'DELETE') action = 'volunteer.buddy.clear';
  }
  else if (resource === 'admin' && segments[1] === 'volunteers' && segments.includes('staff-notes')) {
    if (method === 'POST') action = 'volunteer.staff_note.create';
    else if (method === 'PUT' || method === 'PATCH') action = 'volunteer.staff_note.update';
    else if (method === 'DELETE') action = 'volunteer.staff_note.delete';
  }
  else if (resource === 'admin' && segments[1] === 'expiry-dashboard' && segments.includes('remind')) {
    action = 'expiry.reminder.email';
  }
  else if (resource === 'applications' && segments.includes('swap')) {
    action = method === 'DELETE' ? 'swap.cancel' : 'swap.request';
  }
  else if (resource === 'applications' && segments.includes('swaps')) {
    if (segments.includes('claim') || segments.includes('claim-by-token')) action = 'swap.claim';
    else if (method === 'DELETE') action = 'swap.cancel';
  }
  else if (resource === 'volunteer-shift-notes' && method === 'POST') {
    action = 'volunteer.shift_note.save';
  }
  else if (
    resource === 'opportunities' &&
    segments.includes('usual-availability') &&
    method === 'POST'
  ) {
    action = 'usual_availability.email';
  }
  else if (resource === 'announcements') {
    if (segments.includes('email') && method === 'POST') action = 'announcement.email';
    else if (segments.includes('archive') && method === 'POST') action = 'announcement.archive';
    else if (method === 'POST') action = 'announcement.create';
    else if (method === 'PUT' || method === 'PATCH') action = 'announcement.update';
  }
  else if (resource === 'wishlist') {
    if (segments.includes('archive') && method === 'POST') action = 'wishlist.archive';
    else if (method === 'POST') action = 'wishlist.create';
    else if (method === 'PUT' || method === 'PATCH') action = 'wishlist.update';
  }
  else if (resource === 'animals') {
    if (segments.includes('photo') && method === 'POST') action = 'animal.photo';
    else if (segments.includes('activity') && method === 'POST') action = 'animal.activity';
    else if (method === 'POST') action = 'animal.create';
    else if (method === 'PUT' || method === 'PATCH') action = 'animal.update';
  }

  const entityType =
    resource === 'admin' && segments[1] === 'volunteers'
      ? 'volunteer'
      : resource === 'admin' && segments[1] === 'invites'
        ? 'invite'
      : resource === 'hours'
        ? 'hours'
        : resource.replace(/s$/, '') || resource;

  const entityId =
    idCandidate ||
    (req.params && (req.params.id || req.params.userId || req.params.opportunityId)) ||
    null;

  return { action, entityType, entityId };
}

/**
 * After a successful mutating response (2xx), write an audit_log row for staff/admin actors.
 * Safe to mount broadly on admin/staff route trees.
 */
function auditMutations(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let recorded = false;

  async function maybeRecord(body) {
    if (recorded) return;
    recorded = true;
    if (!isStaffOrAdmin(req)) return;
    const status = res.statusCode || 200;
    if (status < 200 || status >= 400) return;
    // The controller already wrote a more specific row for this request.
    if (res.locals && res.locals.auditWritten) return;

    const inferred = inferFromRequest(req);
    const detail = {
      method,
      path: String(req.originalUrl || req.url || '').split('?')[0],
      status,
    };
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      // Keep a small, non-sensitive summary when present.
      if (body.message) detail.message = body.message;
      if (body.id != null) detail.responseId = body.id;
    }

    try {
      await AuditLog.create({
        userId: req.session?.userId || null,
        action: inferred.action,
        entityType: inferred.entityType,
        entityId: inferred.entityId,
        detail,
      });
    } catch (err) {
      console.error('[Audit] failed to record:', err.message);
    }
  }

  res.json = (body) => {
    maybeRecord(body).catch(() => {});
    return originalJson(body);
  };

  res.send = (body) => {
    maybeRecord(typeof body === 'string' ? { raw: true } : body).catch(() => {});
    return originalSend(body);
  };

  return next();
}

/**
 * Explicit one-shot audit helper for controllers (GDPR export/erasure, retention).
 */
async function recordAudit(req, { action, entityType = null, entityId = null, detail = null }) {
  return AuditLog.create({
    userId: req.session?.userId || null,
    action,
    entityType,
    entityId,
    detail,
  });
}

module.exports = {
  auditMutations,
  recordAudit,
  inferFromRequest,
};
