'use strict';

const Tag = require('../models/Tag');
const { sendOpportunityMatchDigest } = require('../utils/emailService');
const { recordJobRun } = require('../utils/jobLog');

const JOB_NAME = 'opportunityMatchDigest';

function formatDate(value) {
  if (!value) return 'TBA';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString();
}

/**
 * Send pending match digests (max one per volunteer per day).
 * @param {object} [options]
 * @param {Date} [options.now]
 * @param {number|null} [options.maxUsers] Cap recipients (inline fallback uses 200).
 */
async function runOpportunityMatchDigest(options = {}) {
  const now = options.now || new Date();
  const maxUsers =
    typeof options.maxUsers === 'number' ? options.maxUsers : null;

  const digests = await Tag.findPendingDigests(now, { maxUsers });
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const digest of digests) {
    try {
      if (!digest.email || !digest.opportunities.length) {
        skipped += 1;
        continue;
      }

      // Defence in depth: skip if already logged today.
      if (await Tag.hasDigestBeenSent(digest.user_id, now)) {
        skipped += 1;
        continue;
      }

      await sendOpportunityMatchDigest(digest.email, {
        name: digest.first_name || 'Volunteer',
        opportunities: digest.opportunities.map((o) => ({
          title: o.title,
          when: formatDate(o.start_date),
          location: o.location || 'TBA',
        })),
      });

      await Tag.markDigestSent(digest.user_id, now);
      await Tag.clearQueueIds(digest.queue_ids);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(
        '[Job:opportunityMatchDigest] failed for user',
        digest.user_id,
        error.message
      );
    }
  }

  const detail = `sent=${sent};skipped=${skipped};failed=${failed};candidates=${digests.length}`;
  try {
    await recordJobRun(JOB_NAME, failed && !sent ? 'error' : 'ok', detail);
  } catch (logError) {
    console.error('[Job:opportunityMatchDigest] job_runs log failed:', logError.message);
  }

  return { sent, skipped, failed, detail };
}

/**
 * After opportunity create: queue matching volunteers, then either leave for
 * the scheduler or send inline (capped at 200) when the scheduler is not running.
 */
async function notifyOnOpportunityCreate(opportunityIds = []) {
  const queued = await Tag.queueMatchNotifications(opportunityIds);
  if (!queued) {
    return { queued: 0, mode: 'none' };
  }

  let scheduler;
  try {
    scheduler = require('../utils/scheduler');
  } catch {
    scheduler = null;
  }

  const batchAvailable =
    scheduler &&
    typeof scheduler.isStarted === 'function' &&
    scheduler.isStarted() &&
    typeof scheduler.listJobs === 'function' &&
    scheduler.listJobs().includes(JOB_NAME);

  if (batchAvailable) {
    return { queued, mode: 'scheduled' };
  }

  const result = await runOpportunityMatchDigest({
    maxUsers: Tag.INLINE_DIGEST_CAP,
  });
  return { queued, mode: 'inline', ...result };
}

module.exports = {
  JOB_NAME,
  runOpportunityMatchDigest,
  notifyOnOpportunityCreate,
};
