'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { currentShelterId, runWithShelter } = require('../utils/shelterContext');
const {
  publicShelterId,
  requestedShelterSlug,
  requestCarriesShelterId,
  _resetSlugCacheForTests,
} = require('../middleware/shelter');
const publicCtrl = require('../controllers/publicController');
const { getBrand, getBrandLogo } = require('../controllers/brandController');
const groupCtrl = require('../controllers/groupBookingController');
const auth = require('../controllers/authController');
const { bodies } = require('../validation/bodies');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const SLUGS = { assisi: 1, second: 2 };
const SHELTERS = {
  1: { id: 1, slug: 'assisi', name: 'Assisi Animal Sanctuary', logo: PNG, logo_mime: 'image/png' },
  2: { id: 2, slug: 'second', name: 'Second Shelter', logo: PNG, logo_mime: 'image/jpeg' },
};
const OPPS = [
  {
    opportunity_id: 1, id: 1, shelter_id: 1, title: 'MarkerA shift', status: 'open',
    start_date: '2099-06-01 10:00:00', end_date: '2099-06-01 12:00:00', max_volunteers: null,
  },
  {
    opportunity_id: 2, id: 2, shelter_id: 2, title: 'Second shift', status: 'open',
    start_date: '2099-06-02 10:00:00', end_date: '2099-06-02 12:00:00', max_volunteers: null,
  },
];

// Every query records the shelter it ran in, so tests can prove slug B
// never touched shelter A.
let ran = [];

