'use strict';

/**
 * Email configuration check, kept separate from emailService.js so jobs can
 * test it without loading nodemailer. Reads process.env on every call.
 *
 * Configured means: an SMTP host plus a from address (EMAIL_FROM, or EMAIL_USER
 * as sendEmail already falls back to). EMAIL_USER/EMAIL_PASS are optional
 * because some relays accept unauthenticated mail.
 */
function isBlank(value) {
  return !value || typeof value !== 'string' || !value.trim();
}

function isEmailConfigured(env = process.env) {
  if (isBlank(env.EMAIL_HOST)) return false;
  return !(isBlank(env.EMAIL_FROM) && isBlank(env.EMAIL_USER));
}

/**
 * For jobs that only send email. Logs ONE line, records the run, and returns
 * a result the caller can return straight away. Returns null when email is
 * configured and the job should carry on.
 *
 * recordJobRun only stores 'ok' or 'error', so a skip is stored as 'ok' with a
 * "skipped:email_not_configured" detail.
 */
async function skipJobIfEmailUnconfigured(jobName, recordJobRun) {
  if (isEmailConfigured()) return null;
  console.warn(`[Job:${jobName}] skipped: email not configured`);
  try {
    await recordJobRun(jobName, 'ok', 'skipped:email_not_configured');
  } catch (logError) {
    console.error(`[Job:${jobName}] job_runs log failed:`, logError.message);
  }
  return { skipped: true, reason: 'email_not_configured' };
}

module.exports = {
  isEmailConfigured,
  skipJobIfEmailUnconfigured,
};
