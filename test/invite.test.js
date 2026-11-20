'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');

process.env.NODE_ENV = 'test';
// Each test file runs in its own process, so this only lifts the limit here.
process.env.RATE_LIMIT_INVITE = '1000';

const mock = require('./helpers/mockDb');
const { errorHandler } = require('../middleware/errorHandler');
const authRoutes = require('../routes/auth');
const { hashInviteToken } = require('../services/shelterProvision');
const { PRIVACY_NOTICE_VERSION } = require('../config/privacyNotice');

const TOKEN = crypto.randomBytes(32).toString('base64url');
const PASSWORD = 'correct horse battery';

mock.pool.getConnection = async () => ({
  async beginTransaction() { mock.calls.push({ sql: 'BEGIN', params: [] }); },
  async commit() { mock.calls.push({ sql: 'COMMIT', params: [] }); },
  async rollback() { mock.calls.push({ sql: 'ROLLBACK', params: [] }); },
  execute: (sql, params) => mock.pool.execute(sql, params),
  query: (sql, params) => mock.pool.query(sql, params),
  release() {},
});

function inviteRow(overrides = {}) {
  return { id: 11, shelter_id: 5, email: 'ada@north.example', role: 'admin', ...overrides };
}

function scenario({
  invite = inviteRow(),
  shelter = { id: 5, name: 'North Paws', slug: 'north-paws', status: 'active' },
  emailTaken = false,
  insertError = null,
} = {}) {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/UPDATE admin_invites SET used_at = NOW\(\)/i.test(sql)) {
      const rows = invite ? [invite] : [];
      rows.affectedRows = rows.length;
      return [rows];
    }
    if (/FROM admin_invites i/i.test(sql)) {
      return [invite ? [{
        ...invite,
        expires_at: '2026-11-15 10:00:00',
        shelter_name: shelter ? shelter.name : null,
        shelter_slug: shelter ? shelter.slug : null,
        shelter_status: shelter ? shelter.status : null,
      }] : []];
    }
    if (/FROM shelters WHERE id = \?/i.test(sql)) return [shelter ? [shelter] : []];
    if (/FROM users WHERE lower\(email\)/i.test(sql)) return [emailTaken ? [{ user_id: 9 }] : []];
    if (/INSERT INTO users/i.test(sql)) {
      if (insertError) throw insertError;
      const rows = [{ user_id: 77 }];
      rows.insertId = 77;
      return [rows];
    }
    if (/INSERT INTO audit_log/i.test(sql)) return [Object.assign([{ id: 1 }], { insertId: 1 })];
    return [[]];
  });
}

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {};
    next();
  });
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function sqlCalls() {
  return mock.calls.map((c) => c.sql);
}

function acceptBody(overrides = {}) {
  return {
    token: TOKEN,
    first_name: ' Ada ',
    last_name: 'North',
    password: PASSWORD,
    privacy_notice: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /api/auth/invite/check  (token in the body, never the URL)
// ---------------------------------------------------------------------------

test('checking a good invite returns the shelter, email and role, looked up by token hash', async () => {
  scenario();
  const res = await call('POST', '/invite/check', { token: TOKEN });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    valid: true,
    email: 'ada@north.example',
    role: 'admin',
    shelterName: 'North Paws',
    expiresAt: '2026-11-15 10:00:00',
  });
  assert.equal(mock.calls.length, 1);
  const lookup = mock.calls[0];
  assert.match(lookup.sql, /used_at IS NULL AND i\.expires_at > NOW\(\)/);
  assert.deepEqual(lookup.params, [hashInviteToken(TOKEN)]);
  assert.ok(!lookup.params.includes(TOKEN), 'the raw token is never sent to the database');
  assert.ok(!sqlCalls().some((s) => /UPDATE/i.test(s)), 'checking does not use the invite');
});

