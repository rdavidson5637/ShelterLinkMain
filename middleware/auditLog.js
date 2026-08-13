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
  else if (segments.includes('no-show')) action = 'application.no_show';
  else if (segments.includes('export') || resource === 'export') action = `export.${segments[1] || 'data'}`;
  else if (segments.includes('erase')) action = 'gdpr.erase';
  else if (segments.includes('gdpr') && method === 'GET') action = 'gdpr.export';
  else if (segments.includes('retention')) action = 'gdpr.retention';
  else if (segments.includes('qualifications') && resource === 'admin') {
    action = method === 'POST' ? 'volunteer.qualification.award' : 'volunteer.qualification.revoke';
  }

  const entityType =
    resource === 'admin' && segments[1] === 'volunteers'
      ? 'volunteer'
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
