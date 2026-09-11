#!/usr/bin/env node
/**
 * ShelterLink — Database setup (Postgres)
 * ---------------------------------------------------------------------------
 * Rebuilds all tables from database/schema.pg.sql and (by default) loads
 * sample data from database/seed.pg.sql using the same connection as the app
 * (.env DATABASE_URL or DB_*).
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
 * schema.pg.sql DROPs and recreates every table — this destroys all data.
 * When NODE_ENV=production the script refuses to run without --force, and
 * refuses to seed demo accounts at all. Use `npm run migrate` to upgrade a
 * live database without data loss.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { pgPool, closePool } = require('../config/database');

const args = process.argv.slice(2);
const isProduction = process.env.NODE_ENV === 'production';
const forced = args.includes('--force');
const withSeed =
  !isProduction && (args.includes('--seed') || !args.includes('--no-seed'));

if (isProduction && !forced) {
  console.error('\n✗ Refusing to run in production: this DROPs every table.');
  console.error('  For a first-time production build this is expected — re-run with --force.');
  console.error('  To upgrade an existing production database without data loss: npm run migrate');
  process.exit(1);
}
if (isProduction && (args.includes('--seed'))) {
  console.error('\n✗ Refusing to load demo/sample data in production (--seed ignored in prod).');
  process.exit(1);
}

function describeTarget() {
  if (process.env.DATABASE_URL) {
    try {
      const u = new URL(process.env.DATABASE_URL);
      const db = u.pathname.replace(/^\//, '') || 'postgres';
      return `${u.hostname}:${u.port || 5432}  database "${db}"`;
    } catch {
      return '(DATABASE_URL)';
    }
  }
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const user = process.env.DB_USER || 'postgres';
  const name = process.env.DB_NAME || 'shelterlink';
  return `${user}@${host}:${port}  database "${name}"`;
}

function loadSql(file) {
  const full = path.join(__dirname, '..', 'database', file);
  return fs.readFileSync(full, 'utf8');
}

async function run() {
  console.log('ShelterLink database setup');
  console.log(`  Target: ${describeTarget()}`);
  console.log(`  Mode:   ${withSeed ? 'schema + sample data' : 'schema only'}`);

  try {
    await pgPool.query('SELECT 1');
  } catch (err) {
    console.error('\n✗ Could not connect to Postgres.');
    console.error(`  ${err.message}`);
    console.error('  Check that Postgres/Supabase is reachable and DATABASE_URL or DB_* are set.');
    process.exit(1);
  }

  try {
    console.log('\n→ Building schema...');
    await pgPool.query(loadSql('schema.pg.sql'));
    console.log('  ✓ Tables created.');

    if (withSeed) {
      console.log('→ Loading sample data...');
      await pgPool.query(loadSql('seed.pg.sql'));
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
    await closePool();
  }
}

run();
