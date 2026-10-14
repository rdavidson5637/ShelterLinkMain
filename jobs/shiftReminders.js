'use strict';

const Application = require('../models/Application');
const { sendShiftReminder } = require('../utils/emailService');
const { recordJobRun } = require('../utils/jobLog');
const { formatShelterDate, formatShelterTime } = require('../utils/shelterTime');
const { buildReminderPayload } = require('../utils/pushPayloads');
const pushService = require('../utils/pushService');

const JOB_NAME = 'shiftReminders';

async function runShiftReminders(now = new Date()) {
  const due = await Application.findAcceptedNeedingReminder(now);
  let sent = 0;
  let failed = 0;

  for (const app of due) {
    try {
      if (!app.email) {
        failed += 1;
        continue;
      }
      await sendShiftReminder(app.email, {
        title: app.opportunity_title,
        date: formatShelterDate(app.opportunity_start_date),
        time: formatShelterTime(app.opportunity_start_date),
        location: app.opportunity_location,
      });
      let pushSent = 0;
      try {
        const pushResult = await pushService.sendToUsers(
          [app.user_id],
          buildReminderPayload(app),
          { category: 'reminders' }
        );
        pushSent = Number(pushResult.sent) || 0;
      } catch (pushError) {
        console.error('[Job:shiftReminders] push failed:', pushError.message);
      }
      const marked = await Application.markReminderSent(app.application_id, now);
      if (marked) sent += 1;
      app._pushSent = pushSent;
    } catch (error) {
      failed += 1;
      console.error('[Job:shiftReminders] failed for application', app.application_id, error.message);
    }
  }

  const pushSent = due.reduce((sum, app) => sum + (Number(app._pushSent) || 0), 0);
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
