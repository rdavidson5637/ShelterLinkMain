'use strict';

/**
 * Under-18 booking rules (SL-NOW-02).
 *
 * Each shelter sets its own minimum age (shelter_settings.min_volunteer_age).
 * There is no global default: when a shelter has not set one, no minimum is
 * enforced. Whatever the shelter minimum, a volunteer under 18 needs an
 * active guardian consent before they can book.
 *
 * Age is worked out on the shift's own date, so someone who turns 16 next
 * month can book a shift from that day.
 */

const ADULT_AGE = 18;
const MIN_AGE_FLOOR = 1;
const MIN_AGE_CEILING = 99;

function parseIsoDay(value) {
  if (value == null || value === '') return null;
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Whole years between a date of birth and a day, both 'YYYY-MM-DD'. */
function ageOn(dateOfBirth, onDay) {
  const dob = parseIsoDay(dateOfBirth);
  const on = parseIsoDay(onDay);
  if (!dob || !on) return null;
  let age = on.year - dob.year;
  if (on.month < dob.month || (on.month === dob.month && on.day < dob.day)) {
    age -= 1;
  }
  return age < 0 ? null : age;
}

/** A shelter minimum age, or null when unset or out of range. */
function normaliseMinAge(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_AGE_FLOOR || n > MIN_AGE_CEILING) return null;
  return n;
}

/** True when the shelter's settings let under-18s volunteer at all. */
function allowsMinors(minAge) {
  const n = normaliseMinAge(minAge);
  return n == null || n < ADULT_AGE;
}

/**
 * Decide whether a volunteer may book on a given day.
 *
 * @param {object} input
 * @param {string|null} input.dateOfBirth  volunteer_profiles.date_of_birth
 * @param {number|null} input.minAge       shelter_settings.min_volunteer_age
 * @param {boolean}     input.hasConsent   an active guardian consent exists
 * @param {string}      input.onDay        'YYYY-MM-DD' the shift is on
 * @returns {{ ok: boolean, code?: string, age: number|null, minAge: number|null,
 *             needsConsent: boolean }}
 */
function assessAge({ dateOfBirth, minAge, hasConsent, onDay }) {
  const min = normaliseMinAge(minAge);
  const age = ageOn(dateOfBirth, onDay);

  if (age == null) {
    // Without a date of birth we cannot tell. Only block where the shelter has
    // asked for a minimum; otherwise older profiles keep working.
    if (min != null) {
      return { ok: false, code: 'dob_missing', age: null, minAge: min, needsConsent: false };
    }
    return { ok: true, age: null, minAge: min, needsConsent: false };
  }

  if (min != null && age < min) {
    return { ok: false, code: 'under_min_age', age, minAge: min, needsConsent: false };
  }

  const needsConsent = age < ADULT_AGE;
  if (needsConsent && !hasConsent) {
    return { ok: false, code: 'consent_missing', age, minAge: min, needsConsent };
  }

  return { ok: true, age, minAge: min, needsConsent };
}

/** A plain sentence for a blocked booking. action is 'apply', 'claim', or 'accept'. */
function ageMessage(assessment, action = 'apply') {
  if (action === 'accept') return staffAgeMessage(assessment);
  const verb = action === 'claim' ? 'claim this shift' : 'book this shift';
  switch (assessment && assessment.code) {
    case 'dob_missing':
      return `Add your date of birth to your profile before you ${verb}. This shelter has a minimum volunteer age.`;
    case 'under_min_age':
      return `This shelter's minimum volunteer age is ${assessment.minAge}. You cannot ${verb} yet.`;
    case 'consent_missing':
      return `You are under 18, so a parent or guardian needs to give consent on your profile before you ${verb}.`;
    default:
      return '';
  }
}

/** The same rule, worded for staff accepting someone else's application. */
function staffAgeMessage(assessment) {
  switch (assessment && assessment.code) {
    case 'dob_missing':
      return 'This volunteer has no date of birth on their profile, and this shelter has a minimum volunteer age.';
    case 'under_min_age':
      return `This volunteer is under this shelter's minimum volunteer age of ${assessment.minAge} on the shift date.`;
    case 'consent_missing':
      return 'This volunteer is under 18 and has no active parent or guardian consent.';
    default:
      return '';
  }
}

module.exports = {
  ADULT_AGE,
  MIN_AGE_FLOOR,
  MIN_AGE_CEILING,
  ageOn,
  normaliseMinAge,
  allowsMinors,
  assessAge,
  ageMessage,
};
