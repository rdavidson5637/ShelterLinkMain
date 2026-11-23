'use strict';

// SL-DAY-14: volunteers set usual days/parts; staff see matches on short-staffed
// shifts and email one person on an explicit click. Email only; no SMS.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

for (const mod of [
  '../models/UsualAvailability',
  '../controllers/usualAvailabilityController',
  '../middleware/auth',
  '../utils/emailService',
  '../utils/emailConfig',
  '../utils/emailPreview',
]) {
  const resolved = require.resolve(mod);
  delete require.cache[resolved];
}

const UsualAvailability = require('../models/UsualAvailability');
const {
  getMyUsualAvailability,
  putMyUsualAvailability,
  listUsualAvailabilityForOpportunity,
  emailUsualAvailabilityMatch,
} = require('../controllers/usualAvailabilityController');
const { buildUsualAvailabilityAsk } = require('../utils/emailService');
const { catalogIds } = require('../utils/emailPreview');
const { TENANT_TABLES, runWithShelter } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/070_volunteer_usual_availability.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const OPP_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/opportunities.js'), 'utf8');
const PROFILE_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/profile.js'), 'utf8');
const AUDIT = fs.readFileSync(path.join(ROOT, 'middleware/auditLog.js'), 'utf8');
const WEEK_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/week-sheet.js'), 'utf8');
const PROFILE_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/volunteer/complete-profile.js'),
  'utf8'
);
const PROFILE_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/volunteer/complete-profile.html'),
  'utf8'
);
const CSS = fs.readFileSync(path.join(ROOT, 'frontend/public/css/custom.css'), 'utf8');
const GDPR = fs.readFileSync(path.join(ROOT, 'models/Gdpr.js'), 'utf8');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'utils/notify/index.js'), 'utf8');
const SMS = fs.readFileSync(path.join(ROOT, 'utils/notify/smsProvider.js'), 'utf8');
const BODIES = fs.readFileSync(path.join(ROOT, 'validation/bodies.js'), 'utf8');
const EMAIL_SERVICE = fs.readFileSync(path.join(ROOT, 'utils/emailService.js'), 'utf8');

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
    originalUrl: '/api/opportunities/10/usual-availability',
    ...overrides,
  };
}

test('migration 070 creates volunteer_usual_availability with tenant isolation', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS volunteer_usual_availability/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /tenant_isolation/);
  assert.match(MIGRATION, /assert_same_shelter/);
  assert.match(MIGRATION, /weekday IN \('mon'/);
  assert.match(MIGRATION, /part_of_day IN \('morning'/);
  assert.match(SCHEMA, /CREATE TABLE volunteer_usual_availability/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*volunteer_usual_availability/);
  assert.match(SETUP_DB, /070_volunteer_usual_availability\.pg\.sql/);
  assert.ok(TENANT_TABLES.includes('volunteer_usual_availability'));
});

test('routes expose volunteer slots and staff match email; no SMS path', () => {
  assert.match(PROFILE_ROUTES, /\/usual-availability/);
  assert.match(PROFILE_ROUTES, /putMyUsualAvailability/);
  assert.match(OPP_ROUTES, /\/:id\/usual-availability/);
  assert.match(OPP_ROUTES, /usual-availability\/email/);
  assert.match(OPP_ROUTES, /messageLimiter/);
  assert.match(BODIES, /usualAvailability/);
  assert.match(BODIES, /usualAvailabilityEmail/);
  assert.match(AUDIT, /usual_availability\.email/);
  assert.match(EMAIL_SERVICE, /buildUsualAvailabilityAsk/);
  assert.match(EMAIL_SERVICE, /sendUsualAvailabilityAsk/);
  assert.ok(catalogIds().includes('usual_availability_ask'));
  assert.doesNotMatch(NOTIFY, /usualAvailability|UsualAvailability/);
  assert.match(SMS, /disabled|switched off|never/i);
  assert.match(GDPR, /volunteer_usual_availability/);
});

