'use strict';

const { pool } = require('../config/database');
const { recordJobRun } = require('../utils/jobLog');

const JOB_NAME = 'resetTokenCleanup';

/**
 * Clear password-reset tokens that have already passed their one-hour expiry.
 * This is not a retention period. The link is already invalid.
 */
async function runResetTokenCleanup(now = new Date()) {
  const [result] = await pool.execute(
    `UPDATE users
     SET reset_token = NULL, reset_token_expires = NULL
     WHERE reset_token IS NOT NULL AND reset_token_expires < ?`,
    [now]
  );
  const cleared = Number(result && result.affectedRows) || 0;
  try {
    await recordJobRun(JOB_NAME, 'ok', `cleared=${cleared}`);
  } catch (error) {
    console.error('[Job:resetTokenCleanup] job_runs log failed:', error.message);
  }
  return cleared;
}

module.exports = {
  JOB_NAME,
  runResetTokenCleanup,
};
