'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const {
  isInQuietHours,
  normaliseQuietTime,
  parseClockToMinutes,
} = require('../utils/quietHours');

test('normaliseQuietTime accepts HH:MM and HH:MM:SS', () => {
  assert.equal(normaliseQuietTime('9:05'), '09:05');
  assert.equal(normaliseQuietTime('22:00:00'), '22:00');
  assert.equal(normaliseQuietTime(''), null);
  assert.equal(normaliseQuietTime('25:00'), null);
});

test('parseClockToMinutes rejects junk', () => {
  assert.equal(parseClockToMinutes('noon'), null);
  assert.equal(parseClockToMinutes('12:60'), null);
});

test('same-day quiet window', () => {
  const previous = process.env.SHELTER_TIMEZONE;
  process.env.SHELTER_TIMEZONE = 'UTC';
  try {
    assert.equal(isInQuietHours('13:00', '15:00', new Date('2026-06-10T14:00:00Z')), true);
    assert.equal(isInQuietHours('13:00', '15:00', new Date('2026-06-10T15:00:00Z')), false);
    assert.equal(isInQuietHours('13:00', '15:00', new Date('2026-06-10T12:59:00Z')), false);
  } finally {
    if (previous === undefined) delete process.env.SHELTER_TIMEZONE;
    else process.env.SHELTER_TIMEZONE = previous;
  }
});

test('overnight quiet window wraps midnight', () => {
  const previous = process.env.SHELTER_TIMEZONE;
  process.env.SHELTER_TIMEZONE = 'UTC';
  try {
    assert.equal(isInQuietHours('22:00', '08:00', new Date('2026-06-10T23:30:00Z')), true);
    assert.equal(isInQuietHours('22:00', '08:00', new Date('2026-06-11T07:59:00Z')), true);
    assert.equal(isInQuietHours('22:00', '08:00', new Date('2026-06-11T08:00:00Z')), false);
    assert.equal(isInQuietHours('22:00', '08:00', new Date('2026-06-10T12:00:00Z')), false);
  } finally {
    if (previous === undefined) delete process.env.SHELTER_TIMEZONE;
    else process.env.SHELTER_TIMEZONE = previous;
  }
});

test('incomplete quiet hours mean no quiet period', () => {
  assert.equal(isInQuietHours('22:00', null, new Date()), false);
  assert.equal(isInQuietHours(null, '08:00', new Date()), false);
  assert.equal(isInQuietHours('10:00', '10:00', new Date()), false);
});
