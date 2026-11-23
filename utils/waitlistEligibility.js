'use strict';

/**
 * Eligibility for a waitlist seat offer (SL-LATER-23).
 * Age (shelter minimum + guardian consent), training qualifications,
 * animal-required qualifications, and required background checks.
 */

async function isEligibleForWaitlistOffer(userId, opportunity) {
  if (!userId || !opportunity) return { ok: false, reason: 'missing' };

  const VolunteerProfile = require('../models/VolunteerProfile');
  const Qualification = require('../models/Qualification');
  const Animal = require('../models/Animal');
  const Vetting = require('../models/Vetting');
  const GuardianConsent = require('../models/GuardianConsent');

  try {
    const profile = await VolunteerProfile.findByUserId(userId);
    if (!profile || !profile.approved) {
      return { ok: false, reason: 'not_approved' };
    }

    const ageAssessment = await GuardianConsent.assessForBooking(
      userId,
      profile,
      opportunity
    );
    if (!ageAssessment.ok) {
      return { ok: false, reason: ageAssessment.code || 'age' };
    }

    const opportunityId = opportunity.opportunity_id || opportunity.id;
    const missingQuals = await Qualification.findMissingForUser(userId, opportunityId);
    if (missingQuals.length) {
      return { ok: false, reason: 'missing_qualification' };
    }

    const missingAnimalQuals = await Animal.findMissingQualificationsForUser(
      userId,
      opportunityId
    );
    if (missingAnimalQuals.length) {
      return { ok: false, reason: 'missing_animal_qualification' };
    }

    const checkAssessment = await Vetting.assessRequiredCheck(userId, opportunity);
    if (!checkAssessment || !checkAssessment.ok) {
      return { ok: false, reason: 'background_check' };
    }

    return { ok: true };
  } catch (error) {
    console.error('[waitlistEligibility] error:', error.message);
    return { ok: false, reason: 'error' };
  }
}

module.exports = {
  isEligibleForWaitlistOffer,
};
