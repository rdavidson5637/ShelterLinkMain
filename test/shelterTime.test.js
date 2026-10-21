'use strict';

process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatShelterDate, formatShelterTime, nowLocalSql } = require('../utils/shelterTime');

test('UK date and BST/GMT wall-clock formatting', () => {
  assert.equal(formatShelterDate('2026-06-11 10:00:00'), 'Thu 11 Jun 2026');
  assert.equal(formatShelterTime('2026-06-11 10:00:00'), '10:00');
  assert.equal(formatShelterDate(''), 'TBA');
  assert.equal(nowLocalSql(new Date('2026-07-01T12:00:00Z')), '2026-07-01 13:00:00');
  assert.equal(nowLocalSql(new Date('2026-12-01T12:00:00Z')), '2026-12-01 12:00:00');
});
