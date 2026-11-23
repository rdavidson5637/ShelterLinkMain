'use strict';

/**
 * Per-shelter booking approval policy (SL-NOW-03).
 *
 * Two modes, chosen by a shelter admin:
 *   approval  Every booking waits for staff. This is the default, and the
 *             behaviour every shelter had before this setting existed.
 *   instant   Volunteers an admin has marked as trusted are confirmed
 *             straight away when there is a seat. When the shift is full they
 *             join the waitlist, and when a seat frees up the oldest
 *             waitlisted volunteer is confirmed if they are trusted and still
 *             eligible. Everyone else still waits for staff.
 *
 * "Trusted" means one thing only: a shelter admin has explicitly marked that
 * volunteer as trusted (trusted_volunteers row). There is no hours threshold
 * and nothing promotes a volunteer to trusted automatically.
 */

const MODES = Object.freeze(['approval', 'instant']);
const DEFAULT_MODE = 'approval';

function normaliseMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return MODES.includes(mode) ? mode : DEFAULT_MODE;
}

function isValidMode(value) {
  return MODES.includes(value);
}

/** True when this volunteer's bookings skip staff review at this shelter. */
function canBookInstantly({ mode, trusted }) {
  return normaliseMode(mode) === 'instant' && trusted === true;
}

/**
 * Status for a new booking before the seat is actually claimed.
 * 'accepted' here means "try to claim a seat"; the claim itself is atomic
 * (Application.claimSeat) and falls back to 'waitlisted' if the last seat went.
 */
function initialStatus({ mode, trusted, isFull }) {
  if (isFull) return 'waitlisted';
  return canBookInstantly({ mode, trusted }) ? 'accepted' : 'pending';
}

/**
 * Status for the oldest waitlisted volunteer when a seat frees up.
 * eligible: profile still approved, qualifications and background check
 * still valid. If not, staff decide (pending), the same as approval mode.
 */
function promotionStatus({ mode, trusted, eligible }) {
  return canBookInstantly({ mode, trusted }) && eligible === true ? 'accepted' : 'pending';
}

module.exports = {
  MODES,
  DEFAULT_MODE,
  normaliseMode,
  isValidMode,
  canBookInstantly,
  initialStatus,
  promotionStatus,
};
