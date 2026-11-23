'use strict';

const Application = require('../models/Application');
const { recordJobRun } = require('../utils/jobLog');
const { formatShelterDate, formatShelterTime } = require('../utils/shelterTime');
const { isEmailConfigured } = require('../utils/emailConfig');
const { notifyShiftReminder } = require('../utils/notify');

const JOB_NAME = 'shiftReminders';

async function runShiftReminders(now = new Date()) {
  // Push still works without email, so only the email part is skipped here.
  if (!isEmailConfigured()) console.warn(`[Job:${JOB_NAME}] email not configured: sending push only`);
  const due = await Application.findAcceptedNeedingReminder(now);
  let sent = 0;
  let failed = 0;
  let pushSent = 0;

  for (const app of due) {
    try {
      const result = await notifyShiftReminder(app, {
        title: app.opportunity_title,
        date: formatShelterDate(app.opportunity_start_date),
        time: formatShelterTime(app.opportunity_start_date),
        location: app.opportunity_location,
      });
      pushSent += result.push.sent;
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

  const detail = `sent=${sent};failed=${failed};candidates=${due.length};pushSent=${pushSent}`;
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
