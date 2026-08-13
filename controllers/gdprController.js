'use strict';

const AuditLog = require('../models/AuditLog');
const Gdpr = require('../models/Gdpr');
const { recordAudit } = require('../middleware/auditLog');
const { isAdminUser } = require('../middleware/auth');

function ensureAdmin(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!isAdminUser(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

async function listAuditLog(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const { action, entityType, userId, from, to, limit, offset } = req.query || {};
    const rows = await AuditLog.findAll({
      action: action || undefined,
      entityType: entityType || undefined,
      userId: userId || undefined,
      from: from || undefined,
      to: to || undefined,
      limit,
      offset,
    });
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Admin] listAuditLog error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function exportVolunteerGdpr(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const payload = await Gdpr.buildVolunteerExport(userId);
    if (!payload) {
      return res.status(404).json({ error: 'Volunteer not found' });
    }

    await recordAudit(req, {
      action: 'gdpr.export',
      entityType: 'volunteer',
      entityId: userId,
      detail: { email: payload.user.email },
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="volunteer-${userId}-gdpr-export.json"`
    );
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('[Admin] exportVolunteerGdpr error:', error.message);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function eraseVolunteer(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const confirmation = String(req.body?.confirmation || '').trim();
    if (confirmation !== 'DELETE') {
      return res.status(400).json({
        error: 'Typed confirmation required. Send { "confirmation": "DELETE" }',
      });
    }

    const outcome = await Gdpr.anonymiseUser(userId, { reason: 'gdpr_erasure' });
    if (!outcome) {
      return res.status(404).json({ error: 'Volunteer not found' });
    }

    await recordAudit(req, {
      action: 'gdpr.erase',
      entityType: 'volunteer',
      entityId: userId,
      detail: outcome,
    });

    return res.status(200).json({
      message: outcome.already_anonymised
        ? 'Account was already anonymised'
        : 'Account anonymised successfully',
      ...outcome,
    });
  } catch (error) {
    console.error('[Admin] eraseVolunteer error:', error.message);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function runRetention(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const summary = await Gdpr.runDataRetention();
    await recordAudit(req, {
      action: 'gdpr.retention',
      entityType: 'system',
      entityId: null,
      detail: {
        retention_years: summary.retention_years,
        scanned: summary.scanned,
        anonymised: summary.anonymised,
      },
    });
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[Admin] runRetention error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateUserRole(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const userId = Number(req.params.userId);
    const role = String(req.body?.role || '').trim();
    if (!['volunteer', 'staff', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'role must be volunteer, staff, or admin' });
    }
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (userId === req.session.userId && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot demote your own admin account' });
    }

    const { pool } = require('../config/database');
    const [result] = await pool.execute('UPDATE users SET role = ? WHERE user_id = ?', [
      role,
      userId,
    ]);
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'User not found' });
    }

    await recordAudit(req, {
      action: 'user.role_update',
      entityType: 'user',
      entityId: userId,
      detail: { role },
    });

    return res.status(200).json({ message: 'Role updated', user_id: userId, role });
  } catch (error) {
    console.error('[Admin] updateUserRole error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listAuditLog,
  exportVolunteerGdpr,
  eraseVolunteer,
  runRetention,
  updateUserRole,
};
