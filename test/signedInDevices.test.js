'use strict';

// SL-LATER-33: signed-in devices. Own sessions only, opaque ids, sign out
// one or all others, and a password change ends every other session.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-for-signed-in-devices';

const mock = require('./helpers/mockDb');
const bcrypt = require('bcrypt');

delete require.cache[require.resolve('../controllers/sessionsController')];
delete require.cache[require.resolve('../controllers/authController')];
const sessions = require('../controllers/sessionsController');
const auth = require('../controllers/authController');
const { summarizeUserAgent } = require('../utils/deviceSummary');

const HOUR = 60 * 60 * 1000;
const MONTH = 30 * 24 * HOUR;
const hash = bcrypt.hashSync('Old-password-1', 4);

// In-memory stand-in for the connect-pg-simple "session" table.
let table = [];
let users = {};

function seed() {
  const now = Date.now();
  table = [
    { sid: 'sid-current', sess: { userId: 7, role: 'volunteer', device: 'Safari on iPhone', loginAt: now - HOUR, cookie: { originalMaxAge: MONTH } }, expire: new Date(now + MONTH - 60000) },
    { sid: 'sid-laptop', sess: { userId: 7, role: 'volunteer', device: 'Firefox on Windows', loginAt: now - 5 * HOUR, cookie: { originalMaxAge: HOUR } }, expire: new Date(now + HOUR - 30 * 60000) },
    { sid: 'sid-other-user', sess: { userId: 8, role: 'admin', device: 'Chrome on Mac', loginAt: now, cookie: { originalMaxAge: HOUR } }, expire: new Date(now + HOUR) },
    { sid: 'sid-pending-2fa', sess: { pendingTwoFactor: { userId: 7 }, cookie: { originalMaxAge: HOUR } }, expire: new Date(now + HOUR) },
  ];
  users = { 7: { user_id: 7, password: hash } };
}

function ownerOf(row) {
  return row.sess.userId == null ? null : String(row.sess.userId);
}

mock.setHandler(async (sql, params) => {
  const s = String(sql);
  if (/SELECT sid, sess, expire\s+FROM session/i.test(s)) {
    const now = Date.now();
    return [table.filter((r) => ownerOf(r) === params[0] && r.expire.getTime() > now).map((r) => ({ ...r, sess: JSON.stringify(r.sess) }))];
  }
  if (/DELETE FROM session WHERE sid = \? AND sess->>'userId' = \?/i.test(s)) {
    const before = table.length;
    table = table.filter((r) => !(r.sid === params[0] && ownerOf(r) === params[1]));
    return [{ affectedRows: before - table.length }];
  }
  if (/DELETE FROM session WHERE sess->>'userId' = \? AND sid <> \?/i.test(s)) {
    const before = table.length;
    table = table.filter((r) => !(ownerOf(r) === params[0] && r.sid !== params[1]));
    return [{ affectedRows: before - table.length }];
  }
  if (/DELETE FROM session WHERE sess->>'userId' = \?/i.test(s)) {
    const before = table.length;
    table = table.filter((r) => ownerOf(r) !== params[0]);
    return [{ affectedRows: before - table.length }];
  }
  if (/SELECT user_id, password FROM users/i.test(s)) {
    const u = users[params[0]];
    return [u ? [u] : []];
  }
  if (/UPDATE users\s+SET password = \?/i.test(s)) {
    const id = params[params.length - 1];
    if (users[id]) users[id].password = params[0];
    return [{ affectedRows: users[id] ? 1 : 0 }];
  }
  return [[]];
});

function makeReq({ userId = 7, sid = 'sid-current', params = {}, body = {}, session = {} } = {}) {
  return {
    sessionID: sid,
    params,
    body,
    headers: {},
    session: { userId, role: 'volunteer', cookie: { maxAge: HOUR }, ...session },
  };
}

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.clearCookie = () => res;
  return res;
}

async function list(req = makeReq()) {
  const res = makeRes();
  await sessions.listSessions(req, res);
  return res;
}

