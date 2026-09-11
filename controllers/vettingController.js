'use strict';

const Vetting = require('../models/Vetting');
const User = require('../models/User');
const { isStaffOrAdmin } = require('../middleware/auth');
const { sendEmail } = require('../utils/emailService');

function ensureAuth(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function buildReferenceLink(token) {
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  const path = `/pages/public/reference.html?token=${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

async function requestReference(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = Number(req.params.userId || req.body?.user_id);
    const { referee_name, referee_email, referee_relationship } = req.body || {};
    if (!userId || !Number.isFinite(userId)) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!referee_name || !referee_email) {
      return res.status(400).json({ error: 'referee_name and referee_email are required' });
    }

    const volunteer = await User.findById(userId);
    if (!volunteer) {
      return res.status(404).json({ error: 'Volunteer not found' });
    }

    const { reference, token } = await Vetting.createReferenceRequest({
      userId,
      refereeName: referee_name,
      refereeEmail: referee_email,
      refereeRelationship: referee_relationship || null,
    });

    const link = buildReferenceLink(token);
    try {
      await sendEmail(
        referee_email,
        'Reference request - ShelterLink / Assisi Animal Sanctuary',
        `
        <p>Hello ${reference.referee_name},</p>
        <p>${volunteer.first_name || 'A volunteer'} has listed you as a referee for volunteering
        at Assisi Animal Sanctuary via ShelterLink.</p>
        <p>Please complete this short confidential form:</p>
        <p><a href="${link}">Provide a reference</a></p>
        <p>This link expires on ${String(reference.expires_at).slice(0, 10)}.</p>
        <p>Thank you,<br/>ShelterLink</p>
        `
      );
    } catch (emailError) {
      console.error('[Vetting] reference email failed:', emailError.message);
    }

    return res.status(201).json({ reference, link_sent: true });
  } catch (error) {
    console.error('[Vetting] requestReference error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listVolunteerReferences(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = Number(req.params.userId);
    const rows = await Vetting.listReferencesForUser(userId, { includeComments: true });
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Vetting] listVolunteerReferences error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listMyReferences(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    // Never include referee comments on volunteer-facing APIs.
    const rows = await Vetting.listReferencesForUser(req.session.userId, {
      includeComments: false,
    });
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Vetting] listMyReferences error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listBackgroundChecks(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = Number(req.params.userId);
    const rows = await Vetting.listBackgroundChecksForUser(userId);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Vetting] listBackgroundChecks error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listMyBackgroundChecks(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const rows = await Vetting.listBackgroundChecksForUser(req.session.userId);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Vetting] listMyBackgroundChecks error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function upsertBackgroundCheck(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = Number(req.params.userId);
    const body = req.body || {};
    const checkType = Vetting.normalizeCheckType(body.check_type || body.checkType);
    if (!checkType) {
      return res.status(400).json({ error: 'Valid check_type is required' });
    }
    const status = Vetting.normalizeCheckStatus(body.status) || 'pending';
    const row = await Vetting.upsertBackgroundCheck({
      id: body.id ? Number(body.id) : null,
      userId,
      checkType,
      referenceNumber: body.reference_number || body.referenceNumber || null,
      issuedOn: body.issued_on || body.issuedOn || null,
      expiresOn: body.expires_on || body.expiresOn || null,
      status,
      notes: body.notes || null,
      updatedBy: req.session.userId,
    });
    if (!row) {
      return res.status(404).json({ error: 'Background check not found' });
    }
    return res.status(body.id ? 200 : 201).json(row);
  } catch (error) {
    console.error('[Vetting] upsertBackgroundCheck error:', error.message);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function getOnboardingChecklist(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const checklist = await Vetting.getOnboardingChecklist(req.session.userId);
    return res.status(200).json(checklist);
  } catch (error) {
    console.error('[Vetting] getOnboardingChecklist error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getOnboardingPipeline(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const pipeline = await Vetting.getOnboardingPipeline();
    return res.status(200).json(pipeline);
  } catch (error) {
    console.error('[Vetting] getOnboardingPipeline error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getPublicReference(req, res) {
  try {
    const token = req.params.token;
    const row = await Vetting.findReferenceByToken(token);
    if (!row) {
      return res.status(404).json({ error: 'Reference request not found' });
    }
    if (row.status === 'expired' || (row.expires_at && new Date(row.expires_at) < new Date())) {
      return res.status(410).json({ error: 'This reference link has expired' });
    }
    if (row.status !== 'requested') {
      return res.status(410).json({ error: 'This reference has already been submitted' });
    }
    return res.status(200).json({
      referee_name: row.referee_name,
      referee_relationship: row.referee_relationship,
      expires_at: row.expires_at,
      status: row.status,
    });
  } catch (error) {
    console.error('[Vetting] getPublicReference error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function submitPublicReference(req, res) {
  try {
    const token = req.params.token;
    const body = req.body || {};
    const declined = Boolean(body.declined);
    const raw = body.is_suitable ?? body.isSuitable;
    // Tri-state: undefined/null (field omitted) must stay distinct from an
    // explicit "0"/false — the former is "no answer", not "not suitable".
    const isSuitable =
      raw === true || raw === 1 || raw === '1'
        ? true
        : raw === false || raw === 0 || raw === '0'
          ? false
          : null;

    const result = await Vetting.submitReferenceResponse(token, {
      declined,
      isSuitable: declined ? null : isSuitable,
      comments: body.comments || null,
    });

    if (!result.ok) {
      const map = {
        not_found: [404, 'Reference request not found'],
        expired: [410, 'This reference link has expired'],
        already_responded: [410, 'This reference has already been submitted'],
      };
      const [code, message] = map[result.error] || [400, 'Unable to submit reference'];
      return res.status(code).json({ error: message });
    }

    return res.status(200).json({ message: 'Thank you. Your reference has been recorded.' });
  } catch (error) {
    console.error('[Vetting] submitPublicReference error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  requestReference,
  listVolunteerReferences,
  listMyReferences,
  listBackgroundChecks,
  listMyBackgroundChecks,
  upsertBackgroundCheck,
  getOnboardingChecklist,
  getOnboardingPipeline,
  getPublicReference,
  submitPublicReference,
};
