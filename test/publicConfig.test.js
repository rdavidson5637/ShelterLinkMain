'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

delete require.cache[require.resolve('../controllers/publicConfigController')];
const { getDemoInfo, getPublicConfig } = require('../controllers/publicConfigController');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

test('demo-info shows accounts only when demo env vars are set', () => {
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    DEMO_ADMIN_EMAIL: process.env.DEMO_ADMIN_EMAIL,
    DEMO_ADMIN_PASSWORD: process.env.DEMO_ADMIN_PASSWORD,
    DEMO_VOLUNTEER_EMAIL: process.env.DEMO_VOLUNTEER_EMAIL,
    DEMO_VOLUNTEER_PASSWORD: process.env.DEMO_VOLUNTEER_PASSWORD,
  };
  process.env.NODE_ENV = 'test';
  delete process.env.DEMO_ADMIN_EMAIL;
  delete process.env.DEMO_ADMIN_PASSWORD;
  delete process.env.DEMO_VOLUNTEER_EMAIL;
  delete process.env.DEMO_VOLUNTEER_PASSWORD;
  const hidden = makeRes();
  getDemoInfo({}, hidden);
  assert.strictEqual(hidden.body.showDemoHints, false);
  assert.deepStrictEqual(hidden.body.accounts, []);

  process.env.DEMO_ADMIN_EMAIL = 'admin@shelterlink.org';
  process.env.DEMO_ADMIN_PASSWORD = 'local-demo-admin';
  process.env.DEMO_VOLUNTEER_EMAIL = 'alex.jenkins@example.com';
  process.env.DEMO_VOLUNTEER_PASSWORD = 'local-demo-volunteer';
  const res = makeRes();
  getDemoInfo({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.showDemoHints, true);
  assert.strictEqual(res.body.accounts.length, 2);
  assert.ok(res.body.accounts.some((a) => a.email === 'admin@shelterlink.org'));

  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('public config hides demo accounts in production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const res = makeRes();
  getPublicConfig({}, res);
  assert.strictEqual(res.body.showDemoHints, false);
  assert.deepStrictEqual(res.body.accounts, []);
  process.env.NODE_ENV = prev;
});
