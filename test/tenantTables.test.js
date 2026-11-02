'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { TENANT_TABLES } = require('../utils/shelterContext');

function migrationTables() {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'database', '033_add_shelters.pg.sql'),
    'utf8'
  );
  const block = sql.match(/tables text\[\] := ARRAY\[([\s\S]*?)\];/);
  assert.ok(block, 'migration 033 has a tables array');
  return [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
}

test('TENANT_TABLES matches the shelter_id tables in migration 033', () => {
  const fromMigration = migrationTables();
  const expected = [...fromMigration, 'shelters'].sort();
  const actual = [...TENANT_TABLES].sort();
  assert.deepEqual(actual, expected);
});
