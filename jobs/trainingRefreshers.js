'use strict';

const Qualification = require('../models/Qualification');
const { recordJobRun, claimJobRun } = require('../utils/jobLog');
const { formatShelterDate } = require('../utils/shelterTime');
const { isEmailConfigured } = require('../utils/emailConfig');
const { notifyTrainingRefresher } = require('../utils/notify');
const { rowInQuietHours } = require('../utils/quietHours');

const JOB_NAME = 'trainingRefreshers';
const WARN_DAYS = 14;

/**
 * Email + push 14 days before training-awarded qualifications expire.
 * Quiet hours delay the send; job_runs.run_key claims prevent duplicate
 * sends across replicas. Expired awards already block shift eligibility.
 */
async function runTrainingRefreshers(now = new Date()) {
  if (!isEmailConfigured()) {
    console.warn(`[Job:${JOB_NAME}] email not configured: sending push only`);
  }

  const due = await Qualification.findNeedingTrainingRefresher(now);
  let sent = 0;
  let failed = 0;
  let pushSent = 0;
  let skippedQuiet = 0;
  let skippedClaim = 0;

  for (const row of due) {
    try {
      if (rowInQuietHours(row, now)) {
        skippedQuiet += 1;
        continue;
      }

      const expiresDay = Qualification.toDateOnly(row.expires_at);
      const claimed = await claimJobRun(
        'trainingRefresherSend',
        `vq:${row.volunteer_qualification_id}:${expiresDay}`
      );
      if (!claimed) {
        skippedClaim += 1;
        continue;
      }

      const result = await notifyTrainingRefresher(
        row,
        {
          qualificationName: row.qualification_name,
          expiresAt: formatShelterDate(row.expires_at),
          warnDays: WARN_DAYS,
        },
        { now }
      );

      pushSent += result.push.sent;
      if (result.skipReason === 'quiet_hours') {
        skippedQuiet += 1;
        continue;
      }
      if (result.skipReason === 'prefer_reminders_off') {
        continue;
      }
      if (result.email.reason === 'missing_email' && result.push.sent === 0) {
        failed += 1;
        continue;
      }
      if (!result.delivered) continue;

      const marked = await Qualification.markExpiryNotified(
        row.volunteer_qualification_id,
        Qualification.toDateOnly(now)
      );
      if (marked) sent += 1;
    } catch (error) {
      failed += 1;
      console.error(
        '[Job:trainingRefreshers] failed for',
        row.volunteer_qualification_id,
        error.message
      );
    }
  }

  const detail =
    `sent=${sent};failed=${failed};candidates=${due.length};pushSent=${pushSent}` +
    `;skippedQuiet=${skippedQuiet};skippedClaim=${skippedClaim}`;
  try {
    await recordJobRun(JOB_NAME, failed && !sent ? 'error' : 'ok', detail);
  } catch (logError) {
    console.error('[Job:trainingRefreshers] job_runs log failed:', logError.message);
  }

  return detail;
}

module.exports = {
  JOB_NAME,
  WARN_DAYS,
  runTrainingRefreshers,
};
