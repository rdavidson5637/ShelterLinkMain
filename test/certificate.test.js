'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

delete require.cache[require.resolve('../models/Certificate')];
delete require.cache[require.resolve('../models/VolunteerHours')];
delete require.cache[require.resolve('../models/Application')];
delete require.cache[require.resolve('../models/Badge')];
delete require.cache[require.resolve('../models/User')];
delete require.cache[require.resolve('../controllers/certificateController')];

const Certificate = require('../models/Certificate');
const {
  issueMyCertificate,
  getMyCertificate,
  verifyCertificate,
  publicVerifyPayload,
} = require('../controllers/certificateController');

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

test('issueForUser freezes hours and shifts snapshot', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/SUM\(hours\)/i.test(sql)) return [[{ total_hours: 42.5 }]];
    if (/COUNT\(\*\)/i.test(sql) && /applications/i.test(sql)) {
      return [[{ cnt: 7 }]];
    }
    if (/INSERT INTO certificates/i.test(sql)) {
      assert.strictEqual(params[0], 4);
      assert.strictEqual(params[1].length, 12);
      assert.strictEqual(params[2], 42.5);
      assert.strictEqual(params[3], 7);
      return [{ insertId: 21 }];
    }
    if (/FROM certificates/i.test(sql) && /WHERE c\.id/i.test(sql)) {
      return [[
        {
          id: 21,
          user_id: 4,
          code: 'ABCDEFGHJKLM',
          issued_at: '2026-08-26 12:00:00',
          hours_at_issue: 42.5,
          shifts_at_issue: 7,
          first_name: 'Vera',
          last_name: 'Volunteer',
        },
      ]];
    }
    return [[]];
  });

  const cert = await Certificate.issueForUser(4);
  assert.strictEqual(cert.hours_at_issue, 42.5);
  assert.strictEqual(cert.shifts_at_issue, 7);
  assert.strictEqual(cert.code.length, 12);
});

test('issueMyCertificate requires auth and returns badges', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users/i.test(sql) && /user_id/i.test(sql)) {
      return [[{ user_id: 4, first_name: 'Vera', last_name: 'Volunteer', role: 'volunteer' }]];
    }
    if (/SUM\(hours\)/i.test(sql)) return [[{ total_hours: 10 }]];
    if (/COUNT\(\*\)/i.test(sql) && /applications/i.test(sql)) return [[{ cnt: 2 }]];
    if (/INSERT INTO certificates/i.test(sql)) return [{ insertId: 30 }];
    if (/FROM certificates/i.test(sql)) {
      return [[
        {
          id: 30,
          user_id: 4,
          code: 'CODE12345678',
          issued_at: '2026-08-26',
          hours_at_issue: 10,
          shifts_at_issue: 2,
          first_name: 'Vera',
          last_name: 'Volunteer',
        },
      ]];
    }
    return [[]];
  });

  const res = makeRes();
  await issueMyCertificate({ session: { userId: 4, role: 'volunteer' } }, res);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.hours_at_issue, 10);
  assert.strictEqual(res.body.code, 'CODE12345678');
  assert.ok(Array.isArray(res.body.badges));
});

test('getMyCertificate 404s when none issued', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  await getMyCertificate({ session: { userId: 4 } }, res);
  assert.strictEqual(res.statusCode, 404);
});

test('verify endpoint returns limited public fields', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.strictEqual(params[0], 'ABCDEFGHJKLM');
    return [[
      {
        id: 21,
        user_id: 4,
        code: 'ABCDEFGHJKLM',
        issued_at: '2026-08-26',
        hours_at_issue: 42.5,
        shifts_at_issue: 7,
        first_name: 'Vera',
        last_name: 'Volunteer',
        email: 'secret@x.com',
      },
    ]];
  });

  const res = makeRes();
  await verifyCertificate({ params: { code: 'abcdefghjklm' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.first_name, 'Vera');
  assert.strictEqual(res.body.last_initial, 'V.');
  assert.strictEqual(res.body.hours, 42.5);
  assert.strictEqual(res.body.shifts, 7);
  assert.strictEqual(res.body.email, undefined);
  assert.strictEqual(res.body.last_name, undefined);
});

test('verify 404s unknown codes', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  await verifyCertificate({ params: { code: 'NOSUCHCODE00' } }, res);
  assert.strictEqual(res.statusCode, 404);
});

test('publicVerifyPayload redacts last name', () => {
  const payload = publicVerifyPayload({
    first_name: 'Sam',
    last_name: 'Smith',
    hours_at_issue: 3,
    shifts_at_issue: 1,
    issued_at: '2026-01-01',
    code: 'ABCDEFGHJKLM',
    email: 'x@y.com',
  });
  assert.strictEqual(payload.last_initial, 'S.');
  assert.strictEqual(payload.email, undefined);
});
