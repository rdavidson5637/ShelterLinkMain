'use strict';

const Foster = require('../models/Foster');
const Animal = require('../models/Animal');
const VolunteerProfile = require('../models/VolunteerProfile');
const { isStaffOrAdmin } = require('../middleware/auth');
const { sendFosterPlacementConfirmation } = require('../utils/emailService');

function ensureAuth(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function ensureStaff(req, res) {
  if (!ensureAuth(req, res)) return false;
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function emergencyPhone() {
  return process.env.SHELTER_EMERGENCY_PHONE || null;
}

async function createRequest(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const body = req.body || {};
    const animal = await Animal.findById(body.animal_id);
    if (!animal) return res.status(404).json({ error: 'Animal not found' });

    const request = await Foster.createRequest({
      animalId: body.animal_id,
      createdBy: req.session.userId,
      urgency: body.urgency,
      neededFrom: body.needed_from,
      expectedDurationDays: body.expected_duration_days,
      requirements: body.requirements || body.requirements_json,
      description: body.description,
    });
    return res.status(201).json(request);
  } catch (error) {
    if ([400, 409].includes(error.status)) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[Foster] createRequest error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listRequests(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const requests = await Foster.listRequests({ status: req.query.status || null });
    return res.status(200).json(requests);
  } catch (error) {
    console.error('[Foster] listRequests error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getRequest(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const request = await Foster.findRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Foster request not found' });
    const offers = await Foster.listOffersForRequest(request.id);
    return res.status(200).json({ ...request, offers });
  } catch (error) {
    console.error('[Foster] getRequest error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateRequest(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const request = await Foster.updateRequest(req.params.id, req.body || {});
    if (!request) return res.status(404).json({ error: 'Foster request not found' });
    return res.status(200).json(request);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[Foster] updateRequest error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function cancelRequest(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const request = await Foster.cancelRequest(req.params.id);
    if (!request) return res.status(404).json({ error: 'Foster request not found' });
    return res.status(200).json(request);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[Foster] cancelRequest error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listOffers(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const request = await Foster.findRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Foster request not found' });
    const offers = await Foster.listOffersForRequest(request.id);
    return res.status(200).json(offers);
  } catch (error) {
    console.error('[Foster] listOffers error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function confirmOffer(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const body = req.body || {};
    const result = await Foster.confirmOffer(req.params.offerId, {
      startedOn: body.started_on,
      expectedEndOn: body.expected_end_on,
      notes: body.notes,
    });

    try {
      const placement = result.placement;
      if (placement?.email) {
        await sendFosterPlacementConfirmation(placement.email, {
          volunteerName: placement.first_name || placement.name,
          animalName: placement.animal_name,
          startedOn: placement.started_on,
          expectedEndOn: placement.expected_end_on,
          handlingNotes: placement.animal_handling_notes,
          emergencyPhone: emergencyPhone(),
        });
      }
    } catch (emailError) {
      console.error('[Foster] confirmOffer email error:', emailError.message);
    }

    return res.status(200).json({
      ...result,
      emergency_phone: emergencyPhone(),
    });
  } catch (error) {
    if ([400, 404, 409].includes(error.status)) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[Foster] confirmOffer error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listActivePlacements(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const placements = await Foster.listActivePlacements();
    return res.status(200).json({
      placements,
      emergency_phone: emergencyPhone(),
    });
  } catch (error) {
    console.error('[Foster] listActivePlacements error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function endPlacement(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const body = req.body || {};
    const placement = await Foster.endPlacement(req.params.id, {
      endedOn: body.ended_on,
      status: body.status || 'ended',
      notes: body.notes,
      animalStatus: body.animal_status || 'available',
    });
    return res.status(200).json(placement);
  } catch (error) {
    if (error.status === 400 || error.status === 404) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[Foster] endPlacement error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listMatching(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const requests = await Foster.listOpenMatchingForUser(req.session.userId);
    return res.status(200).json({
      requests,
      emergency_phone: emergencyPhone(),
    });
  } catch (error) {
    console.error('[Foster] listMatching error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createOffer(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const offer = await Foster.createOffer({
      requestId: Number(req.params.id),
      userId: req.session.userId,
      note: req.body?.note,
    });
    return res.status(201).json(offer);
  } catch (error) {
    if ([400, 403, 404, 409].includes(error.status)) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[Foster] createOffer error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listMyPlacements(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const activeOnly = req.query.active === '1' || req.query.active === 'true';
    const placements = await Foster.listPlacementsForUser(req.session.userId, { activeOnly });
    return res.status(200).json({
      placements,
      emergency_phone: emergencyPhone(),
    });
  } catch (error) {
    console.error('[Foster] listMyPlacements error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function logCheckIn(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const userId = req.session.userId;
    const placement = await Foster.findPlacementById(req.params.id);
    if (!placement) return res.status(404).json({ error: 'Placement not found' });
    if (Number(placement.user_id) !== Number(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (placement.status !== 'active') {
      return res.status(400).json({ error: 'Placement is not active' });
    }

    const activityType = req.body?.activity_type || 'other';
    if (!Animal.ACTIVITY_TYPES.has(activityType)) {
      return res.status(400).json({ error: 'Invalid activity_type' });
    }

    const row = await Animal.logActivity({
      animalId: placement.animal_id,
      userId,
      applicationId: null,
      activityType,
      notes: req.body?.notes || 'Foster check-in',
    });
    return res.status(201).json(row);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[Foster] logCheckIn error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getEmergencyPhone(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    return res.status(200).json({ emergency_phone: emergencyPhone() });
  } catch (error) {
    console.error('[Foster] getEmergencyPhone error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateFosterApproval(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const { foster_approved } = req.body || {};
    if (typeof foster_approved !== 'boolean' && foster_approved !== 0 && foster_approved !== 1) {
      return res.status(400).json({ error: 'foster_approved must be a boolean' });
    }
    const result = await VolunteerProfile.updateFosterApproved(
      req.params.userId,
      Boolean(foster_approved)
    );
    if (!result) return res.status(404).json({ error: 'Profile not found' });
    return res.status(200).json({
      message: `Foster ${foster_approved ? 'approved' : 'unapproved'} successfully`,
      foster_approved: Boolean(foster_approved),
      profile: result,
    });
  } catch (error) {
    console.error('[Foster] updateFosterApproval error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createRequest,
  listRequests,
  getRequest,
  updateRequest,
  cancelRequest,
  listOffers,
  confirmOffer,
  listActivePlacements,
  endPlacement,
  listMatching,
  createOffer,
  listMyPlacements,
  logCheckIn,
  getEmergencyPhone,
  updateFosterApproval,
};
