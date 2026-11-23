'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { runWithShelter } = require('../utils/shelterContext');
const { getBrand, getBrandLogo } = require('../controllers/brandController');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Two shelters. A query that does not name the id gets the first row, which
// is what LIMIT 1 without WHERE used to do.
const ROWS = [
  {
    id: 1,
    slug: 'assisi',
    name: 'Assisi Animal Sanctuary',
    logo: PNG,
    logo_mime: 'image/png',
    logo_storage_key: null,
    primary_colour: null,
  },
  {
    id: 2,
    slug: 'second',
    name: 'Second Shelter',
    logo: PNG,
    logo_mime: 'image/jpeg',
    logo_storage_key: null,
    primary_colour: '#0f766e',
  },
];

function handler(sql, params) {
  if (/FROM shelters WHERE slug = 'assisi'/.test(sql)) return [[{ id: 1 }]];
  if (/FROM\s+shelters/.test(sql)) {
    const match = /WHERE\s+id\s*=\s*\?/.test(sql)
      ? ROWS.filter((r) => r.id === Number(params[0]))
      : ROWS;
    return [match.map((r) => ({
      ...r,
      has_logo: Boolean(r.logo || r.logo_storage_key),
    }))];
  }
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

function brandQueries() {
  return mock.calls.filter((c) => /FROM\s+shelters/.test(c.sql) && !/WHERE slug =/.test(c.sql));
}

test.beforeEach(() => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => handler(sql, params));
});

test('brand queries name the shelter with WHERE id = ? and never LIMIT 1 alone', async () => {
  await runWithShelter(2, () => getBrand({}, makeRes()));
  await runWithShelter(2, () => getBrandLogo({}, makeRes()));
  const calls = brandQueries();
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.sql, /WHERE\s+id\s*=\s*\?/);
    assert.doesNotMatch(call.sql, /LIMIT 1/);
    assert.deepEqual(call.params, [2]);
  }
});

test('getBrand returns the bound shelter, not the first row', async () => {
  const res = makeRes();
  await runWithShelter(2, () => getBrand({}, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.name, 'Second Shelter');
  assert.equal(res.body.slug, 'second');
  assert.equal(res.body.hasLogo, true);
  assert.equal(res.body.primaryColour, '#0f766e');
  assert.equal(res.body.colourTokens.green, '#0f766e');
});

test('getBrand with no session falls back to Assisi by id', async () => {
  const res = makeRes();
  await getBrand({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.name, 'Assisi Animal Sanctuary');
  assert.equal(res.body.primaryColour, null);
  assert.equal(res.body.colourTokens, null);
  assert.deepEqual(brandQueries().map((c) => c.params), [[1]]);
});

test('getBrandLogo returns the bound shelter logo and mime', async () => {
  const res = makeRes();
  await runWithShelter(2, () => getBrandLogo({}, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/jpeg');
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(res.body, PNG);
});

test('brand endpoints 404 when the bound shelter row is missing', async () => {
  const brand = makeRes();
  await runWithShelter(99, () => getBrand({}, brand));
  assert.equal(brand.statusCode, 404);

  const logo = makeRes();
  await runWithShelter(99, () => getBrandLogo({}, logo));
  assert.equal(logo.statusCode, 404);
});
