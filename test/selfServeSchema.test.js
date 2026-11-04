'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { TENANT_TABLES } = require('../utils/shelterContext');

const DB = path.join(__dirname, '..', 'database');
const schema = fs.readFileSync(path.join(DB, 'schema.pg.sql'), 'utf8');
const migration = fs.readFileSync(path.join(DB, '036_self_serve_shelters.pg.sql'), 'utf8');
const setupDb = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

const NEW_TABLES = ['shelter_applications', 'platform_owners', 'admin_invites'];

function tableBody(sql, table) {
  const m = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  assert.ok(m, `${table} table not found`);
  return m[1]
    .split('\n')
    .map((l) => l.trim().replace(/,$/, '').replace(/\s+/g, ' '))
    .filter(Boolean);
}

for (const table of NEW_TABLES) {
  test(`schema.pg.sql defines ${table} the same way as 036`, () => {
    assert.deepEqual(tableBody(schema, table), tableBody(migration, table));
  });

  test(`schema.pg.sql drops ${table} with the other tables`, () => {
    const drop = /DROP TABLE IF EXISTS([\s\S]*?)CASCADE;/.exec(schema);
    assert.ok(drop);
    assert.match(drop[1], new RegExp(`\\b${table}\\b`));
  });
}

test('036 keeps existing shelters working: new columns nullable, status defaults to active', () => {
  const adds = [...migration.matchAll(/ALTER TABLE shelters ADD COLUMN IF NOT EXISTS (\w+) (.+);/g)];
  const byName = Object.fromEntries(adds.map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(byName).sort(), [
    'charity_checked_at',
    'charity_number',
    'charity_register_name',
    'charity_regulator',
    'primary_colour',
    'privacy_contact_email',
    'status',
  ]);
  for (const [name, def] of Object.entries(byName)) {
    if (name === 'status') {
      assert.match(def, /NOT NULL DEFAULT 'active'/);
      assert.match(def, /CHECK \(status IN \('active','suspended'\)\)/);
    } else {
      assert.doesNotMatch(def, /NOT NULL/, `${name} must stay nullable for Assisi`);
    }
  }
  assert.match(migration, /WHERE id = 1 AND slug = 'assisi'/);
});

test('036 limits regulators to ccew, oscr, ccni, cri', () => {
  assert.match(migration, /CHECK \(charity_regulator IN \('ccew','oscr','ccni','cri'\)\)/);
  assert.match(migration, /CHECK \(regulator IN \('ccew','oscr','ccni','cri'\)\)/);
});

test('036 makes (charity_regulator, charity_number) unique only when both are set', () => {
  for (const sql of [migration, schema]) {
    assert.match(
      sql,
      /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?shelters_charity_key\s+ON shelters \(charity_regulator, charity_number\)\s+WHERE charity_regulator IS NOT NULL AND charity_number IS NOT NULL;/
    );
  }
});

test('shelter_applications status is pending, approved, or rejected', () => {
  assert.match(migration, /status IN \('pending','approved','rejected'\)/);
  assert.match(migration, /status\s+TEXT NOT NULL DEFAULT 'pending'/);
});

test('admin_invites is a tenant table with the 033 RLS pattern', () => {
  assert.ok(TENANT_TABLES.includes('admin_invites'));
  assert.match(migration, /ALTER TABLE admin_invites ENABLE ROW LEVEL SECURITY;/);
  assert.match(migration, /CREATE POLICY tenant_isolation ON admin_invites\s+FOR ALL\s+TO shelterlink_tenant/);
  assert.match(migration, /FOREIGN KEY \(shelter_id\) REFERENCES shelters \(id\) ON DELETE RESTRICT/);
  assert.match(migration, /CREATE TRIGGER trg_same_shelter\s+BEFORE INSERT OR UPDATE ON admin_invites/);
  assert.match(migration, /role IN \('admin','staff'\)/);
});

test('shelter_applications and platform_owners stay global and hidden from shelterlink_tenant', () => {
  for (const table of ['shelter_applications', 'platform_owners']) {
    assert.ok(!TENANT_TABLES.includes(table), `${table} must not be a tenant table`);
    assert.match(migration, new RegExp(`REVOKE ALL ON ${table} FROM shelterlink_tenant;`));
    assert.doesNotMatch(migration, new RegExp(`CREATE POLICY \\w+ ON ${table}`));
    assert.doesNotMatch(tableBody(migration, table).join('\n'), /shelter_id/);
  }
});

test('fresh setup applies 036 after 033', () => {
  const a = setupDb.indexOf("'033_add_shelters.pg.sql'");
  const b = setupDb.indexOf("'036_self_serve_shelters.pg.sql'");
  assert.ok(a > 0 && b > a);
});
