'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { scrubEvent, redactText, captureError } = require('../utils/sentry');

test('redactText removes emails and UK phone numbers', () => {
  const out = redactText('Failed for ann.o\'neil+x@example.co.uk, call 07700 900201 or 028 9083 0001 or +44 7700 900201');
  assert.ok(!out.includes('@example.co.uk'));
  assert.ok(!/07700|9083|900201/.test(out));
  assert.match(out, /\[email\]/);
  assert.match(out, /\[phone\]/);
});

test('redactText leaves ordinary text and numbers alone', () => {
  assert.equal(redactText('Shift 12 on 2026-10-19 failed after 3 retries'), 'Shift 12 on 2026-10-19 failed after 3 retries');
});

test('scrubEvent drops bodies, cookies, auth headers, user and extra data', () => {
  const event = scrubEvent({
    message: 'Could not email val@example.com',
    request: {
      url: 'https://shelterlink.online/api/auth/login',
      data: { email: 'val@example.com', password: 'hunter2' },
      cookies: { 'connect.sid': 'abc' },
      query_string: 'token=secret',
      headers: { Authorization: 'Bearer x', Cookie: 'connect.sid=abc', 'user-agent': 'jest' },
    },
    user: { id: 7, email: 'val@example.com', ip_address: '1.2.3.4' },
    extra: { session: { userId: 7 } },
    exception: { values: [{ type: 'Error', value: 'bad number 07700 900201' }] },
    breadcrumbs: [{ message: 'sent to a@example.com', data: { to: 'a@example.com' } }],
  });
  assert.equal(event.request.data, undefined);
  assert.equal(event.request.cookies, undefined);
  assert.equal(event.request.query_string, undefined);
  assert.equal(event.request.headers.Authorization, undefined);
  assert.equal(event.request.headers.Cookie, undefined);
  assert.equal(event.request.headers['user-agent'], 'jest');
  assert.equal(event.user, undefined);
  assert.equal(event.extra, undefined);
  assert.ok(!JSON.stringify(event).includes('@example.com'));
  assert.ok(!JSON.stringify(event).includes('900201'));
  assert.ok(!JSON.stringify(event).includes('hunter2'));
  assert.equal(event.breadcrumbs[0].data, undefined);
});

test('without SENTRY_DSN nothing is loaded and reporting is a no-op', () => {
  const sentryPath = require.resolve('../utils/sentry');
  delete require.cache[sentryPath];
  const loaded = [];
  const sdkPath = require.resolve('@sentry/node');
  const original = require.cache[sdkPath];
  Object.defineProperty(require.cache, sdkPath, {
    configurable: true,
    get() {
      loaded.push('touched');
      return original;
    },
  });
  try {
    const fresh = require('../utils/sentry');
    assert.equal(fresh.initSentry({}), false);
    assert.doesNotThrow(() => fresh.captureError(new Error('boom'), { tags: { a: 'b' } }));
    assert.doesNotThrow(() => captureError(new Error('boom')));
    assert.deepEqual(loaded, [], '@sentry/node must not be required when SENTRY_DSN is unset');
  } finally {
    delete require.cache[sdkPath];
    if (original) require.cache[sdkPath] = original;
  }
});

test('with a DSN, init is privacy-safe and errors carry tags', () => {
  const sentryPath = require.resolve('../utils/sentry');
  const sdkPath = require.resolve('@sentry/node');
  const original = require.cache[sdkPath];
  const calls = { init: null, tags: null, captured: [] };
  require.cache[sdkPath] = {
    id: sdkPath,
    filename: sdkPath,
    loaded: true,
    exports: {
      init: (opts) => { calls.init = opts; },
      withScope: (fn) => fn({ setTags: (t) => { calls.tags = t; } }),
      captureException: (e) => calls.captured.push(e),
    },
  };
  delete require.cache[sentryPath];
  try {
    const fresh = require('../utils/sentry');
    assert.equal(fresh.initSentry({ SENTRY_DSN: 'https://k@o0.ingest.sentry.io/1', SENTRY_ENVIRONMENT: 'demo' }), true);
    assert.equal(calls.init.dsn, 'https://k@o0.ingest.sentry.io/1');
    assert.equal(calls.init.environment, 'demo');
    assert.equal(calls.init.sendDefaultPii, false);
    assert.equal(calls.init.tracesSampleRate, 0);
    assert.equal(calls.init.beforeSend, fresh.scrubEvent);

    const err = new Error('job failed');
    fresh.captureError(err, { tags: { job: 'weeklyDigest' } });
    assert.deepEqual(calls.tags, { job: 'weeklyDigest' });
    assert.deepEqual(calls.captured, [err]);
  } finally {
    delete require.cache[sentryPath];
    if (original) require.cache[sdkPath] = original;
    else delete require.cache[sdkPath];
  }
});
