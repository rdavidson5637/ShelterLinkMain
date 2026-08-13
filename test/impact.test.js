'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  calculateStreakFromMonths,
  nextBadgeProgressFrom,
} = require('../utils/impactMath');

test('streak counts consecutive months ending at latest activity', () => {
  assert.strictEqual(calculateStreakFromMonths(['2026-01', '2026-02', '2026-03']), 3);
  assert.strictEqual(calculateStreakFromMonths(['2025-12', '2026-01', '2026-02']), 3);
});

test('streak breaks across gaps', () => {
  // Latest is March; Feb missing → streak is 1 (March only)
  assert.strictEqual(calculateStreakFromMonths(['2026-01', '2026-03']), 1);
  assert.strictEqual(calculateStreakFromMonths(['2026-01', '2026-02', '2026-04']), 1);
});

test('streak across year boundary', () => {
  assert.strictEqual(calculateStreakFromMonths(['2025-11', '2025-12', '2026-01']), 3);
});

test('empty months yield zero streak', () => {
  assert.strictEqual(calculateStreakFromMonths([]), 0);
  assert.strictEqual(calculateStreakFromMonths(null), 0);
});

test('next-badge progress math for hours badge', () => {
  const progress = nextBadgeProgressFrom({
    id: 'dedicated_helper',
    label: 'Dedicated Helper',
    hoursNeeded: 10,
    shiftsNeeded: 0,
    currentProgress: 4,
  });
  assert.strictEqual(progress.current, 4);
  assert.strictEqual(progress.target, 10);
  assert.strictEqual(progress.percent, 40);
});

test('next-badge progress math for shifts badge', () => {
  const progress = nextBadgeProgressFrom({
    id: 'first_step',
    label: 'First Step',
    hoursNeeded: 0,
    shiftsNeeded: 1,
    currentProgress: 0,
  });
  assert.strictEqual(progress.current, 0);
  assert.strictEqual(progress.target, 1);
  assert.strictEqual(progress.percent, 0);
});

test('next-badge progress null when no next badge', () => {
  assert.strictEqual(nextBadgeProgressFrom(null), null);
});
