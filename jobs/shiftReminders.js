'use strict';

const Application = require('../models/Application');
const { sendShiftReminder } = require('../utils/emailService');
const { recordJobRun } = require('../utils/jobLog');

const JOB_NAME = 'shiftReminders';

function formatDate(value) {
  if (!value) return 'TBA';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString();
}

function formatTime(value) {
  if (!value) return '';
  const raw = String(value);
  if (/T\d{2}:\d{2}/.test(raw) || /\s\d{2}:\d{2}/.test(raw)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  return '';
}

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
        date: formatDate(app.opportunity_start_date),
        time: formatTime(app.opportunity_start_date),
        location: app.opportunity_location,
      });
      const marked = await Application.markReminderSent(app.application_id, now);
      if (marked) sent += 1;
    } catch (error) {
      failed += 1;
      console.error('[Job:shiftReminders] failed for application', app.application_id, error.message);
    }
  }

  const detail = `sent=${sent};failed=${failed};candidates=${due.length}`;
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
