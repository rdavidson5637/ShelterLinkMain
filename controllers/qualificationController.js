'use strict';

const Qualification = require('../models/Qualification');
const { isAdminUser, isStaffOrAdmin } = require('../middleware/auth');

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

function ensureStaff(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function listQualifications(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const qualifications = await Qualification.findAll();
    return res.status(200).json(qualifications);
  } catch (error) {
    console.error('[Qualification] listQualifications error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createQualification(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;

    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const description = req.body?.description != null ? String(req.body.description).trim() : null;
    let validity_months = req.body?.validity_months;
    if (validity_months === '' || validity_months === undefined) {
      validity_months = null;
    } else if (validity_months !== null) {
      validity_months = Number(validity_months);
      if (!Number.isFinite(validity_months) || validity_months <= 0) {
        return res.status(400).json({ error: 'validity_months must be a positive integer or null' });
      }
    }

    const created = await Qualification.create({ name, description, validity_months });
    return res.status(201).json(created);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A qualification with that name already exists' });
    }
    console.error('[Qualification] createQualification error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateQualification(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;

    const { id } = req.params;
    const data = {};
    if (typeof req.body?.name !== 'undefined') {
      data.name = String(req.body.name).trim();
      if (!data.name) {
        return res.status(400).json({ error: 'name cannot be empty' });
      }
    }
    if (typeof req.body?.description !== 'undefined') {
      data.description = req.body.description == null ? null : String(req.body.description).trim();
    }
    if (typeof req.body?.validity_months !== 'undefined') {
      if (req.body.validity_months === '' || req.body.validity_months === null) {
        data.validity_months = null;
      } else {
        data.validity_months = Number(req.body.validity_months);
        if (!Number.isFinite(data.validity_months) || data.validity_months <= 0) {
          return res.status(400).json({ error: 'validity_months must be a positive integer or null' });
        }
      }
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    const updated = await Qualification.update(id, data);
    if (!updated) {
      return res.status(404).json({ error: 'Qualification not found' });
    }
    return res.status(200).json(updated);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A qualification with that name already exists' });
    }
    console.error('[Qualification] updateQualification error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteQualification(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const deleted = await Qualification.remove(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Qualification not found' });
    }
    return res.status(200).json({ message: 'Qualification deleted' });
  } catch (error) {
    console.error('[Qualification] deleteQualification error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyQualifications(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const rows = await Qualification.findByUserId(req.session.userId);
    const today = Qualification.toDateOnly(new Date());
    const enriched = rows.map((row) => {
      const expires = Qualification.toDateOnly(row.expires_at);
      let status = 'valid';
      if (expires) {
        if (expires < today) status = 'expired';
        else if (expires === today) status = 'expires_today';
        else {
          const in30 = new Date(`${today}T00:00:00Z`);
          in30.setUTCDate(in30.getUTCDate() + 30);
          const in30Day = in30.toISOString().slice(0, 10);
          if (expires <= in30Day) status = 'expiring_soon';
        }
      } else {
        status = 'never_expires';
      }
      return { ...row, status };
    });
    return res.status(200).json(enriched);
  } catch (error) {
    console.error('[Qualification] getMyQualifications error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getVolunteerQualifications(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const rows = await Qualification.findByUserId(req.params.userId);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Qualification] getVolunteerQualifications error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function awardQualification(req, res) {
  try {
    if (!ensureStaff(req, res)) return;

    const userId = Number(req.params.userId);
    const qualificationId = Number(req.body?.qualification_id ?? req.body?.qualificationId);
    const awardedAt = req.body?.awarded_at || req.body?.awardedAt || new Date();

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (!Number.isFinite(qualificationId) || qualificationId <= 0) {
      return res.status(400).json({ error: 'qualification_id is required' });
    }

    const award = await Qualification.awardToUser({
      userId,
      qualificationId,
      awardedAt,
      awardedBy: req.session.userId,
    });

    return res.status(201).json(award);
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ error: error.message });
    }
    console.error('[Qualification] awardQualification error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function revokeQualification(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const userId = Number(req.params.userId);
    const qualificationId = Number(req.params.qualificationId);
    const removed = await Qualification.revokeFromUser(userId, qualificationId);
    if (!removed) {
      return res.status(404).json({ error: 'Award not found' });
    }
    return res.status(200).json({ message: 'Qualification revoked' });
  } catch (error) {
    console.error('[Qualification] revokeQualification error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listQualifications,
  createQualification,
  updateQualification,
  deleteQualification,
  getMyQualifications,
  getVolunteerQualifications,
  awardQualification,
  revokeQualification,
};
