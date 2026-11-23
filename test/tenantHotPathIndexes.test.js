'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, '..', 'database');
const MIGRATION = '057_tenant_hot_path_indexes.pg.sql';
const migration = fs.readFileSync(path.join(DB, MIGRATION), 'utf8');
const setupDb = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

const INDEXES = [
  'idx_opportunities_shelter_status_start',
  'idx_opportunities_shelter_start',
  'idx_applications_shelter_status_applied',
  'idx_applications_shelter_user_applied',
  'idx_applications_shelter_opportunity_status',
  'idx_vq_shelter_expires',
  'idx_waitlist_offers_shelter_status',
];

test('057 is the next free migration number after 056', () => {
  const files = fs
    .readdirSync(DB)
    .filter((f) => /^\d{3}_.+\.pg\.sql$/.test(f))
    .sort();
  assert.ok(files.includes('056_training_module_validity.pg.sql'));
  assert.ok(files.includes(MIGRATION));
  const after056 = files.filter((f) => f > '056_training_module_validity.pg.sql');
  assert.equal(after056[0], MIGRATION);
});

test('057 runs in a transaction and is safe to re-run', () => {
  assert.match(migration, /^BEGIN;$/m);
  assert.match(migration, /^COMMIT;$/m);
  for (const name of INDEXES) {
    assert.match(
      migration,
      new RegExp(`CREATE INDEX IF NOT EXISTS ${name}\\b`)
    );
  }
  assert.doesNotMatch(migration, /DROP TABLE/i);
  assert.doesNotMatch(migration, /DROP INDEX(?! IF EXISTS)/i);
});

test('057 indexes cover the hot tenant-scoped shapes', () => {
  assert.match(migration, /ON opportunities \(shelter_id, status, start_date\)/);
  assert.match(migration, /ON opportunities \(shelter_id, start_date\)/);
  assert.match(migration, /ON applications \(shelter_id, status, applied_at DESC\)/);
  assert.match(migration, /ON applications \(shelter_id, user_id, applied_at DESC\)/);
  assert.match(migration, /ON applications \(shelter_id, opportunity_id, status\)/);
  assert.match(migration, /ON volunteer_qualifications \(shelter_id, expires_at\)/);
  assert.match(migration, /ON waitlist_offers \(shelter_id, status\)/);
});

test('fresh setup applies 057 after 056', () => {
  const a = setupDb.indexOf("'056_training_module_validity.pg.sql'");
  const b = setupDb.indexOf(`'${MIGRATION}'`);
  assert.ok(a > 0 && b > a);
});

test('057 migration text is idempotent when concatenated (IF NOT EXISTS twice)', () => {
  // Static stand-in for apply-twice: every CREATE INDEX uses IF NOT EXISTS,
  // so concatenating the body with itself still only contains safe clauses.
  const body = migration
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  const twice = `${body}\n${body}`;
  const creates = twice.match(/CREATE INDEX IF NOT EXISTS/g) || [];
  assert.equal(creates.length, INDEXES.length * 2);
  assert.doesNotMatch(twice, /CREATE INDEX(?! IF NOT EXISTS)/);
});
