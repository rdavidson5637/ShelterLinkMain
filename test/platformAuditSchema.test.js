'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { TENANT_TABLES } = require('../utils/shelterContext');

const DB = path.join(__dirname, '..', 'database');
const schema = fs.readFileSync(path.join(DB, 'schema.pg.sql'), 'utf8');
const migration = fs.readFileSync(path.join(DB, '038_platform_audit.pg.sql'), 'utf8');
const setupDb = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

function tableBody(sql, table) {
  const m = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  assert.ok(m, `${table} table not found`);
  return m[1]
    .split('\n')
    .map((l) => l.trim().replace(/,$/, '').replace(/\s+/g, ' '))
    .filter(Boolean);
}

test('schema.pg.sql defines platform_audit the same way as 038', () => {
  assert.deepEqual(tableBody(schema, 'platform_audit'), tableBody(migration, 'platform_audit'));
});

test('schema.pg.sql drops platform_audit with the other tables', () => {
  const drop = /DROP TABLE IF EXISTS([\s\S]*?)CASCADE;/.exec(schema);
  assert.ok(drop);
  assert.match(drop[1], /\bplatform_audit\b/);
});

test('platform_audit is global and hidden from shelterlink_tenant', () => {
  assert.ok(!TENANT_TABLES.includes('platform_audit'));
  assert.match(migration, /REVOKE ALL ON platform_audit FROM shelterlink_tenant;/);
  assert.match(migration, /REVOKE ALL ON SEQUENCE platform_audit_id_seq FROM shelterlink_tenant;/);
  assert.doesNotMatch(migration, /CREATE POLICY/);
  assert.doesNotMatch(migration, /GRANT /);
  assert.doesNotMatch(tableBody(migration, 'platform_audit').join('\n'), /\bshelter_id\b/);
});

test('platform_audit only accepts the four platform actions', () => {
  const m = /action IN \(([^)]*)\)/.exec(migration);
  assert.deepEqual(m[1].replace(/'/g, '').split(',').sort(), [
    'application.approved',
    'application.rejected',
    'invite.created',
    'shelter.suspended',
  ]);
});

test('038 runs in a transaction and is safe to re-run', () => {
  assert.match(migration, /^BEGIN;$/m);
  assert.match(migration, /^COMMIT;$/m);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS platform_audit/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS platform_audit_created_at_idx/);
});

test('fresh setup applies 038 after 037', () => {
  const a = setupDb.indexOf("'037_charity_register_cache.pg.sql'");
  const b = setupDb.indexOf("'038_platform_audit.pg.sql'");
  assert.ok(a > 0 && b > a);
});
