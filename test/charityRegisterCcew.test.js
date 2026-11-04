'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ccew = require('../services/charityRegister/ccew');

const NOW = new Date('2026-11-04T12:00:00Z');
const KEY = 'test-key-not-real';

function jsonResponse(status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
  };
}

function mockFetch(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return typeof response === 'function' ? response(url, init) : response;
  };
  fn.calls = calls;
  return fn;
}

test('registered charity: maps name, status, and shape; sends key in the header', async () => {
  const fetch = mockFetch(jsonResponse(200, { charity_name: ' Paws Rescue ', reg_status: 'R', date_of_removal: null }));
  const result = await ccew.lookup('123 4567', { apiKey: KEY, fetch, now: NOW, baseUrl: 'https://ccew.test/api/' });

  assert.deepEqual(result, {
    found: true,
    name: 'Paws Rescue',
    status: 'registered',
    removedAt: null,
    source: 'ccew_api',
    checkedAt: '2026-11-04T12:00:00.000Z',
  });
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, 'https://ccew.test/api/charitydetails/1234567/0');
  assert.equal(fetch.calls[0].init.headers['Ocp-Apim-Subscription-Key'], KEY);
  assert.equal(fetch.calls[0].init.method, 'GET');
  assert.ok(fetch.calls[0].init.signal);
});

test('subsidiary number goes in the suffix path segment', async () => {
  const fetch = mockFetch(jsonResponse(200, { charity_name: 'Branch', reg_status: 'R' }));
  await ccew.lookup('1234567-01', { apiKey: KEY, fetch, now: NOW, baseUrl: 'https://ccew.test' });
  assert.equal(fetch.calls[0].url, 'https://ccew.test/charitydetails/1234567/1');
});

test('removed charity reports removedAt as a date', async () => {
  const fetch = mockFetch(
    jsonResponse(200, { charity_name: 'Old Shelter', reg_status: 'RM', date_of_removal: '2021-03-31T00:00:00' })
  );
  const result = await ccew.lookup('223344', { apiKey: KEY, fetch, now: NOW });
  assert.equal(result.found, true);
  assert.equal(result.status, 'removed');
  assert.equal(result.removedAt, '2021-03-31');
});

test('array body is accepted (first element)', async () => {
  const fetch = mockFetch(jsonResponse(200, [{ charity_name: 'Arr', reg_status: 'R' }]));
  const result = await ccew.lookup('1234567', { apiKey: KEY, fetch, now: NOW });
  assert.equal(result.name, 'Arr');
});

test('404 and empty 200 both mean not found', async () => {
  for (const res of [jsonResponse(404), jsonResponse(200), jsonResponse(200, {})]) {
    const result = await ccew.lookup('1234567', { apiKey: KEY, fetch: mockFetch(res), now: NOW });
    assert.deepEqual(result, {
      found: false,
      name: null,
      status: 'not_found',
      removedAt: null,
      source: 'ccew_api',
      checkedAt: '2026-11-04T12:00:00.000Z',
    });
  }
});

test('no key: not_configured, no HTTP call', async () => {
  const fetch = mockFetch(jsonResponse(200, {}));
  for (const apiKey of ['', '   ', null]) {
    const result = await ccew.lookup('1234567', { apiKey, fetch, now: NOW });
    assert.equal(result.found, null);
    assert.equal(result.status, 'not_configured');
    assert.equal(result.error, 'ccew_api_key_missing');
  }
  assert.equal(fetch.calls.length, 0);
});

test('reads CCEW_API_KEY from the environment when no key is passed', async () => {
  const before = process.env.CCEW_API_KEY;
  process.env.CCEW_API_KEY = 'env-key';
  try {
    const fetch = mockFetch(jsonResponse(200, { charity_name: 'Env', reg_status: 'R' }));
    await ccew.lookup('1234567', { fetch, now: NOW });
    assert.equal(fetch.calls[0].init.headers['Ocp-Apim-Subscription-Key'], 'env-key');
  } finally {
    if (before === undefined) delete process.env.CCEW_API_KEY;
    else process.env.CCEW_API_KEY = before;
  }
});

test('bad format: invalid_format with the formats.js message, no HTTP call', async () => {
  const fetch = mockFetch(jsonResponse(200, {}));
  const result = await ccew.lookup('SC012345', { apiKey: KEY, fetch, now: NOW });
  assert.equal(result.status, 'invalid_format');
  assert.equal(result.found, null);
  assert.match(result.message, /6 or 7 digits/);
  assert.equal(fetch.calls.length, 0);
});

test('API down: unavailable with a code, never throws, never leaks the key', async () => {
  const cases = [
    [new TypeError('fetch failed'), 'ccew_network'],
    [Object.assign(new Error('timed out'), { name: 'TimeoutError' }), 'ccew_timeout'],
    [jsonResponse(500, { message: 'boom' }), 'ccew_http_500'],
    [jsonResponse(503), 'ccew_http_503'],
    [jsonResponse(401), 'ccew_auth'],
    [jsonResponse(403), 'ccew_auth'],
    [jsonResponse(429), 'ccew_rate_limited'],
    [{ status: 200, ok: true, text: async () => '<html>' }, 'ccew_bad_response'],
    [jsonResponse(200, { charity_name: 'X', reg_status: 'ZZ' }), 'ccew_unknown_status'],
  ];
  for (const [res, code] of cases) {
    const result = await ccew.lookup('1234567', { apiKey: KEY, fetch: mockFetch(res), now: NOW });
    assert.equal(result.found, null, code);
    assert.equal(result.status, 'unavailable', code);
    assert.equal(result.error, code);
    assert.equal(result.checkedAt, '2026-11-04T12:00:00.000Z');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
  }
});

test('mapStatus and splitNumber', () => {
  assert.equal(ccew.mapStatus('R'), 'registered');
  assert.equal(ccew.mapStatus(' rm '), 'removed');
  assert.equal(ccew.mapStatus(undefined), null);
  assert.deepEqual(ccew.splitNumber('1234567'), { main: '1234567', suffix: '0' });
  assert.deepEqual(ccew.splitNumber('1234567-12'), { main: '1234567', suffix: '12' });
});
