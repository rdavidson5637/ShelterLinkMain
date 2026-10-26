'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');

const {
  TENANT_TABLES,
  currentShelterId,
  isBypass,
  runWithShelter,
  runWithoutShelter,
  mentionsTenantTable,
} = require('../utils/shelterContext');
const { requestCarriesShelterId } = require('../middleware/shelter');

const LOCAL = 'postgresql://postgres@127.0.0.1:54329/shelterlink_tenant_test';

test('mentionsTenantTable detects every tenant-scoped table and ignores global tables', () => {
  for (const table of TENANT_TABLES) {
    assert.equal(
      mentionsTenantTable(`SELECT * FROM ${table} WHERE id = 1`),
      true,
      `Expected ${table} to be recognised as a tenant table`
    );
  }
  assert.equal(mentionsTenantTable('SELECT 1 AS ok'), false);
  assert.equal(mentionsTenantTable('SELECT * FROM session WHERE sid = $1'), false);
  assert.equal(mentionsTenantTable('INSERT INTO job_runs (job_name, status) VALUES ($1, $2)'), false);
  assert.equal(mentionsTenantTable('SELECT filename FROM schema_migrations'), false);
});

test('runWithShelter and runWithoutShelter scope AsyncLocalStorage context', async () => {
  assert.equal(currentShelterId(), null);
  assert.equal(isBypass(), false);

  assert.throws(() => runWithShelter(0, () => {}), /Shelter context is missing/);
  assert.throws(() => runWithShelter('abc', () => {}), /Shelter context is missing/);

  await runWithShelter(7, async () => {
    assert.equal(currentShelterId(), 7);
    assert.equal(isBypass(), false);
  });

  await runWithoutShelter(async () => {
    assert.equal(currentShelterId(), null);
    assert.equal(isBypass(), true);
  });
});

test('requestCarriesShelterId rejects shelter_id or shelterId anywhere in body, query, or params', () => {
  assert.equal(requestCarriesShelterId({ body: {}, query: {}, params: {} }), false);
  assert.equal(requestCarriesShelterId({ body: { shelter_id: 2 }, query: {}, params: {} }), true);
  assert.equal(requestCarriesShelterId({ body: {}, query: { shelterId: '2' }, params: {} }), true);
  assert.equal(requestCarriesShelterId({ body: {}, query: {}, params: { shelter_id: 1 } }), true);
  assert.equal(
    requestCarriesShelterId({ body: { filter: [{ nested: { shelter_id: 2 } }] }, query: {}, params: {} }),
    true
  );
});

test('shelter B cannot read or change shelter A', { timeout: 300000 }, (t) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(__dirname, 'tenantIsolation.run.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: LOCAL,
      SESSION_SECRET: 'tenant-isolation-test-secret-value',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    output += text;
    process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    output += text;
    process.stderr.write(text);
  });
  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
      return;
    }
    const sandboxBlocked =
      !process.env.CI &&
      !process.env.TENANT_DATABASE_URL &&
      (/shmget|could not create shared memory segment|Operation not permitted|EPERM|initdb was not found/i.test(output));
    if (sandboxBlocked) {
      t.skip('Local Postgres cluster cannot start in this OS sandbox (shmget/EPERM)');
      resolve();
      return;
    }
    reject(new Error(`tenant isolation run failed with code ${code}`));
  });
}));
