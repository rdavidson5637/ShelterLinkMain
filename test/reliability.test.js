'use strict';

// SL-LATER-34: staff-only attendance counts (attended, no-shows, late
// cancellations, hours) for the last 12 months. The real-database cross-shelter
// check lives in tenantIsolation.run.js (GET /api/admin/volunteers/2/reliability).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

for (const mod of [
  '../models/Reliability',
  '../middleware/auth',
  '../middleware/auditLog',
  '../models/AuditLog',
  '../controllers/profileController',
]) {
  delete require.cache[require.resolve(mod)];
}

const Reliability = require('../models/Reliability');
const { getAllVolunteers, getVolunteerReliability } = require('../controllers/profileController');
const { mentionsTenantTable } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');

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
    session: { userId: 1, role: 'staff' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/admin/volunteers',
    ...overrides,
  };
}

function reliabilityHandler({ shifts = [], hours = [], users = [] } = {}) {
  return async (sql) => {
    if (/FROM applications a\s+JOIN opportunities o/i.test(sql)) return [shifts];
    if (/FROM volunteer_hours vh\s+WHERE vh.approved = 1/i.test(sql)) return [hours];
    if (/INSERT INTO audit_log/i.test(sql)) return [{ insertId: 1 }];
    if (/FROM users/i.test(sql)) return [users];
    return [[]];
  };
}

test('window covers the 12 months up to now', () => {
  const win = Reliability.reliabilityWindow(new Date('2026-11-23T06:30:00Z'));
  assert.equal(win.start, '2025-11-23 06:30:00');
  assert.equal(win.end, '2026-11-23 06:30:00');
  assert.equal(win.startDate, '2025-11-23');
  assert.equal(win.endDate, '2026-11-23');
});

test('queries read only tenant tables, bound to the window, so row-level security scopes them', async () => {
  mock.resetCalls();
  mock.setHandler(reliabilityHandler());
  await Reliability.countsByUser({ now: new Date('2026-11-23T00:00:00Z') });
  assert.equal(mock.calls.length, 2);
  for (const call of mock.calls) {
    assert.equal(mentionsTenantTable(call.sql), true, 'must touch a tenant table');
    assert.doesNotMatch(call.sql, /shelter_id/i, 'scope comes from RLS, not a caller-supplied id');
  }
  const [shiftCall, hoursCall] = mock.calls;
  assert.deepEqual(shiftCall.params, ['2025-11-23 00:00:00', '2026-11-23 00:00:00']);
  assert.deepEqual(hoursCall.params, ['2025-11-23', '2026-11-23']);
  // Late cancellation = claimed swap asked for inside the shift's cutoff.
  assert.match(shiftCall.sql, /sr\.status = 'claimed'/);
  assert.match(shiftCall.sql, /cancellation_cutoff_hours/);
  assert.match(shiftCall.sql, /no_show/);
  assert.match(shiftCall.sql, /checked_in_at IS NOT NULL/);
});

test('single-volunteer query filters by that user', async () => {
  mock.resetCalls();
  mock.setHandler(
    reliabilityHandler({
      shifts: [{ user_id: 7, attended: 5, no_shows: 1, late_cancellations: 2 }],
      hours: [{ user_id: 7, hours: '12.50' }],
    })
  );
  const out = await Reliability.forVolunteer(7, { now: new Date('2026-11-23T00:00:00Z') });
  assert.deepEqual(out, {
    window_start: '2025-11-23',
    window_end: '2026-11-23',
    attended: 5,
    no_shows: 1,
    late_cancellations: 2,
    hours: 12.5,
  });
  for (const call of mock.calls) {
    assert.match(call.sql, /user_id = \?/);
    assert.equal(call.params[call.params.length - 1], 7);
  }
});

test('volunteer with no activity gets zeros, not missing fields', async () => {
  mock.setHandler(reliabilityHandler());
  const out = await Reliability.forVolunteer(9);
  assert.equal(out.attended, 0);
  assert.equal(out.no_shows, 0);
  assert.equal(out.late_cancellations, 0);
  assert.equal(out.hours, 0);
});

test('staff volunteers list carries 12-month counts per row in two batched queries', async () => {
  mock.resetCalls();
  mock.setHandler(
    reliabilityHandler({
      users: [
        { user_id: 3, first_name: 'Ada', last_name: 'L', approved: 1 },
        { user_id: 4, first_name: 'Ben', last_name: 'M', approved: 1 },
      ],
      shifts: [{ user_id: 3, attended: 4, no_shows: 1, late_cancellations: 1 }],
      hours: [{ user_id: 3, hours: 9 }],
    })
  );
  const res = makeRes();
  await getAllVolunteers(makeReq(), res);
  assert.equal(res.statusCode, 200);
  const [ada, ben] = res.body;
  assert.equal(ada.attended_12m, 4);
  assert.equal(ada.no_shows_12m, 1);
  assert.equal(ada.late_cancellations_12m, 1);
  assert.equal(ada.hours_12m, 9);
  assert.equal(ben.attended_12m, 0);
  assert.equal(ben.hours_12m, 0);
  const selects = mock.calls.filter((c) => /^\s*SELECT/i.test(c.sql));
  assert.equal(selects.length, 3, 'list + shifts + hours, no per-volunteer queries');
});

