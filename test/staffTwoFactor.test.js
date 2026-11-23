'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const bcrypt = require('bcrypt');
const totp = require('../utils/totp');

delete require.cache[require.resolve('../controllers/twoFactorController')];
delete require.cache[require.resolve('../controllers/authController')];
const auth = require('../controllers/authController');
const twoFactor = require('../controllers/twoFactorController');

const hash = bcrypt.hashSync('Password1', 4);
const SECRET = totp.generateSecret();

function makeReq(body, session = {}) {
  return {
    body,
    session: {
      cookie: { maxAge: 3600000 },
      ...session,
      regenerate(cb) {
        for (const k of Object.keys(this)) {
          if (!['cookie', 'regenerate'].includes(k)) delete this[k];
        }
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

function userRow(role, extra = {}) {
  return {
    user_id: 7,
    first_name: 'Sam',
    last_name: 'Reid',
    name: 'Sam Reid',
    email: 'sam@example.com',
    password: hash,
    role,
    shelter_id: 1,
    created_at: '2026-01-01',
    ...extra,
  };
}

function enabledColumns(extra = {}) {
  return {
    totp_secret: totp.encryptSecret(SECRET),
    totp_enabled_at: '2026-11-01 10:00:00',
    totp_last_counter: null,
    totp_recovery_codes: JSON.stringify([]),
    ...extra,
  };
}

/** A tiny users table keyed by the SQL the controllers send. */
function installUsers(row) {
  const state = { row: { ...row }, updates: [] };
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/^\s*UPDATE users SET totp_last_counter/i.test(sql)) {
      const [counter] = params;
      const last = state.row.totp_last_counter;
      if (last != null && Number(last) >= counter) return [{ affectedRows: 0 }];
      state.row.totp_last_counter = counter;
      return [{ affectedRows: 1 }];
    }
    if (/^\s*UPDATE users SET totp_recovery_codes/i.test(sql)) {
      if (params[3] !== state.row.totp_recovery_codes) return [{ affectedRows: 0 }];
      state.row.totp_recovery_codes = params[0];
      return [{ affectedRows: 1 }];
    }
    if (/^\s*UPDATE users/i.test(sql)) {
      state.updates.push({ sql, params });
      if (/SET totp_secret = \?, totp_enabled_at = NOW\(\)/i.test(sql)) {
        if (state.row.totp_enabled_at) return [{ affectedRows: 0 }];
        state.row.totp_secret = params[0];
        state.row.totp_enabled_at = '2026-11-23 09:00:00';
        state.row.totp_last_counter = params[1];
        state.row.totp_recovery_codes = params[2];
        return [{ affectedRows: 1 }];
      }
      if (/totp_secret = NULL/i.test(sql)) {
        Object.assign(state.row, {
          totp_secret: null,
          totp_enabled_at: null,
          totp_last_counter: null,
          totp_recovery_codes: null,
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO audit/i.test(sql)) return [{ insertId: 1, affectedRows: 1 }];
    if (/FROM users/i.test(sql)) return [[{ ...state.row }]];
    return [[]];
  });
  return state;
}

// ─── utils/totp ──────────────────────────────────────────────────────────────

test('TOTP matches the RFC 6238 SHA-1 test vectors', () => {
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp.generateCode(secret, 59 * 1000), '287082');
  assert.equal(totp.generateCode(secret, 1111111109 * 1000), '081804');
  assert.equal(totp.generateCode(secret, 1234567890 * 1000), '005924');
  assert.equal(totp.generateCode(secret, 2000000000 * 1000), '279037');
});

test('verifyCode allows one step of clock drift and refuses replays', () => {
  const now = Date.UTC(2026, 10, 23, 12, 0, 0);
  const counter = totp.counterAt(now);
  assert.equal(totp.verifyCode(SECRET, totp.generateCode(SECRET, now), { timeMs: now }), counter);
  assert.equal(totp.verifyCode(SECRET, totp.generateCode(SECRET, now - 30000), { timeMs: now }), counter - 1);
  assert.equal(totp.verifyCode(SECRET, totp.generateCode(SECRET, now - 90000), { timeMs: now }), null);
  assert.equal(
    totp.verifyCode(SECRET, totp.generateCode(SECRET, now), { timeMs: now, lastCounter: counter }),
    null
  );
  assert.equal(totp.verifyCode(SECRET, 'abcdef', { timeMs: now }), null);
});

test('secrets are encrypted at rest and tampering is detected', () => {
  const stored = totp.encryptSecret(SECRET);
  assert.ok(!stored.includes(SECRET));
  assert.equal(totp.decryptSecret(stored), SECRET);
  const parts = stored.split(':');
  parts[3] = Buffer.from('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX').toString('base64');
  assert.throws(() => totp.decryptSecret(parts.join(':')));
});

test('recovery codes are stored hashed and each works once', () => {
  const { codes, hashes } = totp.generateRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.ok(hashes.every((h) => /^[0-9a-f]{64}$/.test(h)));
  assert.ok(!JSON.stringify(hashes).includes(codes[0]));
  const left = totp.consumeRecoveryCode(JSON.stringify(hashes), codes[2].toUpperCase());
  assert.equal(left.length, 7);
  assert.equal(totp.consumeRecoveryCode(JSON.stringify(left), codes[2]), null);
});

test('otpauth URI names the issuer and account', () => {
  const uri = totp.otpauthUri(SECRET, 'sam@example.com');
  assert.match(uri, /^otpauth:\/\/totp\/ShelterLink%3Asam%40example\.com\?/);
  assert.match(uri, new RegExp(`secret=${SECRET}`));
  assert.match(uri, /issuer=ShelterLink/);
});

// ─── Sign-in flow ────────────────────────────────────────────────────────────

test('staff with 2FA on get a challenge, not a session, from the password step', async () => {
  installUsers(userRow('staff', enabledColumns()));
  const req = makeReq({ email: 'sam@example.com', password: 'Password1', rememberMe: true });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { twoFactorRequired: true });
  assert.equal(req.session.userId, undefined);
  assert.equal(req.session.role, undefined);
  assert.equal(req.session.pendingTwoFactor.userId, 7);
  assert.equal(req.session.pendingTwoFactor.rememberMe, true);
  assert.equal(mock.calls.some((c) => /last_login/i.test(c.sql)), false);
});

test('a wrong password never reaches the code step', async () => {
  installUsers(userRow('admin', enabledColumns()));
  const req = makeReq({ email: 'sam@example.com', password: 'wrong' });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(req.session.pendingTwoFactor, undefined);
});

test('a correct code finishes sign-in with the staff cookie rules', async () => {
  const state = installUsers(userRow('admin', enabledColumns()));
  const req = makeReq({ email: 'sam@example.com', password: 'Password1', rememberMe: true });
  await auth.login(req, makeRes());
  req.body = { code: totp.generateCode(SECRET) };
  const res = makeRes();
  await auth.verifyTwoFactor(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.role, 'admin');
  assert.equal(req.session.userId, 7);
  assert.equal(req.session.pendingTwoFactor, undefined);
  assert.equal(req.session.cookie.maxAge, 8 * 60 * 60 * 1000);
  for (const key of ['totp_secret', 'totp_enabled_at', 'totp_last_counter', 'totp_recovery_codes', 'password']) {
    assert.equal(key in res.body, false, key);
  }
  assert.ok(state.updates.some((u) => /last_login = NOW\(\)/.test(u.sql)));
});

test('the same code cannot be used twice', async () => {
  installUsers(userRow('staff', enabledColumns()));
  const code = totp.generateCode(SECRET);
  const first = makeReq({ email: 'sam@example.com', password: 'Password1' });
  await auth.login(first, makeRes());
  first.body = { code };
  await auth.verifyTwoFactor(first, makeRes());
  assert.equal(first.session.userId, 7);

  const second = makeReq({ email: 'sam@example.com', password: 'Password1' });
  await auth.login(second, makeRes());
  second.body = { code };
  const res = makeRes();
  await auth.verifyTwoFactor(second, res);
  assert.equal(res.statusCode, 401);
  assert.equal(second.session.userId, undefined);
});

test('wrong codes count, and the fifth ends the attempt', async () => {
  installUsers(userRow('staff', enabledColumns()));
  const req = makeReq({ email: 'sam@example.com', password: 'Password1' });
  await auth.login(req, makeRes());
  for (let i = 0; i < twoFactor.MAX_ATTEMPTS; i += 1) {
    req.body = { code: '000000' === totp.generateCode(SECRET) ? '111111' : '000000' };
    const res = makeRes();
    await auth.verifyTwoFactor(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.restart, undefined);
  }
  req.body = { code: totp.generateCode(SECRET) };
  const res = makeRes();
  await auth.verifyTwoFactor(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.restart, true);
  assert.equal(req.session.userId, undefined);
  assert.equal(req.session.pendingTwoFactor, undefined);
});

test('the code step times out after five minutes', async () => {
  installUsers(userRow('staff', enabledColumns()));
  const req = makeReq({ email: 'sam@example.com', password: 'Password1' });
  await auth.login(req, makeRes());
  req.session.pendingTwoFactor.startedAt = Date.now() - twoFactor.PENDING_TTL_MS - 1000;
  req.body = { code: totp.generateCode(SECRET) };
  const res = makeRes();
  await auth.verifyTwoFactor(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.restart, true);
  assert.equal(req.session.userId, undefined);
});

test('verify without a password step is refused', async () => {
  installUsers(userRow('staff', enabledColumns()));
  const req = makeReq({ code: totp.generateCode(SECRET) });
  const res = makeRes();
  await auth.verifyTwoFactor(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(req.session.userId, undefined);
});

test('a recovery code signs in once and reports how many are left', async () => {
  const { codes, hashes } = totp.generateRecoveryCodes();
  installUsers(userRow('staff', enabledColumns({ totp_recovery_codes: JSON.stringify(hashes) })));
  const req = makeReq({ email: 'sam@example.com', password: 'Password1' });
  await auth.login(req, makeRes());
  req.body = { code: codes[0] };
  const res = makeRes();
  await auth.verifyTwoFactor(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.recoveryCodesLeft, 7);

  const again = makeReq({ email: 'sam@example.com', password: 'Password1' });
  await auth.login(again, makeRes());
  again.body = { code: codes[0] };
  const res2 = makeRes();
  await auth.verifyTwoFactor(again, res2);
  assert.equal(res2.statusCode, 401);
});

test('volunteers are never challenged, even with totp columns set', async () => {
  installUsers(userRow('volunteer', enabledColumns()));
  const req = makeReq({ email: 'sam@example.com', password: 'Password1' });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.body.twoFactorRequired, undefined);
  assert.equal(req.session.userId, 7);
});

test('staff without 2FA sign in as before', async () => {
  installUsers(userRow('staff', { totp_secret: null, totp_enabled_at: null }));
  const req = makeReq({ email: 'sam@example.com', password: 'Password1' });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.body.twoFactorRequired, undefined);
  assert.equal(req.session.userId, 7);
});

test('before migration 042 is applied, sign-in still works without 2FA', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/totp_/.test(sql)) {
      const err = new Error('column "totp_enabled_at" does not exist');
      err.code = '42703';
      throw err;
    }
    if (/FROM users/.test(sql)) return [[userRow('admin')]];
    return [{ affectedRows: 1 }];
  });
  const req = makeReq({ email: 'sam@example.com', password: 'Password1' });
  const res = makeRes();
  await auth.login(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(req.session.userId, 7);

  const statusReq = { session: { userId: 7, role: 'admin' }, user: { role: 'admin' } };
  const statusRes = makeRes();
  await twoFactor.status(statusReq, statusRes);
  assert.equal(statusRes.statusCode, 503);
});

