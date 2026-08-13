'use strict';

const scheduler = require('../utils/scheduler');
const { runShiftReminders } = require('./shiftReminders');
const { runQualificationExpiry } = require('./qualificationExpiry');
const { runOpportunityMatchDigest } = require('./opportunityMatchDigest');
const { runSwapWaitlistExpiry } = require('./swapWaitlistExpiry');
const { runDataRetentionJob } = require('./dataRetention');
const { runFeedbackRequests } = require('./feedbackRequests');

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
  // Daily: email post-shift feedback links for opportunities from yesterday.
  scheduler.registerJob('feedbackRequests', '30 8 * * *', () => runFeedbackRequests());
  // Daily: anonymise volunteer accounts inactive beyond DATA_RETENTION_YEARS (default 3).
  scheduler.registerJob('dataRetention', '30 3 * * *', () => runDataRetentionJob());
}

module.exports = {
  registerAllJobs,
};
