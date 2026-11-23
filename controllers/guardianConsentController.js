'use strict';

/**
 * Under-18 rules (SL-NOW-02): the shelter's minimum age and guardian consent.
 *
 * Volunteers see their own status and, when under 18 at a shelter that takes
 * minors, a parent or guardian completes the consent form on their profile.
 * Staff can see the record, enter one from a paper form, or withdraw it.
 * Admins set the shelter's minimum age.
 */

const GuardianConsent = require('../models/GuardianConsent');
const VolunteerProfile = require('../models/VolunteerProfile');
const User = require('../models/User');
const { recordAudit } = require('../middleware/auditLog');
const { isStaffOrAdmin, isAdminUser } = require('../middleware/auth');
const { todayIso } = require('../utils/shelterTime');
const { ageOn, allowsMinors, ADULT_AGE } = require('../utils/ageRules');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Validate a consent form. Returns { details } or { errors }. */
function readConsentForm(body = {}, { requireConfirm }) {
  const details = {
    guardian_name: clean(body.guardian_name),
    guardian_relationship: clean(body.guardian_relationship),
    guardian_phone: clean(body.guardian_phone) || null,
    guardian_email: clean(body.guardian_email) || null,
  };
  const errors = {};
  if (!details.guardian_name) errors.guardian_name = 'Enter the parent or guardian’s full name.';
  if (!details.guardian_relationship) {
    errors.guardian_relationship = 'Say how they are related to the volunteer, for example mother or legal guardian.';
  }
  if (!details.guardian_phone && !details.guardian_email) {
    errors.guardian_phone = 'Give a phone number or email address for the parent or guardian.';
  }
  if (details.guardian_email && !EMAIL_RE.test(details.guardian_email)) {
    errors.guardian_email = 'Enter a valid email address.';
  }
  if (requireConfirm) {
    const c = body.confirm;
    if (!(c === true || c === 'on' || c === 'true')) {
      errors.confirm = 'The parent or guardian must tick the box to give consent.';
    }
  }
  return Object.keys(errors).length ? { errors } : { details };
}

function publicConsent(row) {
  if (!row) return null;
  return {
    id: row.id,
    guardian_name: row.guardian_name,
    guardian_relationship: row.guardian_relationship,
    guardian_phone: row.guardian_phone,
    guardian_email: row.guardian_email,
    consented_at: row.consented_at,
    withdrawn_at: row.withdrawn_at,
  };
}

async function audit(req, action, userId, detail = {}) {
  try {
    await recordAudit(req, {
      action,
      entityType: 'volunteer',
      entityId: userId,
      detail: { user_id: Number(userId), ...detail },
    });
  } catch (error) {
    console.error('[GuardianConsent] audit error:', error.message);
  }
}

async function statusFor(userId) {
  const [settings, profile, consent] = await Promise.all([
    GuardianConsent.getShelterSettings(),
    VolunteerProfile.findByUserId(userId),
    GuardianConsent.findActiveForUser(userId),
  ]);
  const minAge = settings.min_volunteer_age;
  const age = profile ? ageOn(profile.date_of_birth, todayIso()) : null;
  return {
    min_volunteer_age: minAge,
    allows_minors: allowsMinors(minAge),
    has_date_of_birth: Boolean(profile && profile.date_of_birth),
    age,
    under_18: age != null && age < ADULT_AGE,
    under_min_age: age != null && minAge != null && age < minAge,
    consent_required: age != null && age < ADULT_AGE && allowsMinors(minAge),
    consent: publicConsent(consent),
  };
}

// --- Volunteer -------------------------------------------------------------

