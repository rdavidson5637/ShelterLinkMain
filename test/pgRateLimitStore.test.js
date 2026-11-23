'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dbPath = require.resolve('../config/database');
const storePath = require.resolve('../middleware/pgRateLimitStore');

function loadStore(executeImpl) {
  delete require.cache[dbPath];
  delete require.cache[storePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      pool: { execute: executeImpl },
    },
  };
  return require('../middleware/pgRateLimitStore');
}

test('createPgRateLimitStore requires a prefix', () => {
  const { createPgRateLimitStore } = loadStore(async () => [[]]);
  assert.throws(() => createPgRateLimitStore(''), /prefix/);
});

test('increment returns hits from Postgres and prefixes the key', async () => {
  const calls = [];
  const { createPgRateLimitStore } = loadStore(async (sql, params) => {
    calls.push({ sql, params });
    return [[{ hits: 3, reset_at: '2026-11-23T12:00:00.000Z' }]];
  });
  const store = createPgRateLimitStore('rl:api:');
  store.init({ windowMs: 60_000 });
  const info = await store.increment('1.2.3.4');
  assert.equal(info.totalHits, 3);
  assert.ok(info.resetTime instanceof Date);
  assert.equal(calls[0].params[0], 'rl:api:1.2.3.4');
  assert.equal(calls[0].params[1], 60_000);
  assert.match(calls[0].sql, /ON CONFLICT \(key\) DO UPDATE/i);
});

test('increment fails open when the database errors', async () => {
  const { createPgRateLimitStore } = loadStore(async () => {
    throw new Error('db down');
  });
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };
  try {
    const store = createPgRateLimitStore('rl:login:');
    const info = await store.increment('9.9.9.9');
    assert.equal(info.totalHits, 0);
    assert.equal(info.resetTime, undefined);
    assert.ok(errors.some((line) => /increment failed/.test(line)));
  } finally {
    console.error = original;
  }
});

test('migration 046 creates rate_limit_hits and job_runs.run_key', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/046_rate_limit_job_dedupe.pg.sql'),
    'utf8'
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS rate_limit_hits/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS run_key/i);
  assert.match(sql, /uq_job_runs_name_run_key/i);
  const setupDb = fs.readFileSync(path.join(__dirname, '../scripts/setup-db.js'), 'utf8');
  assert.match(setupDb, /loadSql\('046_rate_limit_job_dedupe\.pg\.sql'\)/);
});
