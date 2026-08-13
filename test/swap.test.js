'use strict';

const test = require('node:test');
const assert = require('node:assert');
const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const emailCalls = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async (...args) => { emailCalls.push(['sendEmail', ...args]); },
    sendApplicationConfirmation: async () => {},
    sendApplicationApproval: async () => {},
    sendApplicationCancellation: async (...args) => { emailCalls.push(['cancel', ...args]); },
    sendApplicationRejection: async () => {},
    sendWaitlistPromotion: async (...args) => { emailCalls.push(['promote', ...args]); },
    sendHoursApproval: async () => {},
    sendVolunteerApprovalNotification: async () => {},
    sendShiftReminder: async () => {},
    sendOpportunityMatchDigest: async () => {},
    sendQualificationExpiryNotice: async () => {},
    sendSwapOpened: async (...args) => { emailCalls.push(['swapOpened', ...args]); },
    sendSwapWaitlistOffer: async (...args) => { emailCalls.push(['swapWaitlist', ...args]); },
    sendSwapClaimedToOriginal: async (...args) => { emailCalls.push(['swapOrig', ...args]); },
    sendSwapClaimedToClaimer: async (...args) => { emailCalls.push(['swapClaimer', ...args]); },
  },
};

// Clear controller caches so they pick up stubbed email + mock DB.
delete require.cache[require.resolve('../controllers/applicationController')];
delete require.cache[require.resolve('../controllers/swapController')];
delete require.cache[require.resolve('../models/Application')];
delete require.cache[require.resolve('../models/Opportunity')];
delete require.cache[require.resolve('../models/SwapRequest')];
delete require.cache[require.resolve('../models/Qualification')];
delete require.cache[require.resolve('../models/Waiver')];
delete require.cache[require.resolve('../models/VolunteerProfile')];

const { isWithinCancellationCutoff } = require('../utils/cancellationRules');
const appCtrl = require('../controllers/applicationController');
const swapCtrl = require('../controllers/swapController');
const SwapRequest = require('../models/SwapRequest');
const Qualification = require('../models/Qualification');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 2, role: 'volunteer' },
    body: {},
    params: {},
    query: {},
    protocol: 'http',
    get: () => 'localhost:3000',
    ...overrides,
  };
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

test('isWithinCancellationCutoff enforces hours before start', () => {
  const now = new Date('2026-08-11T12:00:00Z');
  assert.strictEqual(
    isWithinCancellationCutoff('2026-08-12T11:00:00Z', 24, now),
    true,
    '23h away is inside 24h cutoff'
  );
  assert.strictEqual(
    isWithinCancellationCutoff('2026-08-13T12:00:00Z', 24, now),
    false,
    '48h away is outside 24h cutoff'
  );
  assert.strictEqual(isWithinCancellationCutoff(null, 24, now), false);
});

test('volunteer cannot cancel accepted application inside cutoff', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM applications a/i.test(sql) && /application_id = \?/i.test(sql)) {
      return [[{
        application_id: 5,
        user_id: 2,
        opportunity_id: 1,
        status: 'accepted',
        email: 'v@x.com',
        opportunity_title: 'Dog Walk',
        opportunity_start_date: hoursFromNow(6),
        cancellation_cutoff_hours: 24,
      }]];
    }
    if (/FROM opportunities/i.test(sql)) {
      return [[{
        opportunity_id: 1,
        title: 'Dog Walk',
        start_date: hoursFromNow(6),
        cancellation_cutoff_hours: 24,
        status: 'open',
        max_volunteers: 2,
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await appCtrl.cancelApplication(makeReq({ params: { id: 5 } }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.must_request_swap, true);
  assert.match(res.body.error, /request a swap/i);
});

test('admin can cancel accepted application inside cutoff', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM applications a/i.test(sql) && /application_id = \?/i.test(sql)) {
      return [[{
        application_id: 5,
        user_id: 2,
        opportunity_id: 1,
        status: 'accepted',
        email: 'v@x.com',
        opportunity_title: 'Dog Walk',
        opportunity_start_date: hoursFromNow(6),
      }]];
    }
    if (/FROM opportunities/i.test(sql)) {
      return [[{
        opportunity_id: 1,
        start_date: hoursFromNow(6),
        cancellation_cutoff_hours: 24,
        status: 'open',
        max_volunteers: 2,
      }]];
    }
    if (/DELETE FROM applications/i.test(sql)) return [{ affectedRows: 1 }];
    if (/UPDATE swap_requests/i.test(sql)) return [{ affectedRows: 0 }];
    if (/status = 'waitlisted'/i.test(sql)) return [[]];
    return [[]];
  });

  const res = makeRes();
  await appCtrl.cancelApplication(
    makeReq({ session: { userId: 1, role: 'admin' }, params: { id: 5 } }),
    res
  );
  assert.strictEqual(res.statusCode, 200);
});

