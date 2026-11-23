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
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
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
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
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
      detail: {
        user_id: outcome.user_id,
        hours_preserved: outcome.hours_preserved,
        already_anonymised: Boolean(outcome.already_anonymised),
      },
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
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getRetentionSettings(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const settings = await Gdpr.getRetentionSettings();
    return res.status(200).json(settings);
  } catch (error) {
    console.error('[Admin] getRetentionSettings error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateRetentionSettings(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const raw = req.body?.retention_inactive_months;
    const months = raw === '' || raw === undefined ? null : raw;
    const settings = await Gdpr.setRetentionMonths(months, req.session.userId);
    await recordAudit(req, {
      action: 'shelter.settings.retention',
      entityType: 'shelter_settings',
      entityId: settings.shelter_id,
      detail: { retention_inactive_months: settings.retention_inactive_months },
    });
    return res.status(200).json(settings);
  } catch (error) {
    console.error('[Admin] updateRetentionSettings error:', error.message);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function previewRetention(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const preview = await Gdpr.listRetentionCandidates();
    return res.status(200).json(preview);
  } catch (error) {
    console.error('[Admin] previewRetention error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
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
      entityId: summary.shelter_id,
      detail: {
        shelter_id: summary.shelter_id,
        retention_inactive_months: summary.retention_inactive_months,
        scanned: summary.scanned,
        anonymised: summary.anonymised,
        skipped: Boolean(summary.skipped),
        cutoff: summary.cutoff,
      },
    });
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[Admin] runRetention error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
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
    const Membership = require('../models/Membership');
    const [result] = await pool.execute('UPDATE users SET role = ? WHERE user_id = ?', [
      role,
      userId,
    ]);
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [rows] = await pool.execute(
      'SELECT user_id, shelter_id, role FROM users WHERE user_id = ? LIMIT 1',
      [userId]
    );
    await Membership.syncFromUser(rows[0]);

    await recordAudit(req, {
      action: 'user.role_update',
      entityType: 'user',
      entityId: userId,
      detail: { role },
    });

    return res.status(200).json({ message: 'Role updated', user_id: userId, role });
  } catch (error) {
    console.error('[Admin] updateUserRole error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listAuditLog,
  exportVolunteerGdpr,
  eraseVolunteer,
  getRetentionSettings,
  updateRetentionSettings,
  previewRetention,
  runRetention,
  updateUserRole,
};