test('UI: volunteer matrix and week-sheet email click; no emoji grid', () => {
  assert.match(PROFILE_HTML, /Usual days you can help/);
  assert.match(PROFILE_HTML, /usualAvailabilityTable/);
  assert.match(PROFILE_JS, /\/volunteer\/usual-availability/);
  assert.match(PROFILE_HTML, /Save usual days/);
  assert.match(WEEK_JS, /Usually available/);
  assert.match(WEEK_JS, /Email about this shift/);
  assert.match(WEEK_JS, /usual-availability\/email/);
  assert.match(CSS, /SL-DAY-14/);
  assert.match(CSS, /\.usual-availability-list\b/);
  const dayCss = CSS.slice(CSS.indexOf('/* SL-DAY-14:'));
  assert.doesNotMatch(dayCss, /🎉|😀|gradient/);
});

test('partOfDayFromHour and weekdayFromDateOnly map shift times', () => {
  assert.equal(UsualAvailability.partOfDayFromHour(9), 'morning');
  assert.equal(UsualAvailability.partOfDayFromHour(12), 'afternoon');
  assert.equal(UsualAvailability.partOfDayFromHour(16), 'afternoon');
  assert.equal(UsualAvailability.partOfDayFromHour(17), 'evening');
  assert.equal(UsualAvailability.weekdayFromDateOnly('2026-11-23'), 'mon');
  assert.equal(UsualAvailability.weekdayFromDateOnly('2026-11-28'), 'sat');
  const slot = UsualAvailability.slotFromOpportunity({
    start_date: '2026-11-28 09:30:00',
  });
  assert.equal(slot.weekday, 'sat');
  assert.equal(slot.part_of_day, 'morning');
});

test('parseSlots dedupes and rejects bad parts', () => {
  const slots = UsualAvailability.parseSlots([
    { weekday: 'mon', part_of_day: 'morning' },
    { weekday: 'Mon', part_of_day: 'morning' },
    { weekday: 'tue', part_of_day: 'evening' },
  ]);
  assert.equal(slots.length, 2);
  assert.throws(
    () => UsualAvailability.parseSlots([{ weekday: 'mon', part_of_day: 'night' }]),
    /part of day/
  );
});

test('replaceForUser clears and inserts slots', async () => {
  mock.resetCalls();
  const inserted = [];
  mock.setHandler(async (sql, params) => {
    if (/SELECT user_id, role/i.test(sql)) {
      return [[{ user_id: 5, role: 'volunteer', archived_at: null, anonymised_at: null }]];
    }
    if (/DELETE FROM volunteer_usual_availability/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO volunteer_usual_availability/i.test(sql)) {
      inserted.push(params);
      return [{ affectedRows: 1 }];
    }
    if (/FROM volunteer_usual_availability/i.test(sql) && /SELECT weekday/i.test(sql)) {
      return [
        [
          { weekday: 'mon', part_of_day: 'morning' },
          { weekday: 'sat', part_of_day: 'afternoon' },
        ],
      ];
    }
    return [[], []];
  });

  const result = await runWithShelter(1, () =>
    UsualAvailability.replaceForUser(5, [
      { weekday: 'mon', part_of_day: 'morning' },
      { weekday: 'sat', part_of_day: 'afternoon' },
    ])
  );

  assert.equal(result.slots.length, 2);
  assert.equal(inserted.length, 2);
  assert.deepEqual(inserted[0], [5, 'mon', 'morning']);
});

test('listMatchesForOpportunity returns approved usual matches only', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities o/i.test(sql)) {
      return [
        [
          {
            opportunity_id: 10,
            title: 'Morning walks',
            location: 'Yard',
            start_date: '2026-11-28 09:00:00',
            end_date: '2026-11-28 12:00:00',
            max_volunteers: 4,
            status: 'open',
            spots_filled: 1,
          },
        ],
      ];
    }
    if (/FROM volunteer_usual_availability vua/i.test(sql)) {
      return [
        [
          {
            user_id: 7,
            first_name: 'Pat',
            last_name: 'Lee',
            name: 'Pat Lee',
            email: 'pat@example.com',
            phone: '07000',
            away_until: null,
          },
        ],
      ];
    }
    return [[], []];
  });

  const summary = await runWithShelter(1, () =>
    UsualAvailability.listMatchesForOpportunity(10)
  );

  assert.equal(summary.opportunity.short_staffed, true);
  assert.equal(summary.match.weekday, 'sat');
  assert.equal(summary.match.part_of_day, 'morning');
  assert.equal(summary.volunteers.length, 1);
  assert.equal(summary.volunteers[0].email, 'pat@example.com');
});

