'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validateEnv, isWeakSecret, collectProductionProblems } = require('../utils/validateEnv');

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

test('placeholder secrets are weak', () => {
  assert.strictEqual(isWeakSecret('change_me_in_env', { minLength: 8 }), true);
  assert.strictEqual(isWeakSecret('shelterlink-admin-2025', { minLength: 8 }), true);
  assert.strictEqual(isWeakSecret('replace_me_now_please', { minLength: 8 }), true);
  assert.strictEqual(isWeakSecret('demo-secret-value-here', { minLength: 8 }), true);
  assert.strictEqual(isWeakSecret('a'.repeat(32), { minLength: 32 }), false);
});

test('production collectProblems flags missing SESSION_SECRET and ADMIN_REGISTRATION_KEY', () => {
  withEnv({
    NODE_ENV: 'production',
    SESSION_SECRET: 'change_me_in_env',
    ADMIN_REGISTRATION_KEY: 'shelterlink-admin-2025',
    APP_URL: 'http://localhost:3000',
    DATABASE_URL: undefined,
  }, () => {
    const missing = collectProductionProblems();
    assert.ok(missing.includes('SESSION_SECRET'));
    assert.ok(missing.includes('ADMIN_REGISTRATION_KEY'));
    assert.ok(missing.includes('APP_URL'));
    assert.ok(missing.includes('DATABASE_URL'));
  });
  withEnv({
    NODE_ENV: 'production',
    SESSION_SECRET: 'x'.repeat(40),
    ADMIN_REGISTRATION_KEY: 'y'.repeat(24),
    APP_URL: 'http://shelterlink.online',
    DATABASE_URL: 'postgresql://db.example.test:5432/shelterlink',
  }, () => {
    assert.ok(collectProductionProblems().includes('APP_URL'));
  });
});

test('production passes with strong secrets and public APP_URL', () => {
  withEnv({
    NODE_ENV: 'production',
    SESSION_SECRET: 'x'.repeat(40),
    ADMIN_REGISTRATION_KEY: 'y'.repeat(24),
    APP_URL: 'https://shelterlink.online',
    DATABASE_URL: 'postgresql://db.example.test:5432/shelterlink',
  }, () => {
    const result = validateEnv({ exitProcess: false });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  });
});

test('non-production does not require secrets', () => {
  withEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: undefined,
    ADMIN_REGISTRATION_KEY: undefined,
    APP_URL: undefined,
  }, () => {
    const result = validateEnv({ exitProcess: false });
    assert.strictEqual(result.ok, true);
  });
});

test('charity register warnings name CCEW_API_KEY and OSCR_API_KEY, never values, never fatal', () => {
  const { collectCharityRegisterWarnings } = require('../utils/validateEnv');
  const none = collectCharityRegisterWarnings({});
  assert.strictEqual(none.length, 2);
  assert.match(none[0], /^CCEW_API_KEY is not set/);
  assert.match(none[1], /^OSCR_API_KEY is not set/);
  assert.deepStrictEqual(collectCharityRegisterWarnings({ CCEW_API_KEY: 'secret-value-1', OSCR_API_KEY: 'secret-value-2' }), []);
  const one = collectCharityRegisterWarnings({ CCEW_API_KEY: '  ', OSCR_API_KEY: 'secret-value-2' });
  assert.strictEqual(one.length, 1);
  assert.doesNotMatch(one.join(' '), /secret-value/);
  withEnv(
    { NODE_ENV: 'production', CCEW_API_KEY: undefined, OSCR_API_KEY: undefined },
    () => assert.ok(!collectProductionProblems().some((n) => /CCEW|OSCR/.test(n)))
  );
});
