'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_SHELTER_APPLY = '1000';
delete process.env.CCEW_API_KEY;

const mock = require('./helpers/mockDb');
const { isBypass } = require('../utils/shelterContext');
const { errorHandler } = require('../middleware/errorHandler');
const publicRoutes = require('../routes/public');
const { registerSnapshot, RECEIVED, fillTimeError, RESERVED_SLUGS } = require('../controllers/shelterApplicationController');
const fs = require('fs');
const path = require('path');

function scenario({
  slugShelter = false,
  slugPending = false,
  charityShelter = false,
  charityPending = false,
  insertError = null,
  pendingTotal = 0,
  pendingMine = 0,
} = {}) {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/count\(\*\)::int AS total/.test(sql)) return [[{ total: pendingTotal, mine: pendingMine }]];
    if (/INSERT INTO shelter_applications/.test(sql)) {
      assert.ok(isBypass(), 'the global applications table is written outside shelter context');
      if (insertError) throw insertError;
      return [Object.assign([{ id: 3 }], { insertId: 3 })];
    }
    if (/FROM shelters WHERE slug = \?/.test(sql)) return [slugShelter ? [{ id: 2 }] : []];
    if (/FROM shelter_applications WHERE desired_slug = \?/.test(sql)) return [slugPending ? [{ id: 5 }] : []];
    if (/FROM shelters WHERE charity_regulator = \?/.test(sql)) return [charityShelter ? [{ id: 2 }] : []];
    if (/FROM shelter_applications\s+WHERE regulator = \?/.test(sql)) return [charityPending ? [{ id: 5 }] : []];
    return [[]];
  });
}

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicRoutes);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/public/shelter-applications`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

async function apply(body) {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function good(overrides = {}) {
  return {
    shelter_name: '  North   Paws Rescue ',
    desired_slug: 'North-Paws',
    regulator: 'ccni',
    charity_number: 'nic 100123',
    contact_name: 'Ada North',
    contact_email: 'Ada@North.Example',
    website: '',
    started_at: Date.now() - 10000,
    ...overrides,
  };
}

function inserts() {
  return mock.calls.filter((c) => /INSERT INTO shelter_applications/.test(c.sql));
}

test('a good application is stored as pending, normalised, with a register snapshot', async () => {
  scenario();
  const res = await apply(good());
  assert.equal(res.status, 201);
  assert.equal(res.body.message, RECEIVED);

  const [insert] = inserts();
  assert.ok(insert, 'one application row');
  const [name, slug, regulator, number, snapshot, contactName, email] = insert.params;
  assert.equal(name, 'North Paws Rescue');
  assert.equal(slug, 'north-paws');
  assert.equal(regulator, 'ccni');
  assert.equal(number, 'NIC100123');
  assert.equal(contactName, 'Ada North');
  assert.equal(email, 'ada@north.example');
  const snap = JSON.parse(snapshot);
  assert.equal(typeof snap.status, 'string', 'register answer saved for the owner');
  assert.doesNotMatch(insert.sql, /status/, 'status is left to its pending default');
});

test('an England and Wales charity can apply', async () => {
  scenario();
  const res = await apply(good({ regulator: 'ccew', charity_number: '1234567' }));
  assert.equal(res.status, 201);
  assert.equal(inserts()[0].params[3], '1234567');
  const snap = JSON.parse(inserts()[0].params[4]);
  assert.equal(snap.status, 'not_configured', 'no CCEW API key here, so the owner checks by hand');
});

test('the honeypot answers like a success and stores nothing', async () => {
  scenario();
  const res = await apply(good({ website: 'http://spam.example' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.message, RECEIVED);
  assert.equal(mock.calls.length, 0);
});

test('Scottish and Irish charities are told they cannot apply yet', async () => {
  for (const [regulator, number] of [['oscr', 'SC012345'], ['cri', '20012345'], ['', '']]) {
    scenario();
    const res = await apply(good({ regulator, charity_number: number }));
    assert.equal(res.status, 400, regulator);
    assert.equal(res.body.field, 'regulator');
    assert.match(res.body.error, /Northern Ireland or in England and Wales/);
    assert.equal(mock.calls.length, 0);
  }
});

test('charity number mistakes get the register\'s own guidance', async () => {
  scenario();
  let res = await apply(good({ charity_number: 'XR12345' }));
  assert.equal(res.status, 400);
  assert.equal(res.body.field, 'charity_number');
  assert.match(res.body.error, /HMRC references/);

  scenario();
  res = await apply(good({ regulator: 'ccew', charity_number: '12345' }));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /6 or 7 digits/);
  assert.equal(mock.calls.length, 0);
});

test('bad, short and reserved web addresses are refused', async () => {
  for (const slug of ['North Paws', 'ab', 'a--b', '-paws', 'admin', 'platform', 'invite', 'x'.repeat(61)]) {
    scenario();
    const res = await apply(good({ desired_slug: slug }));
    assert.equal(res.status, 400, slug);
    assert.equal(res.body.field, 'desired_slug', slug);
    assert.equal(inserts().length, 0, slug);
  }
});

test('missing names and bad emails are refused with the field named', async () => {
  const cases = [
    [{ shelter_name: ' ' }, 'shelter_name'],
    [{ contact_name: 'A' }, 'contact_name'],
    [{ contact_email: 'not-an-email' }, 'contact_email'],
  ];
  for (const [change, field] of cases) {
    scenario();
    const res = await apply(good(change));
    assert.equal(res.status, 400, field);
    assert.equal(res.body.field, field);
    assert.equal(mock.calls.length, 0, field);
  }
});

test('a web address used by a shelter or a pending application is taken', async () => {
  for (const opts of [{ slugShelter: true }, { slugPending: true }]) {
    scenario(opts);
    const res = await apply(good());
    assert.equal(res.status, 409);
    assert.equal(res.body.field, 'desired_slug');
    assert.equal(inserts().length, 0);
  }
});

test('a charity that already has a shelter, or is waiting, cannot apply again', async () => {
  scenario({ charityShelter: true });
  let res = await apply(good());
  assert.equal(res.status, 409);
  assert.match(res.body.error, /already has a shelter/);

  scenario({ charityPending: true });
  res = await apply(good());
  assert.equal(res.status, 409);
  assert.match(res.body.error, /already waiting for review/);
  assert.equal(inserts().length, 0);
});

test('a database failure is a generic 500', async () => {
  scenario({ insertError: new Error('connection reset') });
  const res = await apply(good());
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'Internal server error');
});

test('the request cannot name a shelter id or set a status', async () => {
  for (const extra of [{ shelter_id: 1 }, { status: 'approved' }, { decided_by: 1 }]) {
    scenario();
    const res = await apply(good(extra));
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal(mock.calls.length, 0);
  }
});

test('registerSnapshot never throws or hangs', async () => {
  const thrown = await registerSnapshot('ccni', 'NIC100123', async () => { throw new Error('down'); });
  assert.equal(thrown.status, 'unavailable');

  const slow = await registerSnapshot('ccni', 'NIC100123', () => new Promise(() => {}), 20);
  assert.equal(slow.status, 'unavailable');
  assert.match(slow.message, /timed out/);

  const ok = await registerSnapshot('ccni', 'NIC100123', async () => ({ found: true, status: 'registered', name: 'NORTH PAWS' }));
  assert.equal(ok.name, 'NORTH PAWS');
});

// ---------------------------------------------------------------------------
// Review follow-ups: minimum fill time, pending caps, reserved slugs, and the
// 040 partial unique indexes.
// ---------------------------------------------------------------------------

test('a form sent too fast, with no start time, or left open for days is refused before any query', async () => {
  for (const [startedAt, pattern] of [
    [Date.now(), /take a moment/],
    [undefined, /Reload the page/],
    ['abc', null],
    [Date.now() - 13 * 60 * 60 * 1000, /expired/],
  ]) {
    scenario();
    const body = good();
    if (startedAt === undefined) delete body.started_at;
    else body.started_at = startedAt;
    const res = await apply(body);
    assert.equal(res.status, 400, String(startedAt));
    if (pattern) assert.match(res.body.error, pattern);
    assert.equal(mock.calls.length, 0, 'nothing read or stored');
  }
});

test('fillTimeError allows a normal fill', () => {
  const now = 1_800_000_000_000;
  assert.equal(fillTimeError({ started_at: now - 5000 }, now), null);
  assert.equal(fillTimeError({ started_at: String(now - 5000) }, now), null);
  assert.match(fillTimeError({ started_at: now - 1000 }, now), /moment/);
});

test('a full queue turns new applications away, and so does a busy email address', async () => {
  scenario({ pendingTotal: 100 });
  let res = await apply(good());
  assert.equal(res.status, 503);
  assert.match(res.body.error, /not taking new applications/);
  assert.equal(inserts().length, 0);

  scenario({ pendingTotal: 5, pendingMine: 3 });
  res = await apply(good());
  assert.equal(res.status, 429);
  assert.match(res.body.error, /already have applications waiting/);
  assert.equal(inserts().length, 0);

  const count = mock.calls.find((c) => /count\(\*\)::int AS total/.test(c.sql));
  assert.deepEqual(count.params, ['ada@north.example'], 'per-email cap uses the normalised address');

  scenario({ pendingTotal: 99, pendingMine: 2 });
  res = await apply(good());
  assert.equal(res.status, 201);
});

test('the caps can be set from the environment', async () => {
  process.env.SHELTER_APPLY_MAX_PENDING = '2';
  try {
    scenario({ pendingTotal: 2 });
    const res = await apply(good());
    assert.equal(res.status, 503);
  } finally {
    delete process.env.SHELTER_APPLY_MAX_PENDING;
  }
});

test('demo, test, pages and healthz are reserved', async () => {
  for (const slug of ['demo', 'test', 'pages', 'healthz']) {
    assert.ok(RESERVED_SLUGS.has(slug), slug);
    scenario();
    const res = await apply(good({ desired_slug: slug }));
    assert.equal(res.status, 400, slug);
    assert.equal(res.body.field, 'desired_slug');
    assert.equal(inserts().length, 0);
  }
});

test('a race that reaches the 040 unique indexes gets the same field errors as the read check', async () => {
  for (const [constraint, field] of [
    ['shelter_applications_pending_slug_key', 'desired_slug'],
    ['shelter_applications_pending_charity_key', 'charity_number'],
  ]) {
    scenario({ insertError: Object.assign(new Error('duplicate key'), { code: '23505', constraint }) });
    const res = await apply(good());
    assert.equal(res.status, 409, constraint);
    assert.equal(res.body.field, field);
  }
  scenario({ insertError: Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'something_else' }) });
  assert.equal((await apply(good())).status, 500, 'other unique violations stay generic');
});

test('migration 040 adds pending-only unique indexes and refuses existing duplicates', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', '040_shelter_applications_pending_unique.pg.sql'), 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS shelter_applications_pending_slug_key\s+ON shelter_applications \(desired_slug\)\s+WHERE status = 'pending';/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS shelter_applications_pending_charity_key\s+ON shelter_applications \(regulator, charity_number\)\s+WHERE status = 'pending';/);
  assert.match(sql, /RAISE EXCEPTION 'Pending shelter_applications has duplicates/);
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  assert.match(sql, /Rollback:/);
});

test('the apply page sends started_at and leaves the privacy wording as a TODO', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'apply.js'), 'utf8');
  assert.match(js, /const startedAt = Date\.now\(\);/);
  assert.match(js, /started_at: startedAt/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'apply.html'), 'utf8');
  assert.match(html, /TODO\(Ryan\): final privacy wording/);
});
