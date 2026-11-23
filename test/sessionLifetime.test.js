'use strict';

// SL-NOW-01: 30-day remember-me for volunteers only. Staff, admin and kiosk
// sessions stay at the 1-hour idle default.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

delete require.cache[require.resolve('../controllers/authController')];
delete require.cache[require.resolve('../controllers/kioskController')];
const auth = require('../controllers/authController');
const kiosk = require('../controllers/kioskController');
const {
  DEFAULT_SESSION_MS,
  VOLUNTEER_REMEMBER_MS,
  parseRememberMe,
  sessionMaxAgeFor,
  enforceSessionLifetime,
  sessionCookieOptions,
} = require('../utils/sessionCookie');

const ONE_HOUR = 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * ONE_HOUR;
const hash = bcrypt.hashSync('Password1', 4);

function userRow(role) {
  return {
    user_id: 7,
    first_name: 'Alex',
    last_name: 'Jenkins',
    name: 'Alex Jenkins',
    email: 'alex@example.com',
    password: hash,
    role,
    shelter_id: 1,
    created_at: '2026-01-01',
  };
}

function useRole(role) {
  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow(role)]];
    return [{ affectedRows: 1 }];
  });
}

function makeReq(body, cookie = { maxAge: ONE_HOUR }) {
  return {
    body,
    session: {
      cookie,
      regenerate(cb) {
        cb(null);
      },
    },
  };
}

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
  res.clearCookie = () => res;
  return res;
}

async function loginAs(role, rememberMe) {
  useRole(role);
  const req = makeReq({ email: 'alex@example.com', password: 'Password1', rememberMe });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.statusCode, 200);
  return req.session.cookie.maxAge;
}

test('constants: default is 1 hour, volunteer remember-me is 30 days', () => {
  assert.equal(DEFAULT_SESSION_MS, ONE_HOUR);
  assert.equal(VOLUNTEER_REMEMBER_MS, THIRTY_DAYS);
});

test('sessionMaxAgeFor: only an opted-in, non-kiosk volunteer gets 30 days', () => {
  assert.equal(sessionMaxAgeFor({ role: 'volunteer', rememberMe: true }), THIRTY_DAYS);
  assert.equal(sessionMaxAgeFor({ role: 'volunteer', rememberMe: false }), ONE_HOUR);
  assert.equal(sessionMaxAgeFor({ role: 'volunteer', rememberMe: true, kioskMode: true }), ONE_HOUR);
  for (const role of ['staff', 'admin', 'platform_owner', undefined]) {
    assert.equal(sessionMaxAgeFor({ role, rememberMe: true }), ONE_HOUR, String(role));
  }
  assert.equal(sessionMaxAgeFor(), ONE_HOUR);
});

test('parseRememberMe accepts only explicit opt-in values', () => {
  for (const v of [true, 1, 'true', 'on', '1', ' TRUE ']) assert.equal(parseRememberMe(v), true, String(v));
  for (const v of [false, 0, 'false', 'off', '', 'no', null, undefined, {}, []]) {
    assert.equal(parseRememberMe(v), false, String(v));
  }
});

test('login: volunteer with remember-me gets a 30-day cookie', async () => {
  assert.equal(await loginAs('volunteer', true), THIRTY_DAYS);
  assert.equal(await loginAs('volunteer', 'on'), THIRTY_DAYS);
});

test('login: volunteer without remember-me stays at 1 hour', async () => {
  assert.equal(await loginAs('volunteer', false), ONE_HOUR);
  assert.equal(await loginAs('volunteer', undefined), ONE_HOUR);
  assert.equal(await loginAs('volunteer', 'false'), ONE_HOUR);
});

test('login: staff and admin stay at 1 hour even when they tick remember-me', async () => {
  assert.equal(await loginAs('staff', true), ONE_HOUR);
  assert.equal(await loginAs('admin', true), ONE_HOUR);
  assert.equal(await loginAs('staff', false), ONE_HOUR);
  assert.equal(await loginAs('admin', false), ONE_HOUR);
});

test('login resets a leftover 30-day cookie when a staff member signs in', async () => {
  useRole('staff');
  const req = makeReq(
    { email: 'alex@example.com', password: 'Password1', rememberMe: true },
    { maxAge: THIRTY_DAYS }
  );
  await auth.login(req, makeRes());
  assert.equal(req.session.cookie.maxAge, ONE_HOUR);
});

