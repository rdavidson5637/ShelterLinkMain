'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

delete require.cache[require.resolve('../controllers/authController')];
delete require.cache[require.resolve('../controllers/kioskController')];
delete require.cache[require.resolve('../middleware/auth')];
delete require.cache[require.resolve('../models/User')];

const auth = require('../controllers/authController');
const kiosk = require('../controllers/kioskController');
const {
  attachUser,
  isAuthenticated,
  requireRole,
  requireKiosk,
} = require('../middleware/auth');
const { PRIVACY_NOTICE_VERSION } = require('../config/privacyNotice');
const { destroyUserSessions } = require('../utils/sessionCookie');

const hash = bcrypt.hashSync('Password1', 4);

function makeRes() {
  const res = { statusCode: 200, body: undefined, cleared: false };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  res.clearCookie = () => {
    res.cleared = true;
    return res;
  };
  return res;
}

function makeLoginReq(body, session = {}) {
  return {
    body,
    session: {
      cookie: { maxAge: 3600000 },
      regenerate(cb) {
        cb(null);
      },
      ...session,
    },
  };
}

function userRow(overrides = {}) {
  return {
    user_id: 7,
    first_name: 'Alex',
    last_name: 'Jenkins',
    name: 'Alex Jenkins',
    email: 'alex@example.com',
    password: hash,
    role: 'volunteer',
    shelter_id: 1,
    created_at: '2026-01-01',
    privacy_notice_version: PRIVACY_NOTICE_VERSION,
    ...overrides,
  };
}

test('login rejects missing email or password with 400', async () => {
  const res = makeRes();
  await auth.login(makeLoginReq({ email: 'alex@example.com' }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /email and password/i);
});

test('login with a wrong password is 401 and never sets session.userId', async () => {
  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow()]];
    return [{ affectedRows: 1 }];
  });
  const req = makeLoginReq({ email: 'alex@example.com', password: 'wrong-password' });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(req.session.userId, undefined);
  assert.equal(res.body.password, undefined);
});

test('login success sets session fields and strips password from the body', async () => {
  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow({ role: 'staff', shelter_id: 2 })]];
    return [{ affectedRows: 1 }];
  });
  const req = makeLoginReq({ email: 'alex@example.com', password: 'Password1' });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(req.session.userId, 7);
  assert.equal(req.session.role, 'staff');
  assert.equal(req.session.shelterId, 2);
  assert.ok(req.session.loginAt);
  assert.equal(res.body.password, undefined);
  assert.equal(res.body.reset_token, undefined);
  assert.equal(res.body.needsPrivacyNotice, false);
});

