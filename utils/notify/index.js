'use strict';

/**
 * Notification framework for shift reminders and urgent cover.
 *
 * Channels:
 *   email: SMTP through utils/emailService.js, when EMAIL_HOST and a from
 *          address are set.
 *   push:  Web Push through utils/pushService.js, when VAPID keys are set.
 *          Volunteer preferences (prefer_reminders, prefer_urgent) apply.
 *   sms:   switched off. See ./smsProvider.js. It is never called with a
 *          phone number, and always reports "skipped".
 *
 * Preference and quiet-hours gates (SL-LATER-16) run here so email and push
 * stay in step. Callers should also filter candidates in SQL where possible.
 *
 * Each send returns a result per channel so callers can log and decide what
 * counts as delivered. A failure on one channel never stops the others.
 *
 * Modules are looked up when each send runs, so tests can stub them.
 */

const { isEmailConfigured } = require('../emailConfig');
const {
  buildReminderPayload,
  buildUrgentPayload,
  buildWaitlistOfferPayload,
} = require('../pushPayloads');
const { getSmsProvider } = require('./smsProvider');
const { rowInQuietHours } = require('../quietHours');

const CHANNELS = Object.freeze(['email', 'push', 'sms']);

function emailService() {
  // eslint-disable-next-line global-require
  return require('../emailService');
}

function pushService() {
  // eslint-disable-next-line global-require
  return require('../pushService');
}

function emptyResult(extra = {}) {
  return { sent: 0, failed: 0, skipped: 0, ...extra };
}

function channelStatus() {
  const sms = getSmsProvider();
  return {
    email: isEmailConfigured(),
    push: Boolean(pushService().isConfigured()),
    sms: Boolean(sms.isEnabled()),
  };
}

function prefOn(row, column, defaultOn = true) {
  if (!row || row[column] == null) return defaultOn;
  return Number(row[column]) === 1;
}

async function sendPush(userIds, payload, category) {
  try {
    const result = await pushService().sendToUsers(userIds, payload, { category });
    return {
      sent: Number(result && result.sent) || 0,
      failed: Number(result && result.failed) || 0,
      skipped: Number(result && result.skipped) || 0,
      configured: Boolean(result && result.configured),
    };
  } catch (error) {
    console.error(`[notify] ${category} push failed:`, error.message);
    return emptyResult({ failed: userIds.length, configured: true, error: true });
  }
}

/**
 * SMS stays off. The provider is asked, but phone numbers are never looked up
 * or passed to it while it reports disabled, and no enabled provider exists.
 */
async function sendSms(recipients) {
  const provider = getSmsProvider();
  const count = Array.isArray(recipients) ? recipients.length : 0;
  return emptyResult({ skipped: count, enabled: Boolean(provider.isEnabled()), provider: provider.name });
}

function skipAllChannels(reason, recipientCount = 1) {
  return {
    email: emptyResult({ skipped: recipientCount, reason }),
    push: emptyResult({ skipped: recipientCount, reason }),
    sms: emptyResult({ skipped: recipientCount, reason: 'sms_disabled', provider: getSmsProvider().name }),
    delivered: false,
    skipped: true,
    skipReason: reason,
  };
}

/**
 * One shift reminder to one volunteer.
 *
 * @param {object} app row from Application.findAcceptedNeedingReminder
 * @param {object} details { title, date, time, location } for the email
 * @param {object} [options]
 * @param {Date} [options.now]
 * @returns {{ email, push, sms, delivered: boolean, skipped?: boolean, skipReason?: string }}
 */
async function notifyShiftReminder(app, details = {}, options = {}) {
  const now = options.now || new Date();
  if (!prefOn(app, 'prefer_reminders', true)) {
    return skipAllChannels('prefer_reminders_off');
  }
  if (rowInQuietHours(app, now)) {
    return skipAllChannels('quiet_hours');
  }

  const emailOn = isEmailConfigured();
  const result = {
    email: emptyResult({ configured: emailOn }),
    push: emptyResult(),
    sms: emptyResult(),
    delivered: false,
  };

  if (emailOn) {
    if (!app.email) {
      result.email.failed = 1;
      result.email.reason = 'missing_email';
      return result;
    }
    // Errors from email reach the caller, which counts the reminder as failed.
    await emailService().sendShiftReminder(app.email, details);
    result.email.sent = 1;
  } else {
    result.email.skipped = 1;
  }

  result.push = await sendPush([app.user_id], buildReminderPayload(app), 'reminders');
  result.sms = await sendSms([app.user_id]);
  result.delivered = result.email.sent > 0 || result.push.sent > 0;
  return result;
}

