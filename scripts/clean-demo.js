#!/usr/bin/env node
/**
 * ShelterLink — Remove smoke-test rows from a demo database
 * ---------------------------------------------------------------------------
 * Deletes opportunities titled 'Smoke Test Shift %' (and their applications /
 * hours) and volunteers whose email matches 'smoke+%' (plus the older
 * 'smoke.vol.%' pattern used before plus-addressing).
 *
 * Use this after repeated `npm run smoke` runs so the demo stays clean
 * without a full `npm run db:reset`.
 *
 * Usage:
 *   npm run db:clean-demo
 *   node scripts/clean-demo.js
 */

require('dotenv').config();
const { pool, closePool } = require('../config/database');

const SMOKE_OPP_TITLE = 'Smoke Test Shift %';
const SMOKE_EMAILS = ['smoke+%', 'smoke.vol.%'];

async function run() {
  console.log('ShelterLink clean-demo');

  let connection;
  try {
    connection = await pool.getConnection();
  } catch (err) {
    console.error('\n✗ Could not connect to Postgres.');
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  try {
    const [oppRows] = await connection.execute(
      'SELECT opportunity_id, title FROM opportunities WHERE title LIKE ?',
      [SMOKE_OPP_TITLE]
    );

    const emailClauses = SMOKE_EMAILS.map(() => 'email LIKE ?').join(' OR ');
    const [userRows] = await connection.execute(
      `SELECT user_id, email FROM users WHERE ${emailClauses}`,
      SMOKE_EMAILS
    );

    const oppIds = oppRows.map((r) => r.opportunity_id);
    const userIds = userRows.map((r) => r.user_id);

    if (!oppIds.length && !userIds.length) {
      console.log('\n  Nothing to clean. Demo is already free of smoke-test rows.');
      return;
    }

    await connection.beginTransaction();

    const oppPh = oppIds.map(() => '?').join(', ');
    const userPh = userIds.map(() => '?').join(', ');

    if (oppIds.length && userIds.length) {
      await connection.execute(
        `DELETE FROM volunteer_hours WHERE opportunity_id IN (${oppPh}) OR user_id IN (${userPh})`,
        [...oppIds, ...userIds]
      );
    } else if (oppIds.length) {
      await connection.execute(
        `DELETE FROM volunteer_hours WHERE opportunity_id IN (${oppPh})`,
        oppIds
      );
    } else if (userIds.length) {
      await connection.execute(
        `DELETE FROM volunteer_hours WHERE user_id IN (${userPh})`,
        userIds
      );
    }

    if (oppIds.length) {
      const ph = oppIds.map(() => '?').join(', ');
      await connection.execute(
        `DELETE FROM opportunities WHERE opportunity_id IN (${ph})`,
        oppIds
      );
    }

    if (userIds.length) {
      const ph = userIds.map(() => '?').join(', ');
      await connection.execute(
        `DELETE FROM users WHERE user_id IN (${ph})`,
        userIds
      );
    }

    await connection.commit();

    console.log(`\n  Removed ${oppIds.length} smoke-test shift(s):`);
    oppRows.forEach((r) => console.log(`    - #${r.opportunity_id} ${r.title}`));
    console.log(`  Removed ${userIds.length} smoke-test volunteer(s):`);
    userRows.forEach((r) => console.log(`    - #${r.user_id} ${r.email}`));
    console.log('\n✓ Demo cleaned.');
  } catch (err) {
    try {
      if (connection) await connection.rollback();
    } catch {
      // ignore rollback errors
    }
    console.error('\n✗ Clean failed:', err.message);
    process.exit(1);
  } finally {
    if (connection) connection.release();
    await closePool();
  }
}

run();
