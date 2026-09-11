'use strict';

const { pool } = require('../config/database');
const { recordJobRun } = require('../utils/jobLog');

const JOB_NAME = 'dbKeepAlive';

/**
 * Daily SELECT 1 so a hosted app keeps a free-tier Supabase project awake.
 * The app host itself must be always-on; a paused process cannot ping the DB.
 */
async function runDbKeepAlive() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  const ok = Boolean(rows && rows.length);
  const detail = ok ? 'SELECT 1' : 'empty health check';
  await recordJobRun(JOB_NAME, ok ? 'ok' : 'error', detail);
  if (!ok) throw new Error(detail);
  return detail;
}

module.exports = { runDbKeepAlive };