test('opening a swap offers waitlist first before public', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  let inserted = null;
  mock.setHandler(async (sql, params) => {
    if (/FROM applications a/i.test(sql) && /application_id = \?/i.test(sql)) {
      return [[{
        application_id: 5,
        user_id: 2,
        opportunity_id: 1,
        status: 'accepted',
        email: 'orig@x.com',
        opportunity_title: 'Dog Walk',
      }]];
    }
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 1, title: 'Dog Walk', status: 'open' }]];
    }
    if (/FROM swap_requests/i.test(sql) && /application_id = \?/i.test(sql) && /status = 'open'/i.test(sql)) {
      return [[]];
    }
    if (/status = 'waitlisted'/i.test(sql)) {
      return [[{
        application_id: 8,
        user_id: 3,
        opportunity_id: 1,
        status: 'waitlisted',
        email: 'wait@x.com',
        opportunity_title: 'Dog Walk',
        applied_at: '2026-01-01',
      }]];
    }
    if (/INSERT INTO swap_requests/i.test(sql)) {
      inserted = params;
      return [{ insertId: 50 }];
    }
    if (/FROM swap_requests s/i.test(sql) && /s\.id = \?/i.test(sql)) {
      return [[{
        id: 50,
        application_id: 5,
        status: 'open',
        waitlist_offered_to_user_id: 3,
        public_at: null,
        claim_token: 'tok',
        original_user_id: 2,
        opportunity_id: 1,
        opportunity_title: 'Dog Walk',
        application_status: 'accepted',
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await swapCtrl.requestSwap(makeReq({ params: { id: 5 } }), res);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.waitlist_offered, true);
  assert.ok(inserted);
  assert.strictEqual(inserted[2], 3, 'waitlist user id bound');
  assert.ok(inserted[3], 'waitlist expiry set');
  assert.ok(inserted[4], 'claim token set');
  assert.strictEqual(inserted[5], null, 'not public yet');
  assert.ok(emailCalls.some((c) => c[0] === 'swapWaitlist' && c[1] === 'wait@x.com'));
});

test('claim transfers accepted slot atomically', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  const state = {
    swapStatus: 'open',
    originalStatus: 'accepted',
    claimerAppId: null,
  };

  mock.setHandler(async (sql, params) => {
    if (/FOR UPDATE/i.test(sql) && /FROM swap_requests s/i.test(sql)) {
      return [[{
        id: 50,
        application_id: 5,
        status: state.swapStatus,
        public_at: '2026-01-01 00:00:00',
        claim_token: null,
        waitlist_offered_to_user_id: null,
        waitlist_offer_expires_at: null,
        original_user_id: 2,
        opportunity_id: 1,
        application_status: state.originalStatus,
        opportunity_title: 'Dog Walk',
      }]];
    }
    if (/FROM applications/i.test(sql) && /user_id = \? AND opportunity_id = \?/i.test(sql)) {
      return [[]];
    }
    if (/UPDATE applications\s+SET status = 'cancelled'/i.test(sql)) {
      state.originalStatus = 'cancelled';
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO applications/i.test(sql)) {
      state.claimerAppId = 99;
      return [{ insertId: 99 }];
    }
    if (/UPDATE swap_requests\s+SET status = 'claimed'/i.test(sql)) {
      state.swapStatus = 'claimed';
      return [{ affectedRows: 1 }];
    }
    if (/FROM applications a/i.test(sql) && /LEFT JOIN users/i.test(sql)) {
      const id = Number(params[0]);
      if (id === 99) {
        return [[{
          application_id: 99,
          user_id: 7,
          opportunity_id: 1,
          status: 'accepted',
          email: 'claimer@x.com',
          first_name: 'C',
          last_name: 'Laimer',
        }]];
      }
      return [[{
        application_id: 5,
        user_id: 2,
        opportunity_id: 1,
        status: 'cancelled',
        email: 'orig@x.com',
        first_name: 'O',
        last_name: 'Rig',
      }]];
    }
    if (/FROM swap_requests s/i.test(sql) && /s\.id = \?/i.test(sql)) {
      return [[{
        id: 50,
        application_id: 5,
        status: 'claimed',
        claimed_by_application_id: 99,
        original_user_id: 2,
        opportunity_id: 1,
        opportunity_title: 'Dog Walk',
        application_status: 'cancelled',
      }]];
    }
    if (/UPDATE opportunities/i.test(sql) && /activity_notes/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 1, title: 'Dog Walk', activity_notes: 'note' }]];
    }
    return [[]];
  });

  // Stub eligibility helpers used by claimSwap
  const originalMissing = Qualification.findMissingForUser;
  const VolunteerProfile = require('../models/VolunteerProfile');
  const Waiver = require('../models/Waiver');
  const originalProfile = VolunteerProfile.findByUserId;
  const originalWaivers = Waiver.findPendingForUser;
  Qualification.findMissingForUser = async () => [];
  VolunteerProfile.findByUserId = async () => ({ user_id: 7, approved: 1 });
  Waiver.findPendingForUser = async () => [];

  mock.setHandler(async (sql, params) => {
    if (/FROM swap_requests s/i.test(sql) && /s\.id = \?/i.test(sql) && !/FOR UPDATE/i.test(sql)) {
      return [[{
        id: 50,
        application_id: 5,
        status: state.swapStatus,
        public_at: '2026-01-01 00:00:00',
        original_user_id: 2,
        opportunity_id: 1,
        opportunity_title: 'Dog Walk',
        application_status: state.originalStatus,
      }]];
    }
    if (/UPDATE swap_requests\s+SET public_at/i.test(sql)) return [{ affectedRows: 0 }];
    if (/FOR UPDATE/i.test(sql) && /FROM swap_requests s/i.test(sql)) {
      return [[{
        id: 50,
        application_id: 5,
        status: state.swapStatus,
        public_at: '2026-01-01 00:00:00',
        claim_token: null,
        waitlist_offered_to_user_id: null,
        waitlist_offer_expires_at: null,
        original_user_id: 2,
        opportunity_id: 1,
        application_status: state.originalStatus,
        opportunity_title: 'Dog Walk',
      }]];
    }
    if (/FROM applications/i.test(sql) && /user_id = \? AND opportunity_id = \?/i.test(sql)) {
      return [[]];
    }
    if (/UPDATE applications\s+SET status = 'cancelled'/i.test(sql)) {
      state.originalStatus = 'cancelled';
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO applications/i.test(sql)) {
      state.claimerAppId = 99;
      return [{ insertId: 99 }];
    }
    if (/UPDATE swap_requests\s+SET status = 'claimed'/i.test(sql)) {
      state.swapStatus = 'claimed';
      return [{ affectedRows: 1 }];
    }
    if (/FROM applications a/i.test(sql) && /LEFT JOIN users/i.test(sql)) {
      const id = Number(params[0]);
      if (id === 99) {
        return [[{
          application_id: 99,
          user_id: 7,
          opportunity_id: 1,
          status: 'accepted',
          email: 'claimer@x.com',
          first_name: 'C',
          last_name: 'Laimer',
        }]];
      }
      return [[{
        application_id: 5,
        user_id: 2,
        opportunity_id: 1,
        status: 'cancelled',
        email: 'orig@x.com',
        first_name: 'O',
        last_name: 'Rig',
      }]];
    }
    if (/UPDATE opportunities/i.test(sql) && /activity_notes/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 1, title: 'Dog Walk', activity_notes: 'note' }]];
    }
    return [[]];
  });

  try {
    const res = makeRes();
    await swapCtrl.claimSwap(
      makeReq({ session: { userId: 7, role: 'volunteer' }, params: { id: 50 } }),
      res
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(state.originalStatus, 'cancelled');
    assert.strictEqual(state.swapStatus, 'claimed');
    assert.strictEqual(state.claimerAppId, 99);
    assert.ok(emailCalls.some((c) => c[0] === 'swapOrig'));
    assert.ok(emailCalls.some((c) => c[0] === 'swapClaimer'));
    assert.ok(mock.calls.some((c) => /BEGIN/i.test(c.sql) === false && /activity_notes/i.test(c.sql)));
  } finally {
    Qualification.findMissingForUser = originalMissing;
    VolunteerProfile.findByUserId = originalProfile;
    Waiver.findPendingForUser = originalWaivers;
  }
});

