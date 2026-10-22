'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { LIMITS, WINDOW_MS } = require('../middleware/rateLimiter');

test('rate limiters match live production budgets', () => {
  assert.strictEqual(WINDOW_MS, 15 * 60 * 1000);
  assert.strictEqual(LIMITS.login, 15);
  assert.strictEqual(LIMITS.loginAccount, 5);
  assert.strictEqual(LIMITS.api, 300);
  assert.ok(LIMITS.register <= 10);
  assert.ok(LIMITS.forgotPassword <= 10);
  assert.strictEqual(LIMITS.forgotAccount, 5);
  const authRoute = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  assert.match(authRoute, /forgotAccountLimiter,\s*forgotPasswordLimiter/);
  assert.ok(LIMITS.resetPassword <= 10);
  assert.strictEqual(LIMITS.groupBookingEmail, 3);
  const groupRoute = fs.readFileSync(path.join(__dirname, '../routes/groupBookings.js'), 'utf8');
  assert.match(groupRoute, /groupBookingEmailLimiter/);
});
