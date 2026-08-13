'use strict';

const Waiver = require('../models/Waiver');
const User = require('../models/User');
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

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function normalizeFullName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function listWaivers(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;
    const waivers = await Waiver.findAll();
    return res.status(200).json(waivers);
  } catch (error) {
    console.error('[Waiver] listWaivers error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createWaiver(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;

    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!body) {
      return res.status(400).json({ error: 'body is required' });
    }

    const active = req.body?.active === undefined ? true : Boolean(req.body.active);
    const requires_reacceptance =
      req.body?.requires_reacceptance === undefined
        ? true
        : Boolean(req.body.requires_reacceptance);

    const created = await Waiver.create({
      title,
      body,
      active,
      requires_reacceptance,
    });
    return res.status(201).json(created);
  } catch (error) {
    console.error('[Waiver] createWaiver error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateWaiver(req, res) {
  try {
    if (!ensureAdmin(req, res)) return;

    const data = {};
    if (typeof req.body?.title !== 'undefined') {
      data.title = String(req.body.title).trim();
      if (!data.title) {
        return res.status(400).json({ error: 'title cannot be empty' });
      }
    }
    if (typeof req.body?.body !== 'undefined') {
      data.body = String(req.body.body).trim();
      if (!data.body) {
        return res.status(400).json({ error: 'body cannot be empty' });
      }
    }
    if (typeof req.body?.active !== 'undefined') {
      data.active = Boolean(req.body.active);
    }
    if (typeof req.body?.requires_reacceptance !== 'undefined') {
      data.requires_reacceptance = Boolean(req.body.requires_reacceptance);
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    const updated = await Waiver.update(req.params.id, data);
    if (!updated) {
      return res.status(404).json({ error: 'Waiver not found' });
    }
    return res.status(200).json(updated);
  } catch (error) {
    console.error('[Waiver] updateWaiver error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getPendingWaivers(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const pending = await Waiver.findPendingForUser(req.session.userId);
    return res.status(200).json(pending);
  } catch (error) {
    console.error('[Waiver] getPendingWaivers error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function acceptWaiver(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;

    const waiverId = Number(req.params.id);
    const signature = String(req.body?.signature || '').trim();
    const agreed = Boolean(req.body?.agreed);

    if (!Number.isFinite(waiverId) || waiverId <= 0) {
      return res.status(400).json({ error: 'Invalid waiver id' });
    }
    if (!agreed) {
      return res.status(400).json({ error: 'You must agree to the waiver' });
    }
    if (!signature) {
      return res.status(400).json({ error: 'Typed full name (signature) is required' });
    }

    const waiver = await Waiver.findById(waiverId);
    if (!waiver || !waiver.active) {
      return res.status(404).json({ error: 'Waiver not found' });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const expected = normalizeFullName(`${user.first_name || ''} ${user.last_name || ''}`);
    if (!expected || normalizeFullName(signature) !== expected) {
      return res.status(400).json({
        error: 'Signature must match your full name on file',
      });
    }

    try {
      const acceptance = await Waiver.accept({
        waiverId,
        userId: req.session.userId,
        version: waiver.version,
      });
      return res.status(201).json(acceptance);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(200).json({ message: 'Already accepted', waiver_id: waiverId, version: waiver.version });
      }
      throw error;
    }
  } catch (error) {
    console.error('[Waiver] acceptWaiver error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getVolunteerWaiverStatus(req, res) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const status = await Waiver.getStatusForUser(req.params.userId);
    return res.status(200).json(status);
  } catch (error) {
    console.error('[Waiver] getVolunteerWaiverStatus error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listWaivers,
  createWaiver,
  updateWaiver,
  getPendingWaivers,
  acceptWaiver,
  getVolunteerWaiverStatus,
};
