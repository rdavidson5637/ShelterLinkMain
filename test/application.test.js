'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mock = require('./helpers/mockDb');
const Application = require('../models/Application');

test('create inserts pending application and maps ids', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/INSERT INTO/i.test(sql)) return [{ insertId: 11 }];
    return [[{ application_id: 11, applied_at: '2026-07-01', title: 'X', status: 'pending' }]];
  });
  const app = await Application.create(2, 5);
  assert.strictEqual(app.id, 11);
  assert.strictEqual(app.created_at, '2026-07-01');
  const ins = mock.calls.find(c => /INSERT INTO/i.test(c.sql));
  assert.match(ins.sql, /\?\s*,\s*\?\s*,\s*\?/);
  assert.deepStrictEqual(ins.params, [2, 5, 'pending']);
});

test('create rejects missing args', async () => {
  await assert.rejects(() => Application.create(null, 5), /required/);
});

test('updateStatus includes rejection_reason only when provided', async () => {
  mock.setHandler(async (sql) => {
    if (/UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
    return [[{ application_id: 1, applied_at: 'x' }]];
  });
  await Application.updateStatus(1, 'accepted');
  let upd = mock.calls.find(c => /UPDATE/i.test(c.sql));
  assert.doesNotMatch(upd.sql, /rejection_reason/);
  mock.resetCalls();
  await Application.updateStatus(1, 'rejected', 'no slots');
  upd = mock.calls.find(c => /UPDATE/i.test(c.sql));
  assert.match(upd.sql, /rejection_reason = \?/);
  assert.deepStrictEqual(upd.params, ['rejected', 'no slots', 1]);
});

test('cancelApplication blocks other users (forbidden)', async () => {
  mock.setHandler(async () => [[{ application_id: 1, user_id: 99, status: 'pending' }]]);
  const r = await Application.cancelApplication(1, 2);
  assert.deepStrictEqual(r, { forbidden: true });
});

test('cancelApplication blocks invalid status', async () => {
  mock.setHandler(async () => [[{ application_id: 1, user_id: 2, status: 'rejected' }]]);
  const r = await Application.cancelApplication(1, 2);
  assert.deepStrictEqual(r, { invalidStatus: true });
});

test('cancelApplication succeeds for own pending application', async () => {
  let step = 0;
  mock.setHandler(async (sql) => {
    if (/DELETE/i.test(sql)) return [{ affectedRows: 1 }];
    return [[{ application_id: 1, user_id: 2, status: 'pending' }]];
  });
  const r = await Application.cancelApplication(1, 2);
  assert.strictEqual(r.status, 'cancelled');
});

test('countApprovedByUserId counts accepted+approved', async () => {
  mock.setHandler(async () => [[{ cnt: 4 }]]);
  const n = await Application.countApprovedByUserId(2);
  assert.strictEqual(n, 4);
  assert.match(mock.lastCall().sql, /IN \('accepted', 'approved'\)/);
});
