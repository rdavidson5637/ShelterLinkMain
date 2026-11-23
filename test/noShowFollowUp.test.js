'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { runWithShelter } = require('../utils/shelterContext');

const emailCalls = [];
const emailPath = require.resolve('../utils/emailService');
const realEmail = require(emailPath);
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    ...realEmail,
    sendNoShowFollowUp: async (...args) => {
      emailCalls.push(args);
      return { messageId: 'test-noshow' };
    },
  },
};

const Application = require('../models/Application');
const {
  listNoShows,
  markNoShowContacted,
} = require('../controllers/applicationController');
const { bodies, queries } = require('../validation/bodies');
const { buildNoShowFollowUp } = realEmail;
const { inferFromRequest } = require('../middleware/auditLog');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/069_noshow_followup.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const ROUTES = fs.readFileSync(path.join(ROOT, 'routes/applications.js'), 'utf8');
const NAV = fs.readFileSync(path.join(ROOT, 'frontend/js/components/navConfig.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'frontend/pages/admin/no-shows.html'), 'utf8');
const PAGE_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/no-shows.js'), 'utf8');
const EMAIL_JS = fs.readFileSync(path.join(ROOT, 'utils/emailService.js'), 'utf8');
const RELIABILITY_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/reliability.js'), 'utf8');

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
    session: { userId: 2, role: 'staff' },
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

test('migration 063 adds contacted and follow-up columns', () => {
  assert.match(MIGRATION, /no_show_contacted_at/);
  assert.match(MIGRATION, /no_show_contacted_by/);
  assert.match(MIGRATION, /no_show_followup_sent_at/);
  assert.match(MIGRATION, /applications_no_show_contacted_idx/);
  assert.match(SCHEMA, /no_show_contacted_at/);
  assert.match(SCHEMA, /no_show_followup_sent_at/);
  assert.match(SETUP_DB, /067_noshow_followup\.pg\.sql/);
});

test('routes and nav expose the staff no-show follow-up queue', () => {
  assert.match(ROUTES, /\/no-shows/);
  assert.match(ROUTES, /no-show\/contacted/);
  assert.match(NAV, /no-shows\.html/);
  assert.match(NAV, /No-show follow-up/);
  assert.match(PAGE, /No-show follow-up/);
  assert.match(PAGE_JS, /send_email/);
  assert.match(PAGE_JS, /Mark contacted/);
});

test('noShowContacted and noShows query schemas validate', () => {
  assert.equal(bodies.noShowContacted.safeParse({}).success, true);
  assert.equal(bodies.noShowContacted.safeParse({ send_email: true, message: 'Hi' }).success, true);
  assert.equal(bodies.noShowContacted.safeParse({ send_email: 'maybe' }).success, false);
  assert.equal(queries.noShows.safeParse({ contacted: 'open', days: '90' }).success, true);
  assert.equal(queries.noShows.safeParse({ contacted: 'bad' }).success, false);
});

test('follow-up email copy has no judgement labels or scores', () => {
  const brand = {
    signoff: 'ShelterLink, Example Sanctuary',
    signoffPlain: 'ShelterLink, Example Sanctuary',
  };
  const parts = buildNoShowFollowUp(
    {
      volunteerName: 'Alex',
      opportunityTitle: 'Morning walk',
      shiftDate: '2026-11-15T09:00:00.000Z',
      message: 'Hope you are well.',
    },
    brand
  );
  assert.match(parts.subject, /missed shift/i);
  assert.match(parts.html, /Morning walk/);
  assert.match(parts.html, /Hope you are well/);
  const banned = /unreliable|score|rating|flaky|strike|blacklist|red.?flag/i;
  assert.equal(banned.test(parts.html), false);
  assert.equal(banned.test(parts.text || ''), false);
  assert.equal(banned.test(PAGE), false);
  assert.equal(banned.test(PAGE_JS), false);
  // This task must not invent labels in reliability UI either.
  assert.equal(RELIABILITY_JS.includes('unreliable'), false);
});

test('buildNoShowFollowUp escapes staff message HTML', () => {
  const brand = { signoff: 'ShelterLink', signoffPlain: 'ShelterLink' };
  const parts = buildNoShowFollowUp(
    { volunteerName: 'Sam', opportunityTitle: 'Feed', message: '<script>alert(1)</script>' },
    brand
  );
  assert.equal(parts.html.includes('<script>'), false);
  assert.match(parts.html, /&lt;script&gt;/);
});

test('listRecentNoShows filters open no-shows by default', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /COALESCE\(a\.no_show, 0\) = 1/);
    assert.match(sql, /no_show_contacted_at IS NULL/);
    assert.equal(params[0], 90);
    assert.equal(params[1], 100);
    return [[
      {
        application_id: 11,
        user_id: 5,
        opportunity_id: 3,
        status: 'accepted',
        applied_at: '2026-11-01T00:00:00.000Z',
        no_show: 1,
        no_show_contacted_at: null,
        no_show_contacted_by: null,
        no_show_followup_sent_at: null,
        first_name: 'Ada',
        last_name: 'Lovelace',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        opportunity_title: 'Kennel walk',
        opportunity_location: 'Yard',
        opportunity_start_date: '2026-11-10T09:00:00.000Z',
        opportunity_end_date: '2026-11-10T12:00:00.000Z',
      },
    ]];
  });

  const rows = await runWithShelter(1, () => Application.listRecentNoShows({}));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].volunteer_name, 'Ada Lovelace');
  assert.equal(rows[0].id, 11);
});

