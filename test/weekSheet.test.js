'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

delete require.cache[require.resolve('../models/DaySheet')];
delete require.cache[require.resolve('../models/AuditLog')];
delete require.cache[require.resolve('../controllers/weekSheetController')];
delete require.cache[require.resolve('../controllers/publicController')];
delete require.cache[require.resolve('../middleware/auditLog')];

const DaySheet = require('../models/DaySheet');
const { getWeekSheet, getWeekSheetIcs } = require('../controllers/weekSheetController');

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    sent: undefined,
  };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.send = (b) => {
    res.sent = b;
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
    originalUrl: '/api/admin/week-sheet',
    ...overrides,
  };
}

test('isMonday accepts Mondays only', () => {
  assert.strictEqual(DaySheet.isMonday('2026-08-24'), true);
  assert.strictEqual(DaySheet.isMonday('2026-08-25'), false);
  assert.strictEqual(DaySheet.isMonday('not-a-date'), false);
});

test('getForWeek groups opportunities by day and includes phones', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM opportunities o/i.test(sql) && /start_date::date >=/i.test(sql)) {
      assert.strictEqual(params[0], '2026-08-24');
      assert.strictEqual(params[1], '2026-08-30');
      return [[
        {
          opportunity_id: 10,
          title: 'Monday walks',
          location: 'Kennels',
          start_date: '2026-08-24 09:00:00',
          end_date: '2026-08-24 11:00:00',
          check_in_code: 'ABC123',
          max_volunteers: 4,
          status: 'open',
          is_urgent: 0,
          activity_notes: null,
          waitlist_count: 0,
        },
        {
          opportunity_id: 11,
          title: 'Wednesday clean',
          location: 'Cattery',
          start_date: '2026-08-26 10:00:00',
          end_date: '2026-08-26 12:00:00',
          check_in_code: 'XYZ789',
          max_volunteers: 2,
          status: 'open',
          is_urgent: 0,
          activity_notes: null,
          waitlist_count: 1,
        },
      ]];
    }
    if (/FROM applications a/i.test(sql) && /accepted/i.test(sql)) {
      return [[
        {
          application_id: 1,
          opportunity_id: 10,
          status: 'accepted',
          checked_in_at: null,
          checked_out_at: null,
          no_show: 0,
          user_id: 5,
          first_name: 'Ann',
          last_name: 'Volunteer',
          phone: '07700',
          emergency_contact: 'Mum 07701',
        },
      ]];
    }
    if (/FROM opportunity_qualifications/i.test(sql)) return [[]];
    if (/FROM volunteer_qualifications/i.test(sql)) return [[]];
    if (/FROM opportunity_animals/i.test(sql)) return [[]];
    if (/FROM shift_notes/i.test(sql)) return [[]];
    return [[]];
  });

  const sheet = await DaySheet.getForWeek('2026-08-24');
  assert.strictEqual(sheet.week_start, '2026-08-24');
  assert.strictEqual(sheet.week_end, '2026-08-30');
  assert.strictEqual(sheet.days.length, 7);
  assert.strictEqual(sheet.days[0].opportunities.length, 1);
  assert.strictEqual(sheet.days[0].opportunities[0].volunteers[0].phone, '07700');
  assert.strictEqual(sheet.days[2].opportunities.length, 1);
  assert.strictEqual(sheet.days[2].opportunities[0].title, 'Wednesday clean');
  assert.strictEqual(sheet.days[1].opportunities.length, 0);
});

test('getForWeek rejects non-Monday', async () => {
  await assert.rejects(
    () => DaySheet.getForWeek('2026-08-25'),
    /week_start must be a Monday/
  );
});

test('getWeekSheet writes audit and allows staff', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities o/i.test(sql)) return [[]];
    if (/INSERT INTO audit_log/i.test(sql)) return [{ insertId: 99 }];
    return [[]];
  });

  const res = makeRes();
  await getWeekSheet(makeReq({ query: { week_start: '2026-08-24' } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.week_start, '2026-08-24');
  const audit = mock.calls.find((c) => /INSERT INTO audit_log/i.test(c.sql));
  assert.ok(audit, 'expected audit_log insert');
  assert.strictEqual(audit.params[1], 'week_sheet.view');
});

test('getWeekSheet rejects volunteers with 403', async () => {
  const res = makeRes();
  await getWeekSheet(
    makeReq({
      session: { userId: 3, role: 'volunteer' },
      query: { week_start: '2026-08-24' },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 403);
});

test('getWeekSheet rejects non-Monday week_start', async () => {
  const res = makeRes();
  await getWeekSheet(makeReq({ query: { week_start: '2026-08-26' } }), res);
  assert.strictEqual(res.statusCode, 400);
});

test('getWeekSheetIcs returns calendar payload', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities o/i.test(sql)) {
      return [[
        {
          opportunity_id: 10,
          title: 'Monday walks',
          location: 'Kennels',
          start_date: '2026-08-24 09:00:00',
          end_date: '2026-08-24 11:00:00',
          check_in_code: 'ABC123',
          max_volunteers: 4,
          status: 'open',
          is_urgent: 0,
          activity_notes: null,
          waitlist_count: 0,
        },
      ]];
    }
    if (/FROM applications a/i.test(sql)) {
      return [[
        {
          application_id: 1,
          opportunity_id: 10,
          status: 'accepted',
          checked_in_at: null,
          checked_out_at: null,
          no_show: 0,
          user_id: 5,
          first_name: 'Ann',
          last_name: 'Volunteer',
          phone: '07700',
          emergency_contact: null,
        },
      ]];
    }
    if (/INSERT INTO audit_log/i.test(sql)) return [{ insertId: 1 }];
    return [[]];
  });

  const res = makeRes();
  await getWeekSheetIcs(makeReq({ query: { week_start: '2026-08-24' } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.match(String(res.headers['Content-Type'] || ''), /text\/calendar/);
  assert.match(String(res.sent), /BEGIN:VCALENDAR/);
  assert.match(String(res.sent), /Monday walks/);
  assert.match(String(res.sent), /Ann Volunteer/);

  // The shift is entered as '2026-08-24 09:00:00' — the shelter's own local
  // wall-clock time. DTSTART must reproduce that exactly, as a floating
  // local time (no 'Z'), regardless of the app server's own timezone —
  // previously this went through `new Date(value)`, which reinterpreted the
  // space-separated string as SERVER-local time and shifted it.
  assert.match(String(res.sent), /DTSTART:20260824T090000\r?\n/);
  assert.ok(
    !/DTSTART:20260824T090000Z/.test(String(res.sent)),
    'shift time must not be stamped as a UTC instant'
  );
});
