'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { createAdminAccount } = require('../services/adminAccount');

const shelters = [{ id: 1, slug: 'assisi', name: 'Assisi Animal Sanctuary' }];

function handler({ emailRows = [], insertId = 9 } = {}) {
  return async (sql) => {
    if (/FROM shelters/i.test(sql)) return [shelters];
    if (/FROM users/i.test(sql)) return [emailRows];
    if (/INSERT INTO users/i.test(sql)) return [{ insertId }];
    return [[]];
  };
}

test('createAdminAccount attaches the admin to the only shelter', async () => {
  mock.resetCalls();
  mock.setHandler(handler());
  const created = await createAdminAccount({
    name: 'Ada Lovelace',
    email: 'Ada@Example.com',
    password: 'NorthShelter1',
  });
  assert.strictEqual(created.userId, 9);
  assert.strictEqual(created.shelterId, 1);
  assert.strictEqual(created.slug, 'assisi');
  assert.strictEqual(created.email, 'ada@example.com');
  const insert = mock.calls.find((call) => /INSERT INTO users/i.test(call.sql));
  assert.ok(insert);
  assert.strictEqual(insert.params[0], 'Ada');
  assert.strictEqual(insert.params[1], 'Lovelace');
  assert.strictEqual(insert.params[3], 'ada@example.com');
  assert.strictEqual(insert.params[5], 1);
  assert.notStrictEqual(insert.params[4], 'NorthShelter1');
});

test('createAdminAccount refuses a short password before it writes', async () => {
  mock.resetCalls();
  mock.setHandler(handler());
  await assert.rejects(
    () => createAdminAccount({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'short',
    }),
    /at least 10 characters/
  );
  assert.strictEqual(mock.calls.length, 0);
});

test('createAdminAccount refuses an email that is already in use', async () => {
  mock.resetCalls();
  mock.setHandler(handler({ emailRows: [{ user_id: 3 }] }));
  await assert.rejects(
    () => createAdminAccount({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'NorthShelter1',
    }),
    /already in use/
  );
  assert.ok(!mock.calls.some((call) => /INSERT INTO users/i.test(call.sql)));
});

test('createAdminAccount asks for a slug when several shelters exist', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM shelters/i.test(sql)) {
      return [[
        { id: 1, slug: 'assisi', name: 'Assisi' },
        { id: 2, slug: 'north', name: 'North' },
      ]];
    }
    return [[]];
  });
  await assert.rejects(
    () => createAdminAccount({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'NorthShelter1',
    }),
    /Pass --shelter/
  );
});
