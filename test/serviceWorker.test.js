'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildServiceWorker, getSwVersion, sanitiseSwVersion } = require('../utils/serviceWorker');

const swPath = path.join(__dirname, '..', 'frontend', 'sw.js');
const source = fs.readFileSync(swPath, 'utf8');

test('buildServiceWorker replaces every __SW_VERSION__ token', () => {
  const out = buildServiceWorker('shelterlink-__SW_VERSION__ and __SW_VERSION__', 'abc123');
  assert.equal(out, 'shelterlink-abc123 and abc123');
  assert.equal(out.includes('__SW_VERSION__'), false);
});

test('version sanitising strips slash, spaces and quotes and caps length', () => {
  assert.equal(sanitiseSwVersion("ab/c d'e"), 'abcde');
  assert.equal(sanitiseSwVersion('x'.repeat(50)).length, 40);
});

test('getSwVersion env precedence uses RENDER_GIT_COMMIT first 12 chars', () => {
  const prev = {
    RENDER_GIT_COMMIT: process.env.RENDER_GIT_COMMIT,
    RAILWAY_GIT_COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA,
    SOURCE_VERSION: process.env.SOURCE_VERSION,
    GIT_COMMIT: process.env.GIT_COMMIT,
  };
  process.env.RENDER_GIT_COMMIT = 'abcdef1234567890';
  process.env.RAILWAY_GIT_COMMIT_SHA = 'zzzzzzzzzzzz';
  assert.equal(getSwVersion(), 'abcdef123456');
  Object.entries(prev).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
});

test('frontend/sw.js contains version token, never-cache prefixes, and not /public/sw.js', () => {
  assert.match(source, /__SW_VERSION__/);
  assert.equal(source.includes('/public/sw.js'), false);
  for (const prefix of [
    '/api/auth/',
    '/api/admin/',
    '/api/kiosk/',
    '/api/incidents/',
    '/api/vetting/',
    '/api/documents/',
    '/api/export/',
    '/api/push/',
  ]) {
    assert.ok(source.includes(prefix), prefix);
  }
  assert.ok(source.includes('/api/auth/me'));
  assert.ok(source.includes('/api/applications/my-applications'));
  assert.ok(source.includes('/api/volunteer/profile'));
});