test('unqualified claimer is rejected', async () => {
  mock.resetCalls();
  const VolunteerProfile = require('../models/VolunteerProfile');
  const Waiver = require('../models/Waiver');
  const originalMissing = Qualification.findMissingForUser;
  const originalProfile = VolunteerProfile.findByUserId;
  const originalWaivers = Waiver.findPendingForUser;

  Qualification.findMissingForUser = async () => [{ id: 1, name: 'Dog Handling' }];
  VolunteerProfile.findByUserId = async () => ({ user_id: 7, approved: 1 });
  Waiver.findPendingForUser = async () => [];

  mock.setHandler(async () => [[{
    id: 50,
    application_id: 5,
    status: 'open',
    public_at: '2026-01-01 00:00:00',
    original_user_id: 2,
    opportunity_id: 1,
    opportunity_title: 'Dog Walk',
    application_status: 'accepted',
  }]]);

  try {
    const res = makeRes();
    await swapCtrl.claimSwap(
      makeReq({ session: { userId: 7, role: 'volunteer' }, params: { id: 50 } }),
      res
    );
    assert.strictEqual(res.statusCode, 403);
    assert.match(res.body.error, /missing required qualifications/i);
    assert.ok(Array.isArray(res.body.missing_qualifications));
  } finally {
    Qualification.findMissingForUser = originalMissing;
    VolunteerProfile.findByUserId = originalProfile;
    Waiver.findPendingForUser = originalWaivers;
  }
});

test('publishExpiredWaitlistOffers makes swap public', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [{ affectedRows: 2 }]);
  const n = await SwapRequest.publishExpiredWaitlistOffers(new Date('2026-08-11T12:00:00Z'));
  assert.strictEqual(n, 2);
  assert.match(mock.lastCall().sql, /SET public_at/i);
});
