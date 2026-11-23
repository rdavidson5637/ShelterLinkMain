'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { hashIcalToken } = require('../utils/icalToken');
const Application = require('../models/Application');
const publicCtrl = require('../controllers/publicController');

function makeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

test('getMyIcalToken mints a hashed token and returns the raw URL once', async () => {
  const prev = process.env.APP_URL;
  process.env.APP_URL = 'https://shelterlink.online';
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/SELECT user_id, ical_token/i.test(sql)) {
      return [[{ user_id: 9, ical_token: null }]];
    }
    if (/UPDATE users SET ical_token/i.test(sql)) {
      assert.match(params[0], /^[0-9a-f]{64}$/);
      assert.equal(params[1], 9);
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const session = { userId: 9 };
  const res = makeRes();
  await publicCtrl.getMyIcalToken({ session, protocol: 'http', get: () => 'localhost:3000' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.configured, true);
  assert.ok(res.body.token);
  assert.equal(res.body.token.length, 64);
  assert.equal(
    res.body.url,
    `https://shelterlink.online/api/my-shifts.ics?token=${res.body.token}`
  );
  assert.equal(session.icalTokenRaw, res.body.token);

  const update = mock.calls.find((c) => /UPDATE users SET ical_token/i.test(c.sql));
  assert.ok(update);
  assert.equal(update.params[0], hashIcalToken(res.body.token));
  assert.notEqual(update.params[0], res.body.token);

  if (prev === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = prev;
});

test('getMyIcalToken hides the raw secret when only the hash is stored', async () => {
  const raw = 'b'.repeat(64);
  const hash = hashIcalToken(raw);
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/SELECT user_id, ical_token/i.test(sql)) {
      return [[{ user_id: 9, ical_token: hash }]];
    }
    return [[]];
  });

  const res = makeRes();
  await publicCtrl.getMyIcalToken({
    session: { userId: 9 },
    protocol: 'http',
    get: () => 'localhost:3000',
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.configured, true);
  assert.equal(res.body.token, null);
  assert.equal(res.body.url, null);
});

test('getMyIcalToken reuses session raw when it matches the stored hash', async () => {
  const prev = process.env.APP_URL;
  process.env.APP_URL = 'https://shelterlink.online';
  const raw = 'c'.repeat(64);
  const hash = hashIcalToken(raw);
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/SELECT user_id, ical_token/i.test(sql)) {
      return [[{ user_id: 9, ical_token: hash }]];
    }
    return [[]];
  });

  const res = makeRes();
  await publicCtrl.getMyIcalToken({
    session: { userId: 9, icalTokenRaw: raw },
    protocol: 'http',
    get: () => 'localhost:3000',
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.token, raw);
  assert.equal(res.body.url, `https://shelterlink.online/api/my-shifts.ics?token=${raw}`);
  if (prev === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = prev;
});

test('resetMyIcalToken rotates the hash and returns a new URL', async () => {
  const prev = process.env.APP_URL;
  process.env.APP_URL = 'https://shelterlink.online';
  const oldRaw = 'd'.repeat(64);
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/SELECT user_id, ical_token/i.test(sql)) {
      return [[{ user_id: 9, ical_token: hashIcalToken(oldRaw) }]];
    }
    if (/UPDATE users SET ical_token/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const session = { userId: 9, icalTokenRaw: oldRaw };
  const res = makeRes();
  await publicCtrl.resetMyIcalToken({ session, protocol: 'http', get: () => 'x' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reset, true);
  assert.ok(res.body.token);
  assert.notEqual(res.body.token, oldRaw);
  assert.equal(session.icalTokenRaw, res.body.token);

  const update = mock.calls.find((c) => /UPDATE users SET ical_token/i.test(c.sql));
  assert.equal(update.params[0], hashIcalToken(res.body.token));
  assert.notEqual(update.params[0], res.body.token);

  if (prev === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = prev;
});

test('my-shifts feed looks up the hashed token and drops cancelled shifts', async () => {
  const raw = 'e'.repeat(64);
  const hash = hashIcalToken(raw);
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM users WHERE ical_token/i.test(sql)) {
      assert.equal(params[0], hash);
      return [[{ user_id: 4, shelter_id: 1, ical_token: hash }]];
    }
    return [[]];
  });

  const original = Application.findByUserId;
  Application.findByUserId = async () => ([
    {
      application_id: 1,
      status: 'accepted',
      opportunity_title: 'Keep me',
      opportunity_location: 'Yard',
      opportunity_start_date: '2099-06-01 10:00:00',
      opportunity_end_date: '2099-06-01 12:00:00',
    },
    {
      application_id: 2,
      status: 'cancelled',
      opportunity_title: 'Drop me',
      opportunity_location: 'Yard',
      opportunity_start_date: '2099-06-02 10:00:00',
      opportunity_end_date: '2099-06-02 12:00:00',
    },
    {
      application_id: 3,
      status: 'rejected',
      opportunity_title: 'Also drop',
      opportunity_location: 'Yard',
      opportunity_start_date: '2099-06-03 10:00:00',
      opportunity_end_date: '2099-06-03 12:00:00',
    },
  ]);

  try {
    const res = makeRes();
    await publicCtrl.myShiftsIcs({ query: { token: raw } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /SUMMARY:Keep me/);
    assert.doesNotMatch(res.body, /Drop me/);
    assert.doesNotMatch(res.body, /Also drop/);
  } finally {
    Application.findByUserId = original;
  }
});

test('my-shifts feed upgrades legacy plaintext tokens to hashes', async () => {
  const raw = 'a'.repeat(48);
  assert.equal(raw.length, 48);
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM users WHERE ical_token/i.test(sql) && params[0] === hashIcalToken(raw)) {
      return [[]];
    }
    if (/FROM users WHERE ical_token/i.test(sql) && params[0] === raw) {
      return [[{ user_id: 5, shelter_id: 2, ical_token: raw }]];
    }
    if (/UPDATE users SET ical_token/i.test(sql)) {
      assert.equal(params[0], hashIcalToken(raw));
      assert.equal(params[1], 5);
      assert.equal(params[2], raw);
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const original = Application.findByUserId;
  Application.findByUserId = async () => [];
  try {
    const res = makeRes();
    await publicCtrl.myShiftsIcs({ query: { token: raw } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(mock.calls.some((c) => /UPDATE users SET ical_token/i.test(c.sql)));
  } finally {
    Application.findByUserId = original;
  }
});

test('my-shifts feed 404s when shelter context does not match the token owner', async () => {
  const raw = 'f'.repeat(64);
  const hash = hashIcalToken(raw);
  const { runWithShelter } = require('../utils/shelterContext');
  mock.resetCalls();
  mock.setHandler(async () => [[{ user_id: 4, shelter_id: 1, ical_token: hash }]]);

  const res = makeRes();
  await runWithShelter(2, () => publicCtrl.myShiftsIcs({ query: { token: raw } }, res));
  assert.equal(res.statusCode, 404);
});

test('reset and get require a session', async () => {
  const getRes = makeRes();
  await publicCtrl.getMyIcalToken({ session: {}, protocol: 'http', get: () => 'x' }, getRes);
  assert.equal(getRes.statusCode, 401);

  const resetRes = makeRes();
  await publicCtrl.resetMyIcalToken({ session: null, protocol: 'http', get: () => 'x' }, resetRes);
  assert.equal(resetRes.statusCode, 401);
});
