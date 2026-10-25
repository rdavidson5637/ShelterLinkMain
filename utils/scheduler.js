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
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function shelterTimeZone() {
  const zone = String(process.env.SHELTER_TIMEZONE || '').trim();
  if (zone) return zone;
  if (process.env.NODE_ENV === 'production') return 'Europe/London';
  return '';
}

function localClock(date) {
  return {
    minute: date.getMinutes(),
    hour: date.getHours(),
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear(),
    dayOfWeek: date.getDay(),
  };
}

function clockParts(date) {
  const zone = shelterTimeZone();
  if (!zone) return localClock(date);
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(date);
    const map = {};
    for (const part of parts) {
      if (part.type !== 'literal') map[part.type] = part.value;
    }
    const dayOfWeek = WEEKDAYS[map.weekday];
    if (!Number.isFinite(dayOfWeek)) return localClock(date);
    const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
    return {
      minute: Number(map.minute),
      hour,
      day: Number(map.day),
      month: Number(map.month),
      year: Number(map.year),
      dayOfWeek,
    };
  } catch {
    return localClock(date);
  }
}

function matchesCron(expression, date = new Date()) {
  const fields = String(expression || '').trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
  const [minute, hour, dayMonth, month, dayWeek] = fields;
  const clock = clockParts(date);
  return (
    matchesField(minute, clock.minute) &&
    matchesField(hour, clock.hour) &&
    matchesField(dayMonth, clock.day) &&
    matchesField(month, clock.month) &&
    matchesField(dayWeek, clock.dayOfWeek)
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
  const clock = clockParts(now);
  const minuteKey = `${clock.year}-${clock.month}-${clock.day}-${clock.hour}-${clock.minute}`;
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
