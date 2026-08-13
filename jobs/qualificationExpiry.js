'use strict';

const Qualification = require('../models/Qualification');
const { sendQualificationExpiryNotice } = require('../utils/emailService');
const { recordJobRun } = require('../utils/jobLog');

const JOB_NAME = 'qualificationExpiry';

function formatDate(value) {
  if (!value) return 'TBA';
  const raw = String(value).slice(0, 10);
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString();
}

async function notifyRow(row, kind, now) {
  if (!row.email) return false;
  await sendQualificationExpiryNotice(row.email, {
    name: row.first_name || 'Volunteer',
    qualificationName: row.qualification_name,
    expiresAt: formatDate(row.expires_at),
    kind,
  });
  const milestone =
    kind === 'warning'
      ? Qualification.toDateOnly(now)
      : Qualification.toDateOnly(row.expires_at);
  return Qualification.markExpiryNotified(row.volunteer_qualification_id, milestone);
}

async function runQualificationExpiry(now = new Date()) {
  const warnings = await Qualification.findNeedingExpiryWarning(now);
  const expired = await Qualification.findNeedingExpiryNotice(now);

  let sent = 0;
  let failed = 0;

  for (const row of warnings) {
    try {
      const ok = await notifyRow(row, 'warning', now);
      if (ok) sent += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.error(
        '[Job:qualificationExpiry] warning failed for',
        row.volunteer_qualification_id,
        error.message
      );
    }
  }

  for (const row of expired) {
    try {
      const ok = await notifyRow(row, 'expired', now);
      if (ok) sent += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.error(
        '[Job:qualificationExpiry] expiry failed for',
        row.volunteer_qualification_id,
        error.message
      );
    }
  }

  const detail = `sent=${sent};failed=${failed};warnings=${warnings.length};expired=${expired.length}`;
  try {
    await recordJobRun(JOB_NAME, failed && !sent ? 'error' : 'ok', detail);
  } catch (logError) {
    console.error('[Job:qualificationExpiry] job_runs log failed:', logError.message);
  }

  return detail;
}

module.exports = {
  JOB_NAME,
  runQualificationExpiry,
};
