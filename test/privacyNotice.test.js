'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PRIVACY_NOTICE_VERSION } = require('../config/privacyNotice');

test('the privacy page shows the same version as the config constant', () => {
  const html = fs.readFileSync(path.join(__dirname, '../frontend/pages/privacy.html'), 'utf8');
  assert.match(html, new RegExp(`Version ${PRIVACY_NOTICE_VERSION}`));
  assert.doesNotMatch(html, /Lawful basis: TODO/);
  assert.doesNotMatch(html, /If UK GDPR applies/);
  assert.match(html, /ico\.org\.uk/);
});
