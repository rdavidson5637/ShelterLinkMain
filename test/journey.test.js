'use strict';

// SL-LATER-36: spawn the live Postgres journey runner (same pattern as
// tenantIsolation.test.js). Skips outside CI when a local cluster cannot start.

const test = require('node:test');
const { spawn } = require('child_process');
const path = require('path');

const LOCAL = 'postgresql://postgres@127.0.0.1:54330/shelterlink_journey_test';

test('volunteer journey: book, QR check-in, hours, reports, tenant isolation', { timeout: 300000 }, (t) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(__dirname, 'journey.run.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: LOCAL,
      SESSION_SECRET: 'journey-test-secret-value-not-real',
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
    reject(new Error(`journey run failed with code ${code}`));
  });
}));
