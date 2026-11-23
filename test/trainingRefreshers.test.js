'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.EMAIL_HOST = 'smtp.test.invalid';
process.env.EMAIL_FROM = 'ShelterLink <test@example.com>';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const emailCalls = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async () => {},
    sendTrainingRefresherNotice: async (...args) => {
      emailCalls.push(['refresher', ...args]);
    },
    sendQualificationExpiryNotice: async () => {},
    sendShiftReminder: async () => {},
  },
};

const jobLogPath = require.resolve('../utils/jobLog');
const jobRuns = [];
const claims = [];
require.cache[jobLogPath] = {
  id: jobLogPath,
  filename: jobLogPath,
  loaded: true,
  exports: {
    recordJobRun: async (name, status, detail) => {
      jobRuns.push({ name, status, detail });
      return jobRuns.length;
    },
    claimJobRun: async (name, runKey) => {
      const key = `${name}:${runKey}`;
      if (claims.includes(key)) return false;
      claims.push(key);
      return true;
    },
  },
};

const Qualification = require('../models/Qualification');
const { runTrainingRefreshers, WARN_DAYS } = require('../jobs/trainingRefreshers');
const pushService = require('../utils/pushService');
const pushCalls = [];
const origSend = pushService.sendToUsers;
pushService.sendToUsers = async (...args) => {
  pushCalls.push(args);
  return { sent: 1, failed: 0, skipped: 0, configured: true };
};

const ROOT = path.join(__dirname, '..');

test('WARN_DAYS is 14 for training refreshers', () => {
  assert.strictEqual(WARN_DAYS, 14);
});

test('migration 056 adds training_modules.validity_months', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'database/056_training_module_validity.pg.sql'),
    'utf8'
  );
  assert.match(sql, /ALTER TABLE training_modules/i);
  assert.match(sql, /validity_months/i);
  assert.match(sql, /SL-LATER-28/);

  const setupDb = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
  assert.match(setupDb, /056_training_module_validity\.pg\.sql/);

  const schema = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
  assert.match(schema, /validity_months\s+INTEGER DEFAULT NULL/);
});

test('findNeedingTrainingRefresher SQL uses 14 days and training_modules link', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /interval '14 days'/i);
    assert.match(sql, /training_modules/i);
    assert.match(sql, /quiet_hours_start/i);
    assert.match(sql, /prefer_reminders/i);
    assert.strictEqual(params[0], '2026-11-23');
    return [[]];
  });
  await Qualification.findNeedingTrainingRefresher(new Date('2026-11-23T12:00:00Z'));
});

test('findNeedingExpiryWarning excludes training-module awards', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    assert.match(sql, /interval '30 days'/i);
    assert.match(sql, /NOT EXISTS/i);
    assert.match(sql, /training_modules/i);
    return [[]];
  });
  await Qualification.findNeedingExpiryWarning(new Date('2026-11-23T12:00:00Z'));
});

