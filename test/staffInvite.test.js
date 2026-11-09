'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MESSAGE = '1000';

const mock = require('./helpers/mockDb');
const { currentShelterId, isBypass, runWithShelter } = require('../utils/shelterContext');
const { hashInviteToken } = require('../services/shelterProvision');

const sent = [];
const emailPath = require.resolve('../utils/emailService');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    async sendShelterInvite(to, options) {
      mock.calls.push({ sql: 'EMAIL', params: [to] });
      sent.push({ to, ...options });
    },
  },
};

const { errorHandler } = require('../middleware/errorHandler');
const adminRoutes = require('../routes/admin');
const { CANNOT_INVITE, ADMIN_CONFIRM } = require('../controllers/staffInviteController');

const SHELTER = 3;
const ADMIN = { userId: 9, role: 'admin', shelterId: SHELTER };
const ROLES = { 9: 'admin', 10: 'staff', 11: 'volunteer' };

mock.pool.getConnection = async () => ({
  async beginTransaction() { mock.calls.push({ sql: 'BEGIN', params: [], ctx: currentShelterId() }); },
  async commit() { mock.calls.push({ sql: 'COMMIT', params: [] }); },
  async rollback() { mock.calls.push({ sql: 'ROLLBACK', params: [] }); },
  execute: (sql, params) => mock.pool.execute(sql, params),
  query: (sql, params) => mock.pool.query(sql, params),
  release() {},
});

// Record which shelter context each query ran in.
const contexts = [];

