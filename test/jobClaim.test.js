'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../config/database');
const jobLogPath = require.resolve('../utils/jobLog');

function loadJobLog(executeImpl) {
  delete require.cache[dbPath];
  delete require.cache[jobLogPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      pool: { execute: executeImpl },
    },
  };
  return require('../utils/jobLog');
}

test('claimJobRun inserts run_key and returns true', async () => {
  const calls = [];
  const { claimJobRun } = loadJobLog(async (sql, params) => {
    calls.push({ sql, params });
    return [{ insertId: 1 }];
  });
  assert.equal(await claimJobRun('shiftReminders', '2026-11-23-3-14'), true);
  assert.equal(calls[0].params[0], 'shiftReminders');
  assert.equal(calls[0].params[2], '2026-11-23-3-14');
  assert.match(calls[0].sql, /run_key/i);
});

test('claimJobRun returns false on unique violation', async () => {
  const { claimJobRun } = loadJobLog(async () => {
    const err = new Error('duplicate');
    err.code = '23505';
    throw err;
  });
  assert.equal(await claimJobRun('shiftReminders', '2026-11-23-3-14'), false);
});

test('claimJobRun allows the run when run_key column is missing', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    const { claimJobRun } = loadJobLog(async () => {
      const err = new Error('column "run_key" does not exist');
      err.code = '42703';
      throw err;
    });
    assert.equal(await claimJobRun('weeklyDigest', '2026-11-23-7-0'), true);
    assert.ok(warnings.some((line) => /run_key not ready/.test(line)));
  } finally {
    console.warn = original;
  }
});