test('listNoShows rejects volunteers', async () => {
  const res = makeRes();
  await listNoShows(makeReq({ session: { userId: 9, role: 'volunteer' } }), res);
  assert.equal(res.statusCode, 403);
});

test('listNoShows returns items for staff', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  await listNoShows(makeReq({ query: { contacted: 'all', days: '30' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, []);
  assert.equal(res.body.contacted, 'all');
  assert.equal(res.body.days, 30);
});

test('markNoShowContacted without send_email does not send mail', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM applications a/.test(sql) && /WHERE a\.application_id =/.test(sql)) {
      return [[
        {
          application_id: 11,
          user_id: 5,
          opportunity_id: 3,
          status: 'accepted',
          applied_at: '2026-11-01T00:00:00.000Z',
          no_show: 1,
          no_show_contacted_at: null,
          no_show_contacted_by: null,
          no_show_followup_sent_at: null,
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          opportunity_title: 'Kennel walk',
          opportunity_start_date: '2026-11-10T09:00:00.000Z',
          opportunity_end_date: '2026-11-10T12:00:00.000Z',
          checked_in_at: null,
          checked_out_at: null,
          reminder_sent_at: null,
          rejection_reason: null,
          location: 'Yard',
          check_in_code: null,
          cancellation_cutoff_hours: 24,
        },
      ]];
    }
    if (/UPDATE applications/.test(sql) && /no_show_contacted_at/.test(sql)) {
      assert.equal(params[2], 0);
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const res = makeRes();
  await markNoShowContacted(
    makeReq({ params: { id: '11' }, body: { send_email: false } }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.email_sent, false);
  assert.equal(emailCalls.length, 0);
});

test('markNoShowContacted sends email only when staff sets send_email', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM applications a/.test(sql) && /WHERE a\.application_id =/.test(sql)) {
      return [[
        {
          application_id: 11,
          user_id: 5,
          opportunity_id: 3,
          status: 'accepted',
          applied_at: '2026-11-01T00:00:00.000Z',
          no_show: 1,
          no_show_contacted_at: null,
          no_show_contacted_by: null,
          no_show_followup_sent_at: null,
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          opportunity_title: 'Kennel walk',
          opportunity_start_date: '2026-11-10T09:00:00.000Z',
          opportunity_end_date: '2026-11-10T12:00:00.000Z',
          checked_in_at: null,
          checked_out_at: null,
          reminder_sent_at: null,
          rejection_reason: null,
          location: 'Yard',
          check_in_code: null,
          cancellation_cutoff_hours: 24,
        },
      ]];
    }
    if (/UPDATE applications/.test(sql) && /no_show_contacted_at/.test(sql)) {
      assert.equal(params[2], 1);
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const res = makeRes();
  await markNoShowContacted(
    makeReq({
      params: { id: '11' },
      body: { send_email: true, message: 'Hope you are well.' },
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.email_sent, true);
  assert.equal(emailCalls.length, 1);
  assert.equal(emailCalls[0][0], 'ada@example.com');
  assert.equal(emailCalls[0][1].message, 'Hope you are well.');
});

test('markNoShowContacted rejects non-no-show applications', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async () => [[
    {
      application_id: 12,
      user_id: 5,
      opportunity_id: 3,
      status: 'accepted',
      no_show: 0,
      email: 'ada@example.com',
      name: 'Ada',
      opportunity_title: 'Walk',
      opportunity_start_date: '2026-11-10T09:00:00.000Z',
    },
  ]]);
  const res = makeRes();
  await markNoShowContacted(makeReq({ params: { id: '12' }, body: {} }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(emailCalls.length, 0);
});

test('email helper export exists and is email-only (no SMS wording in sender)', () => {
  assert.match(EMAIL_JS, /function buildNoShowFollowUp/);
  assert.match(EMAIL_JS, /async function sendNoShowFollowUp/);
  assert.equal(/twilio|sms/i.test(EMAIL_JS.slice(EMAIL_JS.indexOf('buildNoShowFollowUp'))), false);
});

test('audit maps contacted path separately from mark no-show', () => {
  const contacted = inferFromRequest({
    method: 'PATCH',
    originalUrl: '/api/applications/11/no-show/contacted',
  });
  assert.equal(contacted.action, 'application.no_show_contacted');
  const marked = inferFromRequest({
    method: 'PATCH',
    originalUrl: '/api/applications/11/no-show',
  });
  assert.equal(marked.action, 'application.no_show');
});
