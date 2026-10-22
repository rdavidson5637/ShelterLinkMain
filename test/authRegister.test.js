'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
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
  assert.ok(mock.calls.some((call) => /INSERT INTO users/i.test(call.sql)));
});
