'use strict';

const { pool } = require('../config/database');

async function recordJobRun(jobName, status, detail = null) {
  const sql = `
    INSERT INTO job_runs (job_name, ran_at, status, detail)
    VALUES (?, NOW(), ?, ?)
  `;
  const [result] = await pool.execute(sql, [
    jobName,
    status === 'error' ? 'error' : 'ok',
    detail == null ? null : String(detail),
  ]);
  return result.insertId;
}

/**
 * Claim a cron minute for a job across app replicas.
 * Returns true when this process owns the run_key; false if another replica
 * already claimed it (unique violation on job_name + run_key).
 *
 * Before migration 046 (no run_key column), returns true so a single-instance
 * deploy keeps working until the coordinator applies the migration.
 */
async function claimJobRun(jobName, runKey) {
  const key = String(runKey || '').trim();
  if (!jobName || !key) return false;
  try {
    await pool.execute(
      `
        INSERT INTO job_runs (job_name, ran_at, status, detail, run_key)
        VALUES (?, NOW(), 'ok', ?, ?)
      `,
      [jobName, `claimed:${key}`, key]
    );
    return true;
  } catch (error) {
    if (error && (error.code === '23505' || error.code === 'ER_DUP_ENTRY')) {
      return false;
    }
    // Column missing until 046 is applied — allow the run on a single host.
    if (error && (error.code === '42703' || /run_key/i.test(error.message || ''))) {
      console.warn(`[Job:${jobName}] claim skipped (run_key not ready):`, error.message);
      return true;
    }
    console.error(`[Job:${jobName}] claim failed:`, error.message);
    return false;
  }
}

module.exports = {
  recordJobRun,
  claimJobRun,
};
