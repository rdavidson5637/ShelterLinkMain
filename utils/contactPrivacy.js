'use strict';

/**
 * Contact privacy helpers.
 * Volunteers must never receive another volunteer's phone, email, address,
 * or emergency contact. Staff/admin retain full access on their own routes.
 */

const CONTACT_FIELDS = [
  'email',
  'phone',
  'address',
  'emergency_contact',
  'user_email',
  'volunteer_email',
  'admin_email',
  'actor_email',
  'password',
  'reset_token',
  'claim_token',
];

function stripContactFields(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const key of CONTACT_FIELDS) {
    delete out[key];
  }
  return out;
}

/** Public / volunteer-facing swap listing — no tokens, no contact fields. */
function toVolunteerSafeSwap(swap) {
  if (!swap) return null;
  const safe = stripContactFields(swap);
  delete safe.claim_token;
  delete safe.waitlist_offered_to_user_id;
  delete safe.waitlist_offer_expires_at;
  // Keep original_user_id only as an opaque id for "don't claim your own" filtering;
  // never expose contact alongside it.
  return {
    id: safe.id,
    application_id: safe.application_id,
    status: safe.status,
    public_at: safe.public_at,
    requested_at: safe.requested_at,
    opportunity_id: safe.opportunity_id,
    opportunity_title: safe.opportunity_title,
    opportunity_start_date: safe.opportunity_start_date,
    opportunity_location: safe.opportunity_location,
    original_user_id: safe.original_user_id,
    missing_qualifications: safe.missing_qualifications,
    can_claim: safe.can_claim,
  };
}

/** Owner's swap response — hide claim tokens from the browser. */
function toOwnerSafeSwap(swap) {
  if (!swap) return null;
  const safe = stripContactFields(swap);
  delete safe.claim_token;
  return safe;
}

/** Volunteer's own application after a swap claim — drop contact fields. */
function toVolunteerSafeApplication(application) {
  if (!application) return null;
  const safe = stripContactFields(application);
  return {
    application_id: safe.application_id || safe.id,
    id: safe.application_id || safe.id,
    user_id: safe.user_id,
    opportunity_id: safe.opportunity_id,
    status: safe.status,
    applied_at: safe.applied_at,
    opportunity_title: safe.opportunity_title || safe.title,
  };
}

function hasContactLeak(payload) {
  if (payload == null) return false;
  if (Array.isArray(payload)) return payload.some(hasContactLeak);
  if (typeof payload !== 'object') return false;
  for (const key of Object.keys(payload)) {
    const lower = key.toLowerCase();
    if (
      lower === 'email' ||
      lower === 'phone' ||
      lower === 'address' ||
      lower === 'emergency_contact' ||
      lower === 'user_email' ||
      lower === 'volunteer_email' ||
      lower === 'claim_token'
    ) {
      const val = payload[key];
      if (val != null && val !== '') return true;
    }
    if (hasContactLeak(payload[key])) return true;
  }
  return false;
}

module.exports = {
  CONTACT_FIELDS,
  stripContactFields,
  toVolunteerSafeSwap,
  toOwnerSafeSwap,
  toVolunteerSafeApplication,
  hasContactLeak,
};
