'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

test('CI applies migration 039 on top of 038 before the unit tests', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const step = ci.indexOf('node scripts/check-migration-039.js');
  assert.ok(step > 0, 'the check runs in CI');
  assert.ok(step < ci.indexOf('- run: npm test'), 'before npm test');
  assert.match(ci, /MIGRATION_CHECK_DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/postgres/);
});

test('the migration check refuses a non-local database', () => {
  const out = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-migration-039.js')], {
    env: { ...process.env, MIGRATION_CHECK_DATABASE_URL: 'postgresql://u:p@db.example.com:5432/postgres' },
    encoding: 'utf8',
  });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /non-local database/);
});
