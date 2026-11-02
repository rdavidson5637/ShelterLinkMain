'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('concurrent auth me loads share one request and one body read', async () => {
  const { createAuthMeLoader } = await import('../frontend/js/authMe.js');
  let calls = 0;
  let jsonReads = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const loader = createAuthMeLoader(async () => {
    calls += 1;
    await gate;
    return {
      ok: true,
      status: 200,
      json: async () => {
        jsonReads += 1;
        return { id: 4, role: 'volunteer', needsPrivacyNotice: true };
      },
    };
  });

  const first = loader.load();
  const second = loader.load();
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(jsonReads, 1);
  assert.equal(a, b);
  assert.equal(a.ok, true);
  assert.equal(a.status, 200);
  assert.equal(a.user.needsPrivacyNotice, true);
  assert.equal(a.networkError, false);

  const third = await loader.load();
  assert.equal(calls, 1);
  assert.equal(third, a);
});

test('a 403 is signed out, and only a drop, 429 or 5xx is unreachable', async () => {
  const { authMeOutcome } = await import('../frontend/js/authMe.js');
  const user = { id: 4, role: 'staff' };

  assert.equal(
    authMeOutcome({ ok: true, status: 200, user, networkError: false }),
    'signed-in'
  );
  for (const status of [401, 403]) {
    assert.equal(
      authMeOutcome({ ok: false, status, user: null, networkError: false }),
      'signed-out'
    );
  }
  for (const status of [429, 500, 503]) {
    assert.equal(
      authMeOutcome({ ok: false, status, user: null, networkError: false }),
      'unreachable'
    );
  }
  assert.equal(
    authMeOutcome({ ok: false, status: 0, user: null, networkError: true }),
    'unreachable'
  );
});

test('auth check throws instead of sending a failed request to login', () => {
  const auth = read('frontend/js/auth.js');
  assert.match(auth, /We could not reach ShelterLink\. Check your signal and try again\./);
  assert.match(auth, /error\.authUnreachable = true/);
  assert.match(auth, /if \(outcome === 'signed-out'\) return null/);
  assert.match(auth, /unhandledrejection/);
  assert.match(auth, /event\.preventDefault\(\)/);
  assert.match(auth, /getElementById\('reachNotice'\)/);
  assert.match(auth, /querySelectorAll\('\.skeleton'\)/);
  const session = read('frontend/js/utils/sessionManager.js');
  assert.match(session, /reportAuthMe\(result\) === 'signed-out'/);
});

test('refresh starts a new auth me request and keeps 401 distinct from a network error', async () => {
  const { createAuthMeLoader } = await import('../frontend/js/authMe.js');
  const responses = [
    { ok: true, status: 200, json: async () => ({ id: 1 }) },
    { ok: false, status: 401 },
  ];
  let calls = 0;
  const loader = createAuthMeLoader(async () => {
    const next = responses[calls];
    calls += 1;
    if (!next) throw new TypeError('Failed to fetch');
    return next;
  });

  const fresh = await loader.load();
  assert.equal(fresh.status, 200);

  const expired = await loader.refresh();
  assert.equal(calls, 2);
  assert.equal(expired.ok, false);
  assert.equal(expired.status, 401);
  assert.equal(expired.user, null);
  assert.equal(expired.networkError, false);

  const offline = await loader.refresh();
  assert.equal(offline.networkError, true);
  assert.equal(offline.status, 0);
  assert.equal(offline.ok, false);
});

test('brand cache lasts 10 minutes and ignores a failed or stale value', async () => {
  const { readBrandCache, writeBrandCache, BRAND_CACHE_TTL_MS } = await import(
    '../frontend/js/brandCache.js'
  );
  const now = 1_700_000_000_000;
  const brand = { name: 'Yard', hasLogo: false };
  const raw = writeBrandCache(brand, now);
  assert.equal(readBrandCache(raw, now + 1000).hit, true);
  assert.deepEqual(readBrandCache(raw, now + 1000).brand, brand);
  assert.equal(readBrandCache(raw, now + BRAND_CACHE_TTL_MS).hit, false);
  assert.equal(readBrandCache(raw, now - 1).hit, false);
  assert.equal(readBrandCache('not json', now).hit, false);
  assert.equal(writeBrandCache(null, now), null);
  assert.equal(BRAND_CACHE_TTL_MS, 10 * 60 * 1000);
});

test('page load uses one shared auth me promise, later checks refresh', () => {
  const auth = read('frontend/js/auth.js');
  const session = read('frontend/js/utils/sessionManager.js');
  const dashboard = read('frontend/js/volunteer/dashboard.js');
  const brand = read('frontend/js/brand.js');

  assert.match(auth, /export function loadAuthMe/);
  assert.match(auth, /export function refreshAuthMe/);
  assert.match(auth, /const result = await loadAuthMe\(\)/);

  assert.match(session, /loadAuthMe\(\)/);
  assert.match(session, /refreshAuthMe\(\)/);
  assert.doesNotMatch(session, /apiRequest\('\/auth\/me'/);

  assert.match(dashboard, /loadAuthMe\(\)/);
  assert.doesNotMatch(dashboard, /apiRequest\('\/auth\/me'/);

  assert.match(brand, /readBrandCache/);
  assert.match(brand, /writeBrandCache/);
  assert.match(brand, /\/api\/public\/brand/);
});
