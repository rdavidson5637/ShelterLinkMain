'use strict';

// SL-LATER-11: register password meter stays neutral until typing, and the
// heading shows the sanctuary from the shelter brand record (not a hard-coded name).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('password strength is idle until the person types', async () => {
  const { getStrengthInfo, getPasswordChecks, allPasswordChecksPass } = await import(
    '../frontend/js/utils/passwordStrength.js'
  );

  const idle = getStrengthInfo('');
  assert.equal(idle.idle, true);
  assert.equal(idle.label, null);
  assert.equal(idle.color, 'var(--text-secondary)');
  assert.notEqual(idle.label, 'Too short');

  const short = getStrengthInfo('abc');
  assert.equal(short.idle, false);
  assert.equal(short.label, 'Too short');
  assert.equal(short.color, 'var(--danger)');

  const ok = getStrengthInfo('longpassword');
  assert.equal(ok.idle, false);
  assert.equal(ok.label, 'Long enough');
  assert.equal(allPasswordChecksPass(getPasswordChecks('longpassword')), true);

  const longer = getStrengthInfo('longpassword12');
  assert.equal(longer.label, 'Long');
});

test('register script keeps the meter neutral on first paint', () => {
  const source = read('frontend/js/register.js');
  assert.match(source, /from '\.\/utils\/passwordStrength\.js'/);
  assert.match(source, /strength\.idle/);
  assert.match(source, /meterTextEl\.textContent = 'Strength'/);
  assert.doesNotMatch(source, /getStrengthInfo\(checks,\s*password/);
});

test('register heading shows sanctuary from shelter brand, not a hard-coded name', () => {
  const html = read('frontend/register.html');
  const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/);
  assert.ok(h1, 'h1 present');
  assert.match(h1[1], /data-shelter-name/);
  assert.match(h1[1], /Join/);
  assert.doesNotMatch(h1[1], /Assisi|North Paws|Second Shelter/i);
  assert.doesNotMatch(html, /Assisi Animal Sanctuary/);

  assert.match(html, /data-shelter-title="Join \{name\} - ShelterLink"/);

  const js = read('frontend/js/register.js');
  assert.match(js, /applyShelterBrand\(brand\)/);
  assert.match(js, /loadBrand/);
});
