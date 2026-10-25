'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('signup network errors do not mention a local port', () => {
  const source = read('frontend/js/register.js');
  assert.doesNotMatch(source, /port 3000/);
  assert.match(source, /Check your connection and try again/);
});

test('sign out everywhere clears the local cache before ending sessions', () => {
  const auth = read('frontend/js/auth.js');
  const profile = read('frontend/js/volunteer/complete-profile.js');
  assert.match(auth, /export async function logoutEverywhere/);
  assert.match(auth, /clearUserCache\(\)/);
  assert.match(profile, /logoutEverywhere\(\)/);
  assert.doesNotMatch(profile, /\/auth\/logout-all/);
});

test('staff status messages are text, not HTML', () => {
  for (const rel of [
    'frontend/js/admin/approve-hours.js',
    'frontend/js/admin/messages.js',
    'frontend/js/admin/animals.js',
    'frontend/js/admin/transport.js',
    'frontend/js/volunteer/log-hours.js',
    'frontend/js/volunteer/accept-waiver.js',
  ]) {
    const source = read(rel);
    assert.match(source, /note\.textContent = text/);
    assert.doesNotMatch(source, /\$\{text\}<\/p>/);
  }
  const transport = read('frontend/js/admin/transport.js');
  assert.doesNotMatch(transport, /value="\$\{defaults\.from/);
  assert.doesNotMatch(transport, /\$\{run\.title\}/);
  assert.doesNotMatch(transport, /\$\{run\.animal_name\}/);
});

test('feedback and audit rows do not treat names or comments as HTML', () => {
  const feedback = read('frontend/js/admin/feedback.js');
  const audit = read('frontend/js/admin/audit-log.js');
  assert.match(feedback, /td\.textContent = value/);
  assert.doesNotMatch(feedback, /\$\{item\.comment/);
  assert.doesNotMatch(feedback, /\$\{r\.opportunity_title\}/);
  assert.match(audit, /td\.textContent = value/);
  assert.doesNotMatch(audit, /\$\{actorLabel/);
  assert.doesNotMatch(audit, /\$\{detail/);
});

test('public status messages are text, not HTML', () => {
  for (const rel of [
    'frontend/js/public/reference.js',
    'frontend/js/public/group-booking.js',
    'frontend/js/feedback.js',
    'frontend/js/kiosk.js',
  ]) {
    const source = read(rel);
    assert.match(source, /textContent = text/);
    assert.doesNotMatch(source, /innerHTML = `?[^`]*\$\{text\}/);
  }
});