test('lists only the caller\'s signed-in sessions, current first, no session ids', async () => {
  seed();
  mock.resetCalls();
  const res = await list();
  assert.equal(res.statusCode, 200);
  const rows = res.body.sessions;
  assert.equal(rows.length, 2, 'other user and pending 2FA sessions are excluded');
  assert.equal(rows[0].current, true);
  assert.equal(rows[0].device, 'Safari on iPhone');
  assert.equal(rows[1].current, false);
  assert.equal(rows[1].device, 'Firefox on Windows');
  // last active = expire - lifetime: about 30 minutes ago for the laptop.
  const ago = Date.now() - new Date(rows[1].lastActiveAt).getTime();
  assert.ok(ago > 25 * 60000 && ago < 35 * 60000, `lastActive ${ago}ms ago`);
  assert.ok(rows[1].signedInAt);

  const text = JSON.stringify(res.body);
  for (const sid of ['sid-current', 'sid-laptop', 'sid-other-user', 'sid-pending-2fa']) {
    assert.equal(text.includes(sid), false, `${sid} leaked`);
  }
  assert.equal(text.includes('Chrome on Mac'), false);
  rows.forEach((r) => assert.match(r.id, /^[A-Za-z0-9_-]{22}$/));
  assert.deepEqual(Object.keys(rows[0]).sort(), ['current', 'device', 'expiresAt', 'id', 'kiosk', 'lastActiveAt', 'signedInAt']);

  const select = mock.calls.find((c) => /FROM session/i.test(c.sql));
  assert.match(select.sql, /sess->>'userId' = \?/);
  assert.deepEqual(select.params, ['7']);
});

test('signed-out callers get 401 and never reach the session table', async () => {
  seed();
  mock.resetCalls();
  const res = makeRes();
  await sessions.listSessions({ sessionID: 'x', session: {} }, res);
  assert.equal(res.statusCode, 401);
  const res2 = makeRes();
  await sessions.revokeOtherSessions({ sessionID: 'x', session: {} }, res2);
  assert.equal(res2.statusCode, 401);
  assert.equal(mock.calls.filter((c) => /session/i.test(c.sql)).length, 0);
});

