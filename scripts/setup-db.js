#!/usr/bin/env node
/**
 * ShelterLink — Database setup
 * ---------------------------------------------------------------------------
 * Creates the database, builds all tables from database/schema.sql, and
 * (by default) loads sample data from database/seed.sql — using the same
 * connection settings as the app (.env).
 *
 * Usage:
 *   node scripts/setup-db.js            # schema + sample data (default)
 *   node scripts/setup-db.js --no-seed  # schema only, empty database
 *   node scripts/setup-db.js --seed     # explicit schema + sample data
 *
 * or via npm:
 *   npm run db:setup      # schema only
 *   npm run db:reset      # schema + sample data (fresh start)
 *
 * Safe to re-run: schema.sql drops and recreates tables, so this resets the
 * database to a known-good state each time.
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

const args = process.argv.slice(2);
const withSeed = args.includes('--seed') || !args.includes('--no-seed');

/**
 * Read a .sql file and strip the leading CREATE DATABASE / USE statements so
 * the target database name always comes from .env (DB_NAME), not a hard-coded
 * value in the file.
 */
function loadSql(file) {
  const full = path.join(__dirname, '..', 'database', file);
  const raw = fs.readFileSync(full, 'utf8');
  return raw
    // Remove the (possibly multi-line) CREATE DATABASE statement.
    .replace(/CREATE\s+DATABASE[\s\S]*?;/i, '')
    // Remove any USE <db>; statements.
    .replace(/^\s*USE\s+`?[A-Za-z0-9_]+`?\s*;/gim, '')
    .trim();
}

async function run() {
  console.log('ShelterLink database setup');
  console.log(`  Target: ${DB_USER}@${DB_HOST}:${DB_PORT}  database "${DB_NAME}"`);
  console.log(`  Mode:   ${withSeed ? 'schema + sample data' : 'schema only'}`);

  let connection;
  try {
    connection = await mysql.createConnection({
      host: DB_HOST,
      port: Number(DB_PORT),
      user: DB_USER,
      password: DB_PASSWORD,
      multipleStatements: true,
    });
  } catch (err) {
    console.error('\n✗ Could not connect to MySQL.');
    console.error(`  ${err.message}`);
    console.error('  Check that MySQL/MAMP is running and your .env DB_* values are correct.');
    process.exit(1);
  }

  try {
    // Full reset: drop the entire database so leftover tables from older
    // versions (with foreign keys the current schema doesn't know about)
    // can never block the rebuild.
    await connection.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    await connection.query(
      `CREATE DATABASE \`${DB_NAME}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.changeUser({ database: DB_NAME });

    console.log('\n→ Building schema...');
    await connection.query(loadSql('schema.sql'));
    console.log('  ✓ Tables created.');

    if (withSeed) {
      console.log('→ Loading sample data...');
      await connection.query(loadSql('seed.sql'));
      console.log('  ✓ Sample data loaded.');
      console.log('\n  Login credentials:');
      console.log('    Admin      admin@shelterlink.org   /  Admin123!');
      console.log('    Volunteer  alex.jenkins@example.com /  Password1');
    }

    console.log('\n✓ Done. Start the app with:  npm run dev');
  } catch (err) {
    console.error('\n✗ Setup failed:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

run();
