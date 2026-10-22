'use strict';

const Vetting = require('../models/Vetting');
const { recordAudit } = require('../middleware/auditLog');
const User = require('../models/User');
const { isStaffOrAdmin, isAdminUser } = require('../middleware/auth');
const { sendEmail } = require('../utils/emailService');
const { currentShelterName } = require('../utils/shelterBrand');
const { pool } = require('../config/database');
const { currentShelterId, isBypass, runWithShelter, runWithoutShelter } = require('../utils/shelterContext');

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
    const shelterName = String(await currentShelterName()).replace(/[\r\n]/g, '').trim();
    const shelterLabel = shelterName
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;') || 'the shelter';
    try {
      await sendEmail(
        referee_email,
        `Reference request - ShelterLink${shelterName ? ` / ${shelterName}` : ''}`,
        `
        <p>Hello ${reference.referee_name},</p>
        <p>${volunteer.first_name || 'A volunteer'} has listed you as a referee for volunteering
        at ${shelterLabel} via ShelterLink.</p>
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
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listVolunteerReferences(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = Number(req.params.userId);
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const rows = await Vetting.listReferencesForUser(userId, { includeComments: true });
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Vetting] listVolunteerReferences error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
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
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function checkVisibility(req) {
  const admin = isAdminUser(req);
  return { includeReference: admin, includeNotes: admin };
}

function storedText(value) {
  if (value == null) return '';
  return String(value);
}

async function listBackgroundChecks(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = Number(req.params.userId);
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const rows = await Vetting.listBackgroundChecksForUser(userId, checkVisibility(req));
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Vetting] listBackgroundChecks error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listMyBackgroundChecks(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const rows = await Vetting.listBackgroundChecksForUser(req.session.userId, {
      includeReference: true,
    });
    return res.status(200).json(rows);
  } catch (error) {
    console.error('[Vetting] listMyBackgroundChecks error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
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
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const status = Vetting.normalizeCheckStatus(body.status) || 'pending';
    const admin = isAdminUser(req);
    let referenceNumber = admin ? (body.reference_number || body.referenceNumber || null) : null;
    let notes = admin ? (body.notes || null) : null;
    const checkId = body.id ? Number(body.id) : null;
    let existing = null;
    if (checkId) {
      existing = await Vetting.findBackgroundCheckById(checkId, { full: true });
      if (!existing || Number(existing.user_id) !== userId) {
        return res.status(404).json({ error: 'Background check not found' });
      }
    }
    if (!admin) {
      referenceNumber = existing ? existing.reference_number : null;
      notes = existing ? existing.notes : null;
    }
    const row = await Vetting.upsertBackgroundCheck({
      id: checkId,
      userId,
      checkType,
      referenceNumber,
      issuedOn: body.issued_on || body.issuedOn || null,
      expiresOn: body.expires_on || body.expiresOn || null,
      status,
      notes,
      updatedBy: req.session.userId,
    });
    if (!row) {
      return res.status(404).json({ error: 'Background check not found' });
    }
    if (admin) {
      const referenceChanged = storedText(existing && existing.reference_number) !== storedText(referenceNumber);
      const notesChanged = storedText(existing && existing.notes) !== storedText(notes);
      if (referenceChanged || notesChanged) {
        try {
          await recordAudit(req, {
            action: 'background_check.sensitive_update',
            entityType: 'background_check',
            entityId: row.id,
            detail: {
              user_id: userId,
              reference_changed: referenceChanged,
              notes_changed: notesChanged,
            },
          });
        } catch (auditError) {
          console.error('[Vetting] sensitive audit failed:', auditError.message);
        }
      }
    }
    return res.status(body.id ? 200 : 201).json(Vetting.toSafeCheck(row, checkVisibility(req)));
  } catch (error) {
    console.error('[Vetting] upsertBackgroundCheck error:', error.message);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function listExpiringChecks(req, res) {
  try {
    if (!isStaffOrAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const rows = await Vetting.findChecksNeedingStaffWarning();
    return res.status(200).json(rows.map((row) => ({
      user_id: row.user_id,
      first_name: row.first_name,
      last_name: row.last_name,
      check_type: row.check_type,
      status: row.status,
      expires_on: row.expires_on,
    })));
  } catch (error) {
    console.error('[Vetting] listExpiringChecks error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getOnboardingChecklist(req, res) {
  try {
    if (!ensureAuth(req, res)) return;
    const checklist = await Vetting.getOnboardingChecklist(req.session.userId);
    return res.status(200).json(checklist);
  } catch (error) {
    console.error('[Vetting] getOnboardingChecklist error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
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
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getPublicReference(req, res) {
  if (!currentShelterId() && !isBypass()) {
    return runWithoutShelter(() => getPublicReference(req, res));
  }
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
    let shelterName = '';
    let hasLogo = false;
    if (row.shelter_id) {
      const brand = await runWithShelter(row.shelter_id, async () => {
        const [shelters] = await pool.execute(
          `SELECT name, (logo IS NOT NULL AND octet_length(logo) > 0) AS has_logo
             FROM shelters WHERE id = ? LIMIT 1`,
          [row.shelter_id]
        );
        return shelters[0] || null;
      });
      shelterName = brand && brand.name ? String(brand.name) : '';
      hasLogo = Boolean(brand && brand.has_logo);
    }
    return res.status(200).json({
      referee_name: row.referee_name,
      referee_relationship: row.referee_relationship,
      expires_at: row.expires_at,
      status: row.status,
      shelter_name: shelterName,
      has_logo: hasLogo,
    });
  } catch (error) {
    console.error('[Vetting] getPublicReference error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function submitPublicReference(req, res) {
  if (!currentShelterId() && !isBypass()) {
    return runWithoutShelter(() => submitPublicReference(req, res));
  }
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
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getPublicReferenceLogo(req, res) {
  if (!currentShelterId() && !isBypass()) {
    return runWithoutShelter(() => getPublicReferenceLogo(req, res));
  }
  try {
    const row = await Vetting.findReferenceByToken(req.params.token);
    if (!row || !row.shelter_id) return res.status(404).json({ error: 'Not found' });
    const logo = await runWithShelter(row.shelter_id, async () => {
      const [shelters] = await pool.execute(
        'SELECT logo, logo_mime FROM shelters WHERE id = ? LIMIT 1',
        [row.shelter_id]
      );
      return shelters[0] || null;
    });
    const mime = String(logo && logo.logo_mime || '').toLowerCase();
    if (!logo || !logo.logo || !['image/jpeg', 'image/png'].includes(mime)) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(logo.logo);
  } catch (error) {
    console.error('[Vetting] getPublicReferenceLogo error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  requestReference,
  listVolunteerReferences,
  listMyReferences,
  listBackgroundChecks,
  listMyBackgroundChecks,
  listExpiringChecks,
  upsertBackgroundCheck,
  getOnboardingChecklist,
  getOnboardingPipeline,
  getPublicReference,
  getPublicReferenceLogo,
  submitPublicReference,
};
