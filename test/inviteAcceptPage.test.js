'use strict';

// The invite accept page (/invite#<token>): the pure helpers it runs on,
// the headers it is served with, and the accessibility basics in its markup.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'invite-page-test-only-not-a-real-secret';

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const helpers = () => import('../frontend/js/utils/inviteAccept.js');

const GOOD = 'Ab0_-'.repeat(8) + 'xyz'; // 43 base64url characters

// ---------------------------------------------------------------------------
// tokenFromHash
// ---------------------------------------------------------------------------

test('tokenFromHash accepts a 43-character base64url token, with or without the #', async () => {
  const { tokenFromHash } = await helpers();
  assert.equal(GOOD.length, 43);
  assert.equal(tokenFromHash(`#${GOOD}`), GOOD);
  assert.equal(tokenFromHash(GOOD), GOOD);
  assert.equal(tokenFromHash(`#${encodeURIComponent(GOOD)}`), GOOD);
});

test('tokenFromHash refuses missing, wrong-length, padded and odd-character tokens', async () => {
  const { tokenFromHash } = await helpers();
  for (const hash of [
    undefined,
    null,
    '',
    '#',
    `#${GOOD.slice(1)}`,
    `#${GOOD}A`,
    `#${GOOD.slice(1)}=`,
    `#${GOOD.slice(1)}+`,
    `#${GOOD.slice(1)}/`,
    `#${GOOD.slice(2)}%20`,
    `#token=${GOOD}`,
    `#${GOOD}&x=1`,
  ]) {
    assert.equal(tokenFromHash(hash), null, `refused: ${hash}`);
  }
});

test('tokenFromHash returns null for a broken percent-encoding instead of throwing', async () => {
  const { tokenFromHash } = await helpers();
  assert.doesNotThrow(() => tokenFromHash('#%E0%A4%A'));
  assert.equal(tokenFromHash('#%E0%A4%A'), null);
});

test('roleLabel names staff and admin invites', async () => {
  const { roleLabel } = await helpers();
  assert.equal(roleLabel('staff'), 'a staff account');
  assert.equal(roleLabel('admin'), 'the admin account');
});

// ---------------------------------------------------------------------------
// validateAcceptForm
// ---------------------------------------------------------------------------

const ok = { firstName: 'Ada', lastName: 'Lovelace', password: 'correct horse', confirm: 'correct horse', privacy: true };

test('validateAcceptForm passes a complete form', async () => {
  const { validateAcceptForm } = await helpers();
  assert.deepEqual(validateAcceptForm(ok), []);
});

test('validateAcceptForm lists every problem, in page order, keyed to the field ids', async () => {
  const { validateAcceptForm } = await helpers();
  const errors = validateAcceptForm({ firstName: '  ', lastName: '', password: 'short', confirm: 'other', privacy: false });
  assert.deepEqual(
    errors.map((e) => e.field),
    ['first_name', 'last_name', 'password', 'confirm_password', 'privacy_notice']
  );
  const html = read('frontend/invite.html');
  for (const { field, message } of errors) {
    assert.match(html, new RegExp(`id="${field}"`), `${field} exists on the page`);
    assert.ok(message.endsWith('.'), 'messages are full sentences');
  }
});

test('validateAcceptForm keeps the password limits in line with the server', async () => {
  const { validateAcceptForm, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } = await helpers();
  const { MIN_PASSWORD_LENGTH: serverMin } = require('../utils/password');
  assert.equal(MIN_PASSWORD_LENGTH, serverMin);
  assert.match(read('validation/bodies.js'), new RegExp(`password: optStr\\(${MAX_PASSWORD_LENGTH}\\)`));

  const at = (n) => 'x'.repeat(n);
  const fields = (pw) => validateAcceptForm({ ...ok, password: pw, confirm: pw }).map((e) => e.field);
  assert.deepEqual(fields(at(MIN_PASSWORD_LENGTH - 1)), ['password']);
  assert.deepEqual(fields(at(MIN_PASSWORD_LENGTH)), []);
  assert.deepEqual(fields(at(MAX_PASSWORD_LENGTH)), []);
  assert.deepEqual(fields(at(MAX_PASSWORD_LENGTH + 1)), ['password']);
});

