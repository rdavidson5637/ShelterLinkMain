'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
let sendShouldFail = false;
const sent = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async (...args) => {
      if (sendShouldFail) throw new Error('SMTP down');
      sent.push(args);
    },
  },
};

delete require.cache[require.resolve('../controllers/authController')];
const auth = require('../controllers/authController');
const { hashResetToken } = require('../utils/resetToken');

function makeRes() {
  const res = { statusCode: 200, body: undefined, cookie: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.clearCookie = (name, options) => { res.cookie = { name, options }; return res; };
  return res;
}

test('register-admin is 404 unless allowlisted outside production', async () => {
  const prevAllow = process.env.ALLOW_ADMIN_REGISTRATION;
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_ADMIN_REGISTRATION;
  const res = makeRes();
  await auth.registerAdmin({ body: {} }, res);
  assert.strictEqual(res.statusCode, 404);

  process.env.NODE_ENV = 'test';
  process.env.ALLOW_ADMIN_REGISTRATION = 'false';
  const res2 = makeRes();
  await auth.registerAdmin({ body: {} }, res2);
  assert.strictEqual(res2.statusCode, 404);

  process.env.NODE_ENV = prevEnv;
  if (prevAllow === undefined) delete process.env.ALLOW_ADMIN_REGISTRATION;
  else process.env.ALLOW_ADMIN_REGISTRATION = prevAllow;
});

test('forgot-password stores a hash and never the raw token', async () => {
  sent.length = 0;
  sendShouldFail = false;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/SELECT user_id, email, first_name/i.test(sql)) {
      return [[{ user_id: 3, email: 'a@b.c', first_name: 'Ann' }]];
    }
    return [{ affectedRows: 1 }];
  });

  const res = makeRes();
  await auth.forgotPassword({ body: { email: 'a@b.c' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.message, 'If that email is registered, a reset link has been sent.');
  assert.strictEqual(res.body.email, undefined);
  const update = mock.calls.find((c) => /SET reset_token/i.test(c.sql));
  assert.ok(update);
  const stored = update.params[0];
  assert.strictEqual(stored.length, 64);
  assert.ok(sent.length === 1);
  const html = sent[0][2];
  const raw = /token=([a-f0-9]+)/.exec(html)[1];
  assert.strictEqual(stored, hashResetToken(raw));
  assert.notStrictEqual(stored, raw);
});

test('forgot-password rolls back the token if email send fails', async () => {
  sent.length = 0;
  sendShouldFail = true;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/SELECT user_id, email, first_name/i.test(sql)) {
      return [[{ user_id: 3, email: 'a@b.c', first_name: 'Ann' }]];
    }
    return [{ affectedRows: 1 }];
  });

  const res = makeRes();
  await auth.forgotPassword({ body: { email: 'a@b.c' } }, res);
  assert.strictEqual(res.statusCode, 200);
  const clear = mock.calls.find((c) => /reset_token = NULL/i.test(c.sql));
  assert.ok(clear, 'token must be cleared when SMTP fails');
  sendShouldFail = false;
});

test('unknown email still gets the generic success body', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  await auth.forgotPassword({ body: { email: 'nobody@example.com' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body.message, /If that email is registered/i);
});

test('GET reset-password token returns valid/invalid only', async () => {
  const { raw, hash } = require('../utils/resetToken').createResetToken();
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (params[0] === hash) {
      return [[{ reset_token_expires: new Date(Date.now() + 60_000) }]];
    }
    return [[]];
  });

  const okRes = makeRes();
  await auth.validateResetToken({ params: { token: raw } }, okRes);
  assert.strictEqual(okRes.statusCode, 200);
  assert.deepStrictEqual(okRes.body, { valid: true });
  assert.strictEqual(okRes.body.email, undefined);

  const badRes = makeRes();
  await auth.validateResetToken({ params: { token: 'nope' } }, badRes);
  assert.deepStrictEqual(badRes.body, { valid: false });
});

test('reset-password looks up the hashed token', async () => {
  const { raw, hash } = require('../utils/resetToken').createResetToken();
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/SELECT user_id, reset_token_expires/i.test(sql)) {
      assert.strictEqual(params[0], hash);
      return [[{ user_id: 3, reset_token_expires: new Date(Date.now() + 60_000) }]];
    }
    return [{ affectedRows: 1 }];
  });
  const res = makeRes();
  await auth.resetPassword({ body: { token: raw, password: 'Password1' } }, res);
  assert.strictEqual(res.statusCode, 200);
});

test('logout clears connect.sid with production cookie flags when NODE_ENV=production', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const res = makeRes();
  await auth.logout({
    session: {
      destroy(cb) { cb(null); },
    },
  }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.cookie.name, 'connect.sid');
  assert.strictEqual(res.cookie.options.secure, true);
  assert.strictEqual(res.cookie.options.httpOnly, true);
  assert.strictEqual(res.cookie.options.sameSite, 'strict');
  process.env.NODE_ENV = prev;
});
