'use strict';

/**
 * Waitlist seat-offer orchestration (SL-LATER-23).
 * Controllers and the hourly job call these helpers so claim/notify/expire
 * stay in one place.
 */

const Application = require('../models/Application');
const Opportunity = require('../models/Opportunity');
const WaitlistOffer = require('../models/WaitlistOffer');
const BookingPolicy = require('../models/BookingPolicy');
const bookingPolicy = require('./bookingPolicy');
const { isEligibleForWaitlistOffer } = require('./waitlistEligibility');
const { notifyWaitlistSeatOffer } = require('./notify');
const { claimJobRun } = require('./jobLog');

function appBaseUrl() {
  return String(process.env.APP_URL || '').replace(/\/$/, '') || '';
}

function claimPath(token) {
  return `/pages/volunteer/claim-waitlist.html?token=${encodeURIComponent(token)}`;
}

function claimLink(token) {
  const base = appBaseUrl();
  const path = claimPath(token);
  return base ? `${base}${path}` : path;
}

async function hasFreeSeat(opportunityId) {
  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity) return false;
  const maxVolunteers = Number(opportunity.max_volunteers);
  if (!Number.isFinite(maxVolunteers) || maxVolunteers <= 0) return true;
  const capacity = await Opportunity.getCurrentCapacity(opportunityId);
  return capacity < maxVolunteers;
}

/**
 * Create an offer for the first eligible waitlisted volunteer, or return the
 * existing active offer. Does not change application status until claim.
 */
async function offerNextWaitlisted(
  opportunityId,
  { now = new Date(), notify = true, skipApplicationIds = [] } = {}
) {
  if (!opportunityId) return null;

  const existing = await WaitlistOffer.findActiveForOpportunity(opportunityId);
  if (existing) {
    if (notify && !existing.notified_at) {
      await tryNotifyOffer(existing, now);
    }
    return existing;
  }

  if (!(await hasFreeSeat(opportunityId))) return null;

  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity) return null;

  const skip = new Set((skipApplicationIds || []).map((id) => Number(id)));
  const queue = await Application.findWaitlistedOrdered(opportunityId, 50);
  let chosen = null;
  for (const app of queue) {
    if (skip.has(Number(app.application_id))) continue;
    const eligibility = await isEligibleForWaitlistOffer(app.user_id, opportunity);
    if (eligibility.ok) {
      chosen = app;
      break;
    }
  }
  if (!chosen) return null;

  let offer;
  try {
    offer = await WaitlistOffer.create({
      opportunityId,
      applicationId: chosen.application_id,
      userId: chosen.user_id,
    });
  } catch (error) {
    // Unique active-offer race: another replica won.
    if (error && (error.code === '23505' || error.code === 'ER_DUP_ENTRY')) {
      return WaitlistOffer.findActiveForOpportunity(opportunityId);
    }
    throw error;
  }

  offer.email = chosen.email;
  offer.first_name = chosen.first_name;
  offer.opportunity_title = chosen.opportunity_title || opportunity.title;
  offer.quiet_hours_start = chosen.quiet_hours_start;
  offer.quiet_hours_end = chosen.quiet_hours_end;

  if (notify) {
    await tryNotifyOffer(offer, now);
  }
  return offer;
}

async function tryNotifyOffer(offer, now = new Date()) {
  if (!offer || offer.notified_at) return { skipped: true, reason: 'already_notified' };

  const claimed = await claimJobRun(
    'waitlistOfferNotify',
    `offer:${offer.id || offer.offer_id}:notify`
  );
  if (!claimed) return { skipped: true, reason: 'claim' };

  const recipient = {
    user_id: offer.user_id,
    email: offer.email,
    quiet_hours_start: offer.quiet_hours_start,
    quiet_hours_end: offer.quiet_hours_end,
  };
  // Reload quiet hours / email if the create path did not attach them.
  if (recipient.email == null || recipient.quiet_hours_start === undefined) {
    const VolunteerProfile = require('../models/VolunteerProfile');
    const User = require('../models/User');
    const user = await User.findById(offer.user_id).catch(() => null);
    const profile = await VolunteerProfile.findByUserId(offer.user_id).catch(() => null);
    if (user) recipient.email = user.email;
    if (profile) {
      recipient.quiet_hours_start = profile.quiet_hours_start;
      recipient.quiet_hours_end = profile.quiet_hours_end;
    }
  }

  const title = offer.opportunity_title || 'a shift';
  const token = offer.claim_token;
  const result = await notifyWaitlistSeatOffer(
    recipient,
    {
      title,
      claimLink: claimLink(token),
      claimPath: claimPath(token),
      hours: WaitlistOffer.OFFER_HOURS,
      offer_id: offer.id || offer.offer_id,
    },
    { now }
  );

  if (result.skipReason === 'quiet_hours') {
    return { skipped: true, reason: 'quiet_hours', result };
  }
  if (!result.delivered) {
    return { skipped: true, reason: 'not_delivered', result };
  }

  const updated = await WaitlistOffer.markNotified(offer.id || offer.offer_id, now);
  return { notified: true, offer: updated, result };
}

/**
 * Keep offering while seats are free. Instant mode with several free seats
 * still goes one active offer at a time; further seats wait until claim or
 * expiry cascades through the job / a later fillFromWaitlist call.
 */
async function fillFromWaitlist(opportunityId, maxRounds = 1) {
  const offered = [];
  const rounds = Math.min(Math.max(Number(maxRounds) || 1, 1), 50);
  for (let i = 0; i < rounds; i += 1) {
    const offer = await offerNextWaitlisted(opportunityId);
    if (!offer) break;
    offered.push(offer);
    // Only one active offer per opportunity.
    break;
  }
  return offered;
}

