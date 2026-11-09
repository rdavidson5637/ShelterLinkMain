'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

// Capture invite emails instead of sending them. inviteDelivery requires the
// email module when it sends, so this stand-in is what it gets. Each send is
// also pushed onto mock.calls as 'EMAIL' so tests can check it ran after
// COMMIT.
const sentEmails = [];
let emailFailure = null;
const emailPath = require.resolve('../utils/emailService');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    async sendShelterInvite(to, options) {
      mock.calls.push({ sql: 'EMAIL', params: [to] });
      if (emailFailure) throw emailFailure;
      sentEmails.push({ to, ...options });
    },
  },
};

function emailOn() {
  process.env.EMAIL_HOST = 'smtp.example.test';
  process.env.EMAIL_FROM = 'noreply@example.test';
  process.env.APP_URL = 'http://localhost:3000';
}

function emailOff() {
  delete process.env.EMAIL_HOST;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_USER;
}
const { errorHandler } = require('../middleware/errorHandler');
const platformRoutes = require('../routes/platform');
const { hashInviteToken } = require('../services/shelterProvision');

const OWNER_ID = 1;
const OWNER_SHELTER = 1;
const ALLOWED_TABLES = new Set([
  'shelters',
  'shelter_applications',
  'admin_invites',
  'platform_owners',
  'platform_audit',
]);

// Record transaction boundaries next to the SQL so tests can check that
// approve, reject, and suspend each run in exactly one transaction.
mock.pool.getConnection = async () => ({
  async beginTransaction() { mock.calls.push({ sql: 'BEGIN', params: [] }); },
  async commit() { mock.calls.push({ sql: 'COMMIT', params: [] }); },
  async rollback() { mock.calls.push({ sql: 'ROLLBACK', params: [] }); },
  execute: (sql, params) => mock.pool.execute(sql, params),
  query: (sql, params) => mock.pool.query(sql, params),
  release() {},
});

function pendingApplication(overrides = {}) {
  return {
    id: 7,
    shelter_name: 'North Paws',
    desired_slug: 'north-paws',
    regulator: 'ccni',
    charity_number: '100123',
    register_snapshot: { found: true, name: 'NORTH PAWS RESCUE', status: 'registered', checkedAt: '2026-11-01T10:00:00Z' },
    contact_name: 'Ada North',
    contact_email: 'Ada@North.example',
    status: 'pending',
    decided_by: null,
    decided_at: null,
    reason: null,
    created_at: '2026-11-01 10:00:00',
    ...overrides,
  };
}

