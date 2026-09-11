'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  toVolunteerSafeSwap,
  toOwnerSafeSwap,
  toVolunteerSafeApplication,
  hasContactLeak,
  stripContactFields,
} = require('../utils/contactPrivacy');

test('toVolunteerSafeSwap strips tokens and contact fields', () => {
  const safe = toVolunteerSafeSwap({
    id: 1,
    application_id: 9,
    status: 'open',
    public_at: '2026-08-01 10:00:00',
    claim_token: 'secret-token',
    waitlist_offered_to_user_id: 4,
    waitlist_offer_expires_at: '2026-08-01 22:00:00',
    email: 'other@example.com',
    phone: '07700 900111',
    opportunity_id: 7,
    opportunity_title: 'Dog Walk',
    original_user_id: 2,
  });
  assert.strictEqual(safe.id, 1);
  assert.strictEqual(safe.opportunity_title, 'Dog Walk');
  assert.strictEqual(safe.claim_token, undefined);
  assert.strictEqual(safe.email, undefined);
  assert.strictEqual(safe.phone, undefined);
  assert.strictEqual(safe.waitlist_offered_to_user_id, undefined);
  assert.ok(!hasContactLeak(safe));
});

test('toOwnerSafeSwap hides claim_token from the swap owner', () => {
  const safe = toOwnerSafeSwap({
    id: 3,
    status: 'open',
    claim_token: 'abc',
    waitlist_offered_to_user_id: 5,
  });
  assert.strictEqual(safe.claim_token, undefined);
  assert.strictEqual(safe.waitlist_offered_to_user_id, 5);
});

test('toVolunteerSafeApplication keeps shift fields only', () => {
  const safe = toVolunteerSafeApplication({
    application_id: 11,
    user_id: 2,
    opportunity_id: 7,
    status: 'accepted',
    email: 'me@example.com',
    phone: '07700',
    first_name: 'Alex',
  });
  assert.strictEqual(safe.application_id, 11);
  assert.strictEqual(safe.status, 'accepted');
  assert.strictEqual(safe.email, undefined);
  assert.strictEqual(safe.phone, undefined);
});

test('hasContactLeak detects nested email/phone/claim_token', () => {
  assert.strictEqual(hasContactLeak({ swap: { email: 'a@b.com' } }), true);
  assert.strictEqual(hasContactLeak({ swap: { claim_token: 'x' } }), true);
  assert.strictEqual(hasContactLeak({ swap: { id: 1, status: 'open' } }), false);
  assert.strictEqual(hasContactLeak([{ phone: '1' }]), true);
});

test('stripContactFields removes known PII keys', () => {
  const out = stripContactFields({
    id: 1,
    email: 'a@b.com',
    emergency_contact: 'Mum',
    title: 'Walk',
  });
  assert.deepStrictEqual(out, { id: 1, title: 'Walk' });
});