// ─── Turning it on and off ───────────────────────────────────────────────────

function signedIn(role, body = {}) {
  return { body, session: { userId: 7, role }, user: { role } };
}

test('setup needs the password, enable needs a good code, codes are shown once', async () => {
  const state = installUsers(userRow('staff', { totp_secret: null, totp_enabled_at: null }));

  const bad = makeRes();
  const req = signedIn('staff', { password: 'nope' });
  await twoFactor.setup(req, bad);
  assert.equal(bad.statusCode, 401);
  assert.equal(req.session.totpSetup, undefined);

  req.body = { password: 'Password1' };
  const setupRes = makeRes();
  await twoFactor.setup(req, setupRes);
  assert.equal(setupRes.statusCode, 200);
  assert.match(setupRes.body.secret, /^[A-Z2-7]{32}$/);
  assert.match(setupRes.body.otpauthUri, /^otpauth:\/\/totp\//);
  assert.equal(state.row.totp_enabled_at, null, 'nothing saved until a code is confirmed');

  req.body = { code: '12' };
  const wrong = makeRes();
  await twoFactor.enable(req, wrong);
  assert.equal(wrong.statusCode, 400);

  req.body = { code: totp.generateCode(setupRes.body.secret) };
  const ok = makeRes();
  await twoFactor.enable(req, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.recoveryCodes.length, 8);
  assert.ok(state.row.totp_enabled_at);
  assert.equal(totp.decryptSecret(state.row.totp_secret), setupRes.body.secret);
  assert.ok(!state.row.totp_recovery_codes.includes(ok.body.recoveryCodes[0]));
  assert.equal(req.session.totpSetup, undefined);

  const statusRes = makeRes();
  await twoFactor.status(req, statusRes);
  assert.deepEqual(
    { enabled: statusRes.body.enabled, left: statusRes.body.recoveryCodesLeft },
    { enabled: true, left: 8 }
  );
});

test('setup is refused while 2FA is already on', async () => {
  installUsers(userRow('admin', enabledColumns()));
  const res = makeRes();
  await twoFactor.setup(signedIn('admin', { password: 'Password1' }), res);
  assert.equal(res.statusCode, 409);
});

test('disable needs both the password and a code', async () => {
  const state = installUsers(userRow('admin', enabledColumns()));
  const noCode = makeRes();
  await twoFactor.disable(signedIn('admin', { password: 'Password1', code: '000000' === totp.generateCode(SECRET) ? '111111' : '000000' }), noCode);
  assert.equal(noCode.statusCode, 401);
  assert.ok(state.row.totp_enabled_at);

  const noPass = makeRes();
  await twoFactor.disable(signedIn('admin', { password: 'nope', code: totp.generateCode(SECRET) }), noPass);
  assert.equal(noPass.statusCode, 401);
  assert.ok(state.row.totp_enabled_at);

  const ok = makeRes();
  await twoFactor.disable(signedIn('admin', { password: 'Password1', code: totp.generateCode(SECRET) }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(state.row.totp_enabled_at, null);
  assert.equal(state.row.totp_secret, null);
});

test('volunteers cannot use the settings endpoints', async () => {
  installUsers(userRow('volunteer'));
  for (const fn of [twoFactor.status, twoFactor.setup, twoFactor.enable, twoFactor.disable]) {
    const res = makeRes();
    await fn(signedIn('volunteer', { password: 'Password1' }), res);
    assert.equal(res.statusCode, 403);
  }
});

// ─── Wiring ──────────────────────────────────────────────────────────────────

test('routes: verify is rate limited per account, settings are staff-only', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  assert.match(src, /'\/2fa\/verify',\s*twoFactorAccountLimiter,\s*loginLimiter,/);
  for (const p of ["'/2fa'", "'/2fa/setup'", "'/2fa/enable'", "'/2fa/disable'"]) {
    assert.match(src, new RegExp(`router\\.(get|post)\\(\\s*${p.replace(/\//g, '\\/')},\\s*requireStaff`), p);
  }
});

test('migration 042 adds the same nullable columns as schema.pg.sql', () => {
  const db = path.join(__dirname, '..', 'database');
  const migration = fs.readFileSync(path.join(db, '042_staff_totp.pg.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(db, 'schema.pg.sql'), 'utf8');
  for (const col of ['totp_secret', 'totp_enabled_at', 'totp_last_counter', 'totp_recovery_codes']) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${col} \\w+ NULL;`), col);
    assert.match(schema, new RegExp(`\\n  ${col}\\s+\\w+\\s+DEFAULT NULL,`), col);
  }
  assert.doesNotMatch(migration, /NOT NULL|DROP COLUMN(?! IF EXISTS)|UPDATE /);
});
