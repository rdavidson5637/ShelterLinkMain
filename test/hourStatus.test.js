'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('hour status treats 1 as approved and 0 as waiting', async () => {
  const { hourMatchesStatus } = await import('../frontend/js/volunteer/hourStatus.js');

  assert.equal(hourMatchesStatus(1, 'approved'), true);
  assert.equal(hourMatchesStatus(0, 'approved'), false);
  assert.equal(hourMatchesStatus(0, 'pending'), true);
  assert.equal(hourMatchesStatus(1, 'pending'), false);
  assert.equal(hourMatchesStatus(1, ''), true);
  assert.equal(hourMatchesStatus(0, ''), true);
});
