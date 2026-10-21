'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');

const LOCAL = 'postgresql://postgres@127.0.0.1:54329/shelterlink_tenant_test';

test('shelter B cannot read or change shelter A', { timeout: 180000 }, () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(__dirname, 'tenantIsolation.run.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: LOCAL,
      SESSION_SECRET: 'tenant-isolation-test-secret-value',
    },
    stdio: 'inherit',
  });
  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`tenant isolation run failed with code ${code}`));
  });
}));
