'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { rangeContains, sha1Hex } = require('../utils/pwnedPassword');

test('rangeContains matches the suffix from a HIBP range body', () => {
  const hash = sha1Hex('password');
  const suffix = hash.slice(5);
  const body = `0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${suffix}:42\r\nFFFF:0\r\n`;
  assert.strictEqual(rangeContains(body, suffix), true);
  assert.strictEqual(rangeContains(body, 'ABCDEF'), false);
});
