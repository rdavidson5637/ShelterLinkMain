'use strict';
// SL-NOW-03: per-shelter booking approval, instant booking for trusted
// volunteers, and waitlist auto-fill to confirmed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const emailCalls = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async (...args) => { emailCalls.push(['sendEmail', ...args]); },
    sendApplicationConfirmation: async (...args) => { emailCalls.push(['confirm', ...args]); },
    sendApplicationApproval: async (...args) => { emailCalls.push(['approval', ...args]); },
    sendApplicationCancellation: async (...args) => { emailCalls.push(['cancel', ...args]); },
    sendApplicationRejection: async (...args) => { emailCalls.push(['reject', ...args]); },
    sendWaitlistPromotion: async (...args) => { emailCalls.push(['promote', ...args]); },
    sendBookingConfirmed: async (...args) => { emailCalls.push(['booked', ...args]); },
    sendHoursApproval: async () => {},
    sendVolunteerApprovalNotification: async () => {},
  },
};

// SL-LATER-23: seat frees create timed offers. Stub the orchestrator here so
// booking-policy tests stay focused on apply/trust; claim behaviour is covered
// in test/waitlistOffers.test.js.
const offerCalls = [];
const waitlistOffersPath = require.resolve('../utils/waitlistOffers');
require.cache[waitlistOffersPath] = {
  id: waitlistOffersPath,
  filename: waitlistOffersPath,
  loaded: true,
  exports: {
    offerNextWaitlisted: async (opportunityId) => {
      offerCalls.push(['offer', opportunityId]);
      return { id: offerCalls.length, opportunity_id: opportunityId, status: 'offered' };
    },
    fillFromWaitlist: async (opportunityId) => {
      offerCalls.push(['fill', opportunityId]);
      return [{ id: offerCalls.length, opportunity_id: opportunityId, status: 'offered' }];
    },
    claimOfferByToken: async () => ({ error: 'not stubbed', status: 500 }),
  },
};

const appCtrl = require('../controllers/applicationController');
const policyCtrl = require('../controllers/bookingPolicyController');
const policy = require('../utils/bookingPolicy');
const { runWithShelter, TENANT_TABLES } = require('../utils/shelterContext');
const { bodies } = require('../validation/bodies');

const SHELTER = 1;

function resetOffers() {
  offerCalls.length = 0;
  emailCalls.length = 0;
}

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/**
 * Small in-memory stand-in for the tables these flows touch. Every query is
 * matched by shape, the same way the other controller tests do it.
 */
