'use strict';

// SL-DAY-06: volunteer anniversary and 50-shift milestone thank-you emails.
// Staff notice + staff-triggered email only. Dedup per volunteer + kind.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

for (const mod of [
  '../models/Milestone',
  '../controllers/milestoneController',
  '../middleware/auth',
  '../utils/emailService',
  '../utils/emailConfig',
  '../utils/emailPreview',
]) {
  const resolved = require.resolve(mod);
  delete require.cache[resolved];
}

const Milestone = require('../models/Milestone');
const {
  listPendingMilestones,
  getVolunteerMilestones,
  sendMilestoneEmail,
  previewMilestoneEmail,
} = require('../controllers/milestoneController');
const { buildMilestoneThankYou } = require('../utils/emailService');
const { catalogIds } = require('../utils/emailPreview');
const { mentionsTenantTable, TENANT_TABLES, runWithShelter } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/063_volunteer_milestones.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const ADMIN_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const DASHBOARD_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/dashboard.js'), 'utf8');
const DASHBOARD_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/dashboard.html'),
  'utf8'
);
const VOL_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/volunteers.js'), 'utf8');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'utils/notify/index.js'), 'utf8');
const SMS = fs.readFileSync(path.join(ROOT, 'utils/notify/smsProvider.js'), 'utf8');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 1, role: 'staff' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/admin/milestones',
    ...overrides,
  };
}

test('migration 063 creates volunteer_milestone_emails with tenant isolation and dedup', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS volunteer_milestone_emails/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /tenant_isolation/);
  assert.match(MIGRATION, /assert_same_shelter/);
  assert.match(MIGRATION, /anniversary_1y/);
  assert.match(MIGRATION, /shifts_50/);
  assert.match(MIGRATION, /UNIQUE \(user_id, milestone_kind\)/);
  assert.match(SCHEMA, /CREATE TABLE volunteer_milestone_emails/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*volunteer_milestone_emails/);
  assert.match(SETUP_DB, /063_volunteer_milestones\.pg\.sql/);
  assert.ok(TENANT_TABLES.includes('volunteer_milestone_emails'));
});

test('staff routes expose list, per-volunteer status, preview and send; no SMS path', () => {
  assert.match(ADMIN_ROUTES, /\/milestones/);
  assert.match(ADMIN_ROUTES, /\/volunteers\/:userId\/milestones/);
  assert.match(ADMIN_ROUTES, /\/milestones\/:kind\/email/);
  assert.match(ADMIN_ROUTES, /\/milestones\/:kind\/preview/);
  assert.match(ADMIN_ROUTES, /messageLimiter/);
  assert.doesNotMatch(NOTIFY, /milestone/);
  assert.match(SMS, /disabled|switched off|never/i);
});

test('dashboard and volunteer profile show a discreet staff notice, not a public scoreboard', () => {
  assert.match(DASHBOARD_HTML, /Volunteer milestones/);
  assert.match(DASHBOARD_JS, /\/admin\/milestones/);
  assert.match(VOL_JS, /\/admin\/volunteers\/\$\{userId\}\/milestones/);
  assert.match(VOL_JS, /Send thank-you email/);
  assert.match(VOL_JS, /Staff-only/);
  assert.doesNotMatch(VOL_JS, /score|leaderboard|badge.?board/i);
  assert.doesNotMatch(DASHBOARD_JS, /score|leaderboard/i);
});

test('email preview catalog includes the milestone thank-you template', () => {
  assert.ok(catalogIds().includes('milestone'));
  const parts = buildMilestoneThankYou(
    { firstName: 'Alex', kind: 'anniversary_1y' },
    { name: 'Assisi', signoff: 'ShelterLink, Assisi' }
  );
  assert.match(parts.subject, /Thank you/i);
  assert.match(parts.html, /one year/i);
  assert.match(parts.text, /one year/i);
  const shifts = buildMilestoneThankYou(
    { firstName: 'Alex', kind: 'shifts_50' },
    { name: 'Assisi', signoff: 'ShelterLink, Assisi' }
  );
  assert.match(shifts.html, /50 attended shifts/i);
  assert.doesNotMatch(shifts.html, /score/i);
});

test('oneYearAgo is exactly twelve months earlier', () => {
  assert.equal(Milestone.oneYearAgo(new Date('2026-11-23T12:00:00Z')), '2025-11-23 12:00:00');
});

