'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mock = require('./helpers/mockDb');
const Profile = require('../models/VolunteerProfile');

test('create only persists whitelisted profile fields', async () => {
  mock.setHandler(async (sql) => {
    if (/INSERT INTO/i.test(sql)) return [{ insertId: 1 }];
    return [[{ user_id: 1, skills: 'Dogs' }]];
  });
  await Profile.create(1, {
    skills: 'Dogs',
    role: 'admin',
    approved: 1,
    foster_approved: 1,
    address: '1 St',
    has_garden: 1,
  });
  const ins = mock.calls.find(c => /INSERT INTO/i.test(c.sql));
  assert.match(ins.sql, /\bskills\b/);
  assert.match(ins.sql, /\baddress\b/);
  assert.match(ins.sql, /\bhas_garden\b/);
  assert.doesNotMatch(ins.sql, /\brole\b/, 'cannot self-set role via profile');
  assert.doesNotMatch(ins.sql, /\bapproved\b/, 'cannot self-approve via profile create');
  assert.doesNotMatch(ins.sql, /\bfoster_approved\b/, 'cannot self-set foster_approved');
});

test('create requires userId', async () => {
  await assert.rejects(() => Profile.create(null, {}), /userId is required/);
});

test('update throws when no valid fields', async () => {
  await assert.rejects(() => Profile.update(1, { hacker: 'x' }), /No profile fields/);
});

test('updateApprovalStatus coerces to 1/0', async () => {
  mock.setHandler(async (sql) => {
    if (/UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
    return [[{ user_id: 1, approved: 1 }]];
  });
  await Profile.updateApprovalStatus(1, true);
  const upd = mock.calls.find(c => /UPDATE/i.test(c.sql));
  assert.deepStrictEqual(upd.params, [1, 1]);
});

test('updateFosterApproved coerces to 1/0', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
    return [[{ user_id: 1, foster_approved: 1 }]];
  });
  await Profile.updateFosterApproved(1, true);
  const upd = mock.calls.find((c) => /foster_approved/i.test(c.sql));
  assert.deepStrictEqual(upd.params, [1, 1]);
});
