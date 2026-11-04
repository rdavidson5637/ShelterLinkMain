'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { isBypass, runWithShelter } = require('../utils/shelterContext');
const {
  shelterIdFromSlug,
  _resetSlugCacheForTests,
} = require('../middleware/shelter');

const SHELTERS = { assisi: 1, 'second-shelter': 2 };

function useShelters() {
  mock.setHandler(async (sql, params) => {
    if (/FROM shelters WHERE slug = \?/.test(sql)) {
      const id = SHELTERS[params[0]];
      return [id ? [{ id }] : []];
    }
    return [[]];
  });
}

function slugQueries() {
  return mock.calls.filter((c) => /FROM shelters WHERE slug = \?/.test(c.sql));
}

test.beforeEach(() => {
  _resetSlugCacheForTests();
  mock.resetCalls();
  useShelters();
});

test('shelterIdFromSlug returns the id for a known slug, bound as a parameter', async () => {
  assert.equal(await shelterIdFromSlug('second-shelter'), 2);
  const [call] = slugQueries();
  assert.ok(call, 'expected a slug lookup');
  assert.deepEqual(call.params, ['second-shelter']);
  assert.doesNotMatch(call.sql, /second-shelter/, 'slug must not be interpolated into SQL');
});

test('shelterIdFromSlug returns null for an unknown slug', async () => {
  assert.equal(await shelterIdFromSlug('nowhere'), null);
});

test('shelterIdFromSlug caches a hit per slug', async () => {
  assert.equal(await shelterIdFromSlug('assisi'), 1);
  assert.equal(await shelterIdFromSlug('assisi'), 1);
  assert.equal(await shelterIdFromSlug('second-shelter'), 2);
  assert.equal(slugQueries().length, 2, 'one query per distinct slug');
});

test('shelterIdFromSlug does not cache a miss, so a later shelter is found', async () => {
  assert.equal(await shelterIdFromSlug('later'), null);
  SHELTERS.later = 9;
  try {
    assert.equal(await shelterIdFromSlug('later'), 9);
  } finally {
    delete SHELTERS.later;
  }
  assert.equal(slugQueries().length, 2);
});

test('shelterIdFromSlug rejects malformed input without querying', async () => {
  const bad = [
    undefined, null, 1, {}, ['assisi'], '', '   ',
    'has space', 'under_score', '-lead', 'trail-', 'double--dash',
    "assisi' OR '1'='1", 'a'.repeat(101),
  ];
  for (const value of bad) {
    assert.equal(await shelterIdFromSlug(value), null, `expected null for ${JSON.stringify(value)}`);
  }
  assert.equal(mock.calls.length, 0);
});

test('shelterIdFromSlug trims and lowercases before lookup and caching', async () => {
  assert.equal(await shelterIdFromSlug('  Assisi '), 1);
  assert.equal(await shelterIdFromSlug('assisi'), 1);
  assert.deepEqual(slugQueries().map((c) => c.params), [['assisi']]);
});

test('shelterIdFromSlug looks up outside any bound shelter', async () => {
  let bypassed = null;
  mock.setHandler(async () => {
    bypassed = isBypass();
    return [[{ id: 2 }]];
  });
  await runWithShelter(1, () => shelterIdFromSlug('second-shelter'));
  assert.equal(bypassed, true);
});

test('shelterIdFromSlug ignores a row with no usable id', async () => {
  mock.setHandler(async () => [[{ id: null }]]);
  assert.equal(await shelterIdFromSlug('assisi'), null);
  mock.setHandler(async () => [[{ id: 0 }]]);
  assert.equal(await shelterIdFromSlug('assisi'), null);
});
