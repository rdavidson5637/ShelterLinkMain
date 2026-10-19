'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
delete process.env.EMAIL_HOST;
delete process.env.EMAIL_FROM;
delete process.env.EMAIL_USER;
delete process.env.EMAIL_PASS;

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const digestCalls = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendThreadDigest: async (...args) => {
      digestCalls.push(args);
    },
  },
};

const jobLogPath = require.resolve('../utils/jobLog');
const jobRuns = [];
require.cache[jobLogPath] = {
  id: jobLogPath,
  filename: jobLogPath,
  loaded: true,
  exports: {
    recordJobRun: async (name, status, detail) => {
      jobRuns.push({ name, status, detail });
      return jobRuns.length;
    },
  },
};

const { isEmailConfigured } = require('../utils/emailConfig');
const { runMessageDigest } = require('../jobs/messageDigest');
const { collectProductionWarnings } = require('../utils/validateEnv');

function withEnv(vars, fn) {
  const prev = {};
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

function captureWarn() {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(' '));
  return { lines, restore: () => { console.warn = original; } };
}

test('isEmailConfigured needs a host and a from address', () => {
  assert.equal(isEmailConfigured({}), false);
  assert.equal(isEmailConfigured({ EMAIL_HOST: 'smtp.example.com' }), false);
  assert.equal(isEmailConfigured({ EMAIL_FROM: 'a@example.com' }), false);
  assert.equal(isEmailConfigured({ EMAIL_HOST: '  ', EMAIL_FROM: 'a@example.com' }), false);
  assert.equal(isEmailConfigured({ EMAIL_HOST: 'smtp.example.com', EMAIL_FROM: 'a@example.com' }), true);
  // EMAIL_USER is an accepted from-address fallback, as in sendEmail
  assert.equal(isEmailConfigured({ EMAIL_HOST: 'smtp.example.com', EMAIL_USER: 'u@example.com' }), true);
});

test('messageDigest skips once, without touching candidates, when email is unconfigured', async () => {
  digestCalls.length = 0;
  jobRuns.length = 0;
  mock.resetCalls();
  mock.setHandler(async () => {
    throw new Error('DB should not be queried when email is unconfigured');
  });

  const warn = captureWarn();
  let result;
  try {
    result = await runMessageDigest({ now: new Date(Date.UTC(2026, 9, 19, 12, 0, 0)) });
  } finally {
    warn.restore();
  }

  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.detail, 'skipped:email_not_configured');
  assert.equal(mock.calls.length, 0);
  assert.equal(digestCalls.length, 0);
  assert.equal(warn.lines.length, 1);
  assert.match(warn.lines[0], /\[Job:messageDigest\] skipped: email not configured/);
  assert.equal(jobRuns.length, 1);
  assert.equal(jobRuns[0].name, 'messageDigest');
  assert.equal(jobRuns[0].status, 'ok');
  assert.equal(jobRuns[0].detail, 'skipped:email_not_configured');
});

test('messageDigest still sends when email is configured', async () => {
  digestCalls.length = 0;
  jobRuns.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM messages m/i.test(sql)) {
      return [[
        { user_id: 7, email: 'v@example.com', first_name: 'Val', unread_count: 2 },
        { user_id: 8, email: 'w@example.com', first_name: 'Wes', unread_count: 1 },
      ]];
    }
    return [[]];
  });

  await withEnv(
    { EMAIL_HOST: 'smtp.example.com', EMAIL_FROM: 'ShelterLink <no-reply@example.com>' },
    async () => {
      const result = await runMessageDigest({ now: new Date(Date.UTC(2026, 9, 19, 12, 0, 0)) });
      assert.equal(result.sent, 2);
      assert.equal(result.failed, 0);
    }
  );

  assert.equal(digestCalls.length, 2);
  assert.equal(digestCalls[0][0], 'v@example.com');
  assert.equal(jobRuns.at(-1).detail.startsWith('sent=2;'), true);
});

test('production startup warnings list missing optional integrations', () => {
  withEnv(
    {
      NODE_ENV: 'production',
      EMAIL_HOST: undefined,
      EMAIL_FROM: undefined,
      EMAIL_USER: undefined,
      WEB_PUSH_VAPID_PUBLIC_KEY: undefined,
      WEB_PUSH_VAPID_PRIVATE_KEY: undefined,
      VAPID_PUBLIC_KEY: undefined,
      VAPID_PRIVATE_KEY: undefined,
      SHELTER_EMERGENCY_PHONE: undefined,
    },
    () => {
      const warnings = collectProductionWarnings();
      assert.equal(warnings.length, 3);
      assert.match(warnings[0], /Email is not configured/);
      assert.match(warnings[1], /Web push is not configured/);
      assert.match(warnings[2], /SHELTER_EMERGENCY_PHONE/);
    }
  );
});

test('production startup warnings are empty when everything is set, and silent outside production', () => {
  withEnv(
    {
      NODE_ENV: 'production',
      EMAIL_HOST: 'smtp.example.com',
      EMAIL_FROM: 'no-reply@example.com',
      WEB_PUSH_VAPID_PUBLIC_KEY: 'pub',
      WEB_PUSH_VAPID_PRIVATE_KEY: 'priv',
      SHELTER_EMERGENCY_PHONE: '028 0000 0000',
    },
    () => assert.deepEqual(collectProductionWarnings(), [])
  );
  withEnv({ NODE_ENV: 'test', EMAIL_HOST: undefined }, () => {
    assert.deepEqual(collectProductionWarnings(), []);
  });
});