async function getMyAgeStatus(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const status = await statusFor(req.session.userId);
    return res.status(200).json(status);
  } catch (error) {
    console.error('[GuardianConsent] getMyAgeStatus error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function giveMyGuardianConsent(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;

    const status = await statusFor(userId);
    if (!status.has_date_of_birth) {
      return res.status(400).json({ error: 'Add your date of birth to your profile first.' });
    }
    if (!status.under_18) {
      return res.status(400).json({ error: 'Guardian consent is only needed for volunteers under 18.' });
    }
    if (!status.allows_minors || status.under_min_age) {
      return res.status(400).json({
        error: `This shelter's minimum volunteer age is ${status.min_volunteer_age}. Consent cannot be recorded yet.`,
      });
    }

    const form = readConsentForm(req.body, { requireConfirm: true });
    if (form.errors) {
      return res.status(400).json({ error: 'Check the consent form.', fields: form.errors });
    }

    const consent = await GuardianConsent.record(userId, form.details, userId);
    await audit(req, 'volunteer.guardian_consent.given', userId, { recorded_by: 'volunteer' });
    return res.status(201).json({ consent: publicConsent(consent) });
  } catch (error) {
    console.error('[GuardianConsent] giveMyGuardianConsent error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// --- Staff -----------------------------------------------------------------

async function loadVolunteer(userId) {
  const user = await User.findById(userId);
  if (!user || user.role !== 'volunteer') return null;
  return user;
}

async function getVolunteerGuardianConsent(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { userId } = req.params;
    if (!(await loadVolunteer(userId))) return res.status(404).json({ error: 'Volunteer not found' });

    const [status, history] = await Promise.all([
      statusFor(userId),
      GuardianConsent.listForUser(userId),
    ]);
    await audit(req, 'volunteer.guardian_consent.view', userId);
    return res.status(200).json({ ...status, history: history.map(publicConsent) });
  } catch (error) {
    console.error('[GuardianConsent] getVolunteerGuardianConsent error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** Staff entering a consent the guardian gave on paper or in person. */
async function recordVolunteerGuardianConsent(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { userId } = req.params;
    if (!(await loadVolunteer(userId))) return res.status(404).json({ error: 'Volunteer not found' });

    const status = await statusFor(userId);
    if (!status.under_18) {
      return res.status(400).json({ error: 'Guardian consent is only recorded for volunteers under 18.' });
    }
    if (!status.allows_minors || status.under_min_age) {
      return res.status(400).json({
        error: `This volunteer is under this shelter's minimum volunteer age of ${status.min_volunteer_age}.`,
      });
    }

    const form = readConsentForm(req.body, { requireConfirm: false });
    if (form.errors) {
      return res.status(400).json({ error: 'Check the consent form.', fields: form.errors });
    }

    const consent = await GuardianConsent.record(userId, form.details, req.session.userId);
    await audit(req, 'volunteer.guardian_consent.given', userId, { recorded_by: 'staff' });
    return res.status(201).json({ consent: publicConsent(consent) });
  } catch (error) {
    console.error('[GuardianConsent] recordVolunteerGuardianConsent error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function withdrawVolunteerGuardianConsent(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { userId } = req.params;
    if (!(await loadVolunteer(userId))) return res.status(404).json({ error: 'Volunteer not found' });

    const withdrawn = await GuardianConsent.withdraw(userId, req.session.userId);
    if (!withdrawn) return res.status(404).json({ error: 'No active consent to withdraw' });
    await audit(req, 'volunteer.guardian_consent.withdrawn', userId);
    return res.status(200).json({ withdrawn: true });
  } catch (error) {
    console.error('[GuardianConsent] withdrawVolunteerGuardianConsent error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// --- Admin: shelter minimum age ------------------------------------------

async function getAgeSettings(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const settings = await GuardianConsent.getShelterSettings();
    return res.status(200).json({
      min_volunteer_age: settings.min_volunteer_age,
      allows_minors: allowsMinors(settings.min_volunteer_age),
      updated_at: settings.updated_at,
    });
  } catch (error) {
    console.error('[GuardianConsent] getAgeSettings error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateAgeSettings(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdminUser(req)) return res.status(403).json({ error: 'Forbidden' });
    const body = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(body, 'min_volunteer_age')) {
      return res.status(400).json({ error: 'min_volunteer_age is required (a whole number, or null for none).' });
    }
    const raw = body.min_volunteer_age;
    const minAge = raw === '' || raw == null ? null : Number(raw);
    if (minAge !== null && (!Number.isInteger(minAge) || minAge < 1 || minAge > 99)) {
      return res.status(400).json({ error: 'min_volunteer_age must be a whole number from 1 to 99, or empty for none.' });
    }

    const settings = await GuardianConsent.setMinVolunteerAge(minAge, req.session.userId);
    try {
      await recordAudit(req, {
        action: 'shelter.settings.min_age',
        entityType: 'shelter_settings',
        entityId: null,
        detail: { min_volunteer_age: settings.min_volunteer_age },
      });
    } catch (auditError) {
      console.error('[GuardianConsent] settings audit error:', auditError.message);
    }
    return res.status(200).json({
      min_volunteer_age: settings.min_volunteer_age,
      allows_minors: allowsMinors(settings.min_volunteer_age),
      updated_at: settings.updated_at,
    });
  } catch (error) {
    console.error('[GuardianConsent] updateAgeSettings error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    if (error.status === 403) return res.status(403).json({ error: 'Forbidden' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getMyAgeStatus,
  giveMyGuardianConsent,
  getVolunteerGuardianConsent,
  recordVolunteerGuardianConsent,
  withdrawVolunteerGuardianConsent,
  getAgeSettings,
  updateAgeSettings,
  readConsentForm,
};
