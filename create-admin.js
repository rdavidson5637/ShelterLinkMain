'use strict';

/**
 * Create an admin on an existing shelter.
 *
 *   CONFIRM_LIVE_SHELTER=yes ADMIN_INITIAL_PASSWORD='...' \
 *     node create-admin.js "Ada Lovelace" ada@example.com
 *
 *   node create-admin.js "Ada Lovelace" ada@example.com 'a-long-password' --shelter assisi
 *
 * With one shelter in the database, --shelter can be omitted.
 * On a Supabase host, set CONFIRM_LIVE_SHELTER=yes.
 * Pass the password in ADMIN_INITIAL_PASSWORD, or as the third argument, not both.
 */

require('dotenv').config();
const { assertLiveWriteAllowed } = require('./utils/liveDbGuard');
const { closePool } = require('./config/database');
const { createAdminAccount } = require('./services/adminAccount');

function usage() {
  console.error('Usage: node create-admin.js <name> <email> [password] [--shelter slug]');
  console.error('Prefer ADMIN_INITIAL_PASSWORD so the password is not stored in shell history.');
  console.error('With one shelter, the admin is attached to it. Otherwise pass --shelter.');
  console.error('On the live Supabase database, set CONFIRM_LIVE_SHELTER=yes.');
}

function readArgs(argv) {
  const positional = [];
  let shelter = '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--shelter') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --shelter');
      shelter = value;
      i += 1;
      continue;
    }
    positional.push(argv[i]);
  }
  return {
    name: positional[0],
    email: positional[1],
    password: positional[2] || '',
    shelter,
    extra: positional.length > 3,
  };
}

async function main() {
  let args;
  try {
    args = readArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(1);
  }

  if (!args.name || !args.email || args.extra) {
    usage();
    process.exit(1);
  }

  const fromEnv = process.env.ADMIN_INITIAL_PASSWORD || '';
  if (fromEnv && args.password) {
    console.error('Pass the password in ADMIN_INITIAL_PASSWORD or as an argument, not both.');
    process.exit(1);
  }
  const password = fromEnv || args.password;
  if (!password) {
    usage();
    process.exit(1);
  }

  try {
    assertLiveWriteAllowed(process.env.DATABASE_URL, process.env.CONFIRM_LIVE_SHELTER);
    const created = await createAdminAccount({
      name: args.name,
      email: args.email,
      password,
      shelterSlug: args.shelter,
    });
    console.log('Admin user created.');
    console.log(`  Shelter: ${created.slug}`);
    console.log(`  Email: ${created.email}`);
    console.log(`  User ID: ${created.userId}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main();
}