function scenario({ email = true, existingUser = false, revoked = 1 } = {}) {
  mock.resetCalls();
  contexts.length = 0;
  sent.length = 0;
  if (email) {
    process.env.EMAIL_HOST = 'smtp.example.test';
    process.env.EMAIL_FROM = 'noreply@example.test';
    process.env.APP_URL = 'http://localhost:3000';
  } else {
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_FROM;
  }
  mock.setHandler(async (sql, params) => {
    contexts.push({ sql, shelter: currentShelterId(), bypass: isBypass() });
    if (/FROM users\s+WHERE user_id = \?/.test(sql)) {
      const id = Number(params[0]);
      return [ROLES[id] ? [{ user_id: id, name: 'X', email: 'x@example.test', role: ROLES[id], shelter_id: SHELTER }] : []];
    }
    if (/FROM users WHERE lower\(email\)/.test(sql)) return [existingUser ? [{ user_id: 40 }] : []];
    if (/INSERT INTO admin_invites/.test(sql)) {
      return [Object.assign([{ id: 21, expires_at: '2026-11-15 10:00:00' }], { insertId: 21 })];
    }
    if (/UPDATE admin_invites SET expires_at = NOW\(\)\s+WHERE id = \?/.test(sql)) return [{ affectedRows: revoked }];
    if (/UPDATE admin_invites/.test(sql)) return [{ affectedRows: 0 }];
    if (/FROM admin_invites/.test(sql)) {
      return [[{ id: 21, email: 'sam@hope.test', role: 'staff', expires_at: '2026-11-15 10:00:00', created_at: '2026-11-08 10:00:00' }]];
    }
    if (/SELECT name FROM shelters WHERE id = \?/.test(sql)) return [[{ name: 'Hope Rescue' }]];
    if (/INSERT INTO audit_log/.test(sql)) return [Object.assign([{ id: 1 }], { insertId: 1 })];
    return [[]];
  });
}

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  // Stand-in for express-session + bindShelter: the session names the user,
  // and the request runs in that user's shelter.
  app.use((req, res, next) => {
    const header = req.get('x-test-session');
    req.session = header ? JSON.parse(header) : {};
    if (req.session.shelterId) return runWithShelter(req.session.shelterId, () => next());
    return next();
  });
  app.use('/api/admin', adminRoutes);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/admin`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, path, { session = ADMIN, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (session) headers['x-test-session'] = JSON.stringify(session);
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function sqlCalls() {
  return mock.calls.map((c) => c.sql);
}

test('only admins can list, send or revoke invites', async () => {
  const routes = [
    ['GET', '/invites'],
    ['POST', '/invites', { email: 'sam@hope.test' }],
    ['POST', '/invites/21/revoke', {}],
  ];
  for (const [label, session, status] of [
    ['staff', { userId: 10, role: 'staff', shelterId: SHELTER }, 403],
    ['volunteer', { userId: 11, role: 'volunteer', shelterId: SHELTER }, 403],
    ['signed out', null, 401],
  ]) {
    for (const [method, path, body] of routes) {
      scenario();
      const res = await call(method, path, { session, body });
      assert.equal(res.status, status, `${label} ${method} ${path}`);
      assert.ok(!sqlCalls().some((s) => /admin_invites/.test(s)), `${label} touched invites`);
    }
  }
});

test('an admin invites a staff member to their own shelter, and the email goes after commit', async () => {
  scenario();
  const res = await call('POST', '/invites', { body: { email: ' Sam@Hope.Test ', role: 'staff' } });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.inviteEmail, { sent: true });
  assert.equal(res.body.invite.email, 'sam@hope.test');
  assert.equal(res.body.invite.role, 'staff');
  assert.equal(res.body.invite.token, undefined);

  const lookup = contexts.find((c) => /FROM users WHERE lower\(email\)/.test(c.sql));
  assert.ok(lookup.bypass, 'the account check spans every shelter');

  const expire = mock.calls.find((c) => /UPDATE admin_invites SET expires_at = NOW\(\)\s+WHERE shelter_id/.test(c.sql));
  assert.deepEqual(expire.params, [SHELTER, 'sam@hope.test']);

  const insert = mock.calls.find((c) => /INSERT INTO admin_invites/.test(c.sql));
  const [shelterId, email, tokenHash, role, createdBy] = insert.params;
  assert.equal(shelterId, SHELTER, 'the shelter comes from the session, not the request');
  assert.equal(email, 'sam@hope.test');
  assert.equal(role, 'staff');
  assert.equal(createdBy, 9);

  const inviteContexts = contexts.filter((c) => /admin_invites/.test(c.sql));
  assert.ok(inviteContexts.every((c) => c.shelter === SHELTER && !c.bypass), 'invite queries run inside the shelter');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'sam@hope.test');
  assert.equal(sent[0].shelterName, 'Hope Rescue');
  assert.equal(sent[0].role, 'staff');
  const token = /\/invite\/([A-Za-z0-9_-]{43})$/.exec(sent[0].link)[1];
  assert.equal(hashInviteToken(token), tokenHash);
  const sql = sqlCalls();
  assert.ok(sql.indexOf('EMAIL') > sql.indexOf('COMMIT'));
});

test('an admin can invite another admin', async () => {
  scenario();
  const res = await call('POST', '/invites', { body: { email: 'ada@hope.test', role: 'admin', confirm_admin: true } });
  assert.equal(res.status, 201);
  assert.equal(mock.calls.find((c) => /INSERT INTO admin_invites/.test(c.sql)).params[3], 'admin');
});

test('inviting an admin needs confirm_admin: true, and nothing is created without it', async () => {
  for (const extra of [{}, { confirm_admin: false }]) {
    scenario();
    const res = await call('POST', '/invites', { body: { email: 'ada@hope.test', role: 'admin', ...extra } });
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal(res.body.field, 'role');
    assert.equal(res.body.error, ADMIN_CONFIRM);
    assert.ok(!sqlCalls().some((s) => /admin_invites|lower\(email\)/.test(s)), 'checked before the account lookup or any invite query');
  }
  scenario();
  const notBool = await call('POST', '/invites', { body: { email: 'ada@hope.test', role: 'admin', confirm_admin: 'yes' } });
  assert.equal(notBool.status, 400);
  scenario();
  const staff = await call('POST', '/invites', { body: { email: 'sam@hope.test', role: 'staff' } });
  assert.equal(staff.status, 201, 'staff invites need no confirmation');
});

test('the team page asks before inviting an admin and sends confirm_admin only then', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'js', 'admin', 'team.js'), 'utf8');
  assert.match(source, /if \(role !== 'admin'\) \{\s*sendInvite\(email, role\);\s*return;/);
  assert.match(source, /showConfirm\(\{\s*heading: `Make \$\{email\} an admin\?`/);
  assert.match(source, /onConfirm: \(\) => sendInvite\(email, role\)/);
  assert.match(source, /if \(role === 'admin'\) body\.confirm_admin = true;/);
});

test('bad input is refused before anything is created', async () => {
  for (const [body, field] of [
    [{ email: 'not-an-email' }, 'email'],
    [{ email: 'sam@hope.test', role: 'volunteer' }, 'role'],
  ]) {
    scenario();
    const res = await call('POST', '/invites', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.field, field);
    assert.ok(!sqlCalls().some((s) => /INSERT INTO admin_invites/.test(s)));
  }
  for (const extra of [{ shelter_id: 1 }, { shelterId: 1 }, { created_by: 1 }]) {
    scenario();
    const res = await call('POST', '/invites', { body: { email: 'sam@hope.test', ...extra } });
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.ok(!sqlCalls().some((s) => /admin_invites/.test(s)));
  }
});

test('no invite is created when email cannot be sent', async () => {
  scenario({ email: false });
  const res = await call('POST', '/invites', { body: { email: 'sam@hope.test' } });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Email is not set up/);
  assert.ok(!sqlCalls().some((s) => /admin_invites|BEGIN/.test(s)));
});

test('an address that already has an account cannot be invited', async () => {
  scenario({ existingUser: true });
  const res = await call('POST', '/invites', { body: { email: 'sam@hope.test' } });
  assert.equal(res.status, 409);
  assert.equal(res.body.field, 'email');
  assert.equal(res.body.error, CANNOT_INVITE);
  assert.doesNotMatch(res.body.error, /account|already|exists|registered/i, 'never says the address is in use');
  assert.ok(!sqlCalls().some((s) => /INSERT INTO admin_invites/.test(s)));
});

test('the list shows only this shelter\'s open invites, without token hashes', async () => {
  scenario();
  const res = await call('GET', '/invites');
  assert.equal(res.status, 200);
  assert.equal(res.body[0].email, 'sam@hope.test');
  assert.equal(res.body[0].token_hash, undefined);
  const list = mock.calls.find((c) => /FROM admin_invites/.test(c.sql));
  assert.match(list.sql, /WHERE shelter_id = \? AND used_at IS NULL AND expires_at > NOW\(\)/);
  assert.doesNotMatch(list.sql, /token_hash/);
  assert.deepEqual(list.params, [SHELTER]);
});

test('revoking expires an open invite in this shelter, and 404s otherwise', async () => {
  scenario();
  let res = await call('POST', '/invites/21/revoke', { body: {} });
  assert.equal(res.status, 200);
  const update = mock.calls.find((c) => /UPDATE admin_invites/.test(c.sql));
  assert.match(update.sql, /WHERE id = \? AND shelter_id = \? AND used_at IS NULL/);
  assert.deepEqual(update.params, [21, SHELTER]);
  assert.ok(!sqlCalls().some((s) => /DELETE/.test(s)), 'nothing is deleted');

  scenario({ revoked: 0 });
  res = await call('POST', '/invites/21/revoke', { body: {} });
  assert.equal(res.status, 404);

  scenario();
  res = await call('POST', '/invites/abc/revoke', { body: {} });
  assert.equal(res.status, 400);
});

test('invite actions are named in the shelter audit log', () => {
  const { inferFromRequest } = require('../middleware/auditLog');
  assert.deepEqual(
    inferFromRequest({ method: 'POST', originalUrl: '/api/admin/invites', params: {} }),
    { action: 'invite.create', entityType: 'invite', entityId: null }
  );
  assert.deepEqual(
    inferFromRequest({ method: 'POST', originalUrl: '/api/admin/invites/21/revoke', params: { inviteId: '21' } }),
    { action: 'invite.revoke', entityType: 'invite', entityId: '21' }
  );
});

