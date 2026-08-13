'use strict';

const ShiftFeedback = require('../models/ShiftFeedback');
const { createFeedbackToken } = require('../utils/feedbackToken');
const { sendFeedbackRequest } = require('../utils/emailService');
const { recordJobRun } = require('../utils/jobLog');

const JOB_NAME = 'feedbackRequests';

function appBaseUrl() {
  return process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
}

function formatDate(value) {
  if (!value) return 'TBA';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString();
}

async function runFeedbackRequests(now = new Date()) {
  const due = await ShiftFeedback.findAcceptedNeedingFeedbackRequest(now);
  let sent = 0;
  let failed = 0;

  for (const app of due) {
    try {
      if (!app.email) {
        failed += 1;
        continue;
      }
      const token = createFeedbackToken(app.application_id);
      const feedbackLink = `${appBaseUrl()}/pages/feedback.html?token=${encodeURIComponent(token)}`;
      await sendFeedbackRequest(app.email, {
        name: app.first_name || app.name || 'there',
        title: app.opportunity_title,
        date: formatDate(app.opportunity_start_date),
        feedbackLink,
      });
      const marked = await ShiftFeedback.markFeedbackRequested(app.application_id, now);
      if (marked) sent += 1;
    } catch (error) {
      failed += 1;
      console.error(
        '[Job:feedbackRequests] failed for application',
        app.application_id,
        error.message
      );
    }
  }

  const detail = `sent=${sent};failed=${failed};candidates=${due.length}`;
  try {
    await recordJobRun(JOB_NAME, failed && !sent ? 'error' : 'ok', detail);
  } catch (logError) {
    console.error('[Job:feedbackRequests] job_runs log failed:', logError.message);
  }

  return detail;
}

module.exports = {
  JOB_NAME,
  runFeedbackRequests,
};
