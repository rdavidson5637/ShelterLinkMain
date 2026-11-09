'use strict';

// Extra coverage for the platform owner approval queue (PR5, #16): list
// ordering and limits, register snapshot parsing, reason validation on
// reject and suspend, approve edge cases, and rollback on failure. The
// main behaviour is in platform.test.js; this file fills the gaps.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { errorHandler } = require('../middleware/errorHandler');
const platformRoutes = require('../routes/platform');

const OWNER = { userId: 1, role: 'admin', shelterId: 1 };

mock.pool.getConnection = async () => ({
  async beginTransaction() { mock.calls.push({ sql: 'BEGIN', params: [] }); },
  async commit() { mock.calls.push({ sql: 'COMMIT', params: [] }); },
  async rollback() { mock.calls.push({ sql: 'ROLLBACK', params: [] }); },
  execute: (sql, params) => mock.pool.execute(sql, params),
  query: (sql, params) => mock.pool.query(sql, params),
  release() {},
});

function application(overrides = {}) {
  return {
    id: 7,
    shelter_name: 'North Paws',
    desired_slug: 'north-paws',
    regulator: 'ccni',
    charity_number: 'NIC100123',
    register_snapshot: null,
    contact_name: 'Ada North',
    contact_email: 'ada@north.example',
    status: 'pending',
    decided_by: null,
    decided_at: null,
    reason: null,
    created_at: '2026-11-01 10:00:00',
    ...overrides,
  };
}

function scenario({
  rows = [application()],
  shelter = { id: 5, slug: 'north-paws', status: 'active' },
  updatedRows = 1,
  failOn = null,
} = {}) {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (failOn && failOn.test(sql)) throw new Error('boom');
    if (/FROM platform_owners/i.test(sql)) return [[{ user_id: 1 }]];
    if (/FROM shelter_applications/i.test(sql)) return [rows];
    if (/UPDATE shelter_applications/i.test(sql)) return [{ affectedRows: updatedRows }];
    if (/FROM shelters WHERE slug = \?|FROM shelters WHERE charity_regulator/i.test(sql)) return [[]];
    if (/INSERT INTO shelters/i.test(sql)) return [Object.assign([{ id: 42 }], { insertId: 42 })];
    if (/INSERT INTO admin_invites/i.test(sql)) {
      return [Object.assign([{ id: 11, expires_at: '2026-11-16 10:00:00' }], { insertId: 11 })];
    }
    if (/FROM shelters WHERE id = \?/i.test(sql)) return [shelter ? [shelter] : []];
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

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-session': JSON.stringify(OWNER) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const sqlCalls = () => mock.calls.map((c) => c.sql);
const find = (re) => mock.calls.find((c) => re.test(c.sql));

// ---------------------------------------------------------------------------
// GET /applications
// ---------------------------------------------------------------------------

test('pending is oldest first; all is newest first; both are capped at 200', async () => {
  scenario();
  await call('GET', '/applications');
  let list = find(/FROM shelter_applications/);
  assert.match(list.sql, /ORDER BY created_at ASC, id ASC LIMIT 200/);

  scenario();
  await call('GET', '/applications?status=all');
  list = find(/FROM shelter_applications/);
  assert.match(list.sql, /ORDER BY created_at DESC, id DESC LIMIT 200/);
});

test('approved and rejected filters pass the status as a parameter, never in the SQL', async () => {
  for (const status of ['approved', 'rejected']) {
    scenario();
    const res = await call('GET', `/applications?status=${status}`);
    assert.equal(res.status, 200);
    const list = find(/FROM shelter_applications/);
    assert.deepEqual(list.params, [status]);
    assert.doesNotMatch(list.sql, new RegExp(`'${status}'`));
  }
});

test('odd status values are refused before any query', async () => {
  for (const q of ['status=PENDING', 'status=pending%27--', 'status[]=pending', 'status=']) {
    scenario();
    const res = await call('GET', `/applications?${q}`);
    if (q === 'status=') {
      // An empty string is still a string: not a known status.
      assert.equal(res.status, 400, q);
    } else if (q === 'status[]=pending') {
      // A non-string falls back to the pending default.
      assert.equal(res.status, 200, q);
      assert.deepEqual(find(/FROM shelter_applications/).params, ['pending']);
      continue;
    } else {
      assert.equal(res.status, 400, q);
    }
    assert.ok(!sqlCalls().some((s) => /shelter_applications/.test(s)), q);
  }
});

test('register_snapshot is parsed from text, kept as an object, and null when unreadable', async () => {
  scenario({
    rows: [
      application({ id: 1, register_snapshot: '{"status":"registered","name":"NORTH PAWS"}' }),
      application({ id: 2, register_snapshot: { status: 'removed' } }),
      application({ id: 3, register_snapshot: '{not json' }),
      application({ id: 4, register_snapshot: null }),
    ],
  });
  const res = await call('GET', '/applications?status=all');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r) => r.register_snapshot), [
    { status: 'registered', name: 'NORTH PAWS' },
    { status: 'removed' },
    null,
    null,
  ]);
});

// ---------------------------------------------------------------------------
// Approve edge cases
// ---------------------------------------------------------------------------

test('approve: 404 for an unknown application, with nothing created', async () => {
  scenario({ rows: [] });
  const res = await call('POST', '/applications/99/approve');
  assert.equal(res.status, 404);
  assert.ok(!sqlCalls().some((s) => /INSERT/.test(s)));
  assert.ok(sqlCalls().includes('ROLLBACK'));
  assert.ok(!sqlCalls().includes('COMMIT'));
});

