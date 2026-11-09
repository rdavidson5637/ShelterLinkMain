'use strict';

/**
 * Sends a shelter invite email and reports what happened, without throwing.
 *
 * Approving a shelter must not fail because email is down: the shelter and
 * its invite already exist when this runs. So the caller gets
 * { sent: true } or { sent: false, reason } and shows that to the platform
 * owner, who can resend once email works.
 *
 * The raw token only ever appears inside the link in the email body. It is
 * not logged, not returned to the browser, and not stored.
 */

const { isEmailConfigured } = require('../utils/emailConfig');
const { productionResetBaseUrl } = require('../utils/resetToken');

const REASONS = {
  emailNotConfigured: 'email_not_configured',
  appUrlMissing: 'app_url_missing',
  sendFailed: 'send_failed',
};

/** Base URL for links in emails, or null when it is unsafe in production. */
function inviteBaseUrl() {
  return productionResetBaseUrl();
}

/**
 * The token goes in the #fragment: browsers never send a fragment to the
 * server, so it is not written to access logs or sent on in a Referer.
 */
function inviteLink(baseUrl, token) {
  return `${String(baseUrl).replace(/\/$/, '')}/invite#${encodeURIComponent(token)}`;
}

/**
 * Why an invite email cannot go out right now, or null when it can.
 * Checked before a resend so a resend never expires a working link for
 * nothing.
 */
function inviteDeliveryBlocker() {
  if (!isEmailConfigured()) return REASONS.emailNotConfigured;
  if (!inviteBaseUrl()) return REASONS.appUrlMissing;
  return null;
}

async function deliverInvite({ email, token, shelterName, role = 'admin', expiresInDays = 7 } = {}) {
  const blocker = inviteDeliveryBlocker();
  if (blocker) return { sent: false, reason: blocker };
  try {
    // Required here, not at the top, so tests can swap the email module.
    const { sendShelterInvite } = require('../utils/emailService');
    await sendShelterInvite(email, {
      shelterName,
      link: inviteLink(inviteBaseUrl(), token),
      role,
      expiresInDays,
    });
    return { sent: true };
  } catch (error) {
    console.error('[Invite] email failed:', error && error.message ? error.message : 'unknown error');
    return { sent: false, reason: REASONS.sendFailed };
  }
}

module.exports = {
  deliverInvite,
  inviteDeliveryBlocker,
  inviteLink,
  REASONS,
};
