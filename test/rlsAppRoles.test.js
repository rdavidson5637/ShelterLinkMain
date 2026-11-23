'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  roleForQuery,
  isSessionOnlySql,
  isGlobalOpsSql,
} = require('../config/database');

const ROOT = path.join(__dirname, '..');
const MIGRATION = '062_app_roles_no_bypass.pg.sql';
const migration = fs.readFileSync(path.join(ROOT, 'database', MIGRATION), 'utf8');

test('062 creates non-bypass app and platform roles without touching postgres BYPASSRLS', () => {
  assert.match(migration, /CREATE ROLE shelterlink_app NOLOGIN NOBYPASSRLS;/);
  assert.match(migration, /CREATE ROLE shelterlink_platform NOLOGIN NOBYPASSRLS;/);
  assert.match(migration, /GRANT shelterlink_app TO postgres;/);
  assert.match(migration, /GRANT shelterlink_platform TO postgres;/);
  assert.match(migration, /GRANT shelterlink_app TO CURRENT_USER;/);
  assert.doesNotMatch(migration, /REVOKE\s+BYPASSRLS/i);
  assert.doesNotMatch(migration, /NOBYPASSRLS\s+FROM\s+postgres/i);
  assert.doesNotMatch(migration, /ALTER ROLE postgres/i);
});

test('062 grants the session store and ops tables only to shelterlink_app', () => {
  assert.match(migration, /CREATE POLICY app_session_all ON session/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON session TO shelterlink_app;/);
  assert.match(migration, /CREATE POLICY app_job_runs_all ON job_runs/);
  assert.match(migration, /CREATE POLICY app_rate_limit_hits_all ON rate_limit_hits/);
  assert.match(migration, /REVOKE ALL ON TABLE schema_migrations FROM shelterlink_app;/);
  assert.match(migration, /REVOKE ALL ON TABLE schema_migrations FROM shelterlink_platform;/);
});

test('062 adds an explicit platform_unscoped policy on existing RLS tables', () => {
  assert.match(migration, /CREATE POLICY platform_unscoped ON %I FOR ALL TO shelterlink_platform USING \(true\) WITH CHECK \(true\)/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO shelterlink_platform;/);
});

test('roleForQuery uses tenant, platform, or fail-closed app roles — never the login role', () => {
  assert.equal(roleForQuery('SELECT * FROM opportunities', { shelterId: 1 }), 'shelterlink_tenant');
  assert.equal(roleForQuery('SELECT * FROM opportunities', { bypass: true }), 'shelterlink_platform');
  assert.equal(roleForQuery('SELECT * FROM opportunities', null), 'shelterlink_app');
  assert.equal(roleForQuery('SELECT * FROM opportunities', {}), 'shelterlink_app');
  assert.equal(roleForQuery('SELECT * FROM session WHERE sid = $1', { shelterId: 1 }), 'shelterlink_app');
  assert.equal(roleForQuery('INSERT INTO job_runs (job_name) VALUES ($1)', null), 'shelterlink_app');
  assert.equal(roleForQuery('SELECT * FROM rate_limit_hits', { shelterId: 2 }), 'shelterlink_app');
  assert.equal(isSessionOnlySql('DELETE FROM session WHERE sid = $1'), true);
  assert.equal(isSessionOnlySql('SELECT * FROM users'), false);
  assert.equal(isGlobalOpsSql('DELETE FROM rate_limit_hits WHERE key = $1'), true);
  assert.equal(isGlobalOpsSql('SELECT * FROM users u JOIN job_runs j ON true'), false);
});
