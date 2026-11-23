'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
for (const key of [
  'RETENTION_INACTIVE_VOLUNTEER_YEARS',
  'DATA_RETENTION_YEARS',
  'RETENTION_APPLICATION_YEARS',
  'RETENTION_HOURS_YEARS',
  'RETENTION_AUDIT_LOG_YEARS',
  'RETENTION_GROUP_BOOKING_YEARS',
  'RETENTION_RESET_TOKEN_HOURS',
]) {
  delete process.env[key];
}

const { periods, cutoffFrom } = require('../config/retention');
const mock = require('./helpers/mockDb');
const { runWithShelter, TENANT_TABLES, mentionsTenantTable } = require('../utils/shelterContext');
const Gdpr = require('../models/Gdpr');
const {
  getRetentionSettings,
  updateRetentionSettings,
  previewRetention,
  runRetention,
} = require('../controllers/gdprController');
const { bodies } = require('../validation/bodies');

const DB = path.join(__dirname, '..', 'database');
const migration = fs.readFileSync(path.join(DB, '053_shelter_retention.pg.sql'), 'utf8');
const schema = fs.readFileSync(path.join(DB, 'schema.pg.sql'), 'utf8');
const setupDb = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
const jobSource = fs.readFileSync(path.join(__dirname, '..', 'jobs', 'dataRetention.js'), 'utf8');
const jobsIndex = fs.readFileSync(path.join(__dirname, '..', 'jobs', 'index.js'), 'utf8');

function makeReq(overrides = {}) {
  return {
    session: { userId: 1, role: 'admin' },
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('retention periods stay empty until they are set', () => {
  const value = periods();
  assert.strictEqual(value.inactiveVolunteerYears, null);
  assert.strictEqual(value.applicationYears, null);
  assert.strictEqual(value.hoursYears, null);
  assert.strictEqual(value.auditLogYears, null);
  assert.strictEqual(value.groupBookingYears, null);
  assert.strictEqual(value.resetTokenHours, null);
});

test('a set period is used and a blank one is ignored', () => {
  process.env.RETENTION_AUDIT_LOG_YEARS = '2';
  process.env.RETENTION_HOURS_YEARS = '';
  const value = periods();
  assert.strictEqual(value.auditLogYears, 2);
  assert.strictEqual(value.hoursYears, null);
  delete process.env.RETENTION_AUDIT_LOG_YEARS;
  delete process.env.RETENTION_HOURS_YEARS;
});

test('cutoff moves back by the given years', () => {
  const cutoff = cutoffFrom(new Date('2026-10-22T12:00:00Z'), 3, 'years');
  assert.strictEqual(cutoff.toISOString().slice(0, 10), '2023-10-22');
});

test('cutoff moves back by the given months', () => {
  const cutoff = cutoffFrom(new Date('2026-10-22T12:00:00Z'), 6, 'months');
  assert.strictEqual(cutoff.toISOString().slice(0, 10), '2026-04-22');
});

test('053 adds retention_inactive_months off by default and setup applies it', () => {
  assert.match(migration, /retention_inactive_months\s+SMALLINT\s+DEFAULT NULL/);
  assert.match(migration, /shelter_settings_retention_months_chk/);
  assert.match(migration, /retention_inactive_months <= 120/);
  assert.match(schema, /retention_inactive_months/);
  assert.match(setupDb, /053_shelter_retention\.pg\.sql/);
  assert.ok(TENANT_TABLES.includes('shelter_settings'));
  assert.equal(mentionsTenantTable('SELECT retention_inactive_months FROM shelter_settings'), true);
  assert.equal(mentionsTenantTable('SELECT * FROM users WHERE shelter_id = ?'), true);
});

test('admin routes expose settings, preview, and run', () => {
  assert.match(adminRoutes, /\/settings\/retention/);
  assert.match(adminRoutes, /\/gdpr\/retention\/preview/);
  assert.match(adminRoutes, /\/gdpr\/retention\/run/);
  assert.match(jobsIndex, /runDataRetentionJob\(\), HOUSEKEEPING\)/);
  assert.match(jobSource, /gdpr\.retention\.job/);
  assert.match(jobSource, /recordJobRun/);
});

test('retention settings validation rejects out-of-range and foreign keys', () => {
  assert.equal(bodies.retentionSettings.safeParse({ retention_inactive_months: 12 }).success, true);
  assert.equal(bodies.retentionSettings.safeParse({ retention_inactive_months: null }).success, true);
  assert.equal(bodies.retentionSettings.safeParse({ retention_inactive_months: '' }).success, true);
  assert.equal(bodies.retentionSettings.safeParse({ retention_inactive_months: 0 }).success, false);
  assert.equal(bodies.retentionSettings.safeParse({ retention_inactive_months: 121 }).success, false);
  assert.equal(
    bodies.retentionSettings.safeParse({ retention_inactive_months: 12, shelter_id: 2 }).success,
    false
  );
});

test('the retention job does nothing while the shelter period is off', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM shelter_settings/i.test(sql)) {
      return [[{ retention_inactive_months: null }]];
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const summary = await runWithShelter(1, () => Gdpr.runDataRetention(new Date('2026-10-22T12:00:00Z')));
  assert.strictEqual(summary.skipped, true);
  assert.strictEqual(summary.anonymised, 0);
  assert.strictEqual(summary.retention_inactive_months, null);
  assert.ok(mock.calls.every((c) => /shelter_settings/i.test(c.sql)));
});

