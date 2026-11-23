'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { runWithShelter } = require('../utils/shelterContext');
const ThisWeek = require('../models/ThisWeek');
const { getThisWeek } = require('../controllers/thisWeekController');

const ROOT = path.join(__dirname, '..');
const ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const DASHBOARD_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/dashboard.html'),
  'utf8'
);
const DASHBOARD_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/admin/dashboard.js'),
  'utf8'
);
const CSS = fs.readFileSync(path.join(ROOT, 'frontend/public/css/custom.css'), 'utf8');
const TENANT_ISO = fs.readFileSync(path.join(ROOT, 'test/tenantIsolation.run.js'), 'utf8');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 1, role: 'admin' },
    ...overrides,
  };
}

function installDb(state) {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities o/.test(sql) && /spots_filled/.test(sql)) {
      return [state.shifts || []];
    }
    if (/FROM applications a/.test(sql) && /status = 'pending'/.test(sql)) {
      return [state.pending || []];
    }
    if (/FROM volunteer_qualifications vq/.test(sql)) {
      return [state.training || []];
    }
    if (/FROM waitlist_offers w/.test(sql)) {
      return [state.offers || []];
    }
    return [[]];
  });
}

test('admin route exposes this-week for staff', () => {
  assert.match(ROUTES, /\/this-week/);
  assert.match(ROUTES, /getThisWeek/);
  assert.match(ROUTES, /staffOrAdmin.*getThisWeek|getThisWeek/);
});

test('tenant isolation probes include this-week', () => {
  assert.match(TENANT_ISO, /\/api\/admin\/this-week/);
});

test('dashboard this-week uses ruled action lists, not card or icon grids', () => {
  assert.match(DASHBOARD_HTML, /id="thisWeekSection"/);
  assert.match(DASHBOARD_HTML, /id="thisWeekBody"/);
  assert.match(DASHBOARD_HTML, /class="this-week"/);
  assert.doesNotMatch(DASHBOARD_HTML, /thisWeekSection[\s\S]*stat-card/);
  assert.doesNotMatch(DASHBOARD_HTML, /thisWeekSection[\s\S]*feature-grid|emoji|✅|☐/);
  assert.match(DASHBOARD_JS, /\/admin\/this-week/);
  assert.match(DASHBOARD_JS, /action-list/);
  assert.match(DASHBOARD_JS, /unfilled/);
  assert.match(DASHBOARD_JS, /short_staffed/);
  assert.match(DASHBOARD_JS, /pending_bookings/);
  assert.match(DASHBOARD_JS, /training_expiring/);
  assert.match(DASHBOARD_JS, /waitlist_offers/);
  assert.doesNotMatch(DASHBOARD_JS, /emoji|✅|☐|☑/);
  assert.match(CSS, /\.this-week\s*\{/);
  assert.doesNotMatch(CSS, /\.this-week[\s\S]{0,400}linear-gradient/);
});

test('getSummary requires shelter context', async () => {
  installDb({});
  await assert.rejects(() => ThisWeek.getSummary(new Date('2026-11-23T12:00:00Z')), {
    status: 403,
  });
});

test('getSummary splits unfilled and short-staffed and links each item', async () => {
  installDb({
    shifts: [
      {
        opportunity_id: 10,
        title: 'Dog walk',
        location: 'Yard',
        start_date: '2026-11-24 09:00:00',
        end_date: '2026-11-24 11:00:00',
        max_volunteers: 3,
        status: 'open',
        is_urgent: 0,
        spots_filled: 0,
      },
      {
        opportunity_id: 11,
        title: 'Kennel clean',
        location: 'Block A',
        start_date: '2026-11-25 10:00:00',
        end_date: '2026-11-25 12:00:00',
        max_volunteers: 4,
        status: 'open',
        is_urgent: 1,
        spots_filled: 2,
      },
      {
        opportunity_id: 12,
        title: 'Full shift',
        location: 'Office',
        start_date: '2026-11-26 09:00:00',
        end_date: '2026-11-26 12:00:00',
        max_volunteers: 2,
        status: 'open',
        is_urgent: 0,
        spots_filled: 2,
      },
    ],
    pending: [
      {
        application_id: 50,
        user_id: 7,
        opportunity_id: 10,
        applied_at: '2026-11-22 08:00:00',
        first_name: 'Alex',
        last_name: 'Volunteer',
        email: 'alex@example.com',
        opportunity_title: 'Dog walk',
        start_date: '2026-11-24 09:00:00',
        end_date: '2026-11-24 11:00:00',
        location: 'Yard',
      },
    ],
    training: [
      {
        volunteer_qualification_id: 90,
        user_id: 8,
        qualification_id: 3,
        expires_at: '2026-12-01',
        qualification_name: 'Dog walking level 1',
        first_name: 'Sam',
        last_name: 'Walker',
        email: 'sam@example.com',
      },
    ],
    offers: [
      {
        offer_id: 70,
        opportunity_id: 11,
        application_id: 51,
        user_id: 9,
        expires_at: '2026-11-24 18:00:00',
        notified_at: '2026-11-24 06:00:00',
        offered_at: '2026-11-24 05:00:00',
        first_name: 'Pat',
        last_name: 'Cover',
        email: 'pat@example.com',
        opportunity_title: 'Kennel clean',
        start_date: '2026-11-25 10:00:00',
        end_date: '2026-11-25 12:00:00',
        location: 'Block A',
      },
    ],
  });

  const summary = await runWithShelter(1, () =>
    ThisWeek.getSummary(new Date('2026-11-23T12:00:00Z'))
  );

  assert.equal(summary.week_start, '2026-11-23');
  assert.equal(summary.week_end, '2026-11-29');
  assert.equal(summary.unfilled.length, 1);
  assert.equal(summary.unfilled[0].opportunity_id, 10);
  assert.match(summary.unfilled[0].href, /week-sheet\.html\?week_start=2026-11-23/);
  assert.equal(summary.short_staffed.length, 1);
  assert.equal(summary.short_staffed[0].opportunity_id, 11);
  assert.match(summary.short_staffed[0].detail, /Urgent/);
  assert.equal(summary.pending_bookings.length, 1);
  assert.equal(summary.pending_bookings[0].href, '/pages/admin/review-applications.html');
  assert.equal(summary.training_expiring.length, 1);
  assert.match(summary.training_expiring[0].href, /volunteers\.html\?user=8/);
  assert.equal(summary.waitlist_offers.length, 1);
  assert.match(summary.waitlist_offers[0].href, /week-sheet/);
  assert.deepEqual(summary.counts, {
    unfilled: 1,
    short_staffed: 1,
    pending_bookings: 1,
    training_expiring: 1,
    waitlist_offers: 1,
  });
});

test('controller returns summary for staff and forbids volunteers', async () => {
  installDb({ shifts: [], pending: [], training: [], offers: [] });

  const okRes = makeRes();
  await runWithShelter(1, () =>
    getThisWeek(makeReq({ session: { userId: 1, role: 'staff' } }), okRes)
  );
  assert.equal(okRes.statusCode, 200);
  assert.match(okRes.body.week_start, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(okRes.body.counts.unfilled, 0);

  const forbidden = makeRes();
  await getThisWeek(makeReq({ session: { userId: 2, role: 'volunteer' } }), forbidden);
  assert.equal(forbidden.statusCode, 403);
});
