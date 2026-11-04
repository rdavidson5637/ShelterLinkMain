'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'platform-page-test-only-not-a-real-secret';

const mock = require('./helpers/mockDb');
const { isPlatformOwnerPage } = require('../middleware/platformOwner');
const { assertNonProduction, readArgs } = require('../scripts/platform-owner');

const PAGE = path.join(__dirname, '..', 'frontend', 'pages', 'platform-shelters.html');
const NOT_FOUND = path.join(__dirname, '..', 'frontend', 'pages', 'error', '404.html');
const OWNER_ID = 1;

function ownersAre(ids) {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM platform_owners/i.test(sql)) {
      return [ids.includes(Number(params[0])) ? [{ user_id: params[0] }] : []];
    }
    return [[]];
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// isPlatformOwnerPage, with a stand-in session
// ---------------------------------------------------------------------------

let gateServer;
let gateBase;

test.before(async () => {
  const app = express();
  app.use((req, res, next) => {
    const header = req.get('x-test-session');
    req.session = header ? JSON.parse(header) : {};
    next();
  });
  app.get('/platform/shelters', isPlatformOwnerPage(NOT_FOUND), (req, res) => res.sendFile(PAGE));
  gateServer = await listen(app);
  gateBase = `http://127.0.0.1:${gateServer.address().port}`;
});

test.after(() => new Promise((resolve) => gateServer.close(resolve)));

async function getPage(session) {
  const headers = session ? { 'x-test-session': JSON.stringify(session) } : {};
  const res = await fetch(`${gateBase}/platform/shelters`, { headers });
  return { status: res.status, cache: res.headers.get('cache-control'), text: await res.text() };
}

test('/platform/shelters serves the queue page to a platform owner', async () => {
  ownersAre([OWNER_ID]);
  const res = await getPage({ userId: OWNER_ID, role: 'admin', shelterId: 1 });
  assert.equal(res.status, 200);
  assert.match(res.text, /Shelter applications/);
  assert.match(res.text, /\/js\/platform\/shelters\.js/);
  assert.equal(res.cache, 'no-store');
});

for (const [label, session] of [
  ['signed out', undefined],
  ['volunteer', { userId: 2, role: 'volunteer', shelterId: 1 }],
  ['shelter admin who is not a platform owner', { userId: 3, role: 'admin', shelterId: 1 }],
  ['owner on a kiosk session', { userId: OWNER_ID, role: 'admin', shelterId: 1, kioskMode: true }],
]) {
  test(`/platform/shelters is the 404 page for a ${label}`, async () => {
    ownersAre([OWNER_ID]);
    const res = await getPage(session);
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /Shelter applications/);
    assert.equal(res.cache, 'no-store');
  });
}

// ---------------------------------------------------------------------------
// server.js wiring: the gated route and no direct static access
// ---------------------------------------------------------------------------

test('server.js 404s the page file however it is addressed, and gates /platform/shelters', async () => {
  ownersAre([OWNER_ID]);
  const { app } = require('../server');
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const p of [
      '/pages/platform-shelters.html',
      '/pages/Platform-Shelters.HTML',
      '/pages/platform%2Dshelters.html',
      '/pages/admin/../platform-shelters.html',
      '/platform/shelters',
    ]) {
      const res = await fetch(`${base}${p}`);
      const text = await res.text();
      assert.equal(res.status, 404, p);
      assert.doesNotMatch(text, /Shelter applications/, p);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// scripts/platform-owner.js production guard
// ---------------------------------------------------------------------------

test('platform-owner script refuses production and non-local databases without --staging', () => {
  assert.throws(
    () => assertNonProduction({ NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/db' }, { staging: true }),
    /NODE_ENV=production/
  );
  assert.throws(
    () => assertNonProduction({ DATABASE_URL: 'postgres://u:p@db.example.net:5432/app' }, { staging: false }),
    /--staging/
  );
  assert.throws(
    () => assertNonProduction({ DATABASE_URL: 'postgres://u:p@aws-0.pooler.supabase.com:5432/postgres' }, { staging: true }),
    /CONFIRM_LIVE_SHELTER/
  );
  assert.doesNotThrow(() => assertNonProduction({ DATABASE_URL: 'postgres://u:p@localhost:5432/app' }, { staging: false }));
  assert.doesNotThrow(() => assertNonProduction({ DATABASE_URL: 'postgres://u:p@db.example.net:5432/app' }, { staging: true }));
});

test('platform-owner script parses its arguments', () => {
  assert.deepEqual(readArgs(['add', '--email', 'a@b.example', '--staging']), {
    command: 'add', staging: true, email: 'a@b.example',
  });
  assert.throws(() => readArgs(['add', '--email']), /Missing value/);
});
