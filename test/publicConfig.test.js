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

test('demo-info shows accounts when not production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const res = makeRes();
  getDemoInfo({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.showDemoHints, true);
  assert.ok(res.body.accounts.length >= 2);
  assert.ok(res.body.accounts.some((a) => a.email === 'admin@shelterlink.org'));
  process.env.NODE_ENV = prev;
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