function scenario({
  owners = [OWNER_ID],
  application = pendingApplication(),
  slugTaken = false,
  slugRow = { id: 2 },
  charityTaken = false,
  shelter = { id: 5, slug: 'north-paws', status: 'active' },
  usedInvite = false,
  accountEmails = [],
  acceptedInvites = [],
  failOn = null,
  email = false,
  emailError = null,
} = {}) {
  mock.resetCalls();
  sentEmails.length = 0;
  emailFailure = emailError;
  if (email) emailOn(); else emailOff();
  mock.setHandler(async (sql, params) => {
    if (failOn && failOn.test(sql)) throw new Error('boom');
    if (/FROM platform_owners/i.test(sql)) {
      return [owners.includes(Number(params[0])) ? [{ user_id: params[0] }] : []];
    }
    if (/FROM shelter_applications WHERE id = \?/i.test(sql)) return [application ? [application] : []];
    if (/FROM shelter_applications/i.test(sql)) return [application ? [application] : []];
    if (/UPDATE shelter_applications/i.test(sql)) return [{ affectedRows: 1 }];
    if (/FROM shelters WHERE slug = \?/i.test(sql)) return [slugTaken ? [slugRow] : []];
    if (sql === ACCOUNT_LOOKUP_SQL) {
      return [accountEmails.filter((e) => params[0].includes(e)).map((email) => ({ email }))];
    }
    if (/used_at IS NOT NULL AND s\.slug = ANY/.test(sql)) return [acceptedInvites];
    if (/FROM admin_invites/i.test(sql)) return [usedInvite ? [{ id: 9 }] : []];
    if (/UPDATE admin_invites/i.test(sql)) return [{ affectedRows: 1 }];
    if (/FROM shelters WHERE charity_regulator/i.test(sql)) return [charityTaken ? [{ id: 3 }] : []];
    if (/INSERT INTO shelters/i.test(sql)) {
      const rows = [{ id: 42 }];
      rows.insertId = 42;
      return [rows];
    }
    if (/INSERT INTO admin_invites/i.test(sql)) {
      const rows = [{ id: 11, expires_at: '2026-11-11 10:00:00' }];
      rows.insertId = 11;
      return [rows];
    }
    if (/FROM shelters WHERE id = \?/i.test(sql)) return [shelter ? [shelter] : []];
    if (/FROM shelters/i.test(sql)) return [[{ id: 1, name: 'Assisi', slug: 'assisi', status: 'active' }]];
    if (/UPDATE shelters/i.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO platform_audit/i.test(sql)) return [Object.assign([{ id: 1 }], { insertId: 1 })];
    return [[]];
  });
}

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  // Stand-in for express-session + bindShelter: the test picks the session.
  app.use((req, res, next) => {
    const header = req.get('x-test-session');
    req.session = header ? JSON.parse(header) : {};
    next();
  });
  app.use('/api/platform', platformRoutes);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/platform`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

const OWNER = { userId: OWNER_ID, role: 'admin', shelterId: OWNER_SHELTER };

async function call(method, path, { session, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (session) headers['x-test-session'] = JSON.stringify(session);
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function sqlCalls() {
  return mock.calls.map((c) => c.sql);
}

// The one users query the queue may make (services/accountLookup.js): yes
// or no per applicant email, nothing else.
const ACCOUNT_LOOKUP_SQL = 'SELECT DISTINCT lower(email) AS email FROM users WHERE lower(email) = ANY(?::text[])';

function tablesTouched() {
  const tables = new Set();
  for (const sql of sqlCalls()) {
    if (sql === ACCOUNT_LOOKUP_SQL) continue;
    for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gi)) {
      tables.add(m[1].toLowerCase());
    }
  }
  return tables;
}

// ---------------------------------------------------------------------------
// isPlatformOwner: 404 for everyone else, on every route
// ---------------------------------------------------------------------------

const ROUTES = [
  ['GET', '/applications'],
  ['GET', '/applications?status=all'],
  ['POST', '/applications/7/approve'],
  ['POST', '/applications/7/reject'],
  ['POST', '/applications/7/resend-invite'],
  ['POST', '/applications/not-a-number/approve'],
  ['GET', '/shelters'],
  ['POST', '/shelters/5/suspend'],
  ['GET', '/does-not-exist'],
];

const NON_OWNERS = [
  ['signed out', undefined],
  ['volunteer', { userId: 2, role: 'volunteer', shelterId: 1 }],
  ['shelter admin who is not a platform owner', { userId: 3, role: 'admin', shelterId: 1 }],
  ['owner on a kiosk session', { ...OWNER, kioskMode: true }],
];

for (const [label, session] of NON_OWNERS) {
  test(`/api/platform returns 404 on every route for a ${label}`, async () => {
    for (const [method, path] of ROUTES) {
      scenario();
      const res = await call(method, path, { session, body: method === 'POST' ? { reason: 'Not a charity' } : undefined });
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.equal(res.body.error, 'API endpoint not found', `${method} ${path}`);
      assert.ok(
        !sqlCalls().some((sql) => /shelter_applications|INSERT|UPDATE/i.test(sql)),
        `${method} ${path} touched data`
      );
    }
  });
}

test('the owner check reads only platform_owners, outside shelter context', async () => {
  scenario();
  await call('GET', '/applications', { session: { userId: 3, role: 'admin', shelterId: 1 } });
  assert.deepEqual(sqlCalls(), ['SELECT user_id FROM platform_owners WHERE user_id = ? LIMIT 1']);
  assert.deepEqual(mock.calls[0].params, [3]);
});

test('the owner gets 404 for unknown platform paths and 400 for a bad id', async () => {
  scenario();
  assert.equal((await call('GET', '/nope', { session: OWNER })).status, 404);
  assert.equal((await call('POST', '/applications/abc/approve', { session: OWNER })).status, 400);
});

// ---------------------------------------------------------------------------
// GET /applications
// ---------------------------------------------------------------------------

test('GET /applications lists pending applications by default', async () => {
  scenario();
  const res = await call('GET', '/applications', { session: OWNER });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].desired_slug, 'north-paws');
  assert.equal(res.body[0].register_snapshot.name, 'NORTH PAWS RESCUE');
  const list = mock.calls.find((c) => /FROM shelter_applications/.test(c.sql));
  assert.match(list.sql, /WHERE status = \?/);
  assert.deepEqual(list.params, ['pending']);
});

test('GET /applications?status=all lists decided ones too; bad status is 400', async () => {
  scenario();
  const all = await call('GET', '/applications?status=all', { session: OWNER });
  assert.equal(all.status, 200);
  const list = mock.calls.find((c) => /FROM shelter_applications/.test(c.sql));
  assert.doesNotMatch(list.sql, /WHERE/);

  scenario();
  assert.equal((await call('GET', '/applications?status=deleted', { session: OWNER })).status, 400);
});

test('pending applications say whether the applicant email already has an account', async () => {
  scenario();
  let res = await call('GET', '/applications', { session: OWNER });
  assert.equal(res.body[0].contact_has_account, false);
  const lookup = mock.calls.find((c) => c.sql === ACCOUNT_LOOKUP_SQL);
  assert.ok(lookup, 'one account lookup for the list');
  assert.deepEqual(lookup.params, [['ada@north.example']], 'lower-cased, de-duplicated');

  scenario({ accountEmails: ['ada@north.example'] });
  res = await call('GET', '/applications', { session: OWNER });
  assert.equal(res.body[0].contact_has_account, true);
  assert.doesNotMatch(JSON.stringify(res.body), /user_id|role|shelter_id/, 'nothing else about the account');
});

test('approved applications say whether the invite was accepted, so Resend can be hidden', async () => {
  scenario({ application: pendingApplication({ status: 'approved' }), acceptedInvites: [{ slug: 'north-paws', email: 'ada@north.example' }] });
  let res = await call('GET', '/applications?status=all', { session: OWNER });
  assert.equal(res.body[0].invite_accepted, true);

  scenario({ application: pendingApplication({ status: 'approved' }) });
  res = await call('GET', '/applications?status=all', { session: OWNER });
  assert.equal(res.body[0].invite_accepted, false);
  assert.equal(res.body[0].contact_has_account, undefined, 'only pending rows are checked for an account');
  assert.ok(!mock.calls.some((c) => c.sql === ACCOUNT_LOOKUP_SQL), 'no users lookup without pending rows');
  const used = mock.calls.find((c) => /used_at IS NOT NULL AND s\.slug = ANY/.test(c.sql));
  assert.deepEqual(used.params, [['north-paws']]);
});

// ---------------------------------------------------------------------------
// POST /applications/:id/approve
// ---------------------------------------------------------------------------

test('approve creates the shelter and an admin invite in one transaction, with no user or password', async () => {
  scenario();
  const res = await call('POST', '/applications/7/approve', { session: OWNER });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.shelter, { id: 42, name: 'North Paws', slug: 'north-paws', status: 'active' });
  assert.equal(res.body.invite.id, 11);
  assert.equal(res.body.invite.email, 'ada@north.example');
  assert.equal(res.body.invite.role, 'admin');
  assert.equal(res.body.invite.token, undefined, 'raw token must not go to the browser');

  const sql = sqlCalls();
  const begin = sql.indexOf('BEGIN');
  const commit = sql.indexOf('COMMIT');
  assert.ok(begin > 0 && commit > begin);
  assert.equal(sql.filter((s) => s === 'BEGIN').length, 1);
  assert.ok(!sql.includes('ROLLBACK'));
  const inTx = sql.slice(begin + 1, commit);
  assert.ok(inTx.some((s) => /FOR UPDATE/.test(s)), 'application row is locked');
  assert.ok(inTx.some((s) => /INSERT INTO shelters/.test(s)));
  assert.ok(inTx.some((s) => /INSERT INTO admin_invites/.test(s)));
  assert.ok(inTx.some((s) => /UPDATE shelter_applications/.test(s)));
  assert.ok(!sql.some((s) => /INSERT INTO users|password/i.test(s)), 'no user or password is created');

  const shelterInsert = mock.calls.find((c) => /INSERT INTO shelters/.test(c.sql));
  assert.deepEqual(shelterInsert.params, [
    'North Paws', 'north-paws', null, null, 'ccni', '100123', 'NORTH PAWS RESCUE', '2026-11-01T10:00:00Z',
  ]);

  const invite = mock.calls.find((c) => /INSERT INTO admin_invites/.test(c.sql));
  assert.match(invite.sql, /NOW\(\) \+ INTERVAL '7 days'/);
  const [shelterId, email, tokenHash, role, createdBy] = invite.params;
  assert.equal(shelterId, 42, 'invite belongs to the new shelter');
  assert.equal(email, 'ada@north.example');
  assert.match(tokenHash, /^[0-9a-f]{64}$/, 'SHA-256 hex is stored');
  assert.equal(role, 'admin');
  assert.equal(createdBy, null);

  const decided = mock.calls.find((c) => /UPDATE shelter_applications/.test(c.sql));
  assert.match(decided.sql, /status = 'approved'/);
  assert.match(decided.sql, /decided_at = NOW\(\)/);
  assert.deepEqual(decided.params, [OWNER_ID, 7]);
});

test('approve emails the invite after the commit, with a link that matches the stored hash', async () => {
  scenario({ email: true });
  const res = await call('POST', '/applications/7/approve', { session: OWNER });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.inviteEmail, { sent: true });
  assert.equal(sentEmails.length, 1);
  const [mail] = sentEmails;
  assert.equal(mail.to, 'ada@north.example');
  assert.equal(mail.shelterName, 'North Paws');
  assert.equal(mail.role, 'admin');
  assert.equal(mail.expiresInDays, 7);

  const match = /^http:\/\/localhost:3000\/invite#([A-Za-z0-9_-]{43})$/.exec(mail.link);
  assert.ok(match, `link shape: ${mail.link}`);
  const invite = mock.calls.find((c) => /INSERT INTO admin_invites/.test(c.sql));
  assert.equal(hashInviteToken(match[1]), invite.params[2], 'the emailed token is the one whose hash was stored');
  assert.ok(!JSON.stringify(res.body).includes(match[1]), 'the token is not in the response');

  const sql = sqlCalls();
  assert.ok(sql.indexOf('EMAIL') > sql.indexOf('COMMIT'), 'email goes only after the commit');
});

test('approve still succeeds when email is not configured, and says the invite was not sent', async () => {
  scenario({ email: false });
  const res = await call('POST', '/applications/7/approve', { session: OWNER });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.inviteEmail, { sent: false, reason: 'email_not_configured' });
  assert.equal(sentEmails.length, 0);
  assert.ok(!sqlCalls().includes('EMAIL'));
  assert.ok(sqlCalls().includes('COMMIT'));
});

test('approve still succeeds when the email server refuses the invite', async () => {
  scenario({ email: true, emailError: new Error('550 relay denied') });
  const res = await call('POST', '/applications/7/approve', { session: OWNER });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.inviteEmail, { sent: false, reason: 'send_failed' });
  const sql = sqlCalls();
  assert.ok(sql.includes('COMMIT'));
  assert.ok(!sql.includes('ROLLBACK'), 'the approval is not undone');
});

test('approve writes application.approved and invite.created audit rows', async () => {
  scenario();
  await call('POST', '/applications/7/approve', { session: OWNER });
  const audits = mock.calls.filter((c) => /INSERT INTO platform_audit/.test(c.sql));
  assert.deepEqual(audits.map((c) => c.params[1]), ['application.approved', 'invite.created']);
  for (const a of audits) {
    assert.equal(a.params[0], OWNER_ID);
    assert.equal(a.params[2], 7);
    assert.equal(a.params[3], 42);
  }
  const detail = JSON.parse(audits[1].params[4]);
  assert.equal(detail.inviteId, 11);
  assert.ok(!JSON.stringify(audits).includes(audits[0].params[4] && 'token'), 'no token in audit');
  const sql = sqlCalls();
  assert.ok(sql.lastIndexOf('INSERT INTO platform_audit (actor_user_id, action, application_id, target_shelter_id, detail)\n     VALUES (?, ?, ?, ?, ?)') < sql.indexOf('COMMIT'));
});

test('approve rolls back when a later step fails, so no shelter is left half made', async () => {
  scenario({ failOn: /INSERT INTO admin_invites/ });
  const res = await call('POST', '/applications/7/approve', { session: OWNER });
  assert.equal(res.status, 500);
  const sql = sqlCalls();
  assert.ok(sql.includes('ROLLBACK'));
  assert.ok(!sql.includes('COMMIT'));
});

test('approve refuses an application that is already decided, a taken slug, or a taken charity', async () => {
  scenario({ application: pendingApplication({ status: 'rejected', decided_at: '2026-11-02 10:00:00' }) });
  let res = await call('POST', '/applications/7/approve', { session: OWNER });
  assert.equal(res.status, 409);
  assert.ok(sqlCalls().includes('ROLLBACK'));
  assert.ok(!sqlCalls().some((s) => /INSERT INTO shelters/.test(s)));

  scenario({ slugTaken: true });
  res = await call('POST', '/applications/7/approve', { session: OWNER });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Slug already in use/);

  scenario({ charityTaken: true });
  res = await call('POST', '/applications/7/approve', { session: OWNER });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /already has a shelter/);

  scenario({ application: null });
  res = await call('POST', '/applications/7/approve', { session: OWNER });
  assert.equal(res.status, 404);
});

test('approve ignores a client shelter_id', async () => {
  scenario();
  const res = await call('POST', '/applications/7/approve', { session: OWNER, body: { name: 'Other', slug: 'other' } });
  assert.equal(res.status, 201);
  const shelterInsert = mock.calls.find((c) => /INSERT INTO shelters/.test(c.sql));
  assert.equal(shelterInsert.params[1], 'north-paws', 'name and slug come from the application row');
});

// ---------------------------------------------------------------------------
// POST /applications/:id/reject
// ---------------------------------------------------------------------------

test('reject needs a reason', async () => {
  for (const body of [undefined, {}, { reason: '' }, { reason: '  ' }, { reason: 'no' }, { reason: 42 }]) {
    scenario();
    const res = await call('POST', '/applications/7/reject', { session: OWNER, body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(!sqlCalls().some((s) => /UPDATE shelter_applications/.test(s)));
  }
});

test('reject records the reason, decided_by and decided_at, and audits it', async () => {
  scenario();
  const res = await call('POST', '/applications/7/reject', {
    session: OWNER,
    body: { reason: '  Not on the register  ' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.application, { id: 7, status: 'rejected', reason: 'Not on the register' });

  const update = mock.calls.find((c) => /UPDATE shelter_applications/.test(c.sql));
  assert.match(update.sql, /status = 'rejected'/);
  assert.match(update.sql, /decided_at = NOW\(\)/);
  assert.deepEqual(update.params, ['Not on the register', OWNER_ID, 7]);

  const audit = mock.calls.find((c) => /INSERT INTO platform_audit/.test(c.sql));
  assert.equal(audit.params[1], 'application.rejected');
  assert.equal(audit.params[2], 7);
  assert.equal(audit.params[3], null);
  assert.ok(!sqlCalls().some((s) => /INSERT INTO shelters|admin_invites/.test(s)));
  assert.ok(sqlCalls().includes('COMMIT'));
});

test('reject refuses an application that is already decided', async () => {
  scenario({ application: pendingApplication({ status: 'approved', decided_at: '2026-11-02 10:00:00' }) });
  const res = await call('POST', '/applications/7/reject', { session: OWNER, body: { reason: 'Duplicate' } });
  assert.equal(res.status, 409);
  assert.ok(!sqlCalls().some((s) => /UPDATE shelter_applications|INSERT INTO platform_audit/.test(s)));
});

// ---------------------------------------------------------------------------
// POST /applications/:id/resend-invite
// ---------------------------------------------------------------------------

const APPROVED = pendingApplication({ status: 'approved', decided_at: '2026-11-02 10:00:00', decided_by: OWNER_ID });
const NEW_SHELTER = { id: 42, name: 'North Paws', slug: 'north-paws', status: 'active' };

test('resend expires the unused invite, issues a new one, audits it, and emails it after commit', async () => {
  scenario({ email: true, application: APPROVED, slugTaken: true, slugRow: NEW_SHELTER });
  const res = await call('POST', '/applications/7/resend-invite', { session: OWNER });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.inviteEmail, { sent: true });
  assert.equal(res.body.invite.email, 'ada@north.example');
  assert.equal(res.body.invite.token, undefined);

  const sql = sqlCalls();
  const begin = sql.indexOf('BEGIN');
  const commit = sql.indexOf('COMMIT');
  assert.ok(begin > 0 && commit > begin);
  const inTx = sql.slice(begin + 1, commit);
  assert.ok(inTx.some((s) => /FROM shelter_applications[\s\S]*FOR UPDATE/.test(s)), 'application row is locked');

  const expire = mock.calls.find((c) => /UPDATE admin_invites SET expires_at = NOW\(\)/.test(c.sql));
  assert.ok(expire, 'older invites are expired');
  assert.match(expire.sql, /used_at IS NULL/);
  assert.deepEqual(expire.params, [42, 'Ada@North.example']);

  const invite = mock.calls.find((c) => /INSERT INTO admin_invites/.test(c.sql));
  assert.equal(invite.params[0], 42);
  assert.equal(invite.params[3], 'admin');
  assert.ok(sql.indexOf(expire.sql) < sql.indexOf(invite.sql), 'expire runs before the new invite');

  const audit = mock.calls.find((c) => /INSERT INTO platform_audit/.test(c.sql));
  assert.equal(audit.params[1], 'invite.created');
  assert.equal(audit.params[2], 7);
  assert.equal(audit.params[3], 42);
  assert.equal(JSON.parse(audit.params[4]).source, 'resend');

  const token = /\/invite#([A-Za-z0-9_-]{43})$/.exec(sentEmails[0].link)[1];
  assert.equal(hashInviteToken(token), invite.params[2]);
  assert.ok(sql.indexOf('EMAIL') > commit, 'email goes only after the commit');
});

test('resend changes nothing when email cannot be sent', async () => {
  scenario({ email: false, application: APPROVED, slugTaken: true, slugRow: NEW_SHELTER });
  const res = await call('POST', '/applications/7/resend-invite', { session: OWNER });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Email is not configured/);
  assert.ok(!sqlCalls().some((s) => /admin_invites|shelter_applications|BEGIN/.test(s)));
});

test('resend refuses a pending application, an accepted invite, and a suspended shelter', async () => {
  scenario({ email: true, slugTaken: true, slugRow: NEW_SHELTER });
  let res = await call('POST', '/applications/7/resend-invite', { session: OWNER });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Only an approved application/);
  assert.ok(sqlCalls().includes('ROLLBACK'));
  assert.ok(!sqlCalls().some((s) => /INSERT INTO admin_invites|UPDATE admin_invites/.test(s)));
  assert.equal(sentEmails.length, 0);

  scenario({ email: true, application: APPROVED, slugTaken: true, slugRow: NEW_SHELTER, usedInvite: true });
  res = await call('POST', '/applications/7/resend-invite', { session: OWNER });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /already been accepted/);
  assert.ok(!sqlCalls().some((s) => /INSERT INTO admin_invites|UPDATE admin_invites/.test(s)));

  scenario({ email: true, application: APPROVED, slugTaken: true, slugRow: { ...NEW_SHELTER, status: 'suspended' } });
  res = await call('POST', '/applications/7/resend-invite', { session: OWNER });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /suspended/);

  scenario({ email: true, application: null });
  res = await call('POST', '/applications/7/resend-invite', { session: OWNER });
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// Shelters list and suspend
// ---------------------------------------------------------------------------

test('suspend sets status to suspended, deletes nothing, and audits it', async () => {
  scenario();
  const res = await call('POST', '/shelters/5/suspend', { session: OWNER, body: { reason: 'Charity removed' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.shelter, { id: 5, slug: 'north-paws', status: 'suspended' });

  const update = mock.calls.find((c) => /UPDATE shelters/.test(c.sql));
  assert.match(update.sql, /SET status = 'suspended'/);
  assert.deepEqual(update.params, [5]);
  assert.ok(!sqlCalls().some((s) => /\bDELETE\b/i.test(s)));

  const audit = mock.calls.find((c) => /INSERT INTO platform_audit/.test(c.sql));
  assert.equal(audit.params[1], 'shelter.suspended');
  assert.equal(audit.params[3], 5);
  assert.deepEqual(JSON.parse(audit.params[4]), { slug: 'north-paws', reason: 'Charity removed' });
  assert.ok(sqlCalls().includes('COMMIT'));
});

test('suspend: 404 for an unknown shelter, 409 when already suspended or own shelter', async () => {
  scenario({ shelter: null });
  assert.equal((await call('POST', '/shelters/5/suspend', { session: OWNER })).status, 404);

  scenario({ shelter: { id: 5, slug: 'north-paws', status: 'suspended' } });
  assert.equal((await call('POST', '/shelters/5/suspend', { session: OWNER })).status, 409);
  assert.ok(!sqlCalls().some((s) => /UPDATE shelters|platform_audit/.test(s)));

  scenario();
  const own = await call('POST', `/shelters/${OWNER_SHELTER}/suspend`, { session: OWNER });
  assert.equal(own.status, 409);
  assert.ok(!sqlCalls().some((s) => /UPDATE shelters/.test(s)));
});

test('GET /shelters lists shelters without logos or tenant data', async () => {
  scenario();
  const res = await call('GET', '/shelters', { session: OWNER });
  assert.equal(res.status, 200);
  const list = mock.calls.find((c) => /FROM shelters/.test(c.sql));
  assert.doesNotMatch(list.sql, /\blogo\b/);
});

// ---------------------------------------------------------------------------
// The owner never reads tenant volunteer data
// ---------------------------------------------------------------------------

test('owner routes touch only platform tables and never users or volunteer_profiles', async () => {
  const runs = [
    () => call('GET', '/applications', { session: OWNER }),
    () => call('GET', '/applications?status=all', { session: OWNER }),
    () => call('POST', '/applications/7/approve', { session: OWNER }),
    () => call('POST', '/applications/7/reject', { session: OWNER, body: { reason: 'Not a charity' } }),
    () => call('GET', '/shelters', { session: OWNER }),
    () => call('POST', '/shelters/5/suspend', { session: OWNER }),
  ];
  for (const run of runs) {
    scenario();
    const res = await run();
    assert.ok(res.status < 300, `status ${res.status}`);
    const touched = tablesTouched();
    for (const table of touched) {
      assert.ok(ALLOWED_TABLES.has(table), `owner route touched ${table}`);
    }
    for (const sql of sqlCalls()) {
      if (sql === ACCOUNT_LOOKUP_SQL) continue;
      assert.doesNotMatch(sql, /\busers\b|\bvolunteer_profiles\b/i);
    }
    // Responses carry no volunteer profile fields.
    assert.doesNotMatch(JSON.stringify(res.body), /password|date_of_birth|emergency_contact|volunteer/i);
  }
});

// ---------------------------------------------------------------------------
// Invite token helpers
// ---------------------------------------------------------------------------

test('createInvite issues a 32-byte token and stores only its SHA-256 hash', async () => {
  const { createInvite } = require('../services/shelterProvision');
  scenario();
  const invite = await createInvite(mock.pool, { shelterId: 42, email: 'A@B.example' });
  assert.equal(Buffer.from(invite.token, 'base64url').length, 32);
  const insert = mock.calls.find((c) => /INSERT INTO admin_invites/.test(c.sql));
  assert.equal(insert.params[2], hashInviteToken(invite.token));
  assert.ok(!insert.params.includes(invite.token));
  assert.equal(invite.email, 'a@b.example');

  const second = await createInvite(mock.pool, { shelterId: 42, email: 'a@b.example' });
  assert.notEqual(second.token, invite.token);

  await assert.rejects(() => createInvite(mock.pool, { shelterId: 0, email: 'a@b.example' }), /Shelter is required/);
  await assert.rejects(() => createInvite(mock.pool, { shelterId: 42, email: 'nope' }), /email is invalid/);
  await assert.rejects(() => createInvite(mock.pool, { shelterId: 42, email: 'a@b.example', role: 'owner' }), /role is invalid/);
});

test('consumeInvite is single use and checks expiry in the same UPDATE', async () => {
  const { consumeInvite } = require('../services/shelterProvision');
  let used = false;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/UPDATE admin_invites/.test(sql)) {
      if (used) return [[]];
      used = true;
      return [[{ id: 11, shelter_id: 42, email: 'a@b.example', role: 'admin' }]];
    }
    return [[]];
  });
  const first = await consumeInvite(mock.pool, 'tok');
  assert.equal(first.id, 11);
  assert.equal(await consumeInvite(mock.pool, 'tok'), null);
  assert.equal(await consumeInvite(mock.pool, ''), null);
  const update = mock.calls[0];
  assert.match(update.sql, /used_at IS NULL AND expires_at > NOW\(\)/);
  assert.deepEqual(update.params, [hashInviteToken('tok')]);
});
