'use strict';

const Vetting = require('../models/Vetting');
const { sendEmail } = require('../utils/emailService');
const { recordJobRun } = require('../utils/jobLog');
const { isEmailConfigured } = require('../utils/emailConfig');

const JOB_NAME = 'backgroundCheckExpiry';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

  let rosterGaps = [];
  try {
    rosterGaps = await Vetting.findRosteredShiftsMissingCheck(now);
  } catch (error) {
    failed += 1;
    console.error('[Job:backgroundCheckExpiry] roster gap query failed:', error.message);
  }

  const staffEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
  function personLine(row) {
    const name = `${row.first_name || ''} ${row.last_name || ''}`.trim() || `User ${row.user_id}`;
    return escapeHtml(name);
  }

  const warningHtml = warnings
    .map((w) => {
      const safeType = escapeHtml(w.check_type);
      const safeDate = escapeHtml(String(w.expires_on).slice(0, 10));
      return `<li><strong>${personLine(w)}</strong> - ${safeType} expires ${safeDate}</li>`;
    })
    .join('');
  const gapHtml = rosterGaps
    .map((row) => {
      const safeType = escapeHtml(String(row.check_type || '').replace(/_/g, ' '));
      const safeTitle = escapeHtml(row.title || 'Shift');
      const safeDate = escapeHtml(String(row.start_date || '').slice(0, 10));
      return `<li><strong>${personLine(row)}</strong> - ${safeTitle} on ${safeDate} needs a clear ${safeType} check</li>`;
    })
    .join('');

  if (staffEmail && (warnings.length || rosterGaps.length) && !isEmailConfigured()) {
    // Expiry above still ran; only the staff warning email is skipped.
    console.warn('[Job:backgroundCheckExpiry] staff warning skipped: email not configured');
  } else if (staffEmail && (warnings.length || rosterGaps.length)) {
    const sections = [];
    if (warningHtml) {
      sections.push(
        `<p>The following clear background checks expire within ${Vetting.STAFF_WARN_DAYS} days:</p><ul>${warningHtml}</ul>`
      );
    }
    if (gapHtml) {
      sections.push(
        `<p>These accepted shifts are not covered by a clear check on the shift date:</p><ul>${gapHtml}</ul>`
      );
    }
    const subject = warnings.length
      ? `AccessNI checks expiring within ${Vetting.STAFF_WARN_DAYS} days - ShelterLink`
      : 'Accepted shifts need a background check - ShelterLink';
    try {
      await sendEmail(
        staffEmail,
        subject,
        `
        ${sections.join('')}
        <p>Review volunteer records in ShelterLink. This email does not include reference numbers.</p>
        `
      );
      warned = warnings.length + rosterGaps.length;
    } catch (error) {
      failed += 1;
      console.error('[Job:backgroundCheckExpiry] staff email failed:', error.message);
    }
  }

  const detail = `expired_refs=${expiredRefs};expired_checks=${expiredChecks};warned=${warned};roster_gaps=${rosterGaps.length};failed=${failed}`;
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
