'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async () => {},
  },
};

delete require.cache[require.resolve('../controllers/authController')];
const auth = require('../controllers/authController');

function makeRes() {
  const res = { statusCode: 200, body: undefined, headersSent: false };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    res.headersSent = true;
    return res;
  };
  return res;
}

test('forgot-password never returns Invalid credentials', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const unknown = makeRes();
  await auth.forgotPassword({ body: { email: 'nobody@example.com' } }, unknown);
  assert.equal(unknown.statusCode, 200);
  assert.match(unknown.body.message, /If that email is registered/i);
  assert.equal(unknown.body.error, undefined);

  mock.setHandler(async (sql) => {
    if (/SELECT user_id, email, first_name/i.test(sql)) {
      return [[{ user_id: 3, email: 'a@b.c', first_name: 'Ann' }]];
    }
    return [{ affectedRows: 1 }];
  });
  const known = makeRes();
  await auth.forgotPassword({ body: { email: 'a@b.c' } }, known);
  assert.equal(known.statusCode, 200);
  assert.match(known.body.message, /If that email is registered/i);
  assert.doesNotMatch(JSON.stringify(known.body), /Invalid credentials/i);
});

test('register-admin is 404 in production', async () => {
  const prevAllow = process.env.ALLOW_ADMIN_REGISTRATION;
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_ADMIN_REGISTRATION;
  const res = makeRes();
  await auth.registerAdmin({ body: {} }, res);
  assert.equal(res.statusCode, 404);

  process.env.NODE_ENV = 'test';
  process.env.ALLOW_ADMIN_REGISTRATION = 'false';
  const res2 = makeRes();
  await auth.registerAdmin({ body: {} }, res2);
  assert.equal(res2.statusCode, 404);

  process.env.NODE_ENV = prevEnv;
  if (prevAllow === undefined) delete process.env.ALLOW_ADMIN_REGISTRATION;
  else process.env.ALLOW_ADMIN_REGISTRATION = prevAllow;
});
