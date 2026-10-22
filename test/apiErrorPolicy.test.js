'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('API 404/503 stay on the current page; 403/500 still redirect', async () => {
  const { shouldRedirectStatus } = await import('../frontend/js/utils/apiErrorPolicy.js');

  assert.equal(shouldRedirectStatus(404), false);
  assert.equal(shouldRedirectStatus(503), false);
  assert.equal(shouldRedirectStatus(400), false);
  assert.equal(shouldRedirectStatus(429), false);
  assert.equal(shouldRedirectStatus(403), true);
  assert.equal(shouldRedirectStatus(403, 'Forbidden'), true);
  assert.equal(
    shouldRedirectStatus(403, 'This shift requires a clear accessni basic background check before you can claim it.'),
    false
  );
  assert.equal(shouldRedirectStatus(500), true);
  assert.equal(shouldRedirectStatus(502), true);
});