test('getCurrentUser: no session is 401; missing user is 404; success is safe', async () => {
  let res = makeRes();
  await auth.getCurrentUser({ session: {} }, res);
  assert.equal(res.statusCode, 401);

  mock.setHandler(async () => [[]]);
  res = makeRes();
  await auth.getCurrentUser({ session: { userId: 7 } }, res);
  assert.equal(res.statusCode, 404);

  mock.setHandler(async () => [[userRow({
    password: 'secret',
    reset_token: 'tok',
    privacy_notice_version: 'old',
  })]]);
  res = makeRes();
  await auth.getCurrentUser({ session: { userId: 7 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.password, undefined);
  assert.equal(res.body.reset_token, undefined);
  assert.equal(res.body.needsPrivacyNotice, true);
  assert.equal(res.body.email, 'alex@example.com');
});

test('attachUser prefers the live DB role over a stale session role', async () => {
  mock.setHandler(async () => [[{
    user_id: 7,
    name: 'Alex Jenkins',
    email: 'alex@example.com',
    role: 'admin',
    shelter_id: 1,
    created_at: '2026-01-01',
  }]]);
  const req = { session: { userId: 7, role: 'volunteer' } };
  const user = await attachUser(req);
  assert.equal(user.role, 'admin');
  assert.equal(req.session.role, 'admin');
});

test('isAuthenticated rejects a missing session userId', async () => {
  const res = makeRes();
  let nextCalled = false;
  await isAuthenticated({ session: {} }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('isAuthenticated returns 401 when the user row is missing', async () => {
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  let nextCalled = false;
  await isAuthenticated({ session: { userId: 7, role: 'admin' } }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('isAuthenticated calls next when the user row exists', async () => {
  mock.setHandler(async () => [[userRow()]]);
  const req = { session: { userId: 7, role: 'volunteer' } };
  const res = makeRes();
  let nextCalled = false;
  await isAuthenticated(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.user.user_id, 7);
});

test('requireRole returns 401 when the user row is missing (no session-role fallback)', async () => {
  mock.setHandler(async () => [[]]);
  const guard = requireRole('admin');
  const res = makeRes();
  let nextCalled = false;
  await guard({ session: { userId: 7, role: 'admin' } }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('requireKiosk rejects a normal signed-in session', async () => {
  const res = makeRes();
  let nextCalled = false;
  await requireKiosk({ session: { userId: 1, role: 'admin' } }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /Kiosk session required/i);
});

test('kiosk unlock: volunteer is 403; staff unlocks; wrong password is 401', async () => {
  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow({ role: 'volunteer' })]];
    return [[]];
  });
  let req = makeLoginReq({ email: 'alex@example.com', password: 'Password1' });
  let res = makeRes();
  await kiosk.unlockKiosk(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(req.session.kioskMode, undefined);

  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow({ role: 'staff' })]];
    return [[]];
  });
  req = makeLoginReq({ email: 'alex@example.com', password: 'Password1' });
  res = makeRes();
  await kiosk.unlockKiosk(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(req.session.kioskMode, true);
  assert.equal(req.session.userId, 7);
  assert.equal(res.body.user.password, undefined);

  mock.setHandler(async (sql) => {
    if (/FROM users/.test(sql)) return [[userRow({ role: 'admin' })]];
    return [[]];
  });
  req = makeLoginReq({ email: 'alex@example.com', password: 'nope' });
  res = makeRes();
  await kiosk.unlockKiosk(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(req.session.kioskMode, undefined);
});

test('getKioskStatus is 401 when locked and 200 when unlocked', async () => {
  let res = makeRes();
  await kiosk.getKioskStatus({ session: { userId: 1, role: 'admin' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.kiosk, false);

  res = makeRes();
  await kiosk.getKioskStatus({ session: { userId: 1, role: 'admin', kioskMode: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.kiosk, true);
  assert.equal(res.body.userId, 1);
});

test('lockKiosk destroys the session and clears the cookie', async () => {
  const req = {
    session: {
      userId: 1,
      kioskMode: true,
      destroy(cb) {
        cb(null);
      },
    },
  };
  const res = makeRes();
  await new Promise((resolve) => {
    const originalJson = res.json.bind(res);
    res.json = (b) => {
      originalJson(b);
      resolve();
      return res;
    };
    kiosk.lockKiosk(req, res);
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.kiosk, false);
  assert.equal(res.cleared, true);
});

test('kiosk isWithinCheckInWindow covers 1h before through end of day', () => {
  const start = new Date('2099-06-01T10:00:00');
  const okEarly = new Date(start.getTime() - 60 * 60 * 1000);
  const tooEarly = new Date(start.getTime() - 60 * 60 * 1000 - 1);
  const lateEvening = new Date(start);
  lateEvening.setHours(23, 30, 0, 0);
  const nextDay = new Date(start);
  nextDay.setDate(nextDay.getDate() + 1);
  nextDay.setHours(0, 0, 0, 0);

  assert.equal(kiosk.isWithinCheckInWindow(start, okEarly), true);
  assert.equal(kiosk.isWithinCheckInWindow(start, tooEarly), false);
  assert.equal(kiosk.isWithinCheckInWindow(start, lateEvening), true);
  assert.equal(kiosk.isWithinCheckInWindow(start, nextDay), false);
  assert.equal(kiosk.isWithinCheckInWindow('not-a-date', start), false);
});

test('destroyUserSessions no-ops for bad ids and never hits SQL', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [{ affectedRows: 1 }]);
  await destroyUserSessions(mock.pool, 0);
  await destroyUserSessions(mock.pool, -1);
  await destroyUserSessions(mock.pool, 'nope');
  await destroyUserSessions(null, 7);
  assert.equal(mock.calls.length, 0);
});