test('reliability endpoint: volunteers are refused', async () => {
  mock.resetCalls();
  const res = makeRes();
  await getVolunteerReliability(
    makeReq({ session: { userId: 2, role: 'volunteer' }, params: { userId: '2' } }),
    res
  );
  assert.equal(res.statusCode, 403);
  assert.equal(mock.calls.length, 0);
});

test('reliability endpoint: unauthenticated is refused', async () => {
  const res = makeRes();
  await getVolunteerReliability(makeReq({ session: {}, params: { userId: '2' } }), res);
  assert.equal(res.statusCode, 401);
});

test('reliability endpoint: a volunteer outside the caller shelter is a 404 with no counts', async () => {
  // Under RLS the other shelter's user row is invisible, so the lookup is empty.
  mock.resetCalls();
  mock.setHandler(
    reliabilityHandler({
      users: [],
      shifts: [{ user_id: 2, attended: 99, no_shows: 99, late_cancellations: 99 }],
    })
  );
  const res = makeRes();
  await getVolunteerReliability(makeReq({ params: { userId: '2' } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.attended, undefined);
  assert.equal(
    mock.calls.some((c) => /FROM applications a/i.test(c.sql)),
    false,
    'counts are not computed for an unseen volunteer'
  );
});

test('reliability endpoint: staff get the summary for their own volunteer', async () => {
  mock.setHandler(
    reliabilityHandler({
      users: [{ user_id: 2 }],
      shifts: [{ user_id: 2, attended: 3, no_shows: 0, late_cancellations: 1 }],
      hours: [{ user_id: 2, hours: 6 }],
    })
  );
  const res = makeRes();
  await getVolunteerReliability(makeReq({ params: { userId: '2' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.attended, 3);
  assert.equal(res.body.late_cancellations, 1);
  assert.equal(res.body.hours, 6);
  assert.ok(res.body.window_start);
});

test('route is staff-only and sits under /api/admin', () => {
  const src = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
  assert.match(
    src,
    /router\.get\('\/volunteers\/:userId\/reliability', isAuthenticated, staffOrAdmin, getVolunteerReliability\)/
  );
  for (const file of ['routes/public.js', 'routes/profile.js', 'routes/stats.js']) {
    const other = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(other, /Reliability|reliability/, `${file} must not expose attendance counts`);
  }
});

test('volunteer and public pages never request attendance counts', () => {
  const dirs = ['frontend/pages/volunteer', 'frontend/pages/public', 'frontend/js/volunteer'];
  for (const dir of dirs) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      const file = path.join(abs, name);
      if (!fs.statSync(file).isFile()) continue;
      const text = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /\/reliability|_12m\b/, `${dir}/${name}`);
    }
  }
});

test('wording is neutral: no scores or judgement labels', () => {
  const files = [
    'frontend/js/admin/reliability.js',
    'frontend/js/admin/volunteers.js',
    'frontend/pages/admin/volunteers.html',
    'models/Reliability.js',
  ];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(text, /unreliable|reliability score|\bscore\b|flaky|\brating\b/i, f);
  }
});

test('volunteers table has a sortable 12-month column group', () => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend/pages/admin/volunteers.html'), 'utf8');
  assert.match(html, /Last 12 months/);
  for (const key of ['attended_12m', 'no_shows_12m', 'late_cancellations_12m', 'hours_12m']) {
    assert.match(html, new RegExp(`data-sort-key="${key}" aria-sort="none"`));
  }
  assert.match(html, /colspan="10"/);
  assert.match(html, /Emergency contact/);
});

test('sortVolunteers orders by count either way and breaks ties by name', async () => {
  const { sortVolunteers } = await import('../frontend/js/admin/reliability.js');
  const list = [
    { first_name: 'Cara', no_shows_12m: 1 },
    { first_name: 'Abe', no_shows_12m: 3 },
    { first_name: 'Bea', no_shows_12m: 1 },
    { first_name: 'Dan' },
  ];
  const names = (rows) => rows.map((r) => r.first_name);
  assert.deepEqual(names(sortVolunteers(list, 'no_shows_12m', 'descending')), ['Abe', 'Cara', 'Bea', 'Dan']);
  assert.deepEqual(names(sortVolunteers(list, 'no_shows_12m', 'ascending')), ['Dan', 'Bea', 'Cara', 'Abe']);
  assert.deepEqual(names(sortVolunteers(list, 'name', 'ascending')), ['Abe', 'Bea', 'Cara', 'Dan']);
  assert.equal(list[0].first_name, 'Cara', 'input is not mutated');
});

test('profile section renders a ruled table and escapes values', async () => {
  const { reliabilitySectionHtml } = await import('../frontend/js/admin/reliability.js');
  const html = reliabilitySectionHtml({
    attended: 4,
    no_shows: 1,
    late_cancellations: 0,
    hours: 7.5,
    window_start: '2025-11-23',
    window_end: '<b>2026-11-23</b>',
  });
  assert.match(html, /<table class="reliability-table">/);
  assert.match(html, /<th scope="row">Attended<\/th><td class="numeric-cell">4<\/td>/);
  assert.match(html, /Late cancellations/);
  assert.match(html, /7\.5/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /Staff only/);
});
