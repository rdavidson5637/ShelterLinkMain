'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mock = require('./helpers/mockDb');
const Hours = require('../models/VolunteerHours');

test('create validates required fields and hours type', async () => {
  await assert.rejects(() => Hours.create(1, 2, null, 3), /required/);
  await assert.rejects(() => Hours.create(1, 2, '2026-07-01', 'lots'), /required/);
});

test('create inserts unapproved (approved=0) with null opportunity allowed', async () => {
  mock.setHandler(async (sql) => {
    if (/INSERT INTO/i.test(sql)) return [{ insertId: 3 }];
    return [[{ record_id: 3 }]];
  });
  await Hours.create(1, null, '2026-07-01', 2.5);
  const ins = mock.calls.find(c => /INSERT INTO/i.test(c.sql));
  assert.match(ins.sql, /approved,\s*verified_by_checkin\)\s*\n?\s*VALUES/i);
  assert.deepStrictEqual(ins.params, [1, null, '2026-07-01', 2.5, 0]);
});

test('getTotalHours only sums approved', async () => {
  mock.setHandler(async () => [[{ total_hours: 12 }]]);
  const t = await Hours.getTotalHours(1);
  assert.strictEqual(t, 12);
  assert.match(mock.lastCall().sql, /approved.*=.*1/is);
});

test('approve flips approved flag', async () => {
  mock.setHandler(async (sql) => {
    if (/UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
    return [[{ record_id: 9, approved: 1 }]];
  });
  const r = await Hours.approve(9);
  assert.strictEqual(r.approved, 1);
});