test('training refresher job_runs claim and last_expiry_notified_at prevent duplicates', async () => {
  mock.resetCalls();
  emailCalls.length = 0;
  jobRuns.length = 0;
  claims.length = 0;
  pushCalls.length = 0;

  let notified = false;
  mock.setHandler(async (sql) => {
    if (/interval '14 days'/i.test(sql) && /SELECT/i.test(sql)) {
      if (notified) return [[]];
      return [[
        {
          volunteer_qualification_id: 9,
          user_id: 2,
          qualification_id: 3,
          awarded_at: '2025-11-23',
          expires_at: '2026-12-07',
          last_expiry_notified_at: null,
          qualification_name: 'Dog walking level 1',
          email: 'v@x.com',
          first_name: 'Vic',
          last_name: 'Volunteer',
          prefer_reminders: 1,
          quiet_hours_start: null,
          quiet_hours_end: null,
        },
      ]];
    }
    if (/SET last_expiry_notified_at/i.test(sql)) {
      notified = true;
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const first = await runTrainingRefreshers(new Date('2026-11-23T12:00:00Z'));
  assert.match(first, /sent=1/);
  assert.strictEqual(emailCalls.filter((c) => c[0] === 'refresher').length, 1);
  assert.ok(claims.some((c) => c.startsWith('trainingRefresherSend:vq:9:')));
  assert.ok(pushCalls.length >= 1);
  assert.strictEqual(pushCalls[0][2].category, 'reminders');

  const second = await runTrainingRefreshers(new Date('2026-11-23T13:00:00Z'));
  assert.match(second, /sent=0/);
  assert.strictEqual(emailCalls.filter((c) => c[0] === 'refresher').length, 1);
  assert.ok(jobRuns.some((r) => r.name === 'trainingRefreshers'));
});

test('training refresher skips during quiet hours without marking notified', async () => {
  mock.resetCalls();
  emailCalls.length = 0;
  claims.length = 0;
  let markCalls = 0;

  mock.setHandler(async (sql) => {
    if (/interval '14 days'/i.test(sql) && /SELECT/i.test(sql)) {
      return [[
        {
          volunteer_qualification_id: 11,
          user_id: 4,
          qualification_id: 3,
          awarded_at: '2025-11-23',
          expires_at: '2026-12-07',
          last_expiry_notified_at: null,
          qualification_name: 'Dog walking level 1',
          email: 'quiet@x.com',
          first_name: 'Q',
          last_name: 'Hours',
          prefer_reminders: 1,
          quiet_hours_start: '00:00:00',
          quiet_hours_end: '23:59:59',
        },
      ]];
    }
    if (/SET last_expiry_notified_at/i.test(sql)) {
      markCalls += 1;
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const detail = await runTrainingRefreshers(new Date('2026-11-23T12:00:00Z'));
  assert.match(detail, /skippedQuiet=1/);
  assert.match(detail, /sent=0/);
  assert.strictEqual(emailCalls.length, 0);
  assert.strictEqual(markCalls, 0);
  assert.strictEqual(claims.length, 0);
});

test('awardToUser uses training module validity_months override', async () => {
  mock.resetCalls();
  let insertParams = null;
  mock.setHandler(async (sql, params) => {
    if (/FROM qualifications WHERE id/i.test(sql)) {
      return [[
        {
          id: 3,
          name: 'Dog walking level 1',
          description: null,
          validity_months: 24,
          created_at: '2026-01-01',
        },
      ]];
    }
    if (/INSERT INTO volunteer_qualifications/i.test(sql)) {
      insertParams = params;
      return [{ insertId: 1, affectedRows: 1 }];
    }
    if (/FROM volunteer_qualifications vq/i.test(sql)) {
      return [[
        {
          id: 1,
          user_id: 2,
          qualification_id: 3,
          awarded_at: '2026-11-23',
          expires_at: '2027-05-23',
          awarded_by: null,
          last_expiry_notified_at: null,
          name: 'Dog walking level 1',
          description: null,
          validity_months: 24,
        },
      ]];
    }
    return [[]];
  });

  const awarded = await Qualification.awardToUser({
    userId: 2,
    qualificationId: 3,
    awardedAt: '2026-11-23',
    validityMonths: 6,
  });
  assert.ok(insertParams);
  assert.strictEqual(insertParams[3], '2027-05-23');
  assert.strictEqual(awarded.expires_at, '2027-05-23');
});

test('expired training award blocks shift apply', async () => {
  mock.resetCalls();
  const appCtrl = require('../controllers/applicationController');

  mock.setHandler(async (sql) => {
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: 1, user_email: 'v@x.com' }]];
    }
    if (/application_id, status\s+FROM applications/i.test(sql)) return [[]];
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id/i.test(sql)) {
      return [[{ opportunity_id: 1, title: 'Dog Walk', status: 'open', max_volunteers: 5 }]];
    }
    if (/FROM opportunity_qualifications/i.test(sql)) {
      return [[{ id: 3, name: 'Dog walking level 1', description: null, validity_months: 12 }]];
    }
    if (/FROM volunteer_qualifications/i.test(sql)) {
      return [[
        {
          id: 9,
          user_id: 2,
          qualification_id: 3,
          awarded_at: '2024-01-01',
          expires_at: '2025-01-01',
          awarded_by: null,
          name: 'Dog walking level 1',
        },
      ]];
    }
    return [[]];
  });

  const res = { statusCode: 200, body: undefined };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };

  await appCtrl.applyForOpportunity(
    { session: { userId: 2, role: 'volunteer' }, body: { opportunityId: 1 } },
    res
  );
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.body.error, /expired|missing required qualifications/i);
  assert.match(res.body.error, /Dog walking level 1/);
});

// Restore push stub for other files that may load this suite in the same process.
test.after(() => {
  pushService.sendToUsers = origSend;
});
