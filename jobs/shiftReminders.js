'use strict';

const Application = require('../models/Application');
const { recordJobRun, claimJobRun } = require('../utils/jobLog');
const { formatShelterDate, formatShelterTime, nowLocalSql } = require('../utils/shelterTime');
const { isEmailConfigured } = require('../utils/emailConfig');
const { notifyShiftReminder } = require('../utils/notify');
const { rowInQuietHours } = require('../utils/quietHours');

const JOB_NAME = 'shiftReminders';

/**
 * Day-before shift reminders (email + push). The scheduler claims each cron
 * minute in job_runs.run_key; this job also claims per application for the
 * current hour so two replicas never double-send the same reminder.
 */
async function runShiftReminders(now = new Date()) {
  // Push still works without email, so only the email part is skipped here.
  if (!isEmailConfigured()) console.warn(`[Job:${JOB_NAME}] email not configured: sending push only`);
  const due = await Application.findAcceptedNeedingReminder(now);
  let sent = 0;
  let failed = 0;
  let pushSent = 0;
  let skippedQuiet = 0;
  let skippedClaim = 0;

  const hourKey = nowLocalSql(now).slice(0, 13).replace(' ', '-');

  for (const app of due) {
    try {
      if (rowInQuietHours(app, now)) {
        skippedQuiet += 1;
        continue;
      }

      const claimed = await claimJobRun(
        'shiftReminderSend',
        `app:${app.application_id}:${hourKey}`
      );
      if (!claimed) {
        skippedClaim += 1;
        continue;
      }

      const result = await notifyShiftReminder(
        app,
        {
          title: app.opportunity_title,
          date: formatShelterDate(app.opportunity_start_date),
          time: formatShelterTime(app.opportunity_start_date),
          location: app.opportunity_location,
        },
        { now }
      );
      pushSent += result.push.sent;
      if (result.skipReason === 'quiet_hours') {
        skippedQuiet += 1;
        continue;
      }
      if (result.email.reason === 'missing_email') {
        failed += 1;
        continue;
      }
      // Only mark the reminder sent if email or push actually went out.
      if (!result.delivered) continue;
      const marked = await Application.markReminderSent(app.application_id, now);
      if (marked) sent += 1;
    } catch (error) {
      failed += 1;
      console.error('[Job:shiftReminders] failed for application', app.application_id, error.message);
    }
  }

  const detail =
    `sent=${sent};failed=${failed};candidates=${due.length};pushSent=${pushSent}` +
    `;skippedQuiet=${skippedQuiet};skippedClaim=${skippedClaim}`;
  try {
    await recordJobRun(JOB_NAME, failed && !sent ? 'error' : 'ok', detail);
  } catch (logError) {
    console.error('[Job:shiftReminders] job_runs log failed:', logError.message);
  }

  return detail;
}

module.exports = {
  JOB_NAME,
  runShiftReminders,
};
