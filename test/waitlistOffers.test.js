'use strict';

/**
 * SL-LATER-23: timed waitlist seat offers when a place frees.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.EMAIL_HOST = 'smtp.test.invalid';
process.env.EMAIL_FROM = 'ShelterLink <test@example.com>';
process.env.APP_URL = 'https://shelterlink.test';

const mock = require('./helpers/mockDb');

const emailCalls = [];
const emailPath = require.resolve('../utils/emailService');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async () => {},
    sendWaitlistSeatOffer: async (...args) => {
      emailCalls.push(['seatOffer', ...args]);
    },
    sendWaitlistPromotion: async (...args) => {
      emailCalls.push(['promote', ...args]);
    },
    sendBookingConfirmed: async (...args) => {
      emailCalls.push(['booked', ...args]);
    },
    isEmailConfigured: () => true,
  },
};

const claims = [];
const jobRuns = [];
const jobLogPath = require.resolve('../utils/jobLog');
require.cache[jobLogPath] = {
  id: jobLogPath,
  filename: jobLogPath,
  loaded: true,
  exports: {
    recordJobRun: async (name, status, detail) => {
      jobRuns.push({ name, status, detail });
      return jobRuns.length;
    },
    claimJobRun: async (name, runKey) => {
      const key = `${name}:${runKey}`;
      if (claims.includes(key)) return false;
      claims.push(key);
      return true;
    },
  },
};

const eligibilityPath = require.resolve('../utils/waitlistEligibility');
let eligibilityByUser = new Map();
require.cache[eligibilityPath] = {
  id: eligibilityPath,
  filename: eligibilityPath,
  loaded: true,
  exports: {
    isEligibleForWaitlistOffer: async (userId) => {
      if (eligibilityByUser.has(Number(userId))) {
        return eligibilityByUser.get(Number(userId));
      }
      return { ok: true };
    },
  },
};

const BookingPolicy = require('../models/BookingPolicy');
const originalGetMode = BookingPolicy.getMode;
const originalIsTrusted = BookingPolicy.isTrusted;
let bookingMode = 'instant';
let trustedIds = new Set([3]);
BookingPolicy.getMode = async () => bookingMode;
BookingPolicy.isTrusted = async (userId) => trustedIds.has(Number(userId));

const waitlistOffers = require('../utils/waitlistOffers');
const { runWaitlistOffers } = require('../jobs/waitlistOffers');
const { notifyWaitlistSeatOffer } = require('../utils/notify');
const { TENANT_TABLES } = require('../utils/shelterContext');
const { rowInQuietHours } = require('../utils/quietHours');

function resetState() {
  emailCalls.length = 0;
  claims.length = 0;
  jobRuns.length = 0;
  eligibilityByUser = new Map();
  bookingMode = 'instant';
  trustedIds = new Set([3]);
  mock.resetCalls();
}

function offerWorld({
  apps = [],
  offers = [],
  max = 1,
  accepted = 0,
  quiet = null,
} = {}) {
  const db = {
    apps: apps.map((a) => ({ ...a })),
    offers: offers.map((o) => ({ ...o })),
    nextOfferId: 10,
    max,
    accepted,
  };

  mock.setHandler(async (sql, params = []) => {
    const q = String(sql);

    if (/FROM waitlist_offers[\s\S]*status = 'offered'[\s\S]*opportunity_id/i.test(q)
      || (/FROM waitlist_offers/i.test(q) && /status = 'offered'/i.test(q) && /opportunity_id = \?/i.test(q) && /SELECT \*/i.test(q))) {
      const oppId = Number(params[0]);
      const active = db.offers.find((o) => o.opportunity_id === oppId && o.status === 'offered');
      return [active ? [active] : []];
    }

    if (/INSERT INTO waitlist_offers/i.test(q)) {
      const row = {
        id: db.nextOfferId,
        opportunity_id: Number(params[0]),
        application_id: Number(params[1]),
        user_id: Number(params[2]),
        claim_token: params[3],
        status: 'offered',
        offered_at: '2026-11-23 10:00:00',
        notified_at: null,
        expires_at: null,
        email: `v${params[2]}@x.com`,
        opportunity_title: 'Dog Walk',
        quiet_hours_start: quiet ? quiet.start : null,
        quiet_hours_end: quiet ? quiet.end : null,
      };
      db.nextOfferId += 1;
      db.offers.push(row);
      return [{ insertId: row.id }];
    }

    if (/FROM waitlist_offers WHERE id = \?/i.test(q)) {
      const row = db.offers.find((o) => o.id === Number(params[0]));
      return [row ? [row] : []];
    }

    if (/SET notified_at/i.test(q)) {
      const row = db.offers.find((o) => o.id === Number(params[2]));
      if (!row || row.notified_at) return [{ affectedRows: 0 }];
      row.notified_at = params[0];
      row.expires_at = params[1];
      return [{ affectedRows: 1 }];
    }

    if (/SET status = 'claimed'/i.test(q)) {
      const row = db.offers.find((o) => o.id === Number(params[1]));
      if (!row || row.status !== 'offered') return [{ affectedRows: 0 }];
      row.status = 'claimed';
      row.claimed_at = params[0];
      return [{ affectedRows: 1 }];
    }

    if (/SET status = 'expired'/i.test(q)) {
      const row = db.offers.find((o) => o.id === Number(params[0]));
      if (!row || row.status !== 'offered') return [{ affectedRows: 0 }];
      row.status = 'expired';
      return [{ affectedRows: 1 }];
    }

    if (/w\.claim_token = \?/i.test(q)) {
      const row = db.offers.find((o) => o.claim_token === params[0] && o.status === 'offered');
      if (!row) return [[]];
      const app = db.apps.find((a) => a.application_id === row.application_id);
      return [[{
        ...row,
        opportunity_title: 'Dog Walk',
        max_volunteers: db.max,
        opportunity_status: 'open',
        application_status: app ? app.status : 'waitlisted',
      }]];
    }

    if (/w\.status = 'offered'[\s\S]*notified_at IS NULL/i.test(q)
      || (/notified_at IS NULL/i.test(q) && /waitlist_offers/i.test(q))) {
      return [db.offers
        .filter((o) => o.status === 'offered' && !o.notified_at)
        .map((o) => ({
          ...o,
          email: `v${o.user_id}@x.com`,
          opportunity_title: 'Dog Walk',
          quiet_hours_start: quiet ? quiet.start : o.quiet_hours_start,
          quiet_hours_end: quiet ? quiet.end : o.quiet_hours_end,
        }))];
    }

    if (/expires_at IS NOT NULL[\s\S]*expires_at <=/i.test(q)) {
      const now = new Date(params[0]);
      return [db.offers.filter(
        (o) => o.status === 'offered' && o.expires_at && new Date(o.expires_at) <= now
      )];
    }

    if (/FROM opportunities o[\s\S]*max_volunteers/i.test(q) && /NOT EXISTS/i.test(q)) {
      return [[]];
    }

    if (/AS current_count/i.test(q)) {
      return [[{ current_count: db.accepted }]];
    }

    if (/FROM opportunities/i.test(q) && /opportunity_id = \?/i.test(q)) {
      return [[{
        opportunity_id: 1,
        id: 1,
        title: 'Dog Walk',
        status: 'open',
        max_volunteers: db.max,
        start_date: '2026-12-01 10:00:00',
        required_background_check_type: null,
      }]];
    }

    if (/status = 'waitlisted'/i.test(q) && /ORDER BY a\.applied_at/i.test(q)) {
      const list = db.apps
        .filter((a) => a.status === 'waitlisted' && a.opportunity_id === Number(params[0]))
        .sort((a, b) => String(a.applied_at).localeCompare(String(b.applied_at))
          || a.application_id - b.application_id)
        .map((a) => ({
          ...a,
          email: `v${a.user_id}@x.com`,
          opportunity_title: 'Dog Walk',
          quiet_hours_start: quiet ? quiet.start : null,
          quiet_hours_end: quiet ? quiet.end : null,
        }));
      const limit = Number(params[1]) || list.length;
      return [list.slice(0, limit)];
    }

    if (/UPDATE applications[\s\S]*status = \?[\s\S]*pending', 'waitlisted'/i.test(q)
      || /UPDATE applications\s+SET status = \?\s+WHERE application_id = \?\s+AND opportunity_id/i.test(q)) {
      const row = db.apps.find((a) => a.application_id === Number(params[1]));
      if (!row || !['pending', 'waitlisted'].includes(row.status)) return [{ affectedRows: 0 }];
      row.status = params[0];
      if (params[0] === 'accepted') db.accepted += 1;
      return [{ affectedRows: 1 }];
    }

    if (/UPDATE applications SET status = \? WHERE application_id = \?/i.test(q)) {
      const row = db.apps.find((a) => a.application_id === Number(params[1]));
      if (!row) return [{ affectedRows: 0 }];
      row.status = params[0];
      return [{ affectedRows: 1 }];
    }

    if (/FROM applications a/i.test(q) && /application_id = \?/i.test(q)) {
      const row = db.apps.find((a) => a.application_id === Number(params[0]));
      if (!row) return [[]];
      return [[{
        ...row,
        email: `v${row.user_id}@x.com`,
        opportunity_title: 'Dog Walk',
      }]];
    }

    if (/FROM users WHERE user_id/i.test(q) || /FROM users\s+WHERE user_id/i.test(q)) {
      return [[{ user_id: params[0], email: `v${params[0]}@x.com` }]];
    }

    if (/FROM volunteer_profiles/i.test(q)) {
      return [[{
        user_id: params[0],
        approved: 1,
        quiet_hours_start: quiet ? quiet.start : null,
        quiet_hours_end: quiet ? quiet.end : null,
      }]];
    }

    if (/FOR UPDATE/i.test(q) && /FROM opportunities/i.test(q)) {
      return [[{ opportunity_id: 1, max_volunteers: db.max }]];
    }

    if (/UPDATE opportunities SET status/i.test(q)) {
      return [{ affectedRows: 1 }];
    }

    return [[]];
  });

  return db;
}

