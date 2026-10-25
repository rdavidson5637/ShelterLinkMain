'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { PRIVACY_NOTICE_VERSION } = require('../config/privacyNotice');
delete require.cache[require.resolve('../controllers/authController')];
const auth = require('../controllers/authController');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

const payload = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  password: 'longpassword',
  phone: '07700900123',
  privacy_notice: true,
};

test('register does not say when an email is already used', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users/i.test(sql)) {
      return [[{ user_id: 3, email: 'ada@example.com', role: 'volunteer' }]];
    }
    return [[]];
  });

  const res = makeRes();
  await auth.register({ body: payload }, res);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.message, 'Registration successful');
  assert.strictEqual(res.body.error, undefined);
  assert.ok(!mock.calls.some((call) => /INSERT INTO users/i.test(call.sql)));
});

test('register still creates an account for a new email', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM shelters/i.test(sql)) return [[{ id: 1 }]];
    if (/INSERT INTO users/i.test(sql)) return [{ insertId: 8 }];
    return [[]];
  });

  const res = makeRes();
  await auth.register({ body: { ...payload, email: 'new@example.com' } }, res);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.message, 'Registration successful');
  const insert = mock.calls.find((call) => /INSERT INTO users/i.test(call.sql));
  assert.ok(insert);
  assert.ok(insert.params.includes(PRIVACY_NOTICE_VERSION));
});

test('register without the privacy confirmation is rejected', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  const { privacy_notice, ...withoutNotice } = payload;
  await auth.register({ body: withoutNotice }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /privacy notice/i);
  assert.ok(!mock.calls.some((call) => /INSERT INTO users/i.test(call.sql)));
});

test('acknowledging the notice stores the current version', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [{ affectedRows: 1 }]);
  const res = makeRes();
  await auth.acknowledgePrivacyNotice(
    { session: { userId: 4 }, body: { accept: true } },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.needsPrivacyNotice, false);
  const update = mock.calls.find((call) => /privacy_notice_version/i.test(call.sql));
  assert.ok(update);
  assert.strictEqual(update.params[0], PRIVACY_NOTICE_VERSION);
  assert.strictEqual(update.params[1], 4);
});
