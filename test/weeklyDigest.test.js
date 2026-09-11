'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const digestCalls = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendWeeklyDigest: async (...args) => {
      digestCalls.push(args);
    },
  },
};

const jobLogPath = require.resolve('../utils/jobLog');
const jobRuns = [];
require.cache[jobLogPath] = {
  id: jobLogPath,
  filename: jobLogPath,
  loaded: true,
  exports: {
    recordJobRun: async (name, status, detail) => {
      jobRuns.push({ name, status, detail });
      return jobRuns.length;
    },
  },
};

const {
  runWeeklyDigest,
  isoWeekKey,
  startOfIsoWeek,
  JOB_NAME,
} = require('../jobs/weeklyDigest');

test('iso week helpers use Monday start', () => {
  // Wednesday 26 Aug 2026 → week starts Monday 24 Aug
  const wed = new Date(Date.UTC(2026, 7, 26, 12, 0, 0));
  assert.equal(isoWeekKey(wed), '2026-08-24');
  assert.equal(startOfIsoWeek(wed).toISOString().slice(0, 10), '2026-08-24');
});

test('weeklyDigest skips away volunteers and dedupes via job_runs', async () => {
  digestCalls.length = 0;
  jobRuns.length = 0;
  mock.resetCalls();

  let digestLookups = 0;
  mock.setHandler(async (sql, params) => {
    if (/FROM users u/i.test(sql) && /volunteer_profiles/i.test(sql)) {
      assert.match(sql, /away_until IS NULL OR vp\.away_until < CURRENT_DATE/i);
      return [[
        { user_id: 2, email: 'a@x.com', first_name: 'Ann', last_name: 'A', away_until: null },
        { user_id: 3, email: 'b@x.com', first_name: 'Bob', last_name: 'B', away_until: null },
      ]];
    }
    if (/FROM job_runs/i.test(sql) && /user_id=/i.test(String(params[1] || ''))) {
      digestLookups += 1;
      // First user already sent this week
      if (String(params[1]).includes('user_id=2;')) {
        return [[{ '?column?': 1 }]];
      }
      return [[]];
    }
    if (/FROM applications a/i.test(sql)) return [[]];
    if (/FROM opportunities o/i.test(sql)) return [[]];
    return [[]];
  });

  // Foster / MessageThread optional requires may hit DB — keep empty.
  const result = await runWeeklyDigest({ now: new Date(Date.UTC(2026, 7, 26, 7, 0, 0)) });
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 1);
  assert.equal(digestCalls.length, 1);
  assert.equal(digestCalls[0][0], 'b@x.com');
  assert.ok(jobRuns.some((r) => r.name === JOB_NAME && /user_id=3;week=2026-08-24/.test(r.detail)));
  assert.ok(digestLookups >= 2);
});
