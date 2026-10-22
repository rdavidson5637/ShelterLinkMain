'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const { SALT_ROUNDS, passwordPolicyError } = require('../utils/password');

test('new passwords use bcrypt cost 12 and tests skip the breach lookup', async () => {
  assert.strictEqual(SALT_ROUNDS, 12);
  assert.strictEqual(await passwordPolicyError('short'), 'Password must be at least 10 characters');
  assert.strictEqual(await passwordPolicyError('password12'), 'Password is too common');
  assert.strictEqual(await passwordPolicyError('longpassword'), null);
});
