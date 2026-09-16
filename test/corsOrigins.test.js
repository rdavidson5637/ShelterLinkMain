'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isAllowedCorsOrigin } = require('../utils/corsOrigins');

function withEnv(vars, fn) {
  const prev = {};
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('production allowlists shelterlink.online and rejects others', () => {
  withEnv({
    NODE_ENV: 'production',
    APP_URL: 'https://shelterlink.online',
    CORS_ORIGINS: undefined,
  }, () => {
    assert.strictEqual(isAllowedCorsOrigin('https://shelterlink.online'), true);
    assert.strictEqual(isAllowedCorsOrigin('https://evil.example'), false);
    assert.strictEqual(isAllowedCorsOrigin('http://localhost:3000'), false);
    assert.strictEqual(isAllowedCorsOrigin(undefined), true);
  });
});

test('non-production allows localhost and not arbitrary origins', () => {
  withEnv({
    NODE_ENV: 'development',
    CORS_ORIGINS: undefined,
  }, () => {
    assert.strictEqual(isAllowedCorsOrigin('http://localhost:3000'), true);
    assert.strictEqual(isAllowedCorsOrigin('http://127.0.0.1:5173'), true);
    assert.strictEqual(isAllowedCorsOrigin('https://evil.example'), false);
  });
});
