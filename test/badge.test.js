'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mock = require('./helpers/mockDb');
const Badge = require('../models/Badge');

// calculateBadges calls VolunteerHours.getTotalHours (SUM hours) and
// Application.countApprovedByUserId (COUNT). Branch the mock on SQL.
function driveBadges(totalHours, approvedShifts) {
  mock.setHandler(async (sql) => {
    if (/SUM\(hours\)/i.test(sql)) return [[{ total_hours: totalHours }]];
    if (/COUNT\(\*\)/i.test(sql)) return [[{ cnt: approvedShifts }]];
    return [[]];
  });
  return Badge.calculateBadges(1);
}

test('new volunteer earns nothing, next badge is First Step', async () => {
  const { earned, locked, nextBadge } = await driveBadges(0, 0);
  assert.strictEqual(earned.length, 0);
  assert.strictEqual(locked.length, Badge.BADGES.length);
  assert.strictEqual(nextBadge.id, 'first_step');
});

test('one approved shift earns First Step', async () => {
  const { earned } = await driveBadges(0, 1);
  assert.ok(earned.some(b => b.id === 'first_step'));
});

test('10 hours earns Dedicated Helper but not Community Hero', async () => {
  const { earned } = await driveBadges(10, 1);
  const ids = earned.map(b => b.id);
  assert.ok(ids.includes('dedicated_helper'));
  assert.ok(!ids.includes('community_hero'));
});

test('100 hours + a shift earns every badge', async () => {
  const { earned, locked } = await driveBadges(100, 3);
  assert.strictEqual(earned.length, Badge.BADGES.length);
  assert.strictEqual(locked.length, 0);
});

test('locked badges carry a progress note', async () => {
  const { locked } = await driveBadges(5, 1);
  assert.ok(locked.every(b => typeof b.progressNote === 'string' && b.progressNote.length));
});
