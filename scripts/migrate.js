#!/usr/bin/env node
/**
 * ShelterLink — Incremental migrations (Postgres)
 * ---------------------------------------------------------------------------
 * Applies numbered migration files from database/ (001_*.pg.sql, ...)
 * to an EXISTING database, tracking what has already run in
 * schema_migrations. Use this to upgrade a live database without
 * wiping data. For a fresh install use `npm run db:reset` instead
 * (schema.pg.sql already includes every change).
 *
 * Usage:
 *   npm run migrate            # apply all pending migrations
 *   node scripts/migrate.js --dry-run   # list pending, change nothing
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { pgPool, pool, closePool } = require('../config/database');

const dryRun = process.argv.includes('--dry-run');

async function run() {
  const dir = path.join(__dirname, '..', 'database');
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.pg\.sql$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log('No .pg.sql migration files found in database/.');
    await closePool();
    return;
  }

  try {
    await pgPool.query('SELECT 1');
  } catch (err) {
    console.error('✗ Could not connect to Postgres.');
    console.error(`  ${err.message}`);
    console.error('  Check that Postgres/Supabase is reachable and DATABASE_URL or DB_* are set.');
    process.exit(1);
  }

  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [rows] = await pool.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('✓ Database is up to date. Nothing to apply.');
      return;
    }

    console.log(`${pending.length} pending migration(s):`);
    pending.forEach((f) => console.log(`  - ${f}`));

    if (dryRun) {
      console.log('\nDry run: no changes made.');
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8').trim();
      process.stdout.write(`→ Applying ${file}... `);
      try {
        await pgPool.query(sql);
        await pool.execute(
          'INSERT INTO schema_migrations (filename) VALUES (?) ON CONFLICT (filename) DO NOTHING',
          [file]
        );
        console.log('✓');
      } catch (err) {
        // Already present (folded into schema.pg.sql): record and continue.
        if (err.code === '42701' || err.code === '42P07' || err.code === '42710') {
          await pool.execute(
            'INSERT INTO schema_migrations (filename) VALUES (?) ON CONFLICT (filename) DO NOTHING',
            [file]
          );
          console.log('already in schema, recorded as applied');
        } else {
          console.log('✗');
          console.error(`\n✗ Migration ${file} failed: ${err.message}`);
          console.error('  Nothing after this file was applied. Fix the migration and re-run.');
          process.exit(1);
        }
      }
    }

    console.log('\n✓ All migrations applied.');
  } finally {
    await closePool();
  }
}

run();