test('offerNextWaitlisted creates an offer for the first eligible waitlisted volunteer', async () => {
  resetState();
  eligibilityByUser.set(3, { ok: false, reason: 'age' });
  eligibilityByUser.set(4, { ok: true });
  const db = offerWorld({
    accepted: 0,
    max: 1,
    apps: [
      { application_id: 2, user_id: 3, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-01' },
      { application_id: 3, user_id: 4, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-02' },
    ],
  });

  const offer = await waitlistOffers.offerNextWaitlisted(1, { now: new Date('2026-11-23T12:00:00Z') });
  assert.ok(offer);
  assert.equal(offer.user_id, 4);
  assert.equal(db.offers.length, 1);
  assert.equal(db.apps.find((a) => a.application_id === 2).status, 'waitlisted');
  assert.equal(emailCalls.filter((c) => c[0] === 'seatOffer').length, 1);
  assert.ok(String(emailCalls[0][2].claimLink).includes('claim-waitlist.html?token='));
  assert.ok(db.offers[0].notified_at);
  assert.ok(db.offers[0].expires_at);
});

test('quiet hours delay notify and leave the claim clock unset', async () => {
  resetState();
  const db = offerWorld({
    accepted: 0,
    max: 1,
    quiet: { start: '22:00', end: '08:00' },
    apps: [
      { application_id: 2, user_id: 3, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-01' },
    ],
  });

  // 23:00 local-equivalent UTC for the quiet-hours helper (uses Date hours).
  const night = new Date('2026-11-23T23:30:00');
  assert.equal(rowInQuietHours({ quiet_hours_start: '22:00', quiet_hours_end: '08:00' }, night), true);

  const offer = await waitlistOffers.offerNextWaitlisted(1, { now: night });
  assert.ok(offer);
  assert.equal(db.offers[0].notified_at, null);
  assert.equal(db.offers[0].expires_at, null);
  assert.equal(emailCalls.length, 0);
});

test('notifyWaitlistSeatOffer skips quiet hours', async () => {
  resetState();
  const result = await notifyWaitlistSeatOffer(
    {
      user_id: 3,
      email: 'v3@x.com',
      quiet_hours_start: '22:00',
      quiet_hours_end: '08:00',
    },
    { title: 'Dog Walk', claimLink: 'https://x/claim', hours: 12 },
    { now: new Date('2026-11-23T23:00:00') }
  );
  assert.equal(result.skipReason, 'quiet_hours');
  assert.equal(result.delivered, false);
});

test('claim confirms a trusted volunteer in instant mode', async () => {
  resetState();
  bookingMode = 'instant';
  trustedIds = new Set([3]);
  const db = offerWorld({
    accepted: 0,
    max: 1,
    apps: [
      { application_id: 2, user_id: 3, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-01' },
    ],
    offers: [{
      id: 9,
      opportunity_id: 1,
      application_id: 2,
      user_id: 3,
      claim_token: 'tok-claim',
      status: 'offered',
      notified_at: '2026-11-23 10:00:00',
      expires_at: '2026-11-24 10:00:00',
    }],
  });

  const result = await waitlistOffers.claimOfferByToken('tok-claim', 3);
  assert.equal(result.error, undefined);
  assert.equal(result.confirmed, true);
  assert.equal(result.status, 'accepted');
  assert.equal(db.apps[0].status, 'accepted');
  assert.equal(db.offers[0].status, 'claimed');
});

test('claim moves an untrusted volunteer to pending in instant mode', async () => {
  resetState();
  bookingMode = 'instant';
  trustedIds = new Set();
  const db = offerWorld({
    accepted: 0,
    max: 1,
    apps: [
      { application_id: 2, user_id: 3, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-01' },
    ],
    offers: [{
      id: 9,
      opportunity_id: 1,
      application_id: 2,
      user_id: 3,
      claim_token: 'tok-pending',
      status: 'offered',
      notified_at: '2026-11-23 10:00:00',
      expires_at: '2026-11-24 10:00:00',
    }],
  });

  const result = await waitlistOffers.claimOfferByToken('tok-pending', 3);
  assert.equal(result.confirmed, false);
  assert.equal(result.status, 'pending');
  assert.equal(db.apps[0].status, 'pending');
});

test('expired offer cascades to the next eligible volunteer', async () => {
  resetState();
  const db = offerWorld({
    accepted: 0,
    max: 1,
    apps: [
      { application_id: 2, user_id: 3, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-01' },
      { application_id: 3, user_id: 4, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-02' },
    ],
    offers: [{
      id: 9,
      opportunity_id: 1,
      application_id: 2,
      user_id: 3,
      claim_token: 'old',
      status: 'offered',
      notified_at: '2026-11-22 10:00:00',
      expires_at: '2026-11-22 22:00:00',
    }],
  });

  const result = await waitlistOffers.expireAndCascade(new Date('2026-11-23T12:00:00Z'));
  assert.equal(result.expired, 1);
  assert.equal(result.cascaded, 1);
  assert.equal(db.offers.find((o) => o.id === 9).status, 'expired');
  assert.equal(db.offers.filter((o) => o.status === 'offered').length, 1);
  assert.equal(db.offers.find((o) => o.status === 'offered').user_id, 4);
});

test('job_runs claim prevents duplicate notify', async () => {
  resetState();
  const db = offerWorld({
    accepted: 0,
    max: 1,
    apps: [
      { application_id: 2, user_id: 3, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-01' },
    ],
    offers: [{
      id: 9,
      opportunity_id: 1,
      application_id: 2,
      user_id: 3,
      claim_token: 'tok',
      status: 'offered',
      notified_at: null,
      expires_at: null,
      email: 'v3@x.com',
      opportunity_title: 'Dog Walk',
    }],
  });

  const first = await waitlistOffers.tryNotifyOffer(db.offers[0], new Date('2026-11-23T12:00:00Z'));
  assert.equal(first.notified, true);
  const second = await waitlistOffers.tryNotifyOffer(db.offers[0], new Date('2026-11-23T12:00:00Z'));
  assert.equal(second.skipped, true);
  assert.equal(emailCalls.filter((c) => c[0] === 'seatOffer').length, 1);
});

test('waitlistOffers job records a job_runs detail line', async () => {
  resetState();
  offerWorld({ apps: [], offers: [] });
  const detail = await runWaitlistOffers(new Date('2026-11-23T12:05:00Z'));
  assert.match(String(detail), /notified=/);
  assert.equal(jobRuns.length, 1);
  assert.equal(jobRuns[0].name, 'waitlistOffers');
});

test('migration 054 and schema define waitlist_offers as a tenant table', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'database', '054_waitlist_offers.pg.sql'),
    'utf8'
  );
  const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.pg.sql'), 'utf8');
  const setupDb = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS waitlist_offers/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /waitlist_offers_one_active_per_opportunity/);
  assert.match(schema, /CREATE TABLE waitlist_offers/);
  assert.ok(TENANT_TABLES.includes('waitlist_offers'));
  assert.match(setupDb, /054_waitlist_offers\.pg\.sql/);
});

test('claim route and page exist', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'applications.js'), 'utf8');
  assert.match(routes, /waitlist\/claim-by-token/);
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'frontend', 'pages', 'volunteer', 'claim-waitlist.html'))
  );
  const jobs = fs.readFileSync(path.join(__dirname, '..', 'jobs', 'index.js'), 'utf8');
  assert.match(jobs, /waitlistOffers/);
});

test.after(() => {
  BookingPolicy.getMode = originalGetMode;
  BookingPolicy.isTrusted = originalIsTrusted;
});
