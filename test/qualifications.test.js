'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const emailCalls = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async () => {},
    sendApplicationConfirmation: async (...args) => { emailCalls.push(['confirm', ...args]); },
    sendApplicationApproval: async () => {},
    sendApplicationCancellation: async () => {},
    sendApplicationRejection: async () => {},
    sendWaitlistPromotion: async () => {},
    sendHoursApproval: async () => {},
    sendVolunteerApprovalNotification: async () => {},
    sendShiftReminder: async () => {},
    sendQualificationExpiryNotice: async (...args) => {
      emailCalls.push(['expiry', ...args]);
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

const Qualification = require('../models/Qualification');
const { runQualificationExpiry } = require('../jobs/qualificationExpiry');
const appCtrl = require('../controllers/applicationController');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 2, role: 'volunteer' },
    body: { opportunityId: 1 },
    params: {},
    query: {},
    ...overrides,
  };
}

test('computeExpiresAt adds validity_months; null means never expires', () => {
  assert.strictEqual(Qualification.computeExpiresAt('2026-01-15', null), null);
  assert.strictEqual(Qualification.computeExpiresAt('2026-01-15', ''), null);
  assert.strictEqual(Qualification.computeExpiresAt('2026-01-15', 12), '2027-01-15');
  assert.strictEqual(Qualification.computeExpiresAt('2024-01-31', 1), '2024-03-02');
});

test('findMissingOrExpired detects missing and expired awards', () => {
  const required = [
    { id: 1, name: 'Dog Handling' },
    { id: 2, name: 'Manual Handling' },
  ];
  const held = [
    { qualification_id: 1, expires_at: '2026-01-01' },
  ];
  const missing = Qualification.findMissingOrExpired(required, held, '2026-08-11');
  assert.strictEqual(missing.length, 2);
  assert.deepStrictEqual(
    missing.map((m) => m.reason).sort(),
    ['expired', 'missing']
  );
});

test('apply rejects when required qualification is missing', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: 1, user_email: 'v@x.com' }]];
    }
    if (/application_id, status\s+FROM applications/i.test(sql)) return [[]];
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id/i.test(sql)) {
      return [[{ opportunity_id: 1, title: 'Dog Walk', status: 'open', max_volunteers: 5 }]];
    }
    if (/FROM opportunity_qualifications/i.test(sql)) {
      return [[{ id: 10, name: 'Dog Handling', description: null, validity_months: 12 }]];
    }
    if (/FROM volunteer_qualifications/i.test(sql)) {
      return [[]];
    }
    return [[]];
  });

  const res = makeRes();
  await appCtrl.applyForOpportunity(makeReq(), res);
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.body.error, /missing required qualifications/i);
  assert.match(res.body.error, /Dog Handling/);
  assert.strictEqual(emailCalls.length, 0);
});

test('apply rejects when required qualification is expired', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: 1, user_email: 'v@x.com' }]];
    }
    if (/application_id, status\s+FROM applications/i.test(sql)) return [[]];
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id/i.test(sql)) {
      return [[{ opportunity_id: 1, title: 'Dog Walk', status: 'open', max_volunteers: 5 }]];
    }
    if (/FROM opportunity_qualifications/i.test(sql)) {
      return [[{ id: 10, name: 'Dog Handling', description: null, validity_months: 12 }]];
    }
    if (/FROM volunteer_qualifications/i.test(sql)) {
      return [[{
        id: 1,
        user_id: 2,
        qualification_id: 10,
        awarded_at: '2024-01-01',
        expires_at: '2025-01-01',
        name: 'Dog Handling',
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await appCtrl.applyForOpportunity(makeReq(), res);
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.body.error, /Dog Handling/);
});

test('expiry job selects warning and expired rows and notifies only once', async () => {
  emailCalls.length = 0;
  jobRuns.length = 0;
  mock.resetCalls();

  const notified = new Set();
  const now = new Date('2026-08-11T10:00:00Z');

  mock.setHandler(async (sql, params) => {
    if (/\?::date \+ interval '30 days'/i.test(sql)) {
      if (notified.has('warn')) return [[]];
      return [[
        {
          volunteer_qualification_id: 5,
          user_id: 2,
          qualification_id: 10,
          expires_at: '2026-09-10',
          last_expiry_notified_at: null,
          qualification_name: 'Dog Handling',
          email: 'v@x.com',
          first_name: 'Vol',
          last_name: 'Unteer',
        },
      ]];
    }
    if (/WHERE vq\.expires_at = \?/i.test(sql) || (/vq\.expires_at = \?/i.test(sql) && !/interval '30 days'/i.test(sql))) {
      if (notified.has('expired')) return [[]];
      // Only return expiry-day row when selecting for today
      if (params && params[0] === '2026-08-11') {
        return [[
          {
            volunteer_qualification_id: 6,
            user_id: 3,
            qualification_id: 11,
            expires_at: '2026-08-11',
            last_expiry_notified_at: '2026-07-12',
            qualification_name: 'Manual Handling',
            email: 'b@x.com',
            first_name: 'Bee',
            last_name: 'Volunteer',
          },
        ]];
      }
      return [[]];
    }
    if (/SET last_expiry_notified_at/i.test(sql)) {
      const id = params[1];
      if (Number(id) === 5) notified.add('warn');
      if (Number(id) === 6) notified.add('expired');
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const first = await runQualificationExpiry(now);
  assert.match(first, /sent=2/);
  assert.strictEqual(emailCalls.filter((c) => c[0] === 'expiry').length, 2);

  const second = await runQualificationExpiry(now);
  assert.match(second, /sent=0/);
  assert.strictEqual(emailCalls.filter((c) => c[0] === 'expiry').length, 2);
  assert.ok(jobRuns.length >= 2);
  assert.strictEqual(jobRuns[0].name, 'qualificationExpiry');
});

test('findNeedingExpiryWarning SQL is idempotent via last_expiry_notified_at', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /interval '30 days'/i);
    assert.match(sql, /last_expiry_notified_at/i);
    assert.strictEqual(params[0], '2026-08-11');
    return [[]];
  });
  await Qualification.findNeedingExpiryWarning(new Date('2026-08-11T12:00:00Z'));
});
