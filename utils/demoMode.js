'use strict';

/**
 * Demo mode is for a separate, throwaway instance used to pitch ShelterLink to
 * other rescues. It must never be switched on for a real deployment, so every
 * destructive path checks for BOTH the explicit flag and a database that holds
 * nothing but fictional accounts.
 */
const FICTIONAL_EMAIL_SQL =
  "email NOT LIKE '%@example.com' AND email NOT LIKE '%@shelterlink.org'";

function isDemoMode(env = process.env) {
  return String(env.DEMO_MODE || '').trim().toLowerCase() === 'true';
}

/**
 * Decide how scripts/setup-db.js should behave. Pure so it can be tested.
 * Returns { ok, error, withSeed, allowProduction }.
 */
function resolveSetupMode({ args = [], env = process.env } = {}) {
  const demo = args.includes('--demo');
  const isProduction = env.NODE_ENV === 'production';
  const forced = args.includes('--force');

  if (demo) {
    if (!isDemoMode(env)) {
      return {
        ok: false,
        error: 'Refusing to load demo data: set DEMO_MODE=true to confirm this is a demo database.',
      };
    }
    return { ok: true, withSeed: true, allowProduction: true, demo: true };
  }

  if (isProduction && !forced) {
    return {
      ok: false,
      error:
        'Refusing to run in production: this DROPs every table. For a first-time production build re-run with --force. To upgrade an existing database without data loss: npm run migrate',
    };
  }
  if (isProduction && args.includes('--seed')) {
    return { ok: false, error: 'Refusing to load demo/sample data in production (use --demo with DEMO_MODE=true on a demo instance).' };
  }
  const withSeed = !isProduction && (args.includes('--seed') || !args.includes('--no-seed'));
  return { ok: true, withSeed, allowProduction: false, demo: false };
}

/**
 * Throws unless the database is empty or holds only fictional accounts.
 * A missing users table counts as empty (first build).
 */
async function assertOnlyFictionalData(pgPool) {
  let rows;
  try {
    ({ rows } = await pgPool.query(
      `SELECT COUNT(*)::int AS real_accounts FROM users WHERE ${FICTIONAL_EMAIL_SQL}`
    ));
  } catch (error) {
    if (error && error.code === '42P01') return; // undefined_table
    throw error;
  }
  const realAccounts = rows && rows[0] ? Number(rows[0].real_accounts) : 0;
  if (realAccounts > 0) {
    throw new Error(
      `Refusing to rebuild: ${realAccounts} account(s) are not @example.com or @shelterlink.org. DEMO_MODE must only be set on a demo database.`
    );
  }
}

module.exports = {
  FICTIONAL_EMAIL_SQL,
  isDemoMode,
  resolveSetupMode,
  assertOnlyFictionalData,
};