test('preview lists only this shelter\'s inactive volunteers', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM shelter_settings/i.test(sql)) {
      assert.deepEqual(params, [1]);
      return [[{ retention_inactive_months: 6 }]];
    }
    if (/FROM users/i.test(sql) && /anonymised_at IS NULL/i.test(sql)) {
      assert.equal(params[0], 1, 'candidates query must bind current shelter_id');
      assert.match(sql, /shelter_id\s*=\s*\?/i);
      return [[
        {
          user_id: 9,
          first_name: 'Ada',
          last_name: 'Volunteer',
          name: 'Ada Volunteer',
          email: 'ada@example.test',
          last_login: '2025-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
        },
      ]];
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  const preview = await runWithShelter(1, () =>
    Gdpr.listRetentionCandidates(new Date('2026-10-22T12:00:00Z'))
  );
  assert.strictEqual(preview.skipped, false);
  assert.strictEqual(preview.retention_inactive_months, 6);
  assert.strictEqual(preview.shelter_id, 1);
  assert.strictEqual(preview.scanned, 1);
  assert.strictEqual(preview.candidates[0].user_id, 9);
  assert.strictEqual(preview.candidates[0].email, 'ada@example.test');
});

test('runDataRetention anonymises preview candidates and keeps hours path', async () => {
  mock.resetCalls();
  let anonymised = false;
  mock.setHandler(async (sql, params) => {
    if (/FROM shelter_settings/i.test(sql)) {
      return [[{ retention_inactive_months: 3 }]];
    }
    if (/FROM users/i.test(sql) && /anonymised_at IS NULL/i.test(sql) && /COALESCE\(last_login/i.test(sql)) {
      assert.equal(params[0], 2);
      return [[{
        user_id: 11,
        first_name: 'Bea',
        last_name: 'Gone',
        name: 'Bea Gone',
        email: 'bea@example.test',
        last_login: null,
        created_at: '2020-01-01T00:00:00Z',
      }]];
    }
    if (/SELECT user_id, email, role, anonymised_at/i.test(sql)) {
      return [[{
        user_id: 11,
        email: 'bea@example.test',
        role: 'volunteer',
        anonymised_at: anonymised ? new Date() : null,
      }]];
    }
    if (/SUM\(CASE WHEN approved = 1/i.test(sql)) return [[{ total: 8 }]];
    if (/UPDATE users SET/i.test(sql) && /anonymised_at/i.test(sql)) {
      anonymised = true;
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE volunteer_profiles SET/i.test(sql)) return [{ affectedRows: 1 }];
    if (/DELETE FROM/i.test(sql)) return [{ affectedRows: 0 }];
    if (/UPDATE (messages|background_checks|shift_notes|foster_offers|group_bookings|audit_log)/i.test(sql)) {
      return [{ affectedRows: 0 }];
    }
    return [[]];
  });

  const summary = await runWithShelter(2, () =>
    Gdpr.runDataRetention(new Date('2026-10-22T12:00:00Z'))
  );
  assert.strictEqual(summary.shelter_id, 2);
  assert.strictEqual(summary.retention_inactive_months, 3);
  assert.strictEqual(summary.scanned, 1);
  assert.strictEqual(summary.anonymised, 1);
  assert.strictEqual(summary.results[0].outcome.hours_preserved, 8);
  assert.ok(!mock.calls.some((c) => /DELETE FROM volunteer_hours/i.test(c.sql)));
});

test('setRetentionMonths upserts only the retention column for this shelter', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO shelter_settings/i.test(sql)) {
      assert.equal(params[0], 1);
      assert.equal(params[1], 18);
      assert.match(sql, /retention_inactive_months/);
      assert.doesNotMatch(sql, /min_volunteer_age\s*=/);
      return [{ affectedRows: 1 }];
    }
    if (/FROM shelter_settings/i.test(sql)) {
      return [[{ retention_inactive_months: 18, updated_at: 'now' }]];
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  const settings = await runWithShelter(1, () => Gdpr.setRetentionMonths(18, 7));
  assert.strictEqual(settings.retention_inactive_months, 18);
  assert.strictEqual(settings.shelter_id, 1);
});

test('controllers: settings, preview, and run are admin-only and audit the run', async () => {
  mock.resetCalls();
  const audits = [];
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO audit_log/i.test(sql)) {
      audits.push(params);
      return [{ insertId: 1 }];
    }
    if (/FROM shelter_settings/i.test(sql)) {
      return [[{ retention_inactive_months: 12, updated_at: 'then' }]];
    }
    if (/FROM users/i.test(sql) && /COALESCE\(last_login/i.test(sql)) {
      return [[]];
    }
    if (/INSERT INTO shelter_settings/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });

  let res = makeRes();
  await getRetentionSettings(makeReq({ session: { userId: 1, role: 'staff' } }), res);
  assert.strictEqual(res.statusCode, 403);

  res = makeRes();
  await runWithShelter(1, () => getRetentionSettings(makeReq(), res));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.retention_inactive_months, 12);

  res = makeRes();
  await runWithShelter(1, () =>
    updateRetentionSettings(makeReq({ body: { retention_inactive_months: 9 } }), res)
  );
  assert.strictEqual(res.statusCode, 200);
  assert.ok(audits.some((a) => a[1] === 'shelter.settings.retention'));

  res = makeRes();
  await runWithShelter(1, () => previewRetention(makeReq(), res));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.scanned, 0);

  res = makeRes();
  await runWithShelter(1, () => runRetention(makeReq(), res));
  assert.strictEqual(res.statusCode, 200);
  assert.ok(audits.some((a) => a[1] === 'gdpr.retention'));
});

test('tenant isolation: retention candidates always bind shelter_id', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM shelter_settings/i.test(sql)) {
      assert.deepEqual(params, [5]);
      return [[{ retention_inactive_months: 24 }]];
    }
    if (/FROM users/i.test(sql)) {
      assert.equal(params[0], 5);
      assert.match(sql, /shelter_id\s*=\s*\?/i);
      return [[]];
    }
    return [[]];
  });

  await runWithShelter(5, () => Gdpr.listRetentionCandidates(new Date('2026-01-01T00:00:00Z')));
  const userCall = mock.calls.find((c) => /FROM users/i.test(c.sql));
  assert.ok(userCall);
  assert.equal(userCall.params[0], 5);
});
