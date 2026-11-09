#!/usr/bin/env node
'use strict';

/**
 * CI check: migration 039 applies cleanly on top of a database at 038.
 *
 * Builds a throwaway database the way an existing install looks before this
 * deploy (schema.pg.sql, then 033, 036, 037, 038, with some platform_audit
 * rows of every pre-039 action), applies 039 twice, and checks that:
 *   - the old rows are kept,
 *   - 'shelter.reactivated' is now accepted,
 *   - an unknown action is still refused.
 * Then drops the database.
 *
 * Local Postgres only. Set MIGRATION_CHECK_DATABASE_URL to a maintenance
 * URL on localhost (CI uses the postgres service container). The check
 * creates and drops its own database, shelterlink_migration_check, and
 * refuses any other host.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { applySql } = require('./applySql');

const DB_NAME = 'shelterlink_migration_check';
const ROOT = path.join(__dirname, '..', 'database');
const OLD_ACTIONS = ['application.approved', 'application.rejected', 'invite.created', 'shelter.suspended'];

function urls() {
  const raw = process.env.MIGRATION_CHECK_DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/postgres';
  const maintenance = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(maintenance.hostname)) {
    throw new Error('Refusing to run the migration check against a non-local database.');
  }
  const target = new URL(raw);
  target.pathname = `/${DB_NAME}`;
  return { maintenance: maintenance.toString(), target: target.toString() };
}

async function withClient(url, fn) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function recreate(maintenanceUrl, { drop = false } = {}) {
  await withClient(maintenanceUrl, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    if (!drop) await c.query(`CREATE DATABASE ${DB_NAME}`);
  });
}

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

async function main() {
  const { maintenance, target } = urls();
  await recreate(maintenance);
  try {
    await withClient(target, async (db) => {
      await db.query(read('schema.pg.sql'));
      for (const file of ['033_add_shelters.pg.sql', '036_self_serve_shelters.pg.sql',
        '037_charity_register_cache.pg.sql', '038_platform_audit.pg.sql']) {
        await applySql(db, read(file));
      }
      for (const action of OLD_ACTIONS) {
        await db.query('INSERT INTO platform_audit (action, detail) VALUES ($1, $2)', [action, { check: true }]);
      }
      // Before 039, reactivation is refused: proves we really started at 038.
      let refusedBefore = false;
      try {
        await db.query("INSERT INTO platform_audit (action) VALUES ('shelter.reactivated')");
      } catch (error) {
        refusedBefore = error.code === '23514';
      }
      if (!refusedBefore) throw new Error('038 baseline already accepted shelter.reactivated');

      const migration = read('039_platform_audit_reactivate.pg.sql');
      await applySql(db, migration);
      await applySql(db, migration); // rerunnable

      const kept = await db.query('SELECT action FROM platform_audit ORDER BY id');
      const actions = kept.rows.map((r) => r.action);
      if (JSON.stringify(actions) !== JSON.stringify(OLD_ACTIONS)) {
        throw new Error(`existing platform_audit rows changed: ${JSON.stringify(actions)}`);
      }
      await db.query("INSERT INTO platform_audit (action) VALUES ('shelter.reactivated')");
      let refusedUnknown = false;
      try {
        await db.query("INSERT INTO platform_audit (action) VALUES ('shelter.deleted')");
      } catch (error) {
        refusedUnknown = error.code === '23514';
      }
      if (!refusedUnknown) throw new Error('039 let an unknown action through');
    });
    console.log('Migration check passed: 039 applies on top of 038, twice, keeping existing rows.');
  } finally {
    await recreate(maintenance, { drop: true });
  }
}

main().catch((error) => {
  console.error(`Migration check failed: ${error.message}`);
  process.exitCode = 1;
});
