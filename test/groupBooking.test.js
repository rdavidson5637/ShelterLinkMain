'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const groupCtrl = require('../controllers/groupBookingController');
const { groupBookingEmailLimiter, LIMITS } = require('../middleware/rateLimiter');

function makeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.send = (body) => {
    res.body = body;
    return res;
  };
  res.setHeader = (key, value) => {
    res.headers[key] = value;
  };
  return res;
}

function body(overrides = {}) {
  return {
    opportunity_id: 3,
    group_name: 'Year 6',
    contact_name: 'Pat Example',
    contact_email: 'pat@example.com',
    size: 8,
    notes: 'Arriving by coach',
    fax_extension: '',
    started_at: Date.now() - 10000,
    ...overrides,
  };
}

function readyHandler() {
  mock.setHandler(async (sql) => {
    if (/FROM shelters/i.test(sql)) return [[{ id: 1 }]];
    if (/FROM opportunities/i.test(sql)) {
      return [[{
        opportunity_id: 3,
        id: 3,
        title: 'Kennel morning',
        status: 'open',
        max_volunteers: null,
      }]];
    }
    if (/INSERT INTO group_bookings/i.test(sql)) return [{ insertId: 12 }];
    if (/FROM group_bookings/i.test(sql)) {
      return [[{
        id: 12,
        group_name: 'Year 6',
        contact_name: 'Pat Example',
        contact_email: 'pat@example.com',
        size: 8,
        status: 'pending',
        opportunity_title: 'Kennel morning',
      }]];
    }
    return [[]];
  });
}

test('a real group booking is stored', async () => {
  mock.resetCalls();
  readyHandler();
  const res = makeRes();
  await groupCtrl.createGroupBooking({ body: body() }, res);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.id, 12);
  assert.ok(mock.calls.some((call) => /INSERT INTO group_bookings/i.test(call.sql)));
});

test('a filled honeypot is rejected and nothing is stored', async () => {
  mock.resetCalls();
  readyHandler();
  const res = makeRes();
  await groupCtrl.createGroupBooking({ body: body({ fax_extension: 'http://spam.test' }) }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.ok(!mock.calls.some((call) => /INSERT INTO group_bookings/i.test(call.sql)));
});

test('a form submitted too quickly is rejected', async () => {
  mock.resetCalls();
  readyHandler();
  const res = makeRes();
  await groupCtrl.createGroupBooking({ body: body({ started_at: Date.now() }) }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /wait a moment/i);
  assert.ok(!mock.calls.some((call) => /INSERT INTO group_bookings/i.test(call.sql)));
});

test('notes over the length cap are rejected', async () => {
  const res = makeRes();
  await groupCtrl.createGroupBooking({ body: body({ notes: 'a'.repeat(1001) }) }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /too long/i);
});

test('control characters in the email are rejected', async () => {
  const res = makeRes();
  await groupCtrl.createGroupBooking({
    body: body({ contact_email: 'pat@example.com\nBcc: evil@example.com' }),
  }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /invalid/i);
});

test('the same email is capped per day', async () => {
  const email = `cap-${Date.now()}@example.com`;
  let allowed = 0;
  let blocked = 0;
  for (let i = 0; i < LIMITS.groupBookingEmail + 1; i += 1) {
    const res = makeRes();
    let next = false;
    await groupBookingEmailLimiter(
      { body: { contact_email: email }, ip: '203.0.113.10' },
      res,
      () => {
        next = true;
      }
    );
    if (next) allowed += 1;
    else blocked += 1;
  }
  assert.strictEqual(allowed, 3);
  assert.strictEqual(blocked, 1);
});
