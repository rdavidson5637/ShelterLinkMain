'use strict';

// Invite links carry the token in the #fragment (never a path or query),
// the page checks it by POST, and page/check/accept have separate rate
// limits. Plus the platform queue's existing-account warning and the hidden
// Resend button once an invite is accepted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

process.env.NODE_ENV = 'test';

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const {
  LIMITS,
  invitePageLimiter,
  inviteCheckLimiter,
  inviteAcceptLimiter,
} = require('../middleware/rateLimiter');
const { inviteLink } = require('../services/inviteDelivery');

test('invite links put the token in the fragment, never the path or query', () => {
  const token = 'A'.repeat(43);
  const link = inviteLink('https://shelterlink.example/', token);
  assert.equal(link, `https://shelterlink.example/invite#${token}`);
  const url = new URL(link);
  assert.equal(url.pathname, '/invite');
  assert.equal(url.search, '');
  assert.equal(url.hash, `#${token}`);
});

test('page, check and accept have separate limiters, and accept is the strictest', () => {
  assert.equal(typeof invitePageLimiter, 'function');
  assert.equal(typeof inviteCheckLimiter, 'function');
  assert.equal(typeof inviteAcceptLimiter, 'function');
  assert.notEqual(invitePageLimiter, inviteCheckLimiter);
  assert.notEqual(inviteCheckLimiter, inviteAcceptLimiter);
  assert.ok(LIMITS.inviteAccept <= 10, 'accept stays tight');
  assert.ok(LIMITS.inviteCheck > LIMITS.inviteAccept, 'checking does not share the accept budget');
  assert.ok(LIMITS.invitePage >= LIMITS.inviteCheck);

  const routes = read('routes/auth.js');
  assert.match(routes, /router\.post\('\/invite\/check', inviteCheckLimiter,/);
  assert.match(routes, /router\.post\('\/accept-invite', inviteAcceptLimiter,/);
  assert.doesNotMatch(routes, /\/invite\/:token/);
  assert.match(read('server.js'), /app\.get\('\/invite', invitePageLimiter,/);
});

test('using up the check limit does not block accepting', async () => {
  const app = express();
  app.use(express.json());
  app.post('/check', inviteCheckLimiter, (req, res) => res.json({ ok: true }));
  app.post('/accept', inviteAcceptLimiter, (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    let last;
    for (let i = 0; i <= LIMITS.inviteCheck; i += 1) {
      last = await fetch(`${base}/check`, { method: 'POST' });
    }
    assert.equal(last.status, 429, 'check limit reached');
    const accept = await fetch(`${base}/accept`, { method: 'POST' });
    assert.equal(accept.status, 200, 'accept still has its own budget');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the invite page reads the token from the fragment, strips it, and checks it by POST', () => {
  const source = read('frontend/js/invite.js');
  assert.match(source, /tokenFromHash\(window\.location\.hash\)/);
  assert.match(source, /history\.replaceState\(/);
  assert.match(source, /apiRequest\('\/auth\/invite\/check', \{ method: 'POST', body: \{ token \} \}\)/);
  assert.doesNotMatch(source, /location\.pathname\)\s*;?\s*\n?\s*if \(!token/);
  assert.doesNotMatch(source, /\/auth\/invite\/\$\{/, 'the token is never put in an API URL');
});

test('the platform queue warns at Approve when the email has an account, and hides Resend once accepted', () => {
  const source = read('frontend/js/platform/shelters.js');
  assert.match(source, /contact_has_account/);
  assert.match(source, /body: approveConfirmBody\(app\)/);
  assert.match(source, /app\.contact_has_account \? 'Approve anyway' : 'Approve'/);
  assert.match(source, /app\.status === 'approved' && app\.invite_accepted\)/);
  const accepted = source.indexOf('app.invite_accepted)');
  const resend = source.indexOf("textContent: 'Resend invite'");
  assert.ok(accepted > 0 && resend > accepted, 'the accepted branch comes first and has no Resend button');
});
