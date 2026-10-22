'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const { SALT_ROUNDS, passwordPolicyError } = require('../utils/password');

test('new passwords use bcrypt cost 12 and tests skip the breach lookup', async () => {
  assert.strictEqual(SALT_ROUNDS, 12);
  assert.strictEqual(await passwordPolicyError('short'), 'Password must be at least 8 characters with one uppercase letter and one number');
  assert.strictEqual(await passwordPolicyError('Password1'), null);
});
