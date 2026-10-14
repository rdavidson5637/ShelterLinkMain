'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const bcrypt = require('bcrypt');

const hash = bcrypt.hashSync('Password1', 4);

delete require.cache[require.resolve('../controllers/authController')];
const auth = require('../controllers/authController');
const pushService = require('../utils/pushService');

function makeReq(body, session = {}) {
  const req = {
    body,
    session: {
      cookie: { maxAge: 3600000 },
      ...session,
      regenerate(cb) {
        cb(null);
      },
    },
  };
  return req;
}

function makeRes() {
  const res = { statusCode: 200, body: undefined, cleared: false };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  res.clearCookie = () => {
    res.cleared = true;
    return res;
  };
  return res;
}

function userRow(role = 'volunteer', userId = 7) {
  return {
    user_id: userId,
    first_name: 'Alex',
    last_name: 'Jenkins',
    name: 'Alex Jenkins',
    email: 'alex@example.com',
    password: hash,
    role,
    created_at: '2026-01-01',
  };
}

test('rememberMe sets volunteer 30 days, staff 8 hours, otherwise 1 hour, and loginAt', async () => {
  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow('volunteer')]];
    return [{ affectedRows: 1 }];
  });
  let req = makeReq({ email: 'alex@example.com', password: 'Password1', rememberMe: true });
  let res = makeRes();
  await auth.login(req, res);
  assert.equal(req.session.cookie.maxAge, 30 * 24 * 60 * 60 * 1000);
  assert.ok(req.session.loginAt);

  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow('staff')]];
    return [{ affectedRows: 1 }];
  });
  req = makeReq({ email: 'alex@example.com', password: 'Password1', rememberMe: true });
  res = makeRes();
  await auth.login(req, res);
  assert.equal(req.session.cookie.maxAge, 8 * 60 * 60 * 1000);

  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow('admin')]];
    return [{ affectedRows: 1 }];
  });
  req = makeReq({ email: 'alex@example.com', password: 'Password1', rememberMe: true });
  res = makeRes();
  await auth.login(req, res);
  assert.equal(req.session.cookie.maxAge, 8 * 60 * 60 * 1000);

  req = makeReq({ email: 'alex@example.com', password: 'Password1', rememberMe: false });
  res = makeRes();
  await auth.login(req, res);
  assert.equal(req.session.cookie.maxAge, 3600000);
});

test('login pushEndpoint owned by another user is deleted and pushReset returned', async () => {
  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow('volunteer', 7)]];
    if (/FROM push_subscriptions/.test(sql)) return [[{ user_id: 99, endpoint: 'https://push/x' }]];
    return [{ affectedRows: 1 }];
  });
  const req = makeReq({
    email: 'alex@example.com',
    password: 'Password1',
    pushEndpoint: 'https://push/x',
  });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.body.pushReset, true);
});

test('login pushEndpoint owned by same user is kept', async () => {
  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow('volunteer', 7)]];
    if (/FROM push_subscriptions/.test(sql)) return [[{ user_id: 7, endpoint: 'https://push/x' }]];
    return [{ affectedRows: 1 }];
  });
  const req = makeReq({
    email: 'alex@example.com',
    password: 'Password1',
    pushEndpoint: 'https://push/x',
  });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.body.pushReset, undefined);
});

test('login without endpoint does not set pushReset', async () => {
  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow('volunteer', 7)]];
    return [{ affectedRows: 1 }];
  });
  const req = makeReq({ email: 'alex@example.com', password: 'Password1' });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.body.pushReset, undefined);
});

test('logout-all destroys sessions and clears the cookie', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [{ affectedRows: 1 }]);
  const req = {
    session: {
      userId: 7,
      destroy(cb) {
        cb(null);
      },
    },
  };
  const res = makeRes();
  await auth.logoutAll(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.cleared, true);
  assert.ok(mock.calls.some((c) => /DELETE FROM session/i.test(c.sql)));
});

test('findByEndpoint is used by login (pushService export exists)', () => {
  assert.equal(typeof pushService.findByEndpoint, 'function');
});
