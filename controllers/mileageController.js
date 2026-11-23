'use strict';

const MileageClaim = require('../models/MileageClaim');
const { isStaffOrAdmin } = require('../middleware/auth');

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function ensureStaff(req, res) {
  if (!ensureAuthenticated(req, res)) return false;
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function httpError(res, error) {
  if (error && (error.status === 400 || error.status === 403 || error.status === 404 || error.status === 409)) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error('[Mileage]', error && error.message ? error.message : error);
  return res.status(500).json({ error: 'Internal server error' });
}

async function createClaim(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const body = req.body || {};
    const userId = req.session.userId;

    if (body.transport_leg_id != null || body.transportLegId != null) {
      const legId = body.transport_leg_id != null ? body.transport_leg_id : body.transportLegId;
      const claim = await MileageClaim.createFromTransportLeg({
        userId,
        legId,
        miles: body.miles,
        purpose: body.purpose,
      });
      return res.status(201).json(claim);
    }

    if (!body.travel_date && !body.travelDate) {
      return res.status(400).json({ error: 'travel_date is required' });
    }
    if (body.miles == null) {
      return res.status(400).json({ error: 'miles is required' });
    }
    if (!body.purpose) {
      return res.status(400).json({ error: 'purpose is required' });
    }

    const claim = await MileageClaim.create({
      userId,
      travelDate: body.travel_date || body.travelDate,
      miles: body.miles,
      purpose: body.purpose,
      opportunityId: body.opportunity_id != null ? body.opportunity_id : body.opportunityId,
    });
    return res.status(201).json(claim);
  } catch (error) {
    return httpError(res, error);
  }
}

async function getMyClaims(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const claims = await MileageClaim.findByUserId(req.session.userId);
    return res.status(200).json(claims);
  } catch (error) {
    return httpError(res, error);
  }
}

async function getPending(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const claims = await MileageClaim.findByStatus('pending');
    return res.status(200).json(claims);
  } catch (error) {
    return httpError(res, error);
  }
}

async function getTotals(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const totals = await MileageClaim.approvedTotalsByVolunteer();
    return res.status(200).json(totals);
  } catch (error) {
    return httpError(res, error);
  }
}

async function approveClaim(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const claim = await MileageClaim.setStatus(req.params.id, 'approved', req.session.userId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    return res.status(200).json(claim);
  } catch (error) {
    return httpError(res, error);
  }
}

async function rejectClaim(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const claim = await MileageClaim.setStatus(req.params.id, 'rejected', req.session.userId);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    return res.status(200).json(claim);
  } catch (error) {
    return httpError(res, error);
  }
}

module.exports = {
  createClaim,
  getMyClaims,
  getPending,
  getTotals,
  approveClaim,
  rejectClaim,
};
