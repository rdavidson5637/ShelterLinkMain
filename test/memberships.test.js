'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mock = require('./helpers/mockDb');

const Membership = require('../models/Membership');
const { TENANT_TABLES, runWithShelter } = require('../utils/shelterContext');

const DB = path.join(__dirname, '..', 'database');
const schema = fs.readFileSync(path.join(DB, 'schema.pg.sql'), 'utf8');
const migration = fs.readFileSync(path.join(DB, '048_memberships.pg.sql'), 'utf8');
const setupDb = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

function tableBody(sql, table) {
  const m = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  assert.ok(m, `${table} table not found`);
  return m[1]
    .split('\n')
    .map((l) => l.trim().replace(/,$/, '').replace(/\s+/g, ' '))
    .filter(Boolean);
}

test('schema.pg.sql defines memberships the same way as 048', () => {
  assert.deepEqual(tableBody(schema, 'memberships'), tableBody(migration, 'memberships'));
});

test('schema.pg.sql drops memberships with the other tables', () => {
  const drop = /DROP TABLE IF EXISTS([\s\S]*?)CASCADE;/.exec(schema);
  assert.ok(drop);
  assert.match(drop[1], /\bmemberships\b/);
});

test('memberships is a tenant table with the 033 RLS pattern', () => {
  assert.ok(TENANT_TABLES.includes('memberships'));
  assert.match(migration, /ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;/);
  assert.match(
    migration,
    /CREATE POLICY tenant_isolation ON memberships\s+FOR ALL\s+TO shelterlink_tenant/
  );
  assert.match(migration, /FOREIGN KEY \(shelter_id\) REFERENCES shelters \(id\) ON DELETE RESTRICT/);
  assert.match(migration, /UNIQUE \(user_id, shelter_id\)/);
  assert.match(migration, /role IN \('volunteer', 'staff', 'admin'\)/);
});

test('048 backfills from users and syncs primary membership on user changes', () => {
  assert.match(migration, /INSERT INTO memberships[\s\S]*FROM users u/);
  assert.match(migration, /WHERE u\.shelter_id IS NOT NULL/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION sync_user_membership/);
  assert.match(migration, /AFTER INSERT OR UPDATE OF shelter_id, role ON users/);
  assert.doesNotMatch(migration, /PERFORM assert_same_shelter/);
  assert.doesNotMatch(migration, /CREATE TRIGGER trg_same_shelter/);
});

test('fresh setup applies 048 after 033', () => {
  const a = setupDb.indexOf("'033_add_shelters.pg.sql'");
  const b = setupDb.indexOf("'048_memberships.pg.sql'");
  assert.ok(a >= 0 && b > a);
});

test('ensure upserts a membership without inventing a role', async () => {
  mock.resetCalls();
  let inserted = null;
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO memberships/i.test(sql)) {
      inserted = params;
      return [{ insertId: 3, affectedRows: 1 }];
    }
    if (/FROM memberships m/i.test(sql) && /m\.user_id = \?/i.test(sql)) {
      return [
        [
          {
            id: 3,
            user_id: 7,
            shelter_id: 1,
            role: 'volunteer',
            created_at: '2026-11-23',
            updated_at: '2026-11-23',
            shelter_name: 'Assisi',
            shelter_slug: 'assisi',
          },
        ],
      ];
    }
    return [[], []];
  });

  const row = await Membership.ensure({ userId: 7, shelterId: 1, role: 'volunteer' });
  assert.deepEqual(inserted, [7, 1, 'volunteer']);
  assert.equal(row.shelter_slug, 'assisi');
  assert.equal(row.role, 'volunteer');

  await assert.rejects(
    () => Membership.ensure({ userId: 7, shelterId: 1, role: 'owner' }),
    (err) => err.status === 400
  );
});

test('listForUser reads across shelters via bypass', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM memberships m/i.test(sql)) {
      return [
        [
          {
            id: 1,
            user_id: 7,
            shelter_id: 1,
            role: 'volunteer',
            created_at: '2026-11-01',
            updated_at: '2026-11-01',
            shelter_name: 'Assisi',
            shelter_slug: 'assisi',
          },
          {
            id: 2,
            user_id: 7,
            shelter_id: 2,
            role: 'staff',
            created_at: '2026-11-02',
            updated_at: '2026-11-02',
            shelter_name: 'Other',
            shelter_slug: 'other',
          },
        ],
      ];
    }
    return [[], []];
  });

  const rows = await runWithShelter(1, () => Membership.listForUser(7));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].role, 'staff');
  assert.equal(rows[1].shelter_id, 2);
});

test('listMyMemberships returns the signed-in user memberships', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM memberships m/i.test(sql)) {
      return [
        [
          {
            id: 1,
            user_id: 9,
            shelter_id: 1,
            role: 'admin',
            created_at: '2026-11-01',
            updated_at: '2026-11-01',
            shelter_name: 'Assisi',
            shelter_slug: 'assisi',
          },
        ],
      ];
    }
    return [[], []];
  });

  const authController = require('../controllers/authController');
  const req = { session: { userId: 9 } };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await authController.listMyMemberships(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.memberships.length, 1);
  assert.equal(res.body.memberships[0].role, 'admin');
});