test('kiosk unlock is always 1 hour, even over a remembered volunteer cookie', async () => {
  useRole('staff');
  const req = makeReq(
    { email: 'alex@example.com', password: 'Password1', rememberMe: true },
    { maxAge: THIRTY_DAYS }
  );
  const res = makeRes();
  await kiosk.unlockKiosk(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(req.session.kioskMode, true);
  assert.equal(req.session.cookie.maxAge, ONE_HOUR);
});

test('enforceSessionLifetime clamps staff, admin and kiosk sessions to 1 hour', () => {
  const cases = [
    { role: 'staff' },
    { role: 'admin' },
    { role: 'volunteer', kioskMode: true },
    { role: 'staff', kioskMode: true },
  ];
  for (const c of cases) {
    const req = { session: { userId: 7, ...c, cookie: { originalMaxAge: 8 * ONE_HOUR, maxAge: 8 * ONE_HOUR } } };
    let called = false;
    enforceSessionLifetime(req, {}, () => {
      called = true;
    });
    assert.equal(called, true);
    assert.equal(req.session.cookie.maxAge, ONE_HOUR, JSON.stringify(c));
  }
});

test('enforceSessionLifetime leaves volunteer and anonymous sessions alone', () => {
  const vol = { session: { userId: 7, role: 'volunteer', cookie: { originalMaxAge: THIRTY_DAYS, maxAge: THIRTY_DAYS } } };
  enforceSessionLifetime(vol, {}, () => {});
  assert.equal(vol.session.cookie.maxAge, THIRTY_DAYS);

  const anon = { session: { cookie: { originalMaxAge: ONE_HOUR, maxAge: ONE_HOUR } } };
  enforceSessionLifetime(anon, {}, () => {});
  assert.equal(anon.session.cookie.maxAge, ONE_HOUR);

  const staffShort = { session: { userId: 7, role: 'staff', cookie: { originalMaxAge: ONE_HOUR, maxAge: 10 } } };
  enforceSessionLifetime(staffShort, {}, () => {});
  assert.equal(staffShort.session.cookie.maxAge, 10, 'does not extend a nearly-expired cookie');

  let called = false;
  enforceSessionLifetime({}, {}, () => {
    called = true;
  });
  assert.equal(called, true);
});

// Real express-session round trip, configured like server.js (rolling, 1 hour
// default, clamp middleware), so we check the Set-Cookie expiry the browser sees.
function startApp() {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-only-session-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new session.MemoryStore(),
    cookie: { ...sessionCookieOptions(), maxAge: DEFAULT_SESSION_MS },
  }));
  app.use(enforceSessionLifetime);
  app.post('/api/auth/login', (req, res) => auth.login(req, res));
  app.post('/api/kiosk/unlock', (req, res) => kiosk.unlockKiosk(req, res));
  app.get('/api/ping', (req, res) => {
    req.session.touchedAt = Date.now();
    res.json({ ok: true });
  });
  // Simulates a role change after login (for example a volunteer promoted to staff).
  app.post('/api/test/set-role', (req, res) => {
    req.session.role = req.body.role;
    res.json({ ok: true });
  });
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function call(server, method, path, body, cookie) {
  const { port } = server.address();
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, setCookie };
}

function lifetimeMs(setCookie) {
  const m = /Expires=([^;]+)/i.exec(setCookie);
  assert.ok(m, `expected an Expires attribute in: ${setCookie}`);
  return new Date(m[1]).getTime() - Date.now();
}

function sid(setCookie) {
  return setCookie.split(';')[0];
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 5 * 60 * 1000, `${actual} not within 5 min of ${expected}`);
}

test('http: Set-Cookie lifetime by role, and rolling keeps it', async (t) => {
  const server = await startApp();
  t.after(() => server.close());

  useRole('volunteer');
  let r = await call(server, 'POST', '/api/auth/login', { email: 'alex@example.com', password: 'Password1', rememberMe: true });
  assert.equal(r.status, 200);
  near(lifetimeMs(r.setCookie), THIRTY_DAYS);
  const volCookie = sid(r.setCookie);
  r = await call(server, 'GET', '/api/ping', null, volCookie);
  near(lifetimeMs(r.setCookie), THIRTY_DAYS);

  useRole('volunteer');
  r = await call(server, 'POST', '/api/auth/login', { email: 'alex@example.com', password: 'Password1' });
  near(lifetimeMs(r.setCookie), ONE_HOUR);

  for (const role of ['staff', 'admin']) {
    useRole(role);
    r = await call(server, 'POST', '/api/auth/login', { email: 'alex@example.com', password: 'Password1', rememberMe: true });
    assert.equal(r.status, 200);
    near(lifetimeMs(r.setCookie), ONE_HOUR);
    r = await call(server, 'GET', '/api/ping', null, sid(r.setCookie));
    near(lifetimeMs(r.setCookie), ONE_HOUR);
  }

  useRole('staff');
  r = await call(server, 'POST', '/api/kiosk/unlock', { email: 'alex@example.com', password: 'Password1', rememberMe: true }, volCookie);
  assert.equal(r.status, 200);
  near(lifetimeMs(r.setCookie), ONE_HOUR);
});

test('http: a remembered volunteer session drops to 1 hour if the role changes', async (t) => {
  const server = await startApp();
  t.after(() => server.close());

  useRole('volunteer');
  let r = await call(server, 'POST', '/api/auth/login', { email: 'alex@example.com', password: 'Password1', rememberMe: true });
  const cookie = sid(r.setCookie);
  near(lifetimeMs(r.setCookie), THIRTY_DAYS);

  await call(server, 'POST', '/api/test/set-role', { role: 'staff' }, cookie);
  r = await call(server, 'GET', '/api/ping', null, cookie);
  near(lifetimeMs(r.setCookie), ONE_HOUR);
});
