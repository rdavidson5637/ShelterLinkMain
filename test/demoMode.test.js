'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const express = require('express');

process.env.NODE_ENV = 'test';

const {
  isDemoMode,
  resolveSetupMode,
  assertOnlyFictionalData,
} = require('../utils/demoMode');
const { runDemoReset, shelterHour } = require('../jobs/demoReset');
const { getPublicConfig } = require('../controllers/publicConfigController');

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  let out;
  try {
    out = fn();
  } catch (e) {
    restore();
    throw e;
  }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
}

function fakePool(realAccounts, { missingTable = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(String(sql));
      if (/FROM users/i.test(sql)) {
        if (missingTable) {
          const err = new Error('relation "users" does not exist');
          err.code = '42P01';
          throw err;
        }
        return { rows: [{ real_accounts: realAccounts }] };
      }
      return { rows: [] };
    },
  };
}

test('isDemoMode only accepts DEMO_MODE=true', () => {
  assert.equal(isDemoMode({ DEMO_MODE: 'true' }), true);
  assert.equal(isDemoMode({ DEMO_MODE: ' TRUE ' }), true);
  assert.equal(isDemoMode({ DEMO_MODE: '1' }), false);
  assert.equal(isDemoMode({ DEMO_MODE: 'false' }), false);
  assert.equal(isDemoMode({}), false);
});

test('setup mode: --demo needs DEMO_MODE=true and then works in production', () => {
  const refused = resolveSetupMode({ args: ['--demo'], env: { NODE_ENV: 'production' } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /DEMO_MODE=true/);

  const allowed = resolveSetupMode({
    args: ['--demo'],
    env: { NODE_ENV: 'production', DEMO_MODE: 'true' },
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.withSeed, true);
  assert.equal(allowed.demo, true);
});

test('setup mode: existing production protections are unchanged', () => {
  assert.equal(resolveSetupMode({ args: [], env: { NODE_ENV: 'production' } }).ok, false);
  assert.equal(
    resolveSetupMode({ args: ['--force', '--seed'], env: { NODE_ENV: 'production' } }).ok,
    false
  );
  const prodSchemaOnly = resolveSetupMode({ args: ['--force'], env: { NODE_ENV: 'production' } });
  assert.equal(prodSchemaOnly.ok, true);
  assert.equal(prodSchemaOnly.withSeed, false);
  assert.equal(resolveSetupMode({ args: [], env: { NODE_ENV: 'development' } }).withSeed, true);
  assert.equal(resolveSetupMode({ args: ['--no-seed'], env: {} }).withSeed, false);
});

test('db:demo exits non-zero with a clear message when DEMO_MODE is not true', () => {
  const script = path.join(__dirname, '..', 'scripts', 'setup-db.js');
  const result = spawnSync(process.execPath, [script, '--demo'], {
    env: { ...process.env, DEMO_MODE: '', NODE_ENV: 'production', DATABASE_URL: '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DEMO_MODE=true/);
});

test('a database with real accounts is never rebuilt', async () => {
  await assert.rejects(() => assertOnlyFictionalData(fakePool(3)), /3 account\(s\)/);
  await assert.doesNotReject(() => assertOnlyFictionalData(fakePool(0)));
  await assert.doesNotReject(() => assertOnlyFictionalData(fakePool(0, { missingTable: true })));
});

test('shelterHour uses the shelter timezone, not the server clock', () => {
  // 02:10 UTC on 19 Oct 2026 is 03:10 in London (BST)
  assert.equal(shelterHour(new Date(Date.UTC(2026, 9, 19, 2, 10))), 3);
  assert.equal(shelterHour(new Date(Date.UTC(2026, 9, 19, 3, 10))), 4);
});

test('demo reset only runs in demo mode, in the 03:xx hour, on a fictional database', async () => {
  const at3 = new Date(Date.UTC(2026, 9, 19, 2, 10));
  const at12 = new Date(Date.UTC(2026, 9, 19, 11, 10));

  const pool = fakePool(0);
  assert.equal(await runDemoReset(at3, { pool, env: {} }), 'skipped:not_demo_mode');
  assert.equal(await runDemoReset(at12, { pool, env: { DEMO_MODE: 'true' } }), 'skipped:not_reset_hour');
  assert.equal(pool.queries.length, 0);

  assert.equal(await runDemoReset(at3, { pool, env: { DEMO_MODE: 'true' } }), 'rebuilt');
  assert.ok(pool.queries.some((q) => /CREATE TABLE/i.test(q)), 'schema was loaded');
  assert.ok(pool.queries.some((q) => /INSERT INTO users/i.test(q)), 'seed was loaded');

  const realPool = fakePool(2);
  const result = await runDemoReset(at3, { pool: realPool, env: { DEMO_MODE: 'true' } });
  assert.match(result, /^failed:.*not @example\.com/);
  assert.ok(!realPool.queries.some((q) => /CREATE TABLE/i.test(q)), 'nothing was dropped');
});

test('demo banner appears on pages only in demo mode', async () => {
  async function home(demo) {
    return withEnv({ DEMO_MODE: demo, SHELTER_NAME: undefined }, async () => {
      delete require.cache[require.resolve('../routes/seo')];
      const app = express();
      app.use(require('../routes/seo'));
      const server = await new Promise((r) => {
        const s = app.listen(0, '127.0.0.1', () => r(s));
      });
      try {
        return await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
      } finally {
        server.close();
      }
    });
  }
  const on = await home('true');
  assert.equal((on.match(/class="demo-banner"/g) || []).length, 1);
  assert.match(on, /Demo: data resets nightly/);
  const off = await home(undefined);
  assert.ok(!off.includes('demo-banner'));
});

test('login demo hints are shown in production only when DEMO_MODE=true', () => {
  const call = () => {
    const res = { status: () => res, json: (b) => { res.body = b; return res; } };
    getPublicConfig({}, res);
    return res.body;
  };
  withEnv({ NODE_ENV: 'production', DEMO_MODE: undefined }, () => {
    const body = call();
    assert.equal(body.showDemoHints, false);
    assert.deepEqual(body.accounts, []);
    assert.equal(body.demoMode, false);
  });
  withEnv({ NODE_ENV: 'production', DEMO_MODE: 'true' }, () => {
    const body = call();
    assert.equal(body.showDemoHints, true);
    assert.ok(body.accounts.length >= 2);
    assert.equal(body.demoMode, true);
  });
});
