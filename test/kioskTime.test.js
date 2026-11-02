'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TIMEZONE } = require('../utils/shelterTime');
const { isWithinCheckInWindow, todayBounds } = require('../controllers/kioskController');

test('kiosk today and check-in follow the shelter day across BST', () => {
  assert.equal(TIMEZONE, 'Europe/London');

  const lateSaturday = new Date('2026-03-28T23:30:00Z');
  assert.equal(todayBounds(lateSaturday).startSql, '2026-03-28 00:00:00');
  assert.equal(todayBounds(lateSaturday).endSql, '2026-03-28 23:59:59');

  // 23:30 UTC on 29 March is 00:30 BST on 30 March.
  const afterChange = new Date('2026-03-29T23:30:00Z');
  assert.equal(todayBounds(afterChange).startSql, '2026-03-30 00:00:00');
  assert.equal(todayBounds(afterChange).endSql, '2026-03-30 23:59:59');

  // 23:30 UTC on 21 June is 00:30 BST on 22 June.
  const summerNight = new Date('2026-06-21T23:30:00Z');
  assert.equal(todayBounds(summerNight).startSql, '2026-06-22 00:00:00');

  const shift = '2026-03-29 10:00:00';
  assert.equal(isWithinCheckInWindow(shift, new Date('2026-03-29T08:30:00Z')), true);
  assert.equal(isWithinCheckInWindow(shift, new Date('2026-03-29T07:30:00Z')), false);
  assert.equal(isWithinCheckInWindow(shift, new Date('2026-03-29T22:30:00Z')), true);
  assert.equal(isWithinCheckInWindow(shift, new Date('2026-03-29T23:30:00Z')), false);
});
