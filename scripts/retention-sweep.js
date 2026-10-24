#!/usr/bin/env node
'use strict';

/**
 * Prints personal-data rows past the retention periods in config/retention.js.
 * Removes nothing unless you pass --apply. A null period is skipped.
 * Do not point this at production until a backup exists.
 */

const { periods, cutoffFrom } = require('../config/retention');
const { pool } = require('../config/database');
const Gdpr = require('../models/Gdpr');

async function count(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return Number(rows[0] && rows[0].n) || 0;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const now = new Date();
  const config = periods();
  const plan = [];

  if (config.inactiveVolunteerYears == null) {
    plan.push(['inactive volunteer accounts', 'skip', 'period is not set']);
  } else {
    const cutoff = cutoffFrom(now, config.inactiveVolunteerYears, 'years');
    const n = await count(
      `SELECT COUNT(*)::int AS n FROM users
       WHERE role = 'volunteer' AND anonymised_at IS NULL
         AND COALESCE(last_login, created_at) < ?`,
      [cutoff]
    );
    plan.push([
      'inactive volunteer accounts',
      apply ? 'anonymise' : 'would anonymise',
      `${n} accounts older than ${cutoff.toISOString()}. Hour rows are kept.`,
    ]);
    if (apply && n) await Gdpr.runDataRetention(now);
  }

  if (config.applicationYears == null) {
    plan.push(['applications', 'skip', 'period is not set']);
  } else {
    plan.push([
      'applications',
      'skip',
      'Not deleted. Feedback, swaps and animal activity reference application rows. Anonymising the volunteer removes the name.',
    ]);
  }

  if (config.hoursYears == null) {
    plan.push(['hours records', 'skip', 'period is not set']);
  } else {
    plan.push([
      'hours records',
      'skip',
      'Not deleted. Approved hours stay so community-service totals still add up. The volunteer row is anonymised instead.',
    ]);
  }

  if (config.auditLogYears == null) {
    plan.push(['audit logs', 'skip', 'period is not set']);
  } else {
    const cutoff = cutoffFrom(now, config.auditLogYears, 'years');
    const n = await count('SELECT COUNT(*)::int AS n FROM audit_log WHERE created_at < ?', [cutoff]);
    plan.push(['audit logs', apply ? 'delete' : 'would delete', `${n} rows older than ${cutoff.toISOString()}`]);
    if (apply && n) {
      await pool.execute('DELETE FROM audit_log WHERE created_at < ?', [cutoff]);
    }
  }

  if (config.groupBookingYears == null) {
    plan.push(['group booking requests', 'skip', 'period is not set']);
  } else {
    const cutoff = cutoffFrom(now, config.groupBookingYears, 'years');
    const n = await count(
      'SELECT COUNT(*)::int AS n FROM group_bookings WHERE created_at < ?',
      [cutoff]
    );
    plan.push(['group booking requests', apply ? 'delete' : 'would delete', `${n} rows older than ${cutoff.toISOString()}`]);
    if (apply && n) {
      await pool.execute('DELETE FROM group_bookings WHERE created_at < ?', [cutoff]);
    }
  }

  if (config.resetTokenHours == null) {
    plan.push(['password reset tokens', 'skip', 'period is not set']);
  } else {
    const cutoff = cutoffFrom(now, config.resetTokenHours, 'hours');
    const n = await count(
      'SELECT COUNT(*)::int AS n FROM users WHERE reset_token IS NOT NULL AND reset_token_expires < ?',
      [cutoff]
    );
    plan.push(['password reset tokens', apply ? 'clear' : 'would clear', `${n} expired tokens`]);
    if (apply && n) {
      await pool.execute(
        'UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE reset_token IS NOT NULL AND reset_token_expires < ?',
        [cutoff]
      );
    }
  }

  console.log(apply ? 'Applying retention sweep' : 'Dry run. Nothing will be removed.');
  for (const [category, action, detail] of plan) {
    console.log(`- ${category}: ${action}. ${detail}`);
  }
  if (!apply) console.log('Pass --apply to remove the rows listed as "would". Null periods stay skipped.');
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('[retention] failed:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await pool.end();
      } catch (_) {
        /* pool may already be closed */
      }
    });
}

