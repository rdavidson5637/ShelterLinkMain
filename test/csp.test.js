'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cspDirectives } = require('../utils/csp');

test('production CSP drops unsafe-inline scripts and external origins', () => {
  const d = cspDirectives(true);
  assert.deepEqual(d.scriptSrc, ["'self'"]);
  assert.ok(!d.scriptSrc.includes("'unsafe-inline'"));
  assert.ok(d.scriptSrc.every((v) => !String(v).includes('http')));
  assert.deepEqual(d.objectSrc, ["'none'"]);
  assert.deepEqual(d.frameAncestors, ["'none'"]);
  assert.deepEqual(d.upgradeInsecureRequests, []);
});

test('non-production CSP disables upgrade-insecure-requests', () => {
  const d = cspDirectives(false);
  assert.equal(d.upgradeInsecureRequests, null);
  assert.deepEqual(d.scriptSrc, ["'self'"]);
});
