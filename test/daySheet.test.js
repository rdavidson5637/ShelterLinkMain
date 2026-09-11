'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

delete require.cache[require.resolve('../models/DaySheet')];
delete require.cache[require.resolve('../models/AuditLog')];
delete require.cache[require.resolve('../controllers/daySheetController')];
delete require.cache[require.resolve('../middleware/auditLog')];

const DaySheet = require('../models/DaySheet');
const { getDaySheet } = require('../controllers/daySheetController');

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
    originalUrl: '/api/admin/day-sheet',
    ...overrides,
  };
}

test('isValidDateOnly rejects junk', () => {
  assert.strictEqual(DaySheet.isValidDateOnly('2026-08-26'), true);
  assert.strictEqual(DaySheet.isValidDateOnly('26-08-2026'), false);
  assert.strictEqual(DaySheet.isValidDateOnly('2026-13-01'), false);
  assert.strictEqual(DaySheet.isValidDateOnly(null), false);
});

test('getForDate filters by date and only lists accepted volunteers', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM opportunities o/i.test(sql) && /start_date::date/i.test(sql)) {
      assert.strictEqual(params[0], '2026-08-26');
      assert.strictEqual(params[1], '2026-08-26');
      return [[
        {
          opportunity_id: 10,
          title: 'Morning walks',
          location: 'Kennels',
          start_date: '2026-08-26 09:00:00',
          end_date: '2026-08-26 11:00:00',
          check_in_code: 'ABC123',
          max_volunteers: 4,
          status: 'open',
          is_urgent: 0,
          activity_notes: null,
          waitlist_count: 2,
        },
      ]];
    }
    if (/FROM applications a/i.test(sql) && /accepted/i.test(sql)) {
      assert.match(sql, /accepted.*approved|approved.*accepted/i);
      assert.ok(!/pending/i.test(sql.split('WHERE')[1] || ''));
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

  const sheet = await DaySheet.getForDate('2026-08-26');
  assert.strictEqual(sheet.date, '2026-08-26');
  assert.strictEqual(sheet.opportunities.length, 1);
  assert.strictEqual(sheet.opportunities[0].waitlist_count, 2);
  assert.strictEqual(sheet.opportunities[0].volunteers.length, 1);
  assert.strictEqual(sheet.opportunities[0].volunteers[0].phone, '07700');
  assert.strictEqual(sheet.opportunities[0].volunteers[0].emergency_contact, 'Mum 07701');
  assert.ok(Array.isArray(sheet.opportunities[0].shift_notes));
});

test('getDaySheet writes audit row and allows staff', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities o/i.test(sql)) return [[]];
    if (/INSERT INTO audit_log/i.test(sql)) return [{ insertId: 99 }];
    return [[]];
  });

  const res = makeRes();
  await getDaySheet(makeReq({ query: { date: '2026-08-26' } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.date, '2026-08-26');
  const audit = mock.calls.find((c) => /INSERT INTO audit_log/i.test(c.sql));
  assert.ok(audit, 'expected audit_log insert');
  assert.strictEqual(audit.params[1], 'day_sheet.view');
});

test('getDaySheet rejects volunteers with 403', async () => {
  const res = makeRes();
  await getDaySheet(
    makeReq({ session: { userId: 3, role: 'volunteer' }, query: { date: '2026-08-26' } }),
    res
  );
  assert.strictEqual(res.statusCode, 403);
});

test('getDaySheet rejects invalid date', async () => {
  const res = makeRes();
  await getDaySheet(makeReq({ query: { date: 'not-a-date' } }), res);
  assert.strictEqual(res.statusCode, 400);
});