function world({
  mode = null,
  trusted = [],
  max = 5,
  apps = [],
  approvedProfiles = [2, 3, 4],
  oppStatus = 'open',
  countFor = null,
} = {}) {
  const db = {
    mode,
    trusted: new Set(trusted),
    max,
    apps: apps.map((a) => ({ ...a })),
    nextId: 100,
    policyQueries: [],
  };
  const accepted = () => db.apps.filter((a) => a.status === 'accepted').length;
  const appRow = (a) => ({
    ...a,
    id: a.application_id,
    email: `v${a.user_id}@x.com`,
    opportunity_title: 'Dog Walk',
    title: 'Dog Walk',
    applied_at: a.applied_at || '2026-11-01',
  });

  mock.resetCalls();
  mock.setHandler(async (sql, params = []) => {
    const q = String(sql);
    if (/FROM\s+shelter_booking_policy/i.test(q)) {
      db.policyQueries.push(params);
      assert.equal(params[0], SHELTER, 'policy is read for the current shelter');
      return [db.mode ? [{ booking_mode: db.mode, updated_at: 'now' }] : []];
    }
    if (/INSERT INTO shelter_booking_policy/i.test(q)) {
      assert.equal(params[0], SHELTER);
      db.mode = params[1];
      return [{ affectedRows: 1 }];
    }
    if (/DELETE FROM trusted_volunteers/i.test(q)) {
      const had = db.trusted.delete(Number(params[1]));
      return [{ affectedRows: had ? 1 : 0 }];
    }
    if (/FROM\s+trusted_volunteers t/i.test(q)) {
      return [[...db.trusted].map((id) => ({ user_id: id, first_name: 'Vol', last_name: String(id), email: `v${id}@x.com` }))];
    }
    if (/FROM\s+trusted_volunteers/i.test(q)) {
      assert.equal(params[0], SHELTER, 'trust is read for the current shelter');
      return [db.trusted.has(Number(params[1])) ? [{ user_id: params[1] }] : []];
    }
    if (/INSERT INTO trusted_volunteers/i.test(q)) {
      db.trusted.add(Number(params[1]));
      return [{ affectedRows: 1 }];
    }
    if (/FROM\s+users\s+WHERE user_id/i.test(q)) {
      const id = Number(params[0]);
      if (id === 50) return [[{ user_id: 50, role: 'staff', email: 's@x.com' }]];
      if (id === 404) return [[]];
      return [[{ user_id: id, role: 'volunteer', email: `v${id}@x.com` }]];
    }
    if (/FROM\s+volunteer_profiles/i.test(q)) {
      const id = Number(params[0]);
      return [[{ user_id: id, approved: approvedProfiles.includes(id) ? 1 : 0, user_email: `v${id}@x.com` }]];
    }
    if (/AS current_count/i.test(q)) {
      db.countReads = (db.countReads || 0) + 1;
      const n = countFor ? countFor(db.countReads, accepted()) : accepted();
      return [[{ current_count: n }]];
    }
    if (/FROM opportunities/i.test(q) && /opportunity_id = \?/i.test(q)) {
      return [[{
        opportunity_id: 1,
        id: 1,
        title: 'Dog Walk',
        status: oppStatus,
        max_volunteers: db.max,
        required_background_check_type: null,
      }]];
    }
    if (/application_id, status\s+FROM applications/i.test(q)) {
      const found = db.apps.find((a) => a.user_id === Number(params[0]) && a.opportunity_id === Number(params[1]));
      return [found ? [found] : []];
    }
    if (/INSERT INTO applications/i.test(q)) {
      const row = { application_id: db.nextId, user_id: Number(params[0]), opportunity_id: Number(params[1]), status: params[2] };
      db.nextId += 1;
      db.apps.push(row);
      return [{ insertId: row.application_id }];
    }
    if (/UPDATE applications\s+SET status = \?\s+WHERE application_id = \?\s+AND opportunity_id/i.test(q)) {
      const row = db.apps.find((a) => a.application_id === Number(params[1]));
      if (!row || !['pending', 'waitlisted'].includes(row.status)) return [{ affectedRows: 0 }];
      row.status = params[0];
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE applications SET status = \? WHERE application_id = \?/i.test(q)) {
      const row = db.apps.find((a) => a.application_id === Number(params[1]));
      if (!row) return [{ affectedRows: 0 }];
      row.status = params[0];
      return [{ affectedRows: 1 }];
    }
    if (/DELETE FROM applications/i.test(q)) {
      const idx = db.apps.findIndex((a) => a.application_id === Number(params[0]));
      if (idx < 0) return [{ affectedRows: 0 }];
      db.apps.splice(idx, 1);
      return [{ affectedRows: 1 }];
    }
    if (/AND a\.status = 'waitlisted'/i.test(q)) {
      const oldest = db.apps
        .filter((a) => a.status === 'waitlisted')
        .sort((a, b) => String(a.applied_at).localeCompare(String(b.applied_at)) || a.application_id - b.application_id)[0];
      return [oldest ? [appRow(oldest)] : []];
    }
    if (/FROM applications a/i.test(q) && /application_id = \?/i.test(q)) {
      const row = db.apps.find((a) => a.application_id === Number(params[0]));
      return [row ? [appRow(row)] : []];
    }
    return [[]];
  });
  return db;
}

function apply(userId) {
  const res = makeRes();
  const req = { session: { userId, role: 'volunteer' }, body: { opportunityId: 1 }, params: {}, query: {} };
  return runWithShelter(SHELTER, () => appCtrl.applyForOpportunity(req, res)).then(() => res);
}

function cancelAsAdmin(applicationId) {
  const res = makeRes();
  const req = { session: { userId: 1, role: 'admin' }, body: {}, params: { id: applicationId }, query: {} };
  return runWithShelter(SHELTER, () => appCtrl.cancelApplication(req, res)).then(() => res);
}

function emailsOf(kind) {
  return emailCalls.filter((c) => c[0] === kind);
}

test.beforeEach(() => {
  emailCalls.length = 0;
});

// ---------------------------------------------------------------------------
// Pure policy rules
// ---------------------------------------------------------------------------

test('policy: approval is the default and unknown modes fall back to it', () => {
  assert.equal(policy.DEFAULT_MODE, 'approval');
  assert.equal(policy.normaliseMode(null), 'approval');
  assert.equal(policy.normaliseMode('INSTANT'), 'instant');
  assert.equal(policy.normaliseMode('auto'), 'approval');
  assert.equal(policy.isValidMode('auto'), false);
});

