'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('detectPlatform covers phones, in-app browsers and standalone', async () => {
  const { detectPlatform, isDismissed } = await import('../frontend/js/components/installPrompt.js');
  assert.equal(
    detectPlatform(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      false
    ),
    'ios-safari'
  );
  assert.equal(
    detectPlatform(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      false
    ),
    'other'
  );
  assert.equal(
    detectPlatform(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      false,
      { maxTouchPoints: 5 }
    ),
    'ios-safari'
  );
  assert.equal(
    detectPlatform(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram',
      false
    ),
    'ios-inapp'
  );
  assert.equal(
    detectPlatform(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
      false
    ),
    'ios-inapp'
  );
  assert.equal(
    detectPlatform(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      false
    ),
    'chromium'
  );
  assert.equal(
    detectPlatform('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', false),
    'other'
  );
  assert.equal(detectPlatform('Chrome', true), 'standalone');

  const now = Date.UTC(2026, 9, 14);
  assert.equal(isDismissed(now, now - 29 * 24 * 60 * 60 * 1000), true);
  assert.equal(isDismissed(now, now - 31 * 24 * 60 * 60 * 1000), false);
});
