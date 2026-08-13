'use strict';

const Gdpr = require('../models/Gdpr');
const AuditLog = require('../models/AuditLog');
const { recordJobRun } = require('../utils/jobLog');

const JOB_NAME = 'dataRetention';

async function runDataRetentionJob(now = new Date()) {
  const summary = await Gdpr.runDataRetention(now);

  try {
    await AuditLog.create({
      userId: null,
      action: 'gdpr.retention.job',
      entityType: 'system',
      entityId: null,
      detail: {
        retention_years: summary.retention_years,
        scanned: summary.scanned,
        anonymised: summary.anonymised,
        cutoff: summary.cutoff,
      },
    });
  } catch (err) {
    console.error('[Job:dataRetention] audit log failed:', err.message);
  }

  const detail = `years=${summary.retention_years};scanned=${summary.scanned};anonymised=${summary.anonymised}`;
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