test('checking a malformed token answers valid:false without touching the database', async () => {
  for (const bad of ['short', 'x'.repeat(44), `${TOKEN.slice(0, 42)}!`]) {
    scenario();
    const res = await call('POST', '/invite/check', { token: bad });
    assert.equal(res.status, 200, bad);
    assert.deepEqual(res.body, { valid: false });
    assert.equal(mock.calls.length, 0, bad);
  }
});

test('checking a used, expired, or unknown invite answers valid:false', async () => {
  scenario({ invite: null });
  const res = await call('POST', '/invite/check', { token: TOKEN });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { valid: false });
});

test('the old GET /invite/:token check is gone, so a token never has to sit in a URL', async () => {
  scenario();
  const res = await fetch(`${base}/invite/${TOKEN}`);
  assert.equal(res.status, 404);
  assert.equal(mock.calls.length, 0);
});

test('the check refuses extra fields and a missing token without touching the database', async () => {
  scenario();
  let res = await call('POST', '/invite/check', { token: TOKEN, email: 'x@example.test' });
  assert.equal(res.status, 400);
  res = await call('POST', '/invite/check', {});
  assert.deepEqual(res.body, { valid: false });
  assert.equal(mock.calls.length, 0);
});

test('checking an invite for a suspended shelter answers valid:false', async () => {
  scenario({ shelter: { id: 5, name: 'North Paws', slug: 'north-paws', status: 'suspended' } });
  const res = await call('POST', '/invite/check', { token: TOKEN });
  assert.deepEqual(res.body, { valid: false });
});

// ---------------------------------------------------------------------------
// POST /api/auth/accept-invite
// ---------------------------------------------------------------------------