/**
 * Urgent cover to every resolved recipient.
 *
 * Recipients should already be preference-, age-, and quiet-hours-filtered.
 * Quiet hours and prefer_urgent are checked again so a direct caller cannot
 * bypass them.
 *
 * @param {object} args
 * @param {Array<{ user_id, email, first_name, prefer_urgent?, quiet_hours_start?, quiet_hours_end? }>} args.recipients
 * @param {object} args.opportunity { id, title, location }
 * @param {string} args.subject push title, matches the email subject
 * @param {string} args.whenLabel
 * @param {Date} [args.now]
 * @returns {{ email, push, sms, skippedQuiet: number, skippedPref: number }}
 */
async function notifyUrgentCover({
  recipients = [],
  opportunity = {},
  subject,
  whenLabel,
  now = new Date(),
} = {}) {
  const email = emptyResult();
  let skippedQuiet = 0;
  let skippedPref = 0;
  const mailer = emailService();
  const active = [];

  for (const recipient of recipients) {
    if (!prefOn(recipient, 'prefer_urgent', true)) {
      skippedPref += 1;
      continue;
    }
    if (rowInQuietHours(recipient, now)) {
      skippedQuiet += 1;
      continue;
    }
    active.push(recipient);
    try {
      await mailer.sendUrgentCover(recipient.email, {
        firstName: recipient.first_name,
        opportunityTitle: opportunity.title,
        whenLabel,
        location: opportunity.location,
      });
      email.sent += 1;
    } catch (emailError) {
      email.failed += 1;
      console.error('[notify] urgent email failed:', emailError.message);
    }
  }

  const userIds = active.map((r) => r.user_id);
  let push = { sent: 0, skipped: 0, failed: 0, configured: false };
  if (userIds.length) {
    push = await sendPush(
      userIds,
      buildUrgentPayload({
        title: subject,
        whenLabel,
        location: opportunity.location,
        opportunityId: Number(opportunity.id) || undefined,
      }),
      'urgent'
    );
  }
  const sms = await sendSms(active);
  return { email, push, sms, skippedQuiet, skippedPref };
}

/**
 * Timed waitlist seat offer (SL-LATER-23). Quiet hours delay the send; the
 * claim clock starts only when this returns delivered. No preference gate:
 * the volunteer asked to be on the waitlist.
 *
 * @param {object} recipient { user_id, email, quiet_hours_start?, quiet_hours_end? }
 * @param {object} details { title, claimLink, hours, offer_id? }
 * @param {object} [options]
 * @param {Date} [options.now]
 */
async function notifyWaitlistSeatOffer(recipient, details = {}, options = {}) {
  const now = options.now || new Date();
  if (rowInQuietHours(recipient, now)) {
    return skipAllChannels('quiet_hours');
  }

  const emailOn = isEmailConfigured();
  const result = {
    email: emptyResult({ configured: emailOn }),
    push: emptyResult(),
    sms: emptyResult(),
    delivered: false,
  };

  if (emailOn) {
    if (!recipient.email) {
      result.email.failed = 1;
      result.email.reason = 'missing_email';
    } else {
      await emailService().sendWaitlistSeatOffer(recipient.email, {
        title: details.title,
        claimLink: details.claimLink,
        hours: details.hours,
      });
      result.email.sent = 1;
    }
  } else {
    result.email.skipped = 1;
  }

  result.push = await sendPush(
    [recipient.user_id],
    buildWaitlistOfferPayload({
      opportunity_title: details.title,
      hours: details.hours,
      claimUrl: details.claimPath || details.claimLink,
      offer_id: details.offer_id,
    }),
    'waitlist'
  );
  result.sms = await sendSms([recipient.user_id]);
  result.delivered = result.email.sent > 0 || result.push.sent > 0;
  // Push-only when email is off still counts as delivered.
  if (!emailOn && result.push.sent > 0) result.delivered = true;
  // If email is configured but missing, and push also failed, not delivered.
  if (emailOn && result.email.reason === 'missing_email' && result.push.sent === 0) {
    result.delivered = false;
  }
  return result;
}

module.exports = {
  CHANNELS,
  channelStatus,
  notifyShiftReminder,
  notifyUrgentCover,
  notifyWaitlistSeatOffer,
};