test('listPending finds anniversary and 50-shift rows and skips already emailed', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.equal(mentionsTenantTable(sql), true);
    if (/FROM users u[\s\S]*anniversary_1y/i.test(sql)) {
      assert.equal(params[0], '2025-11-23 00:00:00');
      return [
        [
          {
            user_id: 2,
            first_name: 'Ada',
            last_name: 'Volunteer',
            email: 'ada@example.test',
            created_at: '2024-01-01 00:00:00',
          },
        ],
      ];
    }
    if (/attended >=/i.test(sql)) {
      assert.equal(params[0], 50);
      return [
        [
          {
            user_id: 3,
            first_name: 'Ben',
            last_name: 'Helper',
            email: 'ben@example.test',
            attended: 52,
          },
        ],
      ];
    }
    return [[]];
  });

  const out = await runWithShelter(1, () =>
    Milestone.listPending({ now: new Date('2026-11-23T00:00:00Z') })
  );
  assert.equal(out.counts.pending, 2);
  assert.equal(out.pending[0].kind, 'anniversary_1y');
  assert.equal(out.pending[1].kind, 'shifts_50');
  assert.equal(out.pending[1].attended, 52);
  assert.match(out.pending[0].href, /volunteers\.html\?user=2/);
});

test('forVolunteer marks pending vs emailed and ignores unreached kinds', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users u[\s\S]*LEFT JOIN volunteer_profiles/i.test(sql)) {
      return [
        [
          {
            user_id: 2,
            first_name: 'Ada',
            last_name: 'Volunteer',
            email: 'ada@example.test',
            role: 'volunteer',
            created_at: '2024-06-01 00:00:00',
            anonymised_at: null,
            approved: 1,
          },
        ],
      ];
    }
    if (/FROM volunteer_milestone_emails/i.test(sql)) {
      return [[{ milestone_kind: 'anniversary_1y', emailed_at: '2026-06-02 10:00:00', emailed_by: 1 }]];
    }
    if (/COUNT\(\*\)::int AS attended/i.test(sql)) {
      return [[{ attended: 12 }]];
    }
    return [[]];
  });

  const out = await runWithShelter(1, () =>
    Milestone.forVolunteer(2, { now: new Date('2026-11-23T00:00:00Z') })
  );
  assert.equal(out.attended, 12);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].kind, 'anniversary_1y');
  assert.equal(out.items[0].emailed, true);
  assert.equal(out.pending.length, 0);
});

test('listPendingMilestones requires staff', async () => {
  const res = makeRes();
  await listPendingMilestones(makeReq({ session: { userId: 2, role: 'volunteer' } }), res);
  assert.equal(res.statusCode, 403);
});

test('getVolunteerMilestones returns summary for staff', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users u[\s\S]*LEFT JOIN volunteer_profiles/i.test(sql)) {
      return [
        [
          {
            user_id: 2,
            first_name: 'Ada',
            last_name: 'V',
            email: 'ada@example.test',
            role: 'volunteer',
            created_at: '2020-01-01 00:00:00',
            anonymised_at: null,
            approved: 1,
          },
        ],
      ];
    }
    if (/FROM volunteer_milestone_emails/i.test(sql)) return [[]];
    if (/COUNT\(\*\)::int AS attended/i.test(sql)) return [[{ attended: 50 }]];
    return [[]];
  });

  const res = makeRes();
  await runWithShelter(1, () =>
    getVolunteerMilestones(makeReq({ params: { userId: '2' } }), res)
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pending.length, 2);
  assert.deepEqual(
    res.body.pending.map((p) => p.kind).sort(),
    ['anniversary_1y', 'shifts_50']
  );
});

