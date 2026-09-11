'use strict';

const scheduler = require('../utils/scheduler');
const { runShiftReminders } = require('./shiftReminders');
const { runQualificationExpiry } = require('./qualificationExpiry');
const { runOpportunityMatchDigest } = require('./opportunityMatchDigest');
const { runSwapWaitlistExpiry } = require('./swapWaitlistExpiry');
const { runDataRetentionJob } = require('./dataRetention');
const { runFeedbackRequests } = require('./feedbackRequests');
const { runDbKeepAlive } = require('./dbKeepAlive');
const { runMessageDigest } = require('./messageDigest');
const { runBackgroundCheckExpiry } = require('./backgroundCheckExpiry');
const { runWeeklyDigest } = require('./weeklyDigest');

/**
 * Register all scheduled jobs. Importing this module must be safe under test
 * (no timers started — server.js calls scheduler.start()).
 */
function registerAllJobs() {
  // Hourly: remind volunteers of accepted shifts starting within 24 hours.
  scheduler.registerJob('shiftReminders', '0 * * * *', () => runShiftReminders());
  // Daily: qualification expiry warnings (30 days) and day-of notices.
  scheduler.registerJob('qualificationExpiry', '0 8 * * *', () => runQualificationExpiry());
  // Hourly: send queued new-opportunity match digests (max one per volunteer/day).
  scheduler.registerJob('opportunityMatchDigest', '15 * * * *', () =>
    runOpportunityMatchDigest()
  );
  // Hourly: publish swap offers after the waitlist exclusive window.
  scheduler.registerJob('swapWaitlistExpiry', '20 * * * *', () => runSwapWaitlistExpiry());
  // Hourly: unread thread digests (messages older than 15 min; max one email/hour/user).
  scheduler.registerJob('messageDigest', '25 * * * *', () => runMessageDigest());
  // Daily: email post-shift feedback links for opportunities from yesterday.
  scheduler.registerJob('feedbackRequests', '30 8 * * *', () => runFeedbackRequests());
  // Daily: expire AccessNI checks / reference tokens; warn staff 60 days out.
  scheduler.registerJob('backgroundCheckExpiry', '0 7 * * *', () => runBackgroundCheckExpiry());
  // Monday 07:00: weekly volunteer digest (shifts, open matches, fosters, unread).
  scheduler.registerJob('weeklyDigest', '0 7 * * 1', () => runWeeklyDigest());
  // Daily: anonymise volunteer accounts inactive beyond DATA_RETENTION_YEARS (default 3).
  scheduler.registerJob('dataRetention', '30 3 * * *', () => runDataRetentionJob());
  // Daily: keep a paused-after-inactivity Supabase project awake (app host must be always-on).
  scheduler.registerJob('dbKeepAlive', '0 6 * * *', () => runDbKeepAlive());
}

module.exports = {
  registerAllJobs,
};
