'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mock = require('./helpers/mockDb');
const User = require('../models/User');

test('toSafeUser strips password and splits name', () => {
  const safe = User._toSafeUser({ user_id: 1, name: 'Rhian Morgan', email: 'a@b.c', password: 'secret', role: 'admin' });
  assert.strictEqual(safe.password, undefined, 'password removed');
  assert.strictEqual(safe.first_name, 'Rhian');
  assert.strictEqual(safe.last_name, 'Morgan');
  assert.strictEqual(safe.role, 'admin');
});

test('toSafeUser handles single-word and empty names', () => {
  assert.strictEqual(User._toSafeUser({ name: 'Cher' }).last_name, '');
  assert.strictEqual(User._toSafeUser(null), null);
});

test('findByEmail returns the raw row including password (for auth compare)', async () => {
  mock.setHandler(async () => [[{ user_id: 5, email: 'x@y.z', password: 'hash', role: 'volunteer' }]]);
  const row = await User.findByEmail('x@y.z');
  assert.strictEqual(row.password, 'hash');
  assert.match(mock.lastCall().sql, /FROM\s+users/i);
  assert.deepStrictEqual(mock.lastCall().params, ['x@y.z']);
});
