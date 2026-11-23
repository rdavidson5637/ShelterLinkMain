'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createIcalToken, hashIcalToken } = require('../utils/icalToken');

test('createIcalToken returns 64-char raw token and matching sha256 hash', () => {
  const { raw, hash } = createIcalToken();
  assert.equal(raw.length, 64);
  assert.match(raw, /^[0-9a-f]+$/);
  assert.equal(hash, crypto.createHash('sha256').update(raw, 'utf8').digest('hex'));
  assert.equal(hash, hashIcalToken(raw));
});

test('hashIcalToken is stable and does not echo the raw secret', () => {
  const raw = 'a'.repeat(64);
  const hash = hashIcalToken(raw);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, raw);
  assert.equal(hashIcalToken(raw), hash);
});