test('policy: only a trusted volunteer in instant mode books instantly', () => {
  assert.equal(policy.initialStatus({ mode: 'approval', trusted: true, isFull: false }), 'pending');
  assert.equal(policy.initialStatus({ mode: 'instant', trusted: false, isFull: false }), 'pending');
  assert.equal(policy.initialStatus({ mode: 'instant', trusted: true, isFull: false }), 'accepted');
  assert.equal(policy.initialStatus({ mode: 'instant', trusted: true, isFull: true }), 'waitlisted');
  assert.equal(policy.initialStatus({ mode: 'approval', trusted: false, isFull: true }), 'waitlisted');
  // A truthy non-boolean is not trust.
  assert.equal(policy.initialStatus({ mode: 'instant', trusted: 1, isFull: false }), 'pending');
});

test('policy: waitlist promotion confirms only trusted and still-eligible volunteers', () => {
  assert.equal(policy.promotionStatus({ mode: 'approval', trusted: true, eligible: true }), 'pending');
  assert.equal(policy.promotionStatus({ mode: 'instant', trusted: false, eligible: true }), 'pending');
  assert.equal(policy.promotionStatus({ mode: 'instant', trusted: true, eligible: false }), 'pending');
  assert.equal(policy.promotionStatus({ mode: 'instant', trusted: true, eligible: true }), 'accepted');
});

// ---------------------------------------------------------------------------
// Mode (a): every booking needs approval
// ---------------------------------------------------------------------------

test('approval mode: a trusted volunteer still waits for staff', async () => {
  const db = world({ mode: 'approval', trusted: [2] });
  const res = await apply(2);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.status, 'pending');
  assert.equal(db.apps[0].status, 'pending');
  assert.equal(emailsOf('confirm').length, 1);
  assert.equal(emailsOf('booked').length, 0);
});

test('approval mode is the default when the shelter has no policy row', async () => {
  const db = world({ mode: null, trusted: [2] });
  const res = await apply(2);
  assert.equal(res.body.status, 'pending');
  assert.equal(db.policyQueries.length, 1);
});

test('approval mode: freed seat starts a timed waitlist offer (claim later)', async () => {
  resetOffers();
  const db = world({
    mode: 'approval',
    trusted: [3],
    max: 1,
    apps: [
      { application_id: 1, user_id: 2, opportunity_id: 1, status: 'accepted' },
      { application_id: 2, user_id: 3, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-02' },
    ],
  });
  const res = await cancelAsAdmin(1);
  assert.equal(res.statusCode, 200);
  // Status stays waitlisted until the volunteer claims the offer.
  assert.equal(db.apps.find((a) => a.application_id === 2).status, 'waitlisted');
  assert.ok(offerCalls.some((c) => c[0] === 'fill' && c[1] === 1));
  assert.equal(emailsOf('booked').length, 0);
});

// ---------------------------------------------------------------------------
// Mode (b): trusted volunteers book instantly, waitlist auto-fills
// ---------------------------------------------------------------------------

test('instant mode: trusted volunteer with a free seat is confirmed straight away', async () => {
  const db = world({ mode: 'instant', trusted: [2] });
  const res = await apply(2);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.status, 'accepted');
  assert.match(res.body.message, /booked/i);
  assert.equal(db.apps[0].status, 'accepted');
  assert.equal(emailsOf('booked').length, 1);
  assert.equal(emailsOf('confirm').length, 0);
  // The seat claim locks the opportunity row.
  assert.ok(mock.calls.some((c) => /FOR UPDATE/.test(c.sql) && /FROM opportunities/.test(c.sql)));
});

test('instant mode: volunteer who is not trusted still waits for staff', async () => {
  const db = world({ mode: 'instant', trusted: [3] });
  const res = await apply(2);
  assert.equal(res.body.status, 'pending');
  assert.equal(db.apps[0].status, 'pending');
});

test('instant mode: trusted volunteer joins the waitlist when the shift is full', async () => {
  const db = world({
    mode: 'instant',
    trusted: [3],
    max: 1,
    apps: [{ application_id: 1, user_id: 2, opportunity_id: 1, status: 'accepted' }],
  });
  const res = await apply(3);
  assert.equal(res.body.status, 'waitlisted');
  assert.equal(db.apps.find((a) => a.user_id === 3).status, 'waitlisted');
});

test('instant mode: losing the race for the last seat lands on the waitlist, never over capacity', async () => {
  // The pre-check sees a free seat; by the time the locked claim counts, an
  // earlier booking has taken it.
  const db = world({
    mode: 'instant',
    trusted: [2],
    max: 1,
    countFor: (read, real) => (read === 1 ? 0 : Math.max(real, 1)),
  });
  const res = await apply(2);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.status, 'waitlisted');
  assert.equal(db.apps[0].status, 'waitlisted');
  assert.equal(emailsOf('booked').length, 0);
});

