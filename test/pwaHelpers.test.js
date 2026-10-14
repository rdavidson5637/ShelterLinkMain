'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('shouldShowUpdateBanner only when a controller existed at load', async () => {
  const { shouldShowUpdateBanner } = await import('../frontend/js/pwa.js');
  assert.equal(shouldShowUpdateBanner(true), true);
  assert.equal(shouldShowUpdateBanner(false), false);
});

test('apiRequest maps offline TypeError to a UK English error', async () => {
  const origFetch = global.fetch;
  const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.window = { location: { origin: 'http://localhost:3000' } };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: false },
  });
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const { apiRequest } = await import('../frontend/js/config.js');
  await assert.rejects(() => apiRequest('/auth/me'), /You're offline/);
  global.fetch = origFetch;
  if (origNav) Object.defineProperty(globalThis, 'navigator', origNav);
  else delete globalThis.navigator;
});

test('calendar subscribe URLs swap https for webcal and encode Google cid', async () => {
  const { buildCalendarSubscribeUrls } = await import('../frontend/js/utils/calendarUrls.js');
  const urls = buildCalendarSubscribeUrls('https://shelterlink.online/api/my-shifts.ics?token=abc');
  assert.equal(urls.apple, 'webcal://shelterlink.online/api/my-shifts.ics?token=abc');
  assert.ok(urls.google.includes('calendar.google.com'));
  assert.ok(urls.google.includes(encodeURIComponent('webcal://shelterlink.online/api/my-shifts.ics?token=abc')));
});
