'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { runResetTokenCleanup } = require('../jobs/resetTokenCleanup');

test('reset token cleanup clears tokens that have already expired', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [{ affectedRows: 2, insertId: 1 }]);
  const when = new Date('2026-10-25T12:00:00Z');
  const cleared = await runResetTokenCleanup(when);
  assert.strictEqual(cleared, 2);
  const update = mock.calls.find((call) => /reset_token = NULL/i.test(call.sql));
  assert.ok(update);
  assert.match(update.sql, /reset_token_expires < \?/);
  assert.strictEqual(update.params[0], when);
});
