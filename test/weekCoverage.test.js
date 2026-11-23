'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  shiftCoverage,
  buildWeekCoverage,
  describeLevel,
} = require('../utils/weekCoverage');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/week-sheet.html'),
  'utf8'
);
const PAGE_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/admin/week-sheet.js'),
  'utf8'
);
const CSS = fs.readFileSync(
  path.join(ROOT, 'frontend/public/css/custom.css'),
  'utf8'
);

test('shiftCoverage counts open places from volunteers and max', () => {
  const row = shiftCoverage({
    opportunity_id: 1,
    title: 'Morning walks',
    max_volunteers: 4,
    volunteers: [{ user_id: 1 }, { user_id: 2 }],
  });
  assert.strictEqual(row.filled, 2);
  assert.strictEqual(row.open, 2);
  assert.strictEqual(row.max_volunteers, 4);
  assert.strictEqual(row.title, 'Morning walks');
});

test('shiftCoverage leaves open null when capacity is uncapped', () => {
  const row = shiftCoverage({
    title: 'Flexible cover',
    max_volunteers: null,
    volunteers: [{ user_id: 9 }],
  });
  assert.strictEqual(row.filled, 1);
  assert.strictEqual(row.open, null);
  assert.strictEqual(row.max_volunteers, null);
});

test('buildWeekCoverage sums days and groups roles by title', () => {
  const coverage = buildWeekCoverage([
    {
      date: '2026-08-24',
      opportunities: [
        {
          opportunity_id: 10,
          title: 'Morning walks',
          max_volunteers: 4,
          volunteers: [{}, {}],
        },
        {
          opportunity_id: 11,
          title: 'Cattery care',
          max_volunteers: 2,
          volunteers: [],
        },
      ],
    },
    {
      date: '2026-08-25',
      opportunities: [
        {
          opportunity_id: 12,
          title: 'Morning walks',
          max_volunteers: 4,
          volunteers: [{}, {}, {}],
        },
      ],
    },
    { date: '2026-08-26', opportunities: [] },
  ]);

  assert.strictEqual(coverage.days.length, 3);
  assert.strictEqual(coverage.days[0].filled, 2);
  assert.strictEqual(coverage.days[0].open, 4);
  assert.strictEqual(coverage.days[0].level, 'short');
  assert.strictEqual(coverage.days[0].level_label, describeLevel('short'));
  assert.strictEqual(coverage.days[1].level, 'partial');
  assert.strictEqual(coverage.days[2].level, 'none');

  assert.strictEqual(coverage.week.shift_count, 3);
  assert.strictEqual(coverage.week.filled, 5);
  assert.strictEqual(coverage.week.open, 5);
  assert.strictEqual(coverage.week.capacity, 10);

  const walks = coverage.roles.find((r) => r.title === 'Morning walks');
  const cattery = coverage.roles.find((r) => r.title === 'Cattery care');
  assert.ok(walks);
  assert.ok(cattery);
  assert.strictEqual(walks.shift_count, 2);
  assert.strictEqual(walks.open, 3);
  assert.strictEqual(cattery.open, 2);
  // Most open places first.
  assert.strictEqual(coverage.roles[0].title, 'Morning walks');
  assert.strictEqual(coverage.roles[1].title, 'Cattery care');
});

test('week sheet UI renders coverage heat map from API coverage', () => {
  assert.match(PAGE, /coverage heat map/i);
  assert.match(PAGE_JS, /renderCoverage/);
  assert.match(PAGE_JS, /sheet\.coverage/);
  assert.match(PAGE_JS, /By shift title/);
  assert.match(CSS, /\.coverage-heat\b/);
  assert.match(CSS, /\.coverage-heat-cell\.is-short/);
  const coverageCss = CSS.slice(CSS.indexOf('/* SL-DAY-07:'));
  assert.doesNotMatch(coverageCss, /🎉|🔥|😀/);
  assert.doesNotMatch(PAGE_JS, /🎉|🔥|😀/);
});
