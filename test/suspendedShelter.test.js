'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const bcrypt = require('bcrypt');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { currentShelterId } = require('../utils/shelterContext');
const {
  shelterIdFromSlug,
  shelterFromSlug,
  shelterStatus,
  publicShelterId,
  forEachShelter,
  forgetShelter,
  bindShelter,
  activeShelterPage,
  _resetSlugCacheForTests,
} = require('../middleware/shelter');
const publicCtrl = require('../controllers/publicController');
const { getBrand } = require('../controllers/brandController');
const groupCtrl = require('../controllers/groupBookingController');

delete require.cache[require.resolve('../controllers/authController')];
const auth = require('../controllers/authController');

const PASSWORD_HASH = bcrypt.hashSync('Password1', 4);

// assisi is active, paws is suspended. Tests flip statuses as they need.
let shelters;

function resetShelters() {
  shelters = {
    1: { id: 1, slug: 'assisi', name: 'Assisi Animal Sanctuary', status: 'active' },
    2: { id: 2, slug: 'paws', name: 'Paws Rescue', status: 'suspended' },
    3: { id: 3, slug: 'hope', name: 'Hope Rescue', status: 'active' },
  };
}

function bySlug(slug) {
  return Object.values(shelters).find((s) => s.slug === slug) || null;
}

function useDb(extra = () => undefined) {
  mock.setHandler(async (sql, params) => {
    const custom = await extra(sql, params);
    if (custom !== undefined) return custom;
    if (/FROM shelters WHERE slug = 'assisi'/.test(sql)) return [[{ id: 1 }]];
    if (/FROM shelters WHERE slug = \?/.test(sql)) {
      const row = bySlug(params[0]);
      return [row ? [{ id: row.id, status: row.status }] : []];
    }
    if (/SELECT status FROM shelters WHERE id = \?/.test(sql)) {
      const row = shelters[Number(params[0])];
      return [row ? [{ status: row.status }] : []];
    }
    if (/SELECT id FROM shelters WHERE status = 'active' ORDER BY id/.test(sql)) {
      return [Object.values(shelters).filter((s) => s.status === 'active').map((s) => ({ id: s.id }))];
    }
    if (/SELECT id FROM shelters ORDER BY id/.test(sql)) {
      return [Object.values(shelters).map((s) => ({ id: s.id }))];
    }
    if (/FROM\s+shelters/.test(sql)) {
      const row = shelters[Number(params[0])];
      return [row ? [{ ...row, has_logo: false }] : []];
    }
    return [[]];
  });
}

test.beforeEach(() => {
  resetShelters();
  _resetSlugCacheForTests();
  mock.resetCalls();
  useDb();
});

