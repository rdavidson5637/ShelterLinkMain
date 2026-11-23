'use strict';

const Gdpr = require('../models/Gdpr');
const AuditLog = require('../models/AuditLog');
const { recordJobRun } = require('../utils/jobLog');
const { currentShelterId } = require('../utils/shelterContext');

const JOB_NAME = 'dataRetention';

async function runDataRetentionJob(now = new Date()) {
  const shelterId = currentShelterId();
  const summary = await Gdpr.runDataRetention(now);

  try {
    await AuditLog.create({
      userId: null,
      action: 'gdpr.retention.job',
      entityType: 'system',
      entityId: summary.shelter_id || shelterId || null,
      detail: {
        shelter_id: summary.shelter_id || shelterId || null,
        retention_inactive_months: summary.retention_inactive_months,
        scanned: summary.scanned,
        anonymised: summary.anonymised,
        skipped: Boolean(summary.skipped),
        cutoff: summary.cutoff,
      },
    });
  } catch (err) {
    console.error('[Job:dataRetention] audit log failed:', err.message);
  }

  const detail = [
    `shelter=${summary.shelter_id || shelterId || 'none'}`,
    `months=${summary.retention_inactive_months}`,
    `scanned=${summary.scanned}`,
    `anonymised=${summary.anonymised}`,
    summary.skipped ? 'skipped=1' : 'skipped=0',
  ].join(';');
  const failed = summary.results.filter((r) => !r.ok).length;
  try {
    await recordJobRun(JOB_NAME, failed && !summary.anonymised ? 'error' : 'ok', detail);
  } catch (logError) {
    console.error('[Job:dataRetention] job_runs log failed:', logError.message);
  }

  return detail;
}

module.exports = {
  JOB_NAME,
  runDataRetentionJob,
};
