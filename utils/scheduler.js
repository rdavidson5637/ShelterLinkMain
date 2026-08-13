'use strict';

/**
 * Minimal in-process job scheduler.
 * Uses a 60s tick + a small cron matcher (no native deps).
 * Jobs never crash the process — errors are logged and recorded.
 */

const jobs = new Map();
let started = false;
let tickTimer = null;

function matchesField(field, value) {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = Number(field.slice(2));
    return Number.isFinite(step) && step > 0 && value % step === 0;
  }
  const parts = field.split(',');
  return parts.some((part) => {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      return value >= a && value <= b;
    }
    return Number(part) === value;
  });
}

/**
 * Match a 5-field cron expression: minute hour dayMonth month dayWeek
 * dayWeek: 0-6 (Sun-Sat), same as node-cron default.
 */
function matchesCron(expression, date = new Date()) {
  const fields = String(expression || '').trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
  const [minute, hour, dayMonth, month, dayWeek] = fields;
  return (
    matchesField(minute, date.getMinutes()) &&
    matchesField(hour, date.getHours()) &&
    matchesField(dayMonth, date.getDate()) &&
    matchesField(month, date.getMonth() + 1) &&
    matchesField(dayWeek, date.getDay())
  );
}

function registerJob(name, cronExpression, fn) {
  if (!name || typeof name !== 'string') {
    throw new Error('Job name is required');
  }
  if (!cronExpression || typeof cronExpression !== 'string') {
    throw new Error('cronExpression is required');
  }
  if (typeof fn !== 'function') {
    throw new Error('Job handler must be a function');
  }
  // Validate expression early
  matchesCron(cronExpression, new Date());
  jobs.set(name, {
    name,
    cronExpression,
    fn,
    lastRunMinuteKey: null,
  });
  return name;
}

async function runJob(job, detailExtra = null) {
  const ranAt = new Date();
  try {
    const detail = await job.fn();
    return { status: 'ok', detail: detailExtra || detail || null, ranAt };
  } catch (error) {
    console.error(`[Scheduler] job "${job.name}" failed:`, error.message);
    return { status: 'error', detail: error.message, ranAt };
  }
}

async function tick(now = new Date()) {
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  for (const job of jobs.values()) {
    try {
      if (!matchesCron(job.cronExpression, now)) continue;
      if (job.lastRunMinuteKey === minuteKey) continue;
      job.lastRunMinuteKey = minuteKey;
      await runJob(job);
    } catch (error) {
      console.error(`[Scheduler] unexpected error in job "${job.name}":`, error.message);
    }
  }
}

function start() {
  if (started) return false;
  if (process.env.NODE_ENV === 'test') return false;
  started = true;
  tickTimer = setInterval(() => {
    tick().catch((error) => {
      console.error('[Scheduler] tick error:', error.message);
    });
  }, 60 * 1000);
  // Allow the timer to not keep the process alive alone in some hosts
  if (typeof tickTimer.unref === 'function') {
    tickTimer.unref();
  }
  console.log(`[Scheduler] started with ${jobs.size} job(s)`);
  return true;
}

function stop() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  started = false;
}

function isStarted() {
  return started;
}

function listJobs() {
  return Array.from(jobs.keys());
}

function resetForTests() {
  stop();
  jobs.clear();
}

module.exports = {
  registerJob,
  start,
  stop,
  isStarted,
  listJobs,
  matchesCron,
  runJob,
  tick,
  resetForTests,
};
