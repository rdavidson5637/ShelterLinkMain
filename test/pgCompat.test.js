'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  translatePlaceholders,
  mapInsertId,
  ensureReturning,
  shapeExecuteResult,
} = require('../config/database');

test('translatePlaceholders maps ? to $1..$n', () => {
  const { sql, params } = translatePlaceholders(
    'SELECT * FROM users WHERE email = ? AND role = ?',
    ['a@b.com', 'admin']
  );
  assert.strictEqual(sql, 'SELECT * FROM users WHERE email = $1 AND role = $2');
  assert.deepStrictEqual(params, ['a@b.com', 'admin']);
});

test('translatePlaceholders leaves a literal ? inside single quotes', () => {
  const { sql, params } = translatePlaceholders(
    "SELECT * FROM t WHERE note = '?' AND id = ?",
    [9]
  );
  assert.strictEqual(sql, "SELECT * FROM t WHERE note = '?' AND id = $1");
  assert.deepStrictEqual(params, [9]);
});

test('translatePlaceholders ignores ? inside doubled-quote SQL strings', () => {
  const { sql, params } = translatePlaceholders(
    "SELECT * FROM t WHERE note = 'it''s a ? mark' AND id = ?",
    [4]
  );
  assert.strictEqual(sql, "SELECT * FROM t WHERE note = 'it''s a ? mark' AND id = $1");
  assert.deepStrictEqual(params, [4]);
});

test('translatePlaceholders ignores ? inside double-quoted identifiers', () => {
  const { sql } = translatePlaceholders(
    'SELECT "?" FROM t WHERE id = ?',
    [2]
  );
  assert.strictEqual(sql, 'SELECT "?" FROM t WHERE id = $1');
});

test('translatePlaceholders handles multiple mixed params', () => {
  const { sql, params } = translatePlaceholders(
    'INSERT INTO applications (user_id, opportunity_id, status) VALUES (?, ?, ?)',
    [1, 2, 'pending']
  );
  assert.strictEqual(
    sql,
    'INSERT INTO applications (user_id, opportunity_id, status) VALUES ($1, $2, $3)'
  );
  assert.deepStrictEqual(params, [1, 2, 'pending']);
});

test('mapInsertId uses the first id / *_id column', () => {
  assert.strictEqual(mapInsertId({ user_id: 7, name: 'Alex' }), 7);
  assert.strictEqual(mapInsertId({ id: 3, user_id: 9 }), 3);
  assert.strictEqual(mapInsertId({ name: 'x', record_id: 12 }), 12);
  assert.strictEqual(mapInsertId({ name: 'none' }), undefined);
  assert.strictEqual(mapInsertId(undefined), undefined);
});

test('ensureReturning appends RETURNING * on INSERT without one', () => {
  assert.strictEqual(
    ensureReturning('INSERT INTO users (email) VALUES (?)'),
    'INSERT INTO users (email) VALUES (?) RETURNING *'
  );
  assert.strictEqual(
    ensureReturning('INSERT INTO users (email) VALUES (?) RETURNING user_id'),
    'INSERT INTO users (email) VALUES (?) RETURNING user_id'
  );
  assert.strictEqual(
    ensureReturning('UPDATE users SET name = ? WHERE user_id = ?'),
    'UPDATE users SET name = ? WHERE user_id = ?'
  );
});

test('shapeExecuteResult maps INSERT rows to insertId + affectedRows', () => {
  const [result] = shapeExecuteResult('INSERT INTO users (email) VALUES (?)', {
    rows: [{ user_id: 42, email: 'a@b.com' }],
    rowCount: 1,
  });
  assert.strictEqual(result.insertId, 42);
  assert.strictEqual(result.affectedRows, 1);
});

test('shapeExecuteResult maps UPDATE/DELETE to affectedRows', () => {
  const [upd] = shapeExecuteResult('UPDATE users SET name = ? WHERE user_id = ?', {
    rows: [],
    rowCount: 1,
  });
  assert.strictEqual(upd.affectedRows, 1);

  const [del] = shapeExecuteResult('DELETE FROM applications WHERE application_id = ?', {
    rows: [],
    rowCount: 0,
  });
  assert.strictEqual(del.affectedRows, 0);
});

test('shapeExecuteResult returns row arrays for SELECT', () => {
  const rows = [{ user_id: 1 }];
  const [out] = shapeExecuteResult('SELECT * FROM users WHERE user_id = ?', {
    rows,
    rowCount: 1,
  });
  assert.deepStrictEqual(out, rows);
});