test('instant mode: freed seat offers the waitlist place instead of auto-confirming', async () => {
  resetOffers();
  const db = world({
    mode: 'instant',
    trusted: [3, 4],
    max: 1,
    apps: [
      { application_id: 1, user_id: 2, opportunity_id: 1, status: 'accepted' },
      { application_id: 2, user_id: 3, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-02' },
      { application_id: 3, user_id: 4, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-03' },
    ],
  });
  const res = await cancelAsAdmin(1);
  assert.equal(res.statusCode, 200);
  assert.equal(db.apps.find((a) => a.application_id === 2).status, 'waitlisted');
  assert.equal(db.apps.find((a) => a.application_id === 3).status, 'waitlisted');
  assert.ok(offerCalls.some((c) => c[0] === 'fill' && c[1] === 1));
  assert.equal(emailsOf('booked').length, 0);
});

test('instant mode: raising capacity starts one timed waitlist offer', async () => {
  resetOffers();
  world({
    mode: 'instant',
    trusted: [3, 4],
    max: 3,
    apps: [
      { application_id: 1, user_id: 2, opportunity_id: 1, status: 'accepted' },
      { application_id: 2, user_id: 3, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-02' },
      { application_id: 3, user_id: 4, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-03' },
    ],
  });
  const offered = await runWithShelter(SHELTER, () => appCtrl.fillFromWaitlist(1));
  assert.equal(offered.length, 1);
  assert.equal(offered[0].status, 'offered');
  assert.ok(offerCalls.some((c) => c[0] === 'fill'));
});

test('approval mode: raising capacity starts one timed waitlist offer', async () => {
  resetOffers();
  world({
    mode: 'approval',
    trusted: [3, 4],
    max: 3,
    apps: [
      { application_id: 1, user_id: 2, opportunity_id: 1, status: 'accepted' },
      { application_id: 2, user_id: 3, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-02' },
      { application_id: 3, user_id: 4, opportunity_id: 1, status: 'waitlisted', applied_at: '2026-11-03' },
    ],
  });
  const offered = await runWithShelter(SHELTER, () => appCtrl.fillFromWaitlist(1));
  assert.equal(offered.length, 1);
  assert.equal(offered[0].status, 'offered');
});

test('policy read failure fails safe to staff approval', async () => {
  world({ mode: 'instant', trusted: [2] });
  const BookingPolicy = require('../models/BookingPolicy');
  const original = BookingPolicy.getMode;
  BookingPolicy.getMode = async () => { throw new Error('boom'); };
  try {
    const res = await apply(2);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.status, 'pending');
  } finally {
    BookingPolicy.getMode = original;
  }
});

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

function adminReq(body = {}, params = {}) {
  return { session: { userId: 1, role: 'admin' }, body, params, query: {} };
}

test('admin can switch the shelter to instant booking and back', async () => {
  const db = world({ mode: null });
  let res = makeRes();
  await runWithShelter(SHELTER, () => policyCtrl.updateBookingSettings(adminReq({ booking_mode: 'instant' }), res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.booking_mode, 'instant');
  assert.equal(db.mode, 'instant');

  res = makeRes();
  await runWithShelter(SHELTER, () => policyCtrl.updateBookingSettings(adminReq({ booking_mode: 'approval' }), res));
  assert.equal(res.body.booking_mode, 'approval');
});

test('booking settings reject anything other than approval or instant', async () => {
  assert.equal(bodies.bookingSettings.safeParse({ booking_mode: 'instant' }).success, true);
  assert.equal(bodies.bookingSettings.safeParse({ booking_mode: 'auto' }).success, false);
  assert.equal(bodies.bookingSettings.safeParse({ booking_mode: 'instant', shelter_id: 2 }).success, false);
  assert.equal(bodies.trustedVolunteer.safeParse({ trusted: true }).success, true);
  assert.equal(bodies.trustedVolunteer.safeParse({ trusted: 'false' }).success, false);

  world({ mode: null });
  const res = makeRes();
  await runWithShelter(SHELTER, () => policyCtrl.updateBookingSettings(adminReq({ booking_mode: 'auto' }), res));
  assert.equal(res.statusCode, 400);
});

test('admin marks and unmarks a volunteer as trusted; the list reflects it', async () => {
  const db = world({ mode: 'instant' });
  let res = makeRes();
  await runWithShelter(SHELTER, () => policyCtrl.updateVolunteerTrusted(adminReq({ trusted: true }, { userId: '3' }), res));
  assert.equal(res.statusCode, 200);
  assert.ok(db.trusted.has(3));

  res = makeRes();
  await runWithShelter(SHELTER, () => policyCtrl.getBookingSettings(adminReq(), res));
  assert.equal(res.body.booking_mode, 'instant');
  assert.deepEqual(res.body.trusted_volunteers.map((t) => t.user_id), [3]);

  res = makeRes();
  await runWithShelter(SHELTER, () => policyCtrl.updateVolunteerTrusted(adminReq({ trusted: false }, { userId: '3' }), res));
  assert.equal(res.statusCode, 200);
  assert.ok(!db.trusted.has(3));
});

test('only volunteers can be trusted', async () => {
  const db = world({ mode: 'instant' });
  for (const userId of ['50', '404']) {
    const res = makeRes();
    await runWithShelter(SHELTER, () => policyCtrl.updateVolunteerTrusted(adminReq({ trusted: true }, { userId }), res));
    assert.equal(res.statusCode, 404);
  }
  assert.equal(db.trusted.size, 0);
});

test('routes: only admins change the policy or trust; staff can read it', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  assert.match(routes, /router\.get\('\/settings\/booking', isAuthenticated, staffOrAdmin, getBookingSettings\)/);
  assert.match(routes, /router\.put\('\/settings\/booking', isAuthenticated, adminOnly, validateBody\(bodies\.bookingSettings\), updateBookingSettings\)/);
  assert.match(routes, /router\.put\('\/volunteers\/:userId\/trusted', isAuthenticated, adminOnly, validateBody\(bodies\.trustedVolunteer\), updateVolunteerTrusted\)/);
});

test('audit log names the policy and trust actions', () => {
  const { inferFromRequest } = require('../middleware/auditLog');
  assert.equal(
    inferFromRequest({ method: 'PUT', originalUrl: '/api/admin/settings/booking' }).action,
    'booking_policy.update'
  );
  const trust = inferFromRequest({ method: 'PUT', originalUrl: '/api/admin/volunteers/7/trusted' });
  assert.equal(trust.action, 'volunteer.trusted');
  assert.equal(trust.entityId, '7');
});

// ---------------------------------------------------------------------------
// Migration and schema
// ---------------------------------------------------------------------------

const DB = path.join(__dirname, '..', 'database');
const schema = fs.readFileSync(path.join(DB, 'schema.pg.sql'), 'utf8');
const migration = fs.readFileSync(path.join(DB, '044_booking_policy.pg.sql'), 'utf8');
const setupDb = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

function tableBody(sql, table) {
  const m = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  assert.ok(m, `${table} table not found`);
  return m[1].split('\n').map((l) => l.trim().replace(/,$/, '').replace(/\s+/g, ' ')).filter(Boolean);
}

test('schema.pg.sql defines the booking tables the same way as 042', () => {
  for (const table of ['shelter_booking_policy', 'trusted_volunteers']) {
    assert.deepEqual(tableBody(schema, table), tableBody(migration, table));
    const drop = /DROP TABLE IF EXISTS([\s\S]*?)CASCADE;/.exec(schema);
    assert.match(drop[1], new RegExp(`\\b${table}\\b`));
  }
});

test('042 booking tables are tenant tables with row level security', () => {
  for (const table of ['shelter_booking_policy', 'trusted_volunteers']) {
    assert.ok(TENANT_TABLES.includes(table), `${table} must be a tenant table`);
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(migration, new RegExp(`CREATE POLICY tenant_isolation ON ${table}`));
    assert.match(migration, new RegExp(`CREATE TRIGGER trg_same_shelter\\s+BEFORE INSERT OR UPDATE ON ${table}`));
  }
  assert.match(migration, /CHECK \(booking_mode IN \('approval', 'instant'\)\)/);
  assert.match(migration, /booking_mode\s+VARCHAR\(20\) NOT NULL DEFAULT 'approval'/);
  assert.match(setupDb, /loadSql\('044_booking_policy\.pg\.sql'\)/);
});

test('042 does not touch shelter_settings from SL-NOW-02 or any existing table', () => {
  const code = migration.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  assert.doesNotMatch(code, /shelter_settings/);
  assert.doesNotMatch(code, /ALTER TABLE (?!shelter_booking_policy|trusted_volunteers)\w+/);
  assert.doesNotMatch(code, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(code, /\bINSERT INTO\b/i);
});
