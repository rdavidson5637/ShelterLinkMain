'use strict';

const MessageThread = require('../models/MessageThread');
const { sendThreadDigest } = require('../utils/emailService');
const { recordJobRun } = require('../utils/jobLog');

const JOB_NAME = 'messageDigest';

/**
 * Email digests for unread messages older than 15 minutes.
 * At most one email per user per clock-hour; respects muted; skips own messages.
 */
async function runMessageDigest(options = {}) {
  const now = options.now || new Date();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  let candidates = [];
  try {
    candidates = await MessageThread.findDigestCandidates(now);
  } catch (error) {
    console.error('[Job:messageDigest] candidate query failed:', error.message);
    try {
      await recordJobRun(JOB_NAME, 'error', `query_failed:${error.message}`);
    } catch (_) {
      /* ignore */
    }
    return { sent: 0, skipped: 0, failed: 1, detail: error.message };
  }

  for (const candidate of candidates) {
    try {
      if (!candidate.email) {
        skipped += 1;
        continue;
      }
      await sendThreadDigest(candidate.email, {
        name: candidate.first_name || 'there',
        unreadCount: Number(candidate.unread_count) || 1,
      });
      await MessageThread.markDigestSent(candidate.user_id, now);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(
        '[Job:messageDigest] failed for user',
        candidate.user_id,
        error.message
      );
    }
  }

  const detail = `sent=${sent};skipped=${skipped};failed=${failed};candidates=${candidates.length}`;
  try {
    await recordJobRun(JOB_NAME, failed && !sent ? 'error' : 'ok', detail);
  } catch (logError) {
    console.error('[Job:messageDigest] job_runs log failed:', logError.message);
  }

  return { sent, skipped, failed, detail };
}

module.exports = {
  JOB_NAME,
  runMessageDigest,
};
