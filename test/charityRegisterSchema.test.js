'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { TENANT_TABLES } = require('../utils/shelterContext');
const { REGULATORS } = require('../services/charityRegister/formats');

const DB = path.join(__dirname, '..', 'database');
const schema = fs.readFileSync(path.join(DB, 'schema.pg.sql'), 'utf8');
const migration = fs.readFileSync(path.join(DB, '037_charity_register_cache.pg.sql'), 'utf8');
const setupDb = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

function tableBody(sql, table) {
  const m = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  assert.ok(m, `${table} table not found`);
  return m[1]
    .split('\n')
    .map((l) => l.trim().replace(/,$/, '').replace(/\s+/g, ' '))
    .filter(Boolean);
}

test('schema.pg.sql defines charity_register_cache the same way as 037', () => {
  assert.deepEqual(tableBody(schema, 'charity_register_cache'), tableBody(migration, 'charity_register_cache'));
});

test('schema.pg.sql drops charity_register_cache with the other tables', () => {
  const drop = /DROP TABLE IF EXISTS([\s\S]*?)CASCADE;/.exec(schema);
  assert.ok(drop);
  assert.match(drop[1], /\bcharity_register_cache\b/);
});

test('charity_register_cache is global and hidden from shelterlink_tenant', () => {
  assert.ok(!TENANT_TABLES.includes('charity_register_cache'));
  assert.match(migration, /REVOKE ALL ON charity_register_cache FROM shelterlink_tenant;/);
  assert.doesNotMatch(migration, /CREATE POLICY/);
  assert.doesNotMatch(migration, /GRANT /);
  assert.doesNotMatch(tableBody(migration, 'charity_register_cache').join('\n'), /shelter_id/);
});

test('charity_register_cache regulators match formats.js and statuses are fixed', () => {
  const m = /regulator IN \(([^)]*)\)/.exec(migration);
  assert.deepEqual(m[1].replace(/'/g, '').split(','), [...REGULATORS]);
  assert.match(migration, /status IN \('registered','removed','unknown'\)/);
  assert.match(migration, /PRIMARY KEY \(regulator, charity_number\)/);
});

test('037 runs in a transaction and is safe to re-run', () => {
  assert.match(migration, /^BEGIN;$/m);
  assert.match(migration, /^COMMIT;$/m);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS charity_register_cache/);
});

test('fresh setup applies 037 after 036', () => {
  const a = setupDb.indexOf("'036_self_serve_shelters.pg.sql'");
  const b = setupDb.indexOf("'037_charity_register_cache.pg.sql'");
  assert.ok(a > 0 && b > a);
});
