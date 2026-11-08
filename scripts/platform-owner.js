'use strict';

/**
 * Local and staging helper for platform owners. Not for production.
 *
 *   node scripts/platform-owner.js add --email you@example.com
 *   node scripts/platform-owner.js remove --email you@example.com
 *   node scripts/platform-owner.js list
 *   node scripts/platform-owner.js staging-invite --slug north-paws
 *
 * add / remove put an existing user into or out of platform_owners. The user
 * must already exist (sign up or use the seeded admin first). No user or
 * password is created here.
 *
 * staging-invite is for a server where email is not set up. Approve stores
 * just the SHA-256 of the invite token, so the original link cannot be read
 * back. This issues a fresh admin invite for the shelter's applicant, expires
 * any older unused ones, writes an invite.created audit row, and prints the
 * raw token once. Open /invite/<token> to accept it. Where email works, use
 * Resend invite on /platform/shelters instead.
 *
 * Refuses to run when NODE_ENV=production. Refuses any DATABASE_URL that is
 * not localhost unless --staging is passed, and refuses Supabase unless
 * CONFIRM_LIVE_SHELTER=yes as well (same guard as create-shelter.js).
 */

require('dotenv').config();
const { assertLiveWriteAllowed } = require('../utils/liveDbGuard');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function usage() {
  console.error('Usage:');
  console.error('  node scripts/platform-owner.js add --email you@example.com [--staging]');
  console.error('  node scripts/platform-owner.js remove --email you@example.com [--staging]');
  console.error('  node scripts/platform-owner.js list [--staging]');
  console.error('  node scripts/platform-owner.js staging-invite --slug shelter-slug [--staging]');
}

function readArgs(argv) {
  const [command, ...rest] = argv;
  const out = { command, staging: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--staging') {
      out.staging = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument ${arg}`);
    const value = rest[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    out[arg.slice(2)] = value;
    i += 1;
  }
  return out;
}

function databaseHost(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unparseable';
  }
}

/** Throws unless this is clearly a local or explicitly-staging database. */
function assertNonProduction(env, { staging }) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('Refusing to run with NODE_ENV=production. This script is for local and staging only.');
  }
  const host = databaseHost(env.DATABASE_URL);
  if (!LOCAL_HOSTS.has(host) && !staging) {
    throw new Error(`DATABASE_URL points at ${host}, not localhost. Pass --staging if this really is a staging database.`);
  }
  assertLiveWriteAllowed(env.DATABASE_URL, env.CONFIRM_LIVE_SHELTER);
}

function requireValue(args, key) {
  const value = typeof args[key] === 'string' ? args[key].trim() : '';
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

async function findUserId(pool, email) {
  const [rows] = await pool.execute(
    'SELECT user_id FROM users WHERE lower(email) = lower(?) LIMIT 1',
    [email]
  );
  if (!rows.length) throw new Error(`No user with email ${email}. Create the account first.`);
  return Number(rows[0].user_id);
}

async function addOwner(pool, email) {
  const userId = await findUserId(pool, email);
  await pool.execute(
    'INSERT INTO platform_owners (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING',
    [userId]
  );
  console.log(`User ${userId} (${email}) is a platform owner. Sign in and open /platform/shelters.`);
}

async function removeOwner(pool, email) {
  const userId = await findUserId(pool, email);
  await pool.execute('DELETE FROM platform_owners WHERE user_id = ?', [userId]);
  console.log(`User ${userId} (${email}) is no longer a platform owner.`);
}

async function listOwners(pool) {
  const [rows] = await pool.execute(
    `SELECT p.user_id, u.email, p.created_at
     FROM platform_owners p JOIN users u ON u.user_id = p.user_id
     ORDER BY p.user_id`
  );
  if (!rows.length) {
    console.log('No platform owners.');
    return;
  }
  for (const row of rows) console.log(`${row.user_id}\t${row.email}\t${row.created_at}`);
}

async function stagingInvite(pool, slug) {
  const { createInvite } = require('../services/shelterProvision');
  const { recordPlatformAudit, inPlatformTransaction } = require('../controllers/platformController');

  const result = await inPlatformTransaction(async (conn) => {
    const [shelters] = await conn.execute('SELECT id, slug FROM shelters WHERE slug = ? LIMIT 1', [slug]);
    const shelter = shelters[0];
    if (!shelter) throw new Error(`No shelter with slug ${slug}`);
    const [apps] = await conn.execute(
      `SELECT id, contact_email FROM shelter_applications
       WHERE desired_slug = ? AND status = 'approved'
       ORDER BY decided_at DESC, id DESC LIMIT 1`,
      [slug]
    );
    const application = apps[0];
    if (!application) throw new Error(`No approved application for ${slug}`);

    await conn.execute(
      `UPDATE admin_invites SET expires_at = NOW()
       WHERE shelter_id = ? AND lower(email) = lower(?) AND used_at IS NULL AND expires_at > NOW()`,
      [shelter.id, application.contact_email]
    );
    const invite = await createInvite(conn, {
      shelterId: shelter.id,
      email: application.contact_email,
      role: 'admin',
    });
    await recordPlatformAudit(conn, {
      actorUserId: null,
      action: 'invite.created',
      applicationId: application.id,
      targetShelterId: shelter.id,
      detail: { inviteId: invite.inviteId, role: invite.role, expiresAt: invite.expiresAt, source: 'staging-invite script' },
    });
    return invite;
  });

  console.log(`Invite ${result.inviteId} for ${result.email} (${result.role}), expires ${result.expiresAt}.`);
  console.log('Older unused invites for this email were expired.');
  console.log('Raw token (shown once, only its hash is stored):');
  console.log(result.token);
  console.log('Accept it at <APP_URL>/invite/<token>. Do not paste the token into tickets or chat.');
}

async function main() {
  let args;
  try {
    args = readArgs(process.argv.slice(2));
    assertNonProduction(process.env, args);
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(1);
  }

  const { pool, closePool } = require('../config/database');
  const { runWithoutShelter } = require('../utils/shelterContext');
  try {
    await runWithoutShelter(async () => {
      switch (args.command) {
        case 'add': return addOwner(pool, requireValue(args, 'email'));
        case 'remove': return removeOwner(pool, requireValue(args, 'email'));
        case 'list': return listOwners(pool);
        case 'staging-invite': return stagingInvite(pool, requireValue(args, 'slug'));
        default:
          usage();
          process.exitCode = 1;
          return null;
      }
    });
  } catch (error) {
    console.error(error.message || 'platform-owner command failed');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main();
}

module.exports = { assertNonProduction, readArgs, databaseHost };