function handler(sql, params) {
  const sid = currentShelterId();
  ran.push({ sql, sid });
  if (/FROM shelters WHERE slug = 'assisi'/.test(sql)) return [[{ id: 1 }]];
  if (/FROM shelters WHERE slug = \?/.test(sql)) {
    const id = SLUGS[params[0]];
    return [id ? [{ id }] : []];
  }
  if (/FROM\s+shelters/.test(sql)) {
    const row = SHELTERS[Number(params[0])];
    return [row ? [{ ...row, has_logo: true }] : []];
  }
  if (/INSERT INTO group_bookings/i.test(sql)) return [{ insertId: 50 }];
  // Opportunity.findAll / findById. Their column list has a group_bookings
  // subquery, so match these before the group_bookings read below.
  const listAll = /ORDER BY COALESCE\(is_urgent/.test(sql);
  const byId = /FROM opportunities\s+WHERE opportunity_id = \?/.test(sql);
  if (listAll || byId) {
    let rows = OPPS.filter((o) => o.shelter_id === sid);
    if (byId) rows = rows.filter((o) => o.opportunity_id === Number(params[0]));
    return [rows.map((o) => ({ ...o }))];
  }
  if (/FROM group_bookings/i.test(sql)) {
    return [[{ id: 50, contact_email: 'pat@example.test', contact_name: 'Pat', group_name: 'G', size: 1 }]];
  }
  if (/INSERT INTO users/i.test(sql)) return [{ insertId: 9 }];
  return [[]];
}

function makeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

function tenantQueries() {
  return ran.filter((r) => !/FROM shelters WHERE slug/.test(r.sql));
}

test.beforeEach(() => {
  _resetSlugCacheForTests();
  publicCtrl._resetCacheForTests();
  mock.resetCalls();
  ran = [];
  mock.setHandler(async (sql, params) => handler(sql, params));
});

test('requestedShelterSlug reads :slug, then ?shelter=, then shelter_slug; ignores arrays', () => {
  assert.equal(requestedShelterSlug({}), null);
  assert.equal(requestedShelterSlug({ query: { shelter: 'second' } }), 'second');
  assert.equal(requestedShelterSlug({ body: { shelter_slug: 'second' } }), 'second');
  assert.equal(
    requestedShelterSlug({ params: { slug: 'a' }, query: { shelter: 'b' }, body: { shelter_slug: 'c' } }),
    'a'
  );
  assert.equal(requestedShelterSlug({ query: { shelter: ['second', 'assisi'] } }), null);
  assert.equal(requestedShelterSlug({ query: { shelter: '   ' } }), null);
});

test('publicShelterId: no slug -> Assisi, known slug -> that shelter, unknown -> Assisi', async () => {
  assert.equal(await publicShelterId({}), 1);
  assert.equal(await publicShelterId({ query: { shelter: 'second' } }), 2);
  assert.equal(await publicShelterId({ query: { shelter: 'nowhere' } }), 1);
  assert.equal(await publicShelterId({ query: { shelter: "x' OR '1'='1" } }), 1);
});

test('publicShelterId: a known slug wins over the session; no slug keeps the session', async () => {
  await runWithShelter(2, async () => {
    assert.equal(await publicShelterId({}), 2);
    assert.equal(await publicShelterId({ query: { shelter: 'assisi' } }), 1);
    assert.equal(await publicShelterId({ query: { shelter: 'nowhere' } }), 2);
  });
});

test('shelter_slug is not a shelter id, so the shelter_id guard lets it through', () => {
  assert.equal(requestCarriesShelterId({ body: { shelter_slug: 'second' }, query: {}, params: {} }), false);
  assert.equal(requestCarriesShelterId({ body: {}, query: { shelter: 'second' }, params: {} }), false);
  assert.equal(requestCarriesShelterId({ body: { shelter_slug: 'second', shelter_id: 1 }, query: {}, params: {} }), true);
});

test('public opportunities for slug B only read shelter B', async () => {
  const res = makeRes();
  await publicCtrl.listPublicOpportunities({ query: { shelter: 'second' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.map((o) => o.title), ['Second shift']);
  const sids = tenantQueries().map((r) => r.sid);
  assert.ok(sids.length > 0);
  assert.ok(sids.every((sid) => sid === 2), `ran in ${sids}`);
});

test('public opportunities with no slug fall back to Assisi', async () => {
  const res = makeRes();
  await publicCtrl.listPublicOpportunities({ query: {} }, res);
  assert.deepEqual(res.body.map((o) => o.title), ['MarkerA shift']);
});

test('public opportunities cache is keyed by shelter, so A then B do not share a payload', async () => {
  const a = makeRes();
  await publicCtrl.listPublicOpportunities({ query: { shelter: 'assisi' } }, a);
  const b = makeRes();
  await publicCtrl.listPublicOpportunities({ query: { shelter: 'second' } }, b);
  const aAgain = makeRes();
  await publicCtrl.listPublicOpportunities({ query: { shelter: 'assisi' } }, aAgain);
  assert.deepEqual(a.body.map((o) => o.title), ['MarkerA shift']);
  assert.deepEqual(b.body.map((o) => o.title), ['Second shift']);
  assert.deepEqual(aAgain.body.map((o) => o.title), ['MarkerA shift']);
  const oppQueries = ran.filter((r) => /ORDER BY COALESCE\(is_urgent/.test(r.sql));
  assert.deepEqual(oppQueries.map((r) => r.sid), [1, 2], 'third call is a cache hit for shelter 1');
});

test('public ICS for slug B only lists shelter B shifts', async () => {
  const res = makeRes();
  await publicCtrl.publicOpportunitiesIcs({ query: { shelter: 'second' } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /SUMMARY:Second shift/);
  assert.doesNotMatch(res.body, /MarkerA/);
  assert.ok(tenantQueries().every((r) => r.sid === 2));
});

test('brand and logo for slug B name shelter B by id', async () => {
  const brand = makeRes();
  await getBrand({ query: { shelter: 'second' } }, brand);
  assert.deepEqual(brand.body, { name: 'Second Shelter', slug: 'second', hasLogo: true });

  const logo = makeRes();
  await getBrandLogo({ query: { shelter: 'second' } }, logo);
  assert.equal(logo.statusCode, 200);
  assert.equal(logo.headers['Content-Type'], 'image/jpeg');

  const brandQueries = ran.filter((r) => /FROM\s+shelters/.test(r.sql) && !/WHERE slug/.test(r.sql));
  assert.equal(brandQueries.length, 2);
  for (const call of brandQueries) assert.equal(call.sid, 2);
  for (const call of mock.calls.filter((c) => /FROM\s+shelters\s+WHERE id/.test(c.sql.replace(/\s+/g, ' ')))) {
    assert.deepEqual(call.params, [2]);
  }
});

test('brand for an unknown slug falls back to Assisi and reports the Assisi slug', async () => {
  const res = makeRes();
  await getBrand({ query: { shelter: 'nowhere' } }, res);
  assert.equal(res.body.name, 'Assisi Animal Sanctuary');
  assert.equal(res.body.slug, 'assisi');
});

function bookingBody(overrides = {}) {
  return {
    group_name: 'Year 6',
    contact_name: 'Pat',
    contact_email: 'pat@example.test',
    size: 1,
    started_at: Date.now() - 10000,
    ...overrides,
  };
}

test('group booking for slug B cannot book a shelter A shift', async () => {
  const res = makeRes();
  await groupCtrl.createGroupBooking(
    { body: bookingBody({ opportunity_id: 1, shelter_slug: 'second' }), query: {} },
    res
  );
  assert.equal(res.statusCode, 404);
  assert.ok(!ran.some((r) => /INSERT INTO group_bookings/i.test(r.sql)));
  assert.ok(tenantQueries().every((r) => r.sid === 2));
});

test('group booking for slug B books a shelter B shift inside shelter B', async () => {
  const res = makeRes();
  await groupCtrl.createGroupBooking(
    { body: bookingBody({ opportunity_id: 2, shelter_slug: 'second' }), query: {} },
    res
  );
  assert.equal(res.statusCode, 201);
  const insert = ran.find((r) => /INSERT INTO group_bookings/i.test(r.sql));
  assert.equal(insert.sid, 2);
});

test('group booking with no slug still books Assisi', async () => {
  const res = makeRes();
  await groupCtrl.createGroupBooking({ body: bookingBody({ opportunity_id: 1 }), query: {} }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(ran.find((r) => /INSERT INTO group_bookings/i.test(r.sql)).sid, 1);
});

const registration = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada.slug@example.test',
  password: 'longpassword',
  privacy_notice: true,
};

test('register with shelter_slug inserts the volunteer into that shelter', async () => {
  const res = makeRes();
  await auth.register({ body: { ...registration, shelter_slug: 'second' } }, res);
  assert.equal(res.statusCode, 201);
  const insert = ran.find((r) => /INSERT INTO users/i.test(r.sql));
  assert.ok(insert, 'expected an insert');
  assert.equal(insert.sid, 2);
});

test('register with no shelter_slug keeps the Assisi default', async () => {
  const res = makeRes();
  await auth.register({ body: registration }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(ran.find((r) => /INSERT INTO users/i.test(r.sql)).sid, 1);
});

test('register with an unknown shelter_slug is a 404 and never falls through to Assisi', async () => {
  for (const slug of ['nowhere', 'BAD SLUG', "x' OR '1'='1"]) {
    ran = [];
    const res = makeRes();
    await auth.register({ body: { ...registration, shelter_slug: slug } }, res);
    assert.equal(res.statusCode, 404, `slug ${slug}`);
    assert.match(res.body.error, /could not find that shelter/i);
    assert.ok(!ran.some((r) => /INSERT INTO users/i.test(r.sql)));
  }
});

test('register body schema accepts shelter_slug but not shelter_id; admin schema takes neither', () => {
  assert.equal(bodies.register.safeParse({ ...registration, shelter_slug: 'second' }).success, true);
  assert.equal(bodies.register.safeParse({ ...registration, shelter_id: 2 }).success, false);
  assert.equal(bodies.registerAdmin.safeParse({ ...registration, shelter_slug: 'second' }).success, false);
  assert.equal(bodies.groupBooking.safeParse({ ...bookingBody({ opportunity_id: 2 }), shelter_slug: 'second' }).success, true);
  assert.equal(bodies.groupBooking.safeParse({ ...bookingBody({ opportunity_id: 2 }), shelter_id: 2 }).success, false);
});