test('approve: 409 and rollback when the application changed under us', async () => {
  scenario({ updatedRows: 0 });
  const res = await call('POST', '/applications/7/approve');
  assert.equal(res.status, 409);
  assert.match(res.body.error, /changed/);
  assert.ok(sqlCalls().includes('ROLLBACK'));
  assert.ok(!sqlCalls().includes('COMMIT'));
  assert.ok(!sqlCalls().some((s) => /INSERT INTO platform_audit/.test(s)));
});

test('approve copies the register name (capped at 255) and check time from a text snapshot', async () => {
  const longName = 'N'.repeat(300);
  scenario({
    rows: [application({ register_snapshot: JSON.stringify({ name: longName, checkedAt: '2026-11-01T10:00:00Z' }) })],
  });
  const res = await call('POST', '/applications/7/approve');
  assert.equal(res.status, 201);
  const insert = find(/INSERT INTO shelters/);
  const [, , , , regulator, number, registerName, checkedAt] = insert.params;
  assert.equal(regulator, 'ccni');
  assert.equal(number, 'NIC100123');
  assert.equal(registerName.length, 255);
  assert.equal(checkedAt, '2026-11-01T10:00:00Z');
});

test('approve ignores a snapshot name or check time that is not text', async () => {
  scenario({ rows: [application({ register_snapshot: { name: 42, checkedAt: { at: 'x' } } })] });
  const res = await call('POST', '/applications/7/approve');
  assert.equal(res.status, 201);
  const params = find(/INSERT INTO shelters/).params;
  assert.equal(params[6], null);
  assert.equal(params[7], null);
});

test('approve ignores any body, so a client cannot pick the slug, email or shelter', async () => {
  scenario();
  const res = await call('POST', '/applications/7/approve', {
    desired_slug: 'evil', contact_email: 'x@evil.example', shelter_id: 1,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.shelter.slug, 'north-paws');
  assert.equal(res.body.invite.email, 'ada@north.example');
});

test('approve rolls back when the audit insert fails', async () => {
  scenario({ failOn: /INSERT INTO platform_audit/ });
  const res = await call('POST', '/applications/7/approve');
  assert.equal(res.status, 500);
  assert.ok(sqlCalls().includes('ROLLBACK'));
  assert.ok(!sqlCalls().includes('COMMIT'));
});

test('ids must be positive integers', async () => {
  for (const id of ['0', '-1', '1.5', '1e3']) {
    scenario();
    const res = await call('POST', `/applications/${id}/approve`);
    assert.equal(res.status, 400, id);
    assert.ok(!sqlCalls().some((s) => /shelter_applications/.test(s)), id);
  }
});

// ---------------------------------------------------------------------------
// Reject and suspend reasons
// ---------------------------------------------------------------------------

test('reject: a reason over 1000 characters is refused; exactly 1000 is fine', async () => {
  scenario();
  let res = await call('POST', '/applications/7/reject', { reason: 'x'.repeat(1001) });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /at most 1000/);
  assert.ok(!sqlCalls().includes('BEGIN'), 'checked before the transaction');

  scenario();
  res = await call('POST', '/applications/7/reject', { reason: 'x'.repeat(1000) });
  assert.equal(res.status, 200);
});

test('reject: 404 for an unknown application, and rollback when the audit fails', async () => {
  scenario({ rows: [] });
  let res = await call('POST', '/applications/99/reject', { reason: 'Not a charity' });
  assert.equal(res.status, 404);

  scenario({ failOn: /INSERT INTO platform_audit/ });
  res = await call('POST', '/applications/7/reject', { reason: 'Not a charity' });
  assert.equal(res.status, 500);
  assert.ok(sqlCalls().includes('ROLLBACK'));
  assert.ok(!sqlCalls().includes('COMMIT'));
});

test('suspend: the reason is optional, but must be text and at most 1000 characters', async () => {
  scenario();
  let res = await call('POST', '/shelters/5/suspend');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(find(/INSERT INTO platform_audit/).params[4]), { slug: 'north-paws', reason: null });

  for (const reason of [42, 'x'.repeat(1001), ['a']]) {
    scenario();
    res = await call('POST', '/shelters/5/suspend', { reason });
    assert.equal(res.status, 400, JSON.stringify(reason).slice(0, 20));
    assert.ok(!sqlCalls().includes('BEGIN'));
  }

  scenario();
  res = await call('POST', '/shelters/5/suspend', { reason: '   ' });
  assert.equal(res.status, 200, 'blank is the same as no reason');
  assert.equal(JSON.parse(find(/INSERT INTO platform_audit/).params[4]).reason, null);
});

test('suspend locks the shelter row and only flips an active shelter', async () => {
  scenario();
  await call('POST', '/shelters/5/suspend');
  assert.match(find(/FROM shelters WHERE id = \?/).sql, /FOR UPDATE/);
  assert.match(find(/UPDATE shelters/).sql, /WHERE id = \? AND status = 'active'/);
});

// ---------------------------------------------------------------------------
// Page accessibility
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

test('the queue page announces results as a status and names each row\'s buttons', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'pages', 'platform-shelters.html'), 'utf8');
  assert.match(html, /<div id="message" role="status" aria-live="polite"><\/div>/);
  assert.match(html, /<button type="button" id="logoutButton"/);
  for (const caption of ['Applications', 'Shelters']) {
    assert.match(html, new RegExp(`<caption>${caption}</caption>`));
  }

  const js = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'platform', 'shelters.js'), 'utf8');
  assert.match(js, /approveButton\.setAttribute\('aria-label', `Approve \$\{app\.shelter_name\}`\)/);
  assert.match(js, /querySelector\('summary'\)\.setAttribute\('aria-label', `Reject \$\{app\.shelter_name\}`\)/);
  assert.match(js, /el\('label', \{ htmlFor: id, textContent: 'Reason \(kept on record\)' \}\)/, 'reject reason keeps its label');
});
