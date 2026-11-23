'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

delete require.cache[require.resolve('../models/VolunteerHours')];
delete require.cache[require.resolve('../models/User')];
delete require.cache[require.resolve('../models/ShelterBrand')];
delete require.cache[require.resolve('../controllers/hoursStatementController')];

const { runWithShelter } = require('../utils/shelterContext');
const VolunteerHours = require('../models/VolunteerHours');
const {
  getMyHoursStatement,
  getVolunteerHoursStatement,
  parseRange,
  signedOffByRole,
} = require('../controllers/hoursStatementController');

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

test('parseRange requires both ISO dates in order', () => {
  assert.match(parseRange({}).error, /required/i);
  assert.match(parseRange({ startDate: '2026-02-01', endDate: '2026-01-01' }).error, /before/i);
  const ok = parseRange({ startDate: '2026-01-01', endDate: '2026-03-31' });
  assert.strictEqual(ok.startDate, '2026-01-01');
  assert.strictEqual(ok.endDate, '2026-03-31');
});

test('signedOffByRole uses staff session role when staff-issued', () => {
  assert.strictEqual(signedOffByRole('admin', { staffIssued: true }), 'Administrator');
  assert.strictEqual(signedOffByRole('staff', { staffIssued: true }), 'Staff');
  assert.strictEqual(signedOffByRole('volunteer', { staffIssued: false }), 'Shelter staff');
});

test('findApprovedStatement filters by date and sums hours', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /vh\.approved = 1/);
    assert.deepStrictEqual(params, [4, '2026-01-01', '2026-01-31']);
    return [
      [
        {
          record_id: 1,
          date: '2026-01-10',
          hours: 2.5,
          opportunity_title: 'Dog walk',
          opportunity_location: 'Kennels',
        },
        {
          record_id: 2,
          date: '2026-01-20',
          hours: 3,
          opportunity_title: 'Cat care',
          opportunity_location: null,
        },
      ],
    ];
  });

  const result = await VolunteerHours.findApprovedStatement(4, {
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  });
  assert.strictEqual(result.shift_count, 2);
  assert.strictEqual(result.total_hours, 5.5);
  assert.strictEqual(result.shifts[0].title, 'Dog walk');
});

test('getMyHoursStatement returns shelter, shifts, and signed-off role', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users/i.test(sql)) {
      return [[{ user_id: 4, name: 'Vera Volunteer', email: 'vera@example.com', role: 'volunteer' }]];
    }
    if (/FROM volunteer_hours/i.test(sql) || /FROM volunteer_hours vh/i.test(sql)) {
      return [
        [
          {
            record_id: 9,
            date: '2026-02-05',
            hours: 4,
            opportunity_title: 'Morning kennels',
            opportunity_location: 'Yard',
          },
        ],
      ];
    }
    if (/FROM shelters/i.test(sql)) {
      return [[{ name: 'Assisi', slug: 'assisi', primary_colour: null, logo_mime: null, logo_storage_key: null, has_logo: true }]];
    }
    return [[]];
  });

  const res = makeRes();
  await runWithShelter(1, () =>
    getMyHoursStatement(
      {
        session: { userId: 4, role: 'volunteer' },
        query: { startDate: '2026-01-01', endDate: '2026-12-31' },
      },
      res
    )
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.volunteer.name, 'Vera Volunteer');
  assert.strictEqual(res.body.total_hours, 4);
  assert.strictEqual(res.body.shift_count, 1);
  assert.strictEqual(res.body.shelter.name, 'Assisi');
  assert.strictEqual(res.body.shelter.has_logo, true);
  assert.strictEqual(res.body.signed_off_by.role, 'Shelter staff');
  assert.strictEqual(res.body.shifts[0].title, 'Morning kennels');
});

test('getVolunteerHoursStatement signs off with administrator role', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users/i.test(sql)) {
      return [[{ user_id: 4, name: 'Vera Volunteer', email: 'vera@example.com', role: 'volunteer' }]];
    }
    if (/volunteer_hours/i.test(sql)) {
      return [[{ record_id: 1, date: '2026-03-01', hours: 1.5, opportunity_title: 'Walk', opportunity_location: null }]];
    }
    if (/FROM shelters/i.test(sql)) {
      return [[{ name: 'Assisi', slug: 'assisi', primary_colour: null, logo_mime: null, logo_storage_key: null, has_logo: false }]];
    }
    return [[]];
  });

  const res = makeRes();
  await runWithShelter(1, () =>
    getVolunteerHoursStatement(
      {
        session: { userId: 1, role: 'admin' },
        params: { userId: '4' },
        query: { startDate: '2026-01-01', endDate: '2026-06-30' },
      },
      res
    )
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.signed_off_by.role, 'Administrator');
  assert.strictEqual(res.body.shelter.has_logo, false);
});

test('getMyHoursStatement 400s without dates', async () => {
  const res = makeRes();
  await getMyHoursStatement({ session: { userId: 4 }, query: {} }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('printable hours statement pages include print CSS and date range controls', () => {
  const volunteerPage = fs.readFileSync(
    path.join(__dirname, '../frontend/pages/volunteer/certificate.html'),
    'utf8'
  );
  const staffPage = fs.readFileSync(
    path.join(__dirname, '../frontend/pages/admin/hours-statement.html'),
    'utf8'
  );
  for (const html of [volunteerPage, staffPage]) {
    assert.match(html, /@media print/);
    assert.match(html, /id="startDate"/);
    assert.match(html, /id="endDate"/);
    assert.match(html, /id="printButton"/);
    assert.match(html, /hours-statement-sheet/);
    assert.doesNotMatch(html, /pdf\.js|puppeteer|stripe|twilio/i);
  }
  const sharedJs = fs.readFileSync(
    path.join(__dirname, '../frontend/js/hoursStatementShared.js'),
    'utf8'
  );
  assert.match(sharedJs, /Signed off by/);
  assert.match(sharedJs, /hours-statement-logo/);
});
