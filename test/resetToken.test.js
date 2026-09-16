'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { hashResetToken, createResetToken, productionResetBaseUrl } = require('../utils/resetToken');

test('createResetToken returns 64-char raw token and matching sha256 hash', () => {
  const { raw, hash } = createResetToken();
  assert.strictEqual(raw.length, 64);
  assert.strictEqual(hash, hashResetToken(raw));
  assert.notStrictEqual(raw, hash);
});

test('productionResetBaseUrl refuses localhost when NODE_ENV=production', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevUrl = process.env.APP_URL;
  process.env.NODE_ENV = 'production';
  process.env.APP_URL = 'http://localhost:3000';
  assert.strictEqual(productionResetBaseUrl(), null);
  process.env.APP_URL = 'https://shelterlink.online';
  assert.strictEqual(productionResetBaseUrl(), 'https://shelterlink.online');
  process.env.NODE_ENV = prevEnv;
  if (prevUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = prevUrl;
});
