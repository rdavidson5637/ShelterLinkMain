'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sessionCookieOptions, clearSessionCookie } = require('../utils/sessionCookie');

test('production session cookie is Secure, HttpOnly, SameSite=strict', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.deepStrictEqual(sessionCookieOptions(), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
  process.env.NODE_ENV = prev;
});

test('clearSessionCookie passes the same attributes', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  let called = null;
  const res = {
    clearCookie(name, options) {
      called = { name, options };
    },
  };
  clearSessionCookie(res);
  assert.strictEqual(called.name, 'connect.sid');
  assert.deepStrictEqual(called.options, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
  process.env.NODE_ENV = prev;
});