function makeRes() {
  const res = { statusCode: 200, body: undefined, headers: {}, cleared: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.clearCookie = () => { res.cleared = true; return res; };
  return res;
}

function sqlCalls() {
  return mock.calls.map((c) => c.sql);
}

// ---------------------------------------------------------------------------
// Slug and status lookups
// ---------------------------------------------------------------------------

test('a suspended shelter\'s slug has no id, but its row and status are still visible', async () => {
  assert.equal(await shelterIdFromSlug('paws'), null);
  assert.deepEqual(await shelterFromSlug('paws'), { id: 2, status: 'suspended' });
  assert.equal(await shelterIdFromSlug('hope'), 3);
  assert.equal(await shelterIdFromSlug('nowhere'), null);
});

test('shelterStatus reads the status by id and treats a missing row as null', async () => {
  assert.equal(await shelterStatus(1), 'active');
  assert.equal(await shelterStatus(2), 'suspended');
  assert.equal(await shelterStatus(99), null);
  assert.equal(await shelterStatus('abc'), null);
  assert.equal(await shelterStatus(0), null);
});

test('forgetShelter makes a suspension visible at once instead of after the cache expires', async () => {
  assert.equal(await shelterIdFromSlug('hope'), 3);
  assert.equal(await shelterStatus(3), 'active');
  shelters[3].status = 'suspended';
  assert.equal(await shelterIdFromSlug('hope'), 3, 'still cached');
  assert.equal(await shelterStatus(3), 'active', 'still cached');

  forgetShelter({ id: 3, slug: 'hope' });
  assert.equal(await shelterIdFromSlug('hope'), null);
  assert.equal(await shelterStatus(3), 'suspended');
});

test('forgetShelter by id alone also drops that shelter\'s slug entries', async () => {
  assert.equal(await shelterIdFromSlug('hope'), 3);
  shelters[3].status = 'suspended';
  forgetShelter({ id: 3 });
  assert.equal(await shelterIdFromSlug('hope'), null);
});

// ---------------------------------------------------------------------------
// Public reads, feeds and forms
// ---------------------------------------------------------------------------

test('a suspended slug never falls back to another shelter', async () => {
  assert.equal(await publicShelterId({ query: { shelter: 'paws' } }), null);
  assert.equal(await publicShelterId({ params: { slug: 'paws' } }), null);
  assert.equal(await publicShelterId({ body: { shelter_slug: 'paws' } }), null);
});

test('an unknown slug is a 404 too; only a request with no slug falls back to Assisi', async () => {
  assert.equal(await publicShelterId({ query: { shelter: 'nowhere' } }), null);
  assert.equal(await publicShelterId({ params: { slug: 'nowhere' } }), null);
  assert.equal(await publicShelterId({ body: { shelter_slug: 'Bad_Slug!' } }), null);
  assert.equal(await publicShelterId({ query: { shelter: 'hope' } }), 3);
  assert.equal(await publicShelterId({ query: {} }), 1);
});

test('public opportunities, the ICS feed and the brand answer 404 for a suspended slug', async () => {
  let res = makeRes();
  await publicCtrl.listPublicOpportunities({ query: { shelter: 'paws' } }, res);
  assert.equal(res.statusCode, 404);

  res = makeRes();
  await publicCtrl.publicOpportunitiesIcs({ query: { shelter: 'paws' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['Content-Type'], undefined, 'no calendar is served');

  res = makeRes();
  await getBrand({ query: { shelter: 'paws' } }, res);
  assert.equal(res.statusCode, 404);

  assert.ok(!sqlCalls().some((s) => /FROM opportunities/.test(s)), 'no shifts were read for anyone');
});

test('a group booking for a suspended slug is refused before any shelter data is read', async () => {
  const res = makeRes();
  await groupCtrl.createGroupBooking({
    body: {
      opportunity_id: 1,
      shelter_slug: 'paws',
      group_name: 'Year 6',
      contact_name: 'Pat',
      contact_email: 'pat@example.test',
      size: 2,
      started_at: Date.now() - 10000,
    },
    query: {},
  }, res);
  assert.equal(res.statusCode, 404);
  assert.ok(!sqlCalls().some((s) => /opportunities|group_bookings/.test(s)));
});

test('volunteer sign-up for a suspended slug is refused and no user is created', async () => {
  const res = makeRes();
  await auth.register({
    body: {
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.test',
      password: 'longpassword',
      privacy_notice: true,
      shelter_slug: 'paws',
    },
  }, res);
  assert.equal(res.statusCode, 404);
  assert.ok(!sqlCalls().some((s) => /INSERT INTO users/.test(s)));
});

// ---------------------------------------------------------------------------
// Sign-in and sessions
// ---------------------------------------------------------------------------

function loginReq(body) {
  return {
    body,
    session: {
      cookie: { maxAge: 3600000 },
      regenerate(cb) { this.regenerated = true; cb(null); },
    },
  };
}

function withUser(shelterId) {
  useDb((sql) => {
    if (/FROM users\s+WHERE lower\(email\)/.test(sql)) {
      return [[{
        user_id: 7, first_name: 'Alex', last_name: 'J', name: 'Alex J', email: 'alex@example.test',
        password: PASSWORD_HASH, role: 'admin', shelter_id: shelterId, created_at: '2026-01-01',
        privacy_notice_version: null,
      }]];
    }
    if (/UPDATE users SET/.test(sql)) return [{ affectedRows: 1 }];
    return undefined;
  });
}

test('the right password for a suspended shelter is refused with no session', async () => {
  withUser(2);
  const req = loginReq({ email: 'alex@example.test', password: 'Password1' });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'shelter_suspended');
  assert.match(res.body.error, /not active on ShelterLink/);
  assert.ok(!req.session.regenerated, 'no session was started');
  assert.equal(req.session.userId, undefined);
  assert.ok(!sqlCalls().some((s) => /UPDATE users SET/.test(s)), 'last_login is not touched');
});

test('a wrong password never reveals whether the shelter is suspended', async () => {
  withUser(2);
  const res = makeRes();
  await auth.login(loginReq({ email: 'alex@example.test', password: 'WrongPass1' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Invalid credentials');
  assert.ok(!sqlCalls().some((s) => /SELECT status FROM shelters/.test(s)), 'status is not checked before the password');
});

test('an active shelter\'s user still signs in', async () => {
  withUser(3);
  const req = loginReq({ email: 'alex@example.test', password: 'Password1' });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(req.session.userId, 7);
  assert.equal(req.session.shelterId, 3);
});

function bindReq(userShelterId) {
  useDb((sql) => {
    if (/FROM users\s+WHERE user_id = \?/.test(sql)) {
      return [[{ user_id: 7, name: 'Alex', email: 'alex@example.test', role: 'admin', shelter_id: userShelterId }]];
    }
    return undefined;
  });
  return {
    body: {},
    query: {},
    params: {},
    session: {
      userId: 7,
      role: 'admin',
      destroy(cb) { this.destroyed = true; cb(); },
    },
  };
}

test('bindShelter signs out a user whose shelter is suspended', async () => {
  const req = bindReq(2);
  const res = makeRes();
  let nextCalled = false;
  await bindShelter(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'shelter_suspended');
  assert.ok(req.session.destroyed, 'the session is destroyed');
  assert.ok(res.cleared, 'the session cookie is cleared');
});

test('bindShelter still binds an active shelter', async () => {
  const req = bindReq(3);
  const res = makeRes();
  let boundTo = null;
  await bindShelter(req, res, () => { boundTo = currentShelterId(); });
  assert.equal(boundTo, 3);
  assert.equal(req.session.shelterId, 3);
  assert.ok(!req.session.destroyed);
});

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

function withResetUser(shelterId, { owner = false } = {}) {
  const sent = [];
  useDb((sql) => {
    if (/FROM users WHERE lower\(email\)/.test(sql)) {
      return [[{ user_id: 7, email: 'alex@example.test', first_name: 'Alex', shelter_id: shelterId }]];
    }
    if (/FROM platform_owners/.test(sql)) return [owner ? [{ user_id: 7 }] : []];
    if (/UPDATE users SET reset_token/.test(sql)) return [{ affectedRows: 1 }];
    return undefined;
  });
  return sent;
}

async function forgot() {
  const res = makeRes();
  const prev = { APP_URL: process.env.APP_URL };
  process.env.APP_URL = 'https://shelterlink.example';
  try {
    await auth.forgotPassword({ body: { email: 'alex@example.test' } }, res);
  } finally {
    if (prev.APP_URL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev.APP_URL;
  }
  return res;
}

test('forgot-password for a suspended shelter\'s user sends nothing and answers the generic 200', async () => {
  withResetUser(2);
  const res = await forgot();
  assert.equal(res.statusCode, 200);
  assert.ok(!sqlCalls().some((s) => /UPDATE users SET reset_token = \?/.test(s)), 'no reset token is issued');
});

test('forgot-password for an active shelter\'s user still issues a token, with the same body', async () => {
  withResetUser(3);
  const suspended = await (async () => { withResetUser(2); return forgot(); })();
  mock.resetCalls();
  withResetUser(3);
  const res = await forgot();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, suspended.body, 'responses are identical');
  assert.ok(sqlCalls().some((s) => /UPDATE users SET reset_token = \?/.test(s)), 'a reset token is issued');
});

test('forgot-password still works for a platform owner whose shelter is suspended', async () => {
  withResetUser(2, { owner: true });
  await forgot();
  assert.ok(sqlCalls().some((s) => /UPDATE users SET reset_token = \?/.test(s)));
});

// ---------------------------------------------------------------------------
// Platform owner whose own shelter is suspended
// ---------------------------------------------------------------------------

function ownerDb(shelterId) {
  useDb((sql) => {
    if (/FROM users\s+WHERE lower\(email\)/.test(sql)) {
      return [[{
        user_id: 7, first_name: 'Alex', last_name: 'J', name: 'Alex J', email: 'alex@example.test',
        password: PASSWORD_HASH, role: 'admin', shelter_id: shelterId, created_at: '2026-01-01',
        privacy_notice_version: null,
      }]];
    }
    if (/FROM users\s+WHERE user_id = \?/.test(sql)) {
      return [[{ user_id: 7, name: 'Alex', email: 'alex@example.test', role: 'admin', shelter_id: shelterId }]];
    }
    if (/FROM platform_owners/.test(sql)) return [[{ user_id: 7 }]];
    if (/UPDATE users SET/.test(sql)) return [{ affectedRows: 1 }];
    return undefined;
  });
}

function ownerReq(path) {
  return {
    path,
    body: {},
    query: {},
    params: {},
    session: { userId: 7, role: 'admin', destroy(cb) { this.destroyed = true; cb(); } },
  };
}

test('a platform owner whose shelter is suspended can still sign in', async () => {
  ownerDb(2);
  const req = loginReq({ email: 'alex@example.test', password: 'Password1' });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(req.session.userId, 7);
});

test('a platform owner whose shelter is suspended keeps /api/platform and /auth/me', async () => {
  for (const p of ['/platform/applications', '/platform/shelters/2/reactivate', '/platform', '/auth/me', '/auth/logout']) {
    ownerDb(2);
    const req = ownerReq(p);
    const res = makeRes();
    let boundTo = null;
    await bindShelter(req, res, () => { boundTo = currentShelterId(); });
    assert.equal(boundTo, 2, p);
    assert.ok(!req.session.destroyed, `${p}: session kept`);
  }
});

test('a platform owner whose shelter is suspended gets 403 on that shelter\'s own API, without being signed out', async () => {
  for (const p of ['/admin/volunteers', '/opportunities', '/platformx', '/auth/me/extra']) {
    ownerDb(2);
    const req = ownerReq(p);
    const res = makeRes();
    let nextCalled = false;
    await bindShelter(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, p);
    assert.equal(res.statusCode, 403, p);
    assert.equal(res.body.code, 'shelter_suspended');
    assert.ok(!req.session.destroyed, `${p}: session kept`);
  }
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

test('jobs skip suspended shelters by default; housekeeping can include them', async () => {
  const seen = [];
  await forEachShelter(async (id) => { seen.push(id); });
  assert.deepEqual(seen, [1, 3]);

  const all = [];
  await forEachShelter(async (id) => { all.push(currentShelterId()); }, { includeSuspended: true });
  assert.deepEqual(all, [1, 2, 3]);
});

test('retention and token cleanup are registered as housekeeping that includes suspended shelters', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'jobs', 'index.js'), 'utf8');
  assert.match(source, /HOUSEKEEPING = \{ includeSuspended: true \}/);
  assert.match(source, /runDataRetentionJob\(\), HOUSEKEEPING\)/);
  assert.match(source, /runResetTokenCleanup\(\), HOUSEKEEPING\)/);
  for (const job of ['runShiftReminders', 'runWeeklyDigest', 'runMessageDigest', 'runFeedbackRequests']) {
    assert.match(source, new RegExp(`forEachShelter\\(\\(\\) => ${job}\\(\\)\\)`), `${job} skips suspended shelters`);
  }
});

// ---------------------------------------------------------------------------
// /join/<slug> and /s/<slug> pages
// ---------------------------------------------------------------------------

let server;
let base;
let pageFile;

test.before(async () => {
  pageFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sl-page-')), 'page.html');
  fs.writeFileSync(pageFile, '<!doctype html><title>page</title>');
  const app = express();
  app.get('/join/:slug', activeShelterPage(pageFile));
  app.get('/s/:slug/opportunities', activeShelterPage(pageFile));
  app.use((req, res) => res.status(404).send('not found page'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('shelter pages are served for an active slug and 404 for a suspended or unknown one', async () => {
  for (const [url, status] of [
    ['/join/hope', 200],
    ['/s/hope/opportunities', 200],
    ['/join/paws', 404],
    ['/s/paws/opportunities', 404],
    ['/join/nowhere', 404],
    ['/s/nowhere/opportunities', 404],
    ['/join/Bad_Slug', 404],
  ]) {
    const res = await fetch(base + url);
    assert.equal(res.status, status, url);
    const text = await res.text();
    if (status === 200) assert.match(text, /<title>page<\/title>/);
    else assert.equal(text, 'not found page');
  }
});
