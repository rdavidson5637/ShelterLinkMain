'use strict';

/**
 * SL-DAY-21 — volunteer my-impact page and /api/stats/me extensions.
 * Figures must come from existing tables only (no invented badges on the page).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const ROOT = path.join(__dirname, '..');
const mock = require('./helpers/mockDb');

delete require.cache[require.resolve('../models/VolunteerHours')];
delete require.cache[require.resolve('../models/Application')];
delete require.cache[require.resolve('../models/Badge')];
delete require.cache[require.resolve('../controllers/statsController')];

const {
  getMyImpactStats,
  getApprovedHoursForYear,
  countSheltersHelped,
  countTrainingCompleted,
} = require('../controllers/statsController');

const PAGE = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/volunteer/my-impact.html'),
  'utf8'
);
const PAGE_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/volunteer/my-impact.js'),
  'utf8'
);
const NAV = fs.readFileSync(
  path.join(ROOT, 'frontend/js/components/navConfig.js'),
  'utf8'
);

function makeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
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

test('my-impact page is editorial: figures list, no badge or emoji grid copy', () => {
  assert.match(PAGE, /<h1>My impact<\/h1>/);
  assert.match(PAGE, /id="impactFigures"/);
  assert.match(PAGE, /class="my-impact-figures"/);
  assert.match(PAGE, /Hours this year/);
  assert.match(PAGE, /Hours all time/);
  assert.match(PAGE, /Shifts done/);
  assert.match(PAGE, /Shelters helped/);
  assert.match(PAGE, /Training completed/);
  assert.doesNotMatch(PAGE, /badge|emoji|🏆|⭐/i);
  assert.doesNotMatch(PAGE, /stats-grid|metric-strip/);
  assert.match(PAGE_JS, /\/stats\/me/);
  assert.doesNotMatch(PAGE_JS, /badges|currentStreak|nextBadge/);
  assert.match(NAV, /my-impact\.html/);
  assert.match(NAV, /id: 'impact'/);
});

test('getApprovedHoursForYear sums only approved hours in that year', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /EXTRACT\(YEAR FROM date\)/);
    assert.match(sql, /approved = 1/);
    assert.deepEqual(params, [9, 2026]);
    return [[{ total_hours: 12.5 }]];
  });
  const total = await getApprovedHoursForYear(9, 2026);
  assert.equal(total, 12.5);
});

test('countSheltersHelped uses distinct shelter_id on approved hours', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /COUNT\(DISTINCT shelter_id\)/);
    assert.match(sql, /volunteer_hours/);
    assert.deepEqual(params, [9]);
    return [[{ cnt: 2 }]];
  });
  assert.equal(await countSheltersHelped(9), 2);
});

test('countTrainingCompleted counts distinct passed modules', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /training_attempts/);
    assert.match(sql, /passed = 1/);
    assert.match(sql, /COUNT\(DISTINCT module_id\)/);
    assert.deepEqual(params, [9]);
    return [[{ cnt: 3 }]];
  });
  assert.equal(await countTrainingCompleted(9), 3);
});

test('getMyImpactStats returns year, hours, shifts, shelters, training from real queries', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/SUM\(hours\)/i.test(sql) && /EXTRACT\(YEAR FROM date\)/i.test(sql)) {
      return [[{ total_hours: 8 }]];
    }
    if (/SUM\(hours\)/i.test(sql)) {
      return [[{ total_hours: 40 }]];
    }
    if (/COUNT\(\*\)/i.test(sql) && /applications/i.test(sql)) {
      return [[{ cnt: 5 }]];
    }
    if (/COUNT\(DISTINCT shelter_id\)/i.test(sql)) {
      return [[{ cnt: 1 }]];
    }
    if (/COUNT\(DISTINCT module_id\)/i.test(sql) && /training_attempts/i.test(sql)) {
      return [[{ cnt: 2 }]];
    }
    if (/TO_CHAR\(date, 'YYYY-MM'\)/i.test(sql)) {
      return [[{ ym: '2026-03' }, { ym: '2026-02' }]];
    }
    return [[]];
  });

  const res = makeRes();
  await getMyImpactStats({ session: { userId: 9 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.hoursThisYear, 8);
  assert.equal(res.body.totalHours, 40);
  assert.equal(res.body.shiftsCompleted, 5);
  assert.equal(res.body.sheltersHelped, 1);
  assert.equal(res.body.trainingCompleted, 2);
  assert.equal(res.body.year, new Date().getFullYear());
  assert.ok(res.body.badges);
});

test('getMyImpactStats requires a session user', async () => {
  const res = makeRes();
  await getMyImpactStats({ session: {} }, res);
  assert.equal(res.statusCode, 401);
});