test('volunteer PUT saves slots; staff email requires short-staffed match', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/SELECT user_id, role/i.test(sql)) {
      return [[{ user_id: 3, role: 'volunteer', archived_at: null, anonymised_at: null }]];
    }
    if (/DELETE FROM volunteer_usual_availability/i.test(sql)) {
      return [{ affectedRows: 0 }];
    }
    if (/INSERT INTO volunteer_usual_availability/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/FROM volunteer_usual_availability/i.test(sql) && /SELECT weekday/i.test(sql)) {
      return [[{ weekday: 'fri', part_of_day: 'evening' }]];
    }
    if (/FROM opportunities o/i.test(sql)) {
      return [
        [
          {
            opportunity_id: 10,
            title: 'Evening feed',
            location: null,
            start_date: '2026-11-27 18:00:00',
            end_date: '2026-11-27 20:00:00',
            max_volunteers: 2,
            status: 'open',
            spots_filled: 2,
          },
        ],
      ];
    }
    if (/FROM volunteer_usual_availability vua/i.test(sql)) {
      return [
        [
          {
            user_id: 9,
            first_name: 'Sam',
            last_name: 'Ng',
            name: 'Sam Ng',
            email: 'sam@example.com',
            phone: null,
            away_until: null,
          },
        ],
      ];
    }
    return [[], []];
  });

  const putRes = makeRes();
  await runWithShelter(1, () =>
    putMyUsualAvailability(
      makeReq({
        session: { userId: 3, role: 'volunteer' },
        body: { slots: [{ weekday: 'fri', part_of_day: 'evening' }] },
        method: 'PUT',
        originalUrl: '/api/volunteer/usual-availability',
      }),
      putRes
    )
  );
  assert.equal(putRes.statusCode, 200);
  assert.equal(putRes.body.slots.length, 1);

  const getRes = makeRes();
  await runWithShelter(1, () =>
    getMyUsualAvailability(
      makeReq({
        session: { userId: 3, role: 'volunteer' },
        method: 'GET',
        originalUrl: '/api/volunteer/usual-availability',
      }),
      getRes
    )
  );
  assert.equal(getRes.statusCode, 200);

  const listRes = makeRes();
  await runWithShelter(1, () =>
    listUsualAvailabilityForOpportunity(
      makeReq({
        session: { userId: 1, role: 'staff' },
        params: { id: '10' },
      }),
      listRes
    )
  );
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.opportunity.short_staffed, false);

  const emailRes = makeRes();
  await runWithShelter(1, () =>
    emailUsualAvailabilityMatch(
      makeReq({
        session: { userId: 1, role: 'staff' },
        params: { id: '10' },
        body: { user_id: 9 },
        method: 'POST',
        originalUrl: '/api/opportunities/10/usual-availability/email',
      }),
      emailRes
    )
  );
  assert.equal(emailRes.statusCode, 400);
  assert.match(emailRes.body.error, /not short-staffed/i);
});

test('buildUsualAvailabilityAsk is plain and specific', () => {
  const brand = { name: 'Assisi', namePlain: 'Assisi', signoff: 'Assisi team' };
  const parts = buildUsualAvailabilityAsk(
    {
      firstName: 'Pat',
      opportunityTitle: 'Morning walks',
      whenLabel: 'Sat 28 Nov, 09:00 - 12:00',
      location: 'Yard',
      matchLabel: 'Saturday morning',
    },
    brand
  );
  assert.match(parts.subject, /Morning walks/);
  assert.match(parts.html, /short-staffed/);
  assert.match(parts.html, /Saturday morning/);
  assert.doesNotMatch(parts.html, /seamless|elevate|journey/i);
});