test('sendMilestoneEmail records dedup before send and refuses a second send', async () => {
  const previousEmail = process.env.EMAIL_HOST;
  const previousFrom = process.env.EMAIL_FROM;
  process.env.EMAIL_HOST = 'smtp.example.test';
  process.env.EMAIL_FROM = 'noreply@example.test';

  for (const mod of ['../utils/emailConfig', '../utils/emailService', '../controllers/milestoneController']) {
    delete require.cache[require.resolve(mod)];
  }
  const emailService = require('../utils/emailService');
  const originalSend = emailService.sendMilestoneThankYou;
  let sendCalls = 0;
  emailService.sendMilestoneThankYou = async () => {
    sendCalls += 1;
    return { messageId: 'test' };
  };
  // Controller must see the stubbed export.
  delete require.cache[require.resolve('../controllers/milestoneController')];
  const { sendMilestoneEmail: sendAgain } = require('../controllers/milestoneController');

  const rows = {
    volunteer: {
      user_id: 2,
      first_name: 'Ada',
      last_name: 'V',
      email: 'ada@example.test',
      role: 'volunteer',
      created_at: '2020-01-01 00:00:00',
      anonymised_at: null,
      approved: 1,
    },
    emailed: [],
  };

  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM users u[\s\S]*LEFT JOIN volunteer_profiles/i.test(sql)) {
      return [[rows.volunteer]];
    }
    if (/SELECT milestone_kind, emailed_at/i.test(sql)) {
      return [rows.emailed.map((e) => ({ ...e }))];
    }
    if (/SELECT id, emailed_at FROM volunteer_milestone_emails/i.test(sql)) {
      return [rows.emailed.filter((e) => e.milestone_kind === params[1])];
    }
    if (/COUNT\(\*\)::int AS attended/i.test(sql)) return [[{ attended: 8 }]];
    if (/INSERT INTO volunteer_milestone_emails/i.test(sql)) {
      if (rows.emailed.some((e) => e.milestone_kind === params[1])) {
        const err = new Error('duplicate');
        err.code = '23505';
        throw err;
      }
      rows.emailed.push({
        id: 9,
        milestone_kind: params[1],
        emailed_at: '2026-11-23 08:00:00',
        emailed_by: params[2],
      });
      return [{ insertId: 9, affectedRows: 1 }];
    }
    return [[]];
  });

  const first = makeRes();
  await runWithShelter(1, () =>
    sendAgain(
      makeReq({
        method: 'POST',
        params: { userId: '2', kind: 'anniversary_1y' },
        originalUrl: '/api/admin/volunteers/2/milestones/anniversary_1y/email',
      }),
      first
    )
  );
  assert.equal(first.statusCode, 200);
  assert.equal(sendCalls, 1);
  assert.equal(rows.emailed.length, 1);

  const second = makeRes();
  await runWithShelter(1, () =>
    sendAgain(
      makeReq({
        method: 'POST',
        params: { userId: '2', kind: 'anniversary_1y' },
        originalUrl: '/api/admin/volunteers/2/milestones/anniversary_1y/email',
      }),
      second
    )
  );
  assert.equal(second.statusCode, 409);
  assert.equal(sendCalls, 1);

  emailService.sendMilestoneThankYou = originalSend;
  if (previousEmail == null) delete process.env.EMAIL_HOST;
  else process.env.EMAIL_HOST = previousEmail;
  if (previousFrom == null) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = previousFrom;
});

test('sendMilestoneEmail refuses when email is not configured', async () => {
  const previousEmail = process.env.EMAIL_HOST;
  const previousFrom = process.env.EMAIL_FROM;
  delete process.env.EMAIL_HOST;
  delete process.env.EMAIL_FROM;
  for (const mod of ['../utils/emailConfig', '../controllers/milestoneController']) {
    delete require.cache[require.resolve(mod)];
  }
  const { sendMilestoneEmail: sendFresh } = require('../controllers/milestoneController');

  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users u[\s\S]*LEFT JOIN volunteer_profiles/i.test(sql)) {
      return [
        [
          {
            user_id: 2,
            first_name: 'Ada',
            last_name: 'V',
            email: 'ada@example.test',
            role: 'volunteer',
            created_at: '2020-01-01 00:00:00',
            anonymised_at: null,
            approved: 1,
          },
        ],
      ];
    }
    if (/FROM volunteer_milestone_emails/i.test(sql)) return [[]];
    if (/COUNT\(\*\)::int AS attended/i.test(sql)) return [[{ attended: 50 }]];
    return [[]];
  });

  const res = makeRes();
  await runWithShelter(1, () =>
    sendFresh(
      makeReq({
        method: 'POST',
        params: { userId: '2', kind: 'shifts_50' },
      }),
      res
    )
  );
  assert.equal(res.statusCode, 503);

  if (previousEmail == null) delete process.env.EMAIL_HOST;
  else process.env.EMAIL_HOST = previousEmail;
  if (previousFrom == null) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = previousFrom;
});

test('previewMilestoneEmail returns template without sending', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users u[\s\S]*LEFT JOIN volunteer_profiles/i.test(sql)) {
      return [
        [
          {
            user_id: 2,
            first_name: 'Ada',
            last_name: 'V',
            email: 'ada@example.test',
            role: 'volunteer',
            created_at: '2020-01-01 00:00:00',
            anonymised_at: null,
            approved: 1,
          },
        ],
      ];
    }
    if (/FROM volunteer_milestone_emails/i.test(sql)) return [[]];
    if (/COUNT\(\*\)::int AS attended/i.test(sql)) return [[{ attended: 50 }]];
    if (/FROM shelters/i.test(sql)) return [[{ name: 'Assisi Animal Sanctuary' }]];
    return [[]];
  });

  const res = makeRes();
  await runWithShelter(1, () =>
    previewMilestoneEmail(makeReq({ params: { userId: '2', kind: 'shifts_50' } }), res)
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sends_mail, false);
  assert.match(res.body.html, /50 attended shifts/i);
  assert.equal(res.body.to, 'ada@example.test');
});
