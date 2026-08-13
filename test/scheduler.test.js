'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Ensure test env before loading scheduler
process.env.NODE_ENV = 'test';

const scheduler = require('../utils/scheduler');

test('scheduler does not start under test env', () => {
  scheduler.resetForTests();
  process.env.NODE_ENV = 'test';
  scheduler.registerJob('noop', '* * * * *', async () => 'ok');
  const started = scheduler.start();
  assert.strictEqual(started, false);
  assert.strictEqual(scheduler.isStarted(), false);
});

test('registered job that throws is caught and does not crash', async () => {
  scheduler.resetForTests();
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };

  try {
    scheduler.registerJob('boom', '* * * * *', async () => {
      throw new Error('boom-test');
    });

    const job = { name: 'boom', fn: async () => { throw new Error('boom-test'); } };
    const result = await scheduler.runJob(job);
    assert.strictEqual(result.status, 'error');
    assert.match(result.detail, /boom-test/);
    assert.ok(errors.some((line) => /boom-test/.test(line)));
  } finally {
    console.error = originalError;
    scheduler.resetForTests();
  }
});

test('matchesCron understands hourly and daily expressions', () => {
  const topOfHour = new Date(2026, 7, 11, 14, 0, 0);
  assert.strictEqual(scheduler.matchesCron('0 * * * *', topOfHour), true);
  assert.strictEqual(scheduler.matchesCron('0 * * * *', new Date(2026, 7, 11, 14, 5, 0)), false);

  const midnight = new Date(2026, 7, 11, 0, 0, 0);
  assert.strictEqual(scheduler.matchesCron('0 0 * * *', midnight), true);
  assert.strictEqual(scheduler.matchesCron('0 0 * * *', topOfHour), false);
});
