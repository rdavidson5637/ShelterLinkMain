'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { LIMITS, WINDOW_MS } = require('../middleware/rateLimiter');

test('rate limiters match live production budgets', () => {
  assert.strictEqual(WINDOW_MS, 15 * 60 * 1000);
  assert.strictEqual(LIMITS.login, 15);
  assert.strictEqual(LIMITS.api, 300);
  assert.ok(LIMITS.register <= 10);
  assert.ok(LIMITS.forgotPassword <= 10);
  assert.ok(LIMITS.resetPassword <= 10);
});
