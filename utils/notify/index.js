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
 * Each send returns a result per channel so callers can log and decide what
 * counts as delivered. A failure on one channel never stops the others.
 *
 * Modules are looked up when each send runs, so tests can stub them.
 */

const { isEmailConfigured } = require('../emailConfig');
const { buildReminderPayload, buildUrgentPayload } = require('../pushPayloads');
const { getSmsProvider } = require('./smsProvider');

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

/**
 * One shift reminder to one volunteer.
 *
 * @param {object} app row from Application.findAcceptedNeedingReminder
 * @param {object} details { title, date, time, location } for the email
 * @returns {{ email, push, sms, delivered: boolean }}
 */
async function notifyShiftReminder(app, details = {}) {
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
 * @param {object} args
 * @param {Array<{ user_id, email, first_name }>} args.recipients
 * @param {object} args.opportunity { id, title, location }
 * @param {string} args.subject push title, matches the email subject
 * @param {string} args.whenLabel
 * @returns {{ email, push, sms }}
 */
async function notifyUrgentCover({ recipients = [], opportunity = {}, subject, whenLabel } = {}) {
  const email = emptyResult();
  const mailer = emailService();
  for (const recipient of recipients) {
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

  const userIds = recipients.map((r) => r.user_id);
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
  const sms = await sendSms(recipients);
  return { email, push, sms };
}

module.exports = {
  CHANNELS,
  channelStatus,
  notifyShiftReminder,
  notifyUrgentCover,
};