test('signs out one other device by handle and leaves the rest alone', async () => {
  seed();
  const laptop = (await list()).body.sessions.find((s) => !s.current);
  const res = makeRes();
  await sessions.revokeSession(makeReq({ params: { id: laptop.id } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(table.map((r) => r.sid).sort(), ['sid-current', 'sid-other-user', 'sid-pending-2fa']);
});

test('cannot sign out another user\'s session even with its real handle', async () => {
  seed();
  const handle = sessions.sessionHandle('sid-other-user');
  const res = makeRes();
  await sessions.revokeSession(makeReq({ params: { id: handle } }), res);
  assert.equal(res.statusCode, 404);
  assert.ok(table.some((r) => r.sid === 'sid-other-user'));
});

test('a raw session id or junk is not accepted as a handle', async () => {
  seed();
  mock.resetCalls();
  for (const id of ['sid-laptop', '../../etc', '', 'a'.repeat(200)]) {
    const res = makeRes();
    await sessions.revokeSession(makeReq({ params: { id } }), res);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(mock.calls.length, 0);
  assert.equal(table.length, 4);
});

test('the current device is not signed out through the device list', async () => {
  seed();
  const res = makeRes();
  await sessions.revokeSession(makeReq({ params: { id: sessions.sessionHandle('sid-current') } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(table.length, 4);
});

test('sign out all other devices keeps this one and other users\' sessions', async () => {
  seed();
  const res = makeRes();
  await sessions.revokeOtherSessions(makeReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ended, 1);
  assert.deepEqual(table.map((r) => r.sid).sort(), ['sid-current', 'sid-other-user', 'sid-pending-2fa']);
});

test('password change with the wrong current password changes nothing', async () => {
  seed();
  const res = makeRes();
  await sessions.changePassword(makeReq({ body: { currentPassword: 'wrong-one-123', newPassword: 'A-new-long-password-9' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(users[7].password, hash);
  assert.equal(table.length, 4);
});

test('password change rejects a weak new password', async () => {
  seed();
  const res = makeRes();
  await sessions.changePassword(makeReq({ body: { currentPassword: 'Old-password-1', newPassword: 'short' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(users[7].password, hash);
});

test('password change ends every other session for that user only', async () => {
  seed();
  const res = makeRes();
  await sessions.changePassword(makeReq({ body: { currentPassword: 'Old-password-1', newPassword: 'A-new-long-password-9' } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(await bcrypt.compare('A-new-long-password-9', users[7].password));
  assert.deepEqual(table.map((r) => r.sid).sort(), ['sid-current', 'sid-other-user', 'sid-pending-2fa']);
});

test('password change is refused in kiosk mode', async () => {
  seed();
  const res = makeRes();
  await sessions.changePassword(makeReq({ session: { kioskMode: true, role: 'staff' }, body: { currentPassword: 'Old-password-1', newPassword: 'A-new-long-password-9' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(users[7].password, hash);
});

test('password reset ends all of that user\'s sessions', async () => {
  seed();
  const { hashResetToken } = require('../utils/resetToken');
  const tokenHash = hashResetToken('reset-token-abc');
  const prev = mock.calls.length;
  const base = async (sql, params) => {
    if (/WHERE reset_token = \?/i.test(sql) && params[0] === tokenHash) {
      return [[{ user_id: 7, reset_token_expires: new Date(Date.now() + HOUR) }]];
    }
    return null;
  };
  const original = mock.pool.execute;
  mock.pool.execute = async (sql, params) => (await base(sql, params)) || original.call(mock.pool, sql, params);
  try {
    const res = makeRes();
    await auth.resetPassword({ body: { token: 'reset-token-abc', password: 'A-new-long-password-9' }, session: {} }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  } finally {
    mock.pool.execute = original;
  }
  assert.ok(mock.calls.length >= prev);
  assert.deepEqual(table.map((r) => r.sid).sort(), ['sid-other-user', 'sid-pending-2fa']);
});

test('sign-in records a device label and keeps the 30-day remember-me lifetime', async () => {
  seed();
  const pwHash = bcrypt.hashSync('Password1', 4);
  const original = mock.pool.execute;
  mock.pool.execute = async (sql, params) => {
    if (/FROM users/i.test(sql) && /email/i.test(sql)) {
      return [[{ user_id: 7, email: 'alex@example.com', password: pwHash, role: 'volunteer', shelter_id: 1, name: 'Alex' }]];
    }
    return [[]];
  };
  try {
    const req = {
      body: { email: 'alex@example.com', password: 'Password1', rememberMe: true },
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
      session: { cookie: { maxAge: HOUR }, regenerate(cb) { cb(null); } },
    };
    const res = makeRes();
    await auth.login(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(req.session.device, 'Safari on iPhone');
    assert.ok(req.session.loginAt);
    assert.equal(req.session.cookie.maxAge, MONTH);
    assert.equal(JSON.stringify(req.session).includes('Mozilla'), false, 'raw user agent is not stored');
  } finally {
    mock.pool.execute = original;
  }
});

test('device labels come from the user agent without storing it', () => {
  assert.equal(summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'), 'Firefox on Windows');
  assert.equal(summarizeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'), 'Chrome on Mac');
  assert.equal(summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'), 'Edge on Windows');
  assert.equal(summarizeUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36'), 'Samsung Internet on Android');
  assert.equal(summarizeUserAgent(''), 'Unknown device');
  assert.equal(summarizeUserAgent(undefined), 'Unknown device');
});

test('device routes sit behind sign-in', () => {
  delete require.cache[require.resolve('../routes/auth')];
  const router = require('../routes/auth');
  const { isAuthenticated } = require('../middleware/auth');
  const wanted = [
    ['get', '/sessions'],
    ['post', '/sessions/revoke-others'],
    ['delete', '/sessions/:id'],
    ['post', '/change-password'],
  ];
  for (const [method, path] of wanted) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    assert.ok(layer, `${method} ${path} exists`);
    assert.equal(layer.route.stack[0].handle, isAuthenticated, `${method} ${path} needs sign-in`);
  }
});