test('validateAcceptForm does not trim passwords', async () => {
  const { validateAcceptForm } = await helpers();
  const errors = validateAcceptForm({ ...ok, password: ' correct horse ', confirm: 'correct horse' });
  assert.deepEqual(errors.map((e) => e.field), ['confirm_password']);
});

// ---------------------------------------------------------------------------
// GET /invite
// ---------------------------------------------------------------------------

test('GET /invite serves the page with no-store, no-referrer and noindex', async () => {
  const { app } = require('../server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/invite`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('x-robots-tag') || '', /noindex/);
    const body = await res.text();
    assert.match(body, /<script type="module" src="\/js\/invite\.js"><\/script>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Markup and script: accessibility basics
// ---------------------------------------------------------------------------

test('every visible form control on the invite page has a label', () => {
  const html = read('frontend/invite.html');
  const ids = [...html.matchAll(/<input[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), ['confirm_password', 'email', 'first_name', 'last_name', 'password', 'phone', 'privacy_notice'].sort());
  for (const id of ids) {
    assert.match(html, new RegExp(`<label for="${id}">`), `label for ${id}`);
  }
});

test('the invite page has the right autocomplete hints for password managers', () => {
  const html = read('frontend/invite.html');
  const attrs = (id) => new RegExp(`id="${id}"[^>]*>`, 's').exec(html.replace(/\n\s*/g, ' '))[0];
  assert.match(attrs('email'), /autocomplete="username"/);
  assert.match(attrs('email'), /readonly/);
  assert.match(attrs('first_name'), /autocomplete="given-name"/);
  assert.match(attrs('last_name'), /autocomplete="family-name"/);
  assert.match(attrs('phone'), /autocomplete="tel"/);
  assert.match(attrs('password'), /autocomplete="new-password"/);
  assert.match(attrs('password'), /maxlength="200"/);
  assert.match(attrs('confirm_password'), /autocomplete="new-password"/);
  assert.match(attrs('confirm_password'), /maxlength="200"/);
  assert.match(attrs('privacy_notice'), /required/);
});

test('the invite page announces state changes', () => {
  const html = read('frontend/invite.html');
  assert.match(html, /<h1 id="heading" tabindex="-1">/, 'heading can take focus');
  assert.match(html, /id="message" role="status" aria-live="polite"/);
  assert.match(html, /<article class="auth-card" id="inviteCard" aria-labelledby="heading">/);

  const js = read('frontend/js/invite.js');
  // Dead end and success both move focus to the new heading.
  const deadEnd = js.slice(js.indexOf('function deadEnd('), js.indexOf('async function checkToken('));
  assert.match(deadEnd, /announceHeading\(\)/);
  const success = js.slice(js.indexOf('if (res.ok) {'), js.indexOf('if (res.status === 400'));
  assert.match(success, /announceHeading\(\)/);
  assert.match(js, /heading\.focus\(\)/);
  // Busy while checking the token and while submitting.
  assert.match(js, /card\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(js, /card\.removeAttribute\('aria-busy'\)/);
  assert.match(js, /form\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(js, /form\.removeAttribute\('aria-busy'\)/);
  // Validation comes from the tested helper, not a copy.
  assert.match(js, /validateAcceptForm\(\{ firstName, lastName, password, confirm, privacy \}\)/);
  assert.doesNotMatch(js, /const TOKEN_RE/);
});

test('the privacy notice link warns that it opens a new tab', () => {
  const html = read('frontend/invite.html').replace(/\s+/g, ' ');
  assert.match(
    html,
    /<a href="\/pages\/privacy\.html" target="_blank" rel="noopener noreferrer" >privacy notice<span class="visually-hidden"> \(opens in a new tab\)<\/span><\/a >/
  );
  assert.match(read('frontend/public/css/custom.css'), /\.visually-hidden \{/);
});

test('nothing on the invite page links out with a referrer or carries a token', () => {
  const html = read('frontend/invite.html');
  assert.match(html, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    assert.doesNotMatch(href, /#[A-Za-z0-9_-]{20,}|token/i, href);
  }
});
