'use strict';

const { recordJobRun, claimJobRun } = require('../utils/jobLog');
const { nowLocalSql } = require('../utils/shelterTime');
const {
  notifyPending,
  expireAndCascade,
  catchUpOpenSeats,
} = require('../utils/waitlistOffers');

const JOB_NAME = 'waitlistOffers';

/**
 * Timed waitlist offers (SL-LATER-23): notify after quiet hours, expire
 * unclaimed offers and cascade to the next eligible volunteer, and catch up
 * free seats that have no active offer.
 */
async function runWaitlistOffers(now = new Date()) {
  // Minute precision so the 15-minute cron can claim each tick.
  const tickKey = nowLocalSql(now).slice(0, 16).replace(' ', '-');
  const claimed = await claimJobRun(JOB_NAME, `tick:${tickKey}`);
  if (!claimed) {
    return 'skipped=replica_claim';
  }

  let notify = { sent: 0, skippedQuiet: 0, candidates: 0 };
  let expired = { expired: 0, cascaded: 0 };
  let catchUp = { created: 0, candidates: 0 };
  let failed = 0;

  try {
    notify = await notifyPending(now);
  } catch (error) {
    failed += 1;
    console.error('[Job:waitlistOffers] notify failed:', error.message);
  }

  try {
    expired = await expireAndCascade(now);
  } catch (error) {
    failed += 1;
    console.error('[Job:waitlistOffers] expire failed:', error.message);
  }

  try {
    catchUp = await catchUpOpenSeats(now);
  } catch (error) {
    failed += 1;
    console.error('[Job:waitlistOffers] catch-up failed:', error.message);
  }

  const detail =
    `notified=${notify.sent};skippedQuiet=${notify.skippedQuiet}` +
    `;expired=${expired.expired};cascaded=${expired.cascaded}` +
    `;catchUp=${catchUp.created};failed=${failed}`;

  try {
    await recordJobRun(JOB_NAME, failed ? 'error' : 'ok', detail);
  } catch (logError) {
    console.error('[Job:waitlistOffers] job_runs log failed:', logError.message);
  }

  return detail;
}

module.exports = {
  JOB_NAME,
  runWaitlistOffers,
};