async function stillEligibleForConfirm(userId, opportunity) {
  const eligibility = await isEligibleForWaitlistOffer(userId, opportunity);
  return eligibility.ok;
}

/**
 * Volunteer claims their timed offer. Booking policy decides accepted vs pending.
 */
async function claimOfferByToken(token, userId) {
  const offer = await WaitlistOffer.findByClaimToken(token);
  if (!offer) {
    return { error: 'Offer not found or already used', status: 404 };
  }
  if (Number(offer.user_id) !== Number(userId)) {
    return { error: 'This offer belongs to another volunteer', status: 403 };
  }
  if (offer.application_status !== 'waitlisted') {
    return { error: 'Your waitlist place is no longer active', status: 400 };
  }
  if (offer.expires_at && new Date(offer.expires_at) < new Date()) {
    await WaitlistOffer.markExpired(offer.id);
    return { error: 'This offer has expired', status: 410 };
  }
  // Notified offers must still be inside the window; un-notified claims are
  // allowed only if the volunteer somehow has the token (e.g. staff pasted it).
  if (offer.notified_at && offer.expires_at && new Date(offer.expires_at) < new Date()) {
    await WaitlistOffer.markExpired(offer.id);
    return { error: 'This offer has expired', status: 410 };
  }

  const opportunity = await Opportunity.findById(offer.opportunity_id);
  if (!opportunity) {
    return { error: 'Opportunity not found', status: 404 };
  }

  const eligibility = await isEligibleForWaitlistOffer(userId, opportunity);
  if (!eligibility.ok) {
    return { error: 'You are no longer eligible for this shift', status: 400, reason: eligibility.reason };
  }

  let targetStatus = 'pending';
  let confirmed = false;
  try {
    const mode = await BookingPolicy.getMode();
    if (mode === 'instant') {
      const trusted = await BookingPolicy.isTrusted(userId);
      const eligible = trusted ? await stillEligibleForConfirm(userId, opportunity) : false;
      targetStatus = bookingPolicy.promotionStatus({ mode, trusted, eligible });
    }
  } catch (policyError) {
    console.error('[waitlistOffers] claim policy error:', policyError.message);
    targetStatus = 'pending';
  }

  let application = null;
  if (targetStatus === 'accepted') {
    const claimed = await Application.claimSeat(
      offer.application_id,
      offer.opportunity_id,
      'waitlisted'
    );
    if (claimed !== 'accepted') {
      return { error: 'That place was just taken', status: 409 };
    }
    confirmed = true;
    application = await Application.findById(offer.application_id);
  } else {
    application = await Application.updateStatus(offer.application_id, 'pending');
  }

  const marked = await WaitlistOffer.markClaimed(offer.id);
  if (!marked) {
    return { error: 'Offer could not be claimed', status: 409 };
  }

  if (opportunity.status === 'closed') {
    const maxVolunteers = Number(opportunity.max_volunteers);
    const capacity = await Opportunity.getCurrentCapacity(offer.opportunity_id);
    if (!Number.isFinite(maxVolunteers) || maxVolunteers <= 0 || capacity < maxVolunteers) {
      await Opportunity.updateStatus(offer.opportunity_id, 'open');
    }
  }

  // If more seats remain, start the next offer.
  if (await hasFreeSeat(offer.opportunity_id)) {
    try {
      await offerNextWaitlisted(offer.opportunity_id);
    } catch (nextError) {
      console.error('[waitlistOffers] next offer after claim failed:', nextError.message);
    }
  }

  return {
    application,
    confirmed,
    status: confirmed ? 'accepted' : 'pending',
    message: confirmed
      ? 'Place claimed. You are booked on this shift.'
      : 'Place claimed. Staff will confirm your booking.',
  };
}

/**
 * Expire overdue offers and cascade to the next eligible volunteer.
 */
async function expireAndCascade(now = new Date()) {
  const expired = await WaitlistOffer.findExpiredOffers(now);
  let cascaded = 0;
  for (const offer of expired) {
    const claimed = await claimJobRun(
      'waitlistOfferExpire',
      `offer:${offer.id}:expire:${String(offer.expires_at).slice(0, 16)}`
    );
    if (!claimed) continue;
    const ok = await WaitlistOffer.markExpired(offer.id);
    if (!ok) continue;
    // Offer the next person in line, not the volunteer who just timed out.
    const next = await offerNextWaitlisted(offer.opportunity_id, {
      now,
      skipApplicationIds: [offer.application_id],
    });
    if (next) cascaded += 1;
  }
  return { expired: expired.length, cascaded };
}

async function notifyPending(now = new Date()) {
  const awaiting = await WaitlistOffer.findAwaitingNotify();
  let sent = 0;
  let skippedQuiet = 0;
  for (const offer of awaiting) {
    const result = await tryNotifyOffer(offer, now);
    if (result.reason === 'quiet_hours') skippedQuiet += 1;
    else if (result.notified) sent += 1;
  }
  return { sent, skippedQuiet, candidates: awaiting.length };
}

async function catchUpOpenSeats(now = new Date()) {
  const needing = await WaitlistOffer.findOpportunitiesNeedingOffer();
  let created = 0;
  for (const row of needing) {
    const offer = await offerNextWaitlisted(row.opportunity_id, { now });
    if (offer) created += 1;
  }
  return { created, candidates: needing.length };
}

module.exports = {
  claimPath,
  claimLink,
  offerNextWaitlisted,
  fillFromWaitlist,
  tryNotifyOffer,
  claimOfferByToken,
  expireAndCascade,
  notifyPending,
  catchUpOpenSeats,
  hasFreeSeat,
};
