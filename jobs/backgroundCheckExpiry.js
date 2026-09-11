'use strict';

const Vetting = require('../models/Vetting');
const { sendEmail } = require('../utils/emailService');
const { recordJobRun } = require('../utils/jobLog');

const JOB_NAME = 'backgroundCheckExpiry';

/**
 * Expire past-due checks and email staff about clear checks ending within 60 days.
 */
async function runBackgroundCheckExpiry(now = new Date()) {
  let expiredRefs = 0;
  let expiredChecks = 0;
  let warned = 0;
  let failed = 0;

  try {
    expiredRefs = await Vetting.expireStaleReferences(now);
  } catch (error) {
    failed += 1;
    console.error('[Job:backgroundCheckExpiry] expire refs failed:', error.message);
  }

  try {
    expiredChecks = await Vetting.markExpiredChecks(now);
  } catch (error) {
    failed += 1;
    console.error('[Job:backgroundCheckExpiry] expire checks failed:', error.message);
  }

  let warnings = [];
  try {
    warnings = await Vetting.findChecksNeedingStaffWarning(now, Vetting.STAFF_WARN_DAYS);
  } catch (error) {
    failed += 1;
    console.error('[Job:backgroundCheckExpiry] warning query failed:', error.message);
  }

  const staffEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
  if (staffEmail && warnings.length) {
    const listHtml = warnings
      .map((w) => {
        const name = `${w.first_name || ''} ${w.last_name || ''}`.trim() || `User ${w.user_id}`;
        return `<li><strong>${name}</strong> — ${w.check_type} expires ${String(w.expires_on).slice(0, 10)}</li>`;
      })
      .join('');
    try {
      await sendEmail(
        staffEmail,
        `AccessNI checks expiring within ${Vetting.STAFF_WARN_DAYS} days - ShelterLink`,
        `
        <p>The following clear background checks expire within ${Vetting.STAFF_WARN_DAYS} days:</p>
        <ul>${listHtml}</ul>
        <p>Review volunteer records in ShelterLink.</p>
        `
      );
      warned = warnings.length;
    } catch (error) {
      failed += 1;
      console.error('[Job:backgroundCheckExpiry] staff email failed:', error.message);
    }
  }

  const detail = `expired_refs=${expiredRefs};expired_checks=${expiredChecks};warned=${warned};failed=${failed}`;
  try {
    await recordJobRun(JOB_NAME, failed && !expiredChecks && !expiredRefs ? 'error' : 'ok', detail);
  } catch (logError) {
    console.error('[Job:backgroundCheckExpiry] job_runs log failed:', logError.message);
  }

  return { expiredRefs, expiredChecks, warned, failed, detail };
}

module.exports = {
  JOB_NAME,
  runBackgroundCheckExpiry,
};