test('accepting creates the account on the invite\'s shelter with its role, in one transaction', async () => {
  scenario();
  const res = await call('POST', '/accept-invite', acceptBody());
  assert.equal(res.status, 201);
  assert.equal(res.body.email, 'ada@north.example');
  assert.equal(res.body.role, 'admin');
  assert.deepEqual(res.body.shelter, { name: 'North Paws', slug: 'north-paws' });
  assert.ok(!JSON.stringify(res.body).includes(TOKEN), 'no token in the response');

  const sql = sqlCalls();
  assert.equal(sql[0], 'BEGIN');
  assert.equal(sql[sql.length - 1], 'COMMIT');
  assert.ok(!sql.includes('ROLLBACK'));
  const order = [
    /UPDATE admin_invites SET used_at = NOW\(\)/,
    /FROM shelters WHERE id = \?/,
    /FROM users WHERE lower\(email\)/,
    /INSERT INTO users/,
    /INSERT INTO audit_log/,
  ].map((re) => sql.findIndex((s) => re.test(s)));
  assert.ok(order.every((i) => i > 0), `every step ran: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'steps run in order');

  const consume = mock.calls.find((c) => /UPDATE admin_invites/.test(c.sql));
  assert.match(consume.sql, /used_at IS NULL AND expires_at > NOW\(\)/);
  assert.deepEqual(consume.params, [hashInviteToken(TOKEN)]);

  const insert = mock.calls.find((c) => /INSERT INTO users/.test(c.sql));
  const [first, last, name, phone, email, hash, role, shelterId, version] = insert.params;
  assert.equal(first, 'Ada');
  assert.equal(last, 'North');
  assert.equal(name, 'Ada North');
  assert.equal(phone, null);
  assert.equal(email, 'ada@north.example');
  assert.match(hash, /^\$2[aby]\$12\$/, 'password is bcrypt-hashed');
  assert.ok(!insert.params.includes(PASSWORD), 'plain password never reaches the database');
  assert.equal(role, 'admin');
  assert.equal(shelterId, 5);
  assert.equal(version, PRIVACY_NOTICE_VERSION);
  assert.match(insert.sql, /consent_given_at/);

  const audit = mock.calls.find((c) => /INSERT INTO audit_log/.test(c.sql));
  assert.match(audit.sql, /'invite\.accepted'/);
  assert.equal(audit.params[0], 77);
  assert.deepEqual(JSON.parse(audit.params[2]), { inviteId: 11, role: 'admin' });
  assert.equal(audit.params[3], 5);
});

test('a staff invite creates a staff account', async () => {
  scenario({ invite: inviteRow({ role: 'staff', email: 'sam@north.example' }) });
  const res = await call('POST', '/accept-invite', acceptBody({ phone: '028 9000 0000' }));
  assert.equal(res.status, 201);
  const insert = mock.calls.find((c) => /INSERT INTO users/.test(c.sql));
  assert.equal(insert.params[6], 'staff');
  assert.equal(insert.params[3], '028 9000 0000');
});

test('a used, expired, or unknown invite is refused and nothing is created', async () => {
  scenario({ invite: null });
  const res = await call('POST', '/accept-invite', acceptBody());
  assert.equal(res.status, 400);
  assert.match(res.body.error, /invite link is not valid/);
  const sql = sqlCalls();
  assert.ok(sql.includes('ROLLBACK'));
  assert.ok(!sql.includes('COMMIT'));
  assert.ok(!sql.some((s) => /INSERT INTO users/.test(s)));
});

test('an email that already has an account is refused and the invite is left unused', async () => {
  scenario({ emailTaken: true });
  const res = await call('POST', '/accept-invite', acceptBody());
  assert.equal(res.status, 409);
  assert.match(res.body.error, /already uses this email/);
  const sql = sqlCalls();
  assert.ok(sql.includes('ROLLBACK'), 'marking the invite used is rolled back');
  assert.ok(!sql.includes('COMMIT'));
  assert.ok(!sql.some((s) => /INSERT INTO users/.test(s)));
});

test('losing a race on the unique email index is a 409, rolled back', async () => {
  scenario({ insertError: Object.assign(new Error('duplicate key'), { code: '23505' }) });
  const res = await call('POST', '/accept-invite', acceptBody());
  assert.equal(res.status, 409);
  assert.ok(sqlCalls().includes('ROLLBACK'));
});

test('an invite for a suspended shelter is refused', async () => {
  scenario({ shelter: { id: 5, name: 'North Paws', slug: 'north-paws', status: 'suspended' } });
  const res = await call('POST', '/accept-invite', acceptBody());
  assert.equal(res.status, 403);
  assert.ok(sqlCalls().includes('ROLLBACK'));
  assert.ok(!sqlCalls().some((s) => /INSERT INTO users/.test(s)));
});

test('a database failure is a generic 500 and is rolled back', async () => {
  scenario({ insertError: new Error('connection reset') });
  const res = await call('POST', '/accept-invite', acceptBody());
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'Internal server error');
  assert.ok(sqlCalls().includes('ROLLBACK'));
});

test('bad input is refused before the database is touched', async () => {
  const cases = [
    [acceptBody({ token: 'not-a-token' }), /invite link is not valid/],
    [acceptBody({ privacy_notice: false }), /privacy notice/],
    [acceptBody({ privacy_notice: undefined }), /privacy notice/],
    [acceptBody({ password: 'short' }), /at least 10/],
    [acceptBody({ password: 'password12' }), /too common/],
    [acceptBody({ first_name: '' }), /required/],
    [acceptBody({ last_name: undefined }), /required/],
  ];
  for (const [body, message] of cases) {
    scenario();
    const res = await call('POST', '/accept-invite', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, message);
    assert.equal(mock.calls.length, 0, JSON.stringify(body));
  }
});

test('the request cannot choose the email, role, or shelter', async () => {
  for (const extra of [
    { email: 'mallory@example.com' },
    { role: 'admin' },
    { shelter_slug: 'assisi' },
    { shelter_id: 1 },
  ]) {
    scenario();
    const res = await call('POST', '/accept-invite', acceptBody(extra));
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal(mock.calls.length, 0, JSON.stringify(extra));
  }
});
