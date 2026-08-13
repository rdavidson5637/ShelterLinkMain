#!/usr/bin/env node
/**
 * ShelterLink — Incremental migrations
 * ---------------------------------------------------------------------------
 * Applies numbered migration files from database/ (001_*.sql, 002_*.sql, ...)
 * to an EXISTING database, tracking what has already run in a
 * schema_migrations table. Use this to upgrade a live database without
 * wiping data. For a fresh install use `npm run db:reset` instead
 * (schema.sql already includes every migration).
 *
 * Usage:
 *   npm run migrate            # apply all pending migrations
 *   node scripts/migrate.js --dry-run   # list pending, change nothing
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const {
  DB_HOST = 'localhost',
  DB_PORT = '8889',
  DB_USER = 'root',
  DB_PASSWORD = 'root',
  DB_NAME = 'ShelterLink',
} = process.env;

const dryRun = process.argv.includes('--dry-run');

async function run() {
  const dir = path.join(__dirname, '..', 'database');
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found in database/.');
    return;
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      host: DB_HOST,
      port: Number(DB_PORT),
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      multipleStatements: true,
    });
  } catch (err) {
    console.error('✗ Could not connect to MySQL.');
    console.error(`  ${err.message}`);
    console.error('  Check that MySQL/MAMP is running and your .env DB_* values are correct.');
    process.exit(1);
  }

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [rows] = await connection.query('SELECT filename FROM schema_migrations');
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
        await connection.query(sql);
        await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
        console.log('✓');
      } catch (err) {
        // Column/table already exists: schema.sql was built with this change
        // folded in, so record it as applied and move on.
        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_TABLE_EXISTS_ERROR' || err.code === 'ER_DUP_KEYNAME') {
          await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
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
    await connection.end();
  }
}

run();
