'use strict';

const { pgPool } = require('../config/database');
const { isDemoMode } = require('../utils/demoMode');
const { rebuildDemoDatabase } = require('../utils/demoReset');
const { TIMEZONE } = require('../utils/shelterTime');

const JOB_NAME = 'demoReset';
const RESET_HOUR = 3; // shelter-local

function shelterHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === 'hour').value) % 24;
}

/**
 * Registered hourly (only when DEMO_MODE=true); rebuilds once, in the 03:xx hour
 * shelter time. Job history is not recorded because the reset drops job_runs.
 */
async function runDemoReset(now = new Date(), { pool = pgPool, env = process.env } = {}) {
  if (!isDemoMode(env)) return 'skipped:not_demo_mode';
  if (shelterHour(now) !== RESET_HOUR) return 'skipped:not_reset_hour';
  try {
    await rebuildDemoDatabase(pool, { env });
    console.log('[Job:demoReset] demo database rebuilt');
    return 'rebuilt';
  } catch (error) {
    console.error('[Job:demoReset] failed:', error.message);
    return `failed:${error.message}`;
  }
}

module.exports = { JOB_NAME, RESET_HOUR, shelterHour, runDemoReset };
