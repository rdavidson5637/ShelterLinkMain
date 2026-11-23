'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isHiddenFromPublicBoard,
  filterPublicBoardOpportunities,
  isAcceptingApplications,
} = require('../utils/publicOpportunityFilter');

test('public board hides cancelled, closed, completed, and test-titled shifts', () => {
  assert.equal(isHiddenFromPublicBoard({ title: 'Kennel clean', status: 'open' }), false);
  assert.equal(isHiddenFromPublicBoard({ title: 'Walk dogs', status: 'cancelled' }), true);
  assert.equal(isHiddenFromPublicBoard({ title: 'Walk dogs', status: 'closed' }), true);
  assert.equal(isHiddenFromPublicBoard({ title: 'Walk dogs', status: 'completed' }), true);
  assert.equal(isHiddenFromPublicBoard({ title: 'Smoke Test Shift 9', status: 'open' }), true);
  assert.equal(isHiddenFromPublicBoard({ title: 'Night runthrough', status: 'open' }), true);
  assert.equal(isHiddenFromPublicBoard({ title: 'E2E test cover', status: 'open' }), true);
});

test('public board title filter uses word boundaries (Latest / Contest stay visible)', () => {
  assert.equal(isHiddenFromPublicBoard({ title: 'Latest kennel clean', status: 'open' }), false);
  assert.equal(isHiddenFromPublicBoard({ title: 'Contest fundraising walk', status: 'open' }), false);
  assert.equal(isHiddenFromPublicBoard({ title: 'Protest cover needed', status: 'open' }), false);
  assert.equal(isHiddenFromPublicBoard({ title: 'Testament shift', status: 'open' }), false);
  assert.equal(isHiddenFromPublicBoard({ title: 'Morning test walk', status: 'open' }), true);
  assert.equal(isHiddenFromPublicBoard({ title: 'Smoke cover', status: 'open' }), true);
});

test('filterPublicBoardOpportunities is defence-in-depth even if DB returns mixed rows', () => {
  const filtered = filterPublicBoardOpportunities([
    { title: 'Cattery Care', status: 'open' },
    { title: 'Closed deep-clean', status: 'closed' },
    { title: 'Cancelled walk', status: 'cancelled' },
    { title: 'Done walk', status: 'completed' },
    { title: 'Smoke kennel test', status: 'open' },
  ]);
  assert.deepEqual(
    filtered.map((o) => o.title),
    ['Cattery Care']
  );
  assert.deepEqual(filterPublicBoardOpportunities(null), []);
  assert.deepEqual(filterPublicBoardOpportunities(undefined), []);
});

test('full shifts stay visible but are not accepting applications', () => {
  const full = {
    title: 'Evening Dog Enrichment',
    status: 'open',
    max_volunteers: 2,
    spots_filled: 2,
  };
  assert.equal(isHiddenFromPublicBoard(full), false);
  assert.equal(isAcceptingApplications(full), false);
  assert.equal(
    isAcceptingApplications({ title: 'Walk', status: 'open', max_volunteers: 4, spots_filled: 1 }),
    true
  );
  assert.equal(
    isAcceptingApplications({ title: 'Walk', status: 'open', max_volunteers: null, spots_filled: 99 }),
    true
  );
  assert.equal(
    isAcceptingApplications({ title: 'Walk', status: 'open', max_volunteers: 0, spots_filled: 99 }),
    true
  );
});

test('frontend public board filter matches the API helper', async () => {
  const board = await import('../frontend/js/public/publicBoard.js');
  assert.equal(board.isHiddenFromPublicBoard({ title: 'Smoke Test Shift', status: 'open' }), true);
  assert.equal(board.isHiddenFromPublicBoard({ title: 'Walk', status: 'completed' }), true);
  assert.equal(board.isHiddenFromPublicBoard({ title: 'Latest kennel clean', status: 'open' }), false);
  assert.equal(board.isAcceptingSignups({ title: 'Walk', spots_remaining: 0 }), false);
  assert.equal(board.isAcceptingSignups({ title: 'Walk', spots_remaining: 2 }), true);
  assert.equal(board.closedShiftLabel({ status: 'closed' }), 'This shift is closed');
  assert.equal(board.closedShiftLabel({ status: 'cancelled' }), 'This shift was cancelled');
  assert.equal(board.closedShiftLabel({ spots_remaining: 0 }), 'Shift full');
});

test('public opportunities empty state names the shelter', async () => {
  const { publicOpportunitiesEmptyCopy } = await import('../frontend/js/public/opportunitiesEmpty.js');
  const named = publicOpportunitiesEmptyCopy('Assisi Animal Sanctuary');
  assert.match(named.title, /Assisi Animal Sanctuary/);
  assert.match(named.body, /Assisi Animal Sanctuary has nothing listed/);
  const fallback = publicOpportunitiesEmptyCopy('');
  assert.equal(fallback.title, 'No open shifts at this shelter');
  assert.match(fallback.body, /this shelter has nothing listed/i);
});

test('forgot-password copy never surfaces Invalid credentials', async () => {
  const { forgotPasswordFeedback, GENERIC_RESET_NOTICE } = await import(
    '../frontend/js/utils/forgotPasswordCopy.js'
  );
  const from401 = forgotPasswordFeedback({ ok: false, status: 401 }, { error: 'Invalid credentials' });
  assert.equal(from401.type, 'success');
  assert.equal(from401.text, GENERIC_RESET_NOTICE);
  assert.equal(from401.hideForm, true);

  const fromOk = forgotPasswordFeedback(
    { ok: true, status: 200 },
    { message: 'If that email is registered, a reset link has been sent.' }
  );
  assert.equal(fromOk.text, GENERIC_RESET_NOTICE);

  const from429 = forgotPasswordFeedback(
    { ok: false, status: 429 },
    { message: 'Too many password reset requests. Please try again later.' }
  );
  assert.equal(from429.type, 'error');
  assert.match(from429.text, /reset requests/i);
});

test('footer year is dynamic and not stuck on 2025', async () => {
  const { currentFooterYear, footerText } = await import('../frontend/js/utils/footerYear.js');
  const now = new Date('2026-09-14T12:00:00Z');
  assert.equal(currentFooterYear(now), 2026);
  assert.match(footerText(now), /2026/);
  assert.doesNotMatch(footerText(now), /2025/);
});
