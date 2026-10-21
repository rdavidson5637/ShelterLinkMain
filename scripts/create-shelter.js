'use strict';

/**
 * Create a shelter and its first admin, or update an existing shelter's
 * name and logo. This is not a public signup. The public volunteer register
 * still joins Assisi only.
 *
 * The script refuses to run when DATABASE_URL points at Supabase unless
 * CONFIRM_LIVE_SHELTER=yes is set.
 *
 * Create:
 *   node scripts/create-shelter.js \
 *     --name "North Shelter" --slug north \
 *     --admin-name "Ada North" --admin-email ada@north.example \
 *     --admin-password "NorthPass1" --logo ./logo.png
 *
 * Update name and/or logo:
 *   node scripts/create-shelter.js --update --slug north --name "North Animal Shelter" --logo ./logo.png
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { assertLiveWriteAllowed } = require('../utils/liveDbGuard');

function usage() {
  console.error('Create: node scripts/create-shelter.js --name "..." --slug slug --admin-name "..." --admin-email email --admin-password "..." [--logo file.png]');
  console.error('Update: node scripts/create-shelter.js --update --slug slug [--name "..."] [--logo file.png]');
}

function readArgs(argv) {
  const out = { update: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--update') {
      out.update = true;
      continue;
    }
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    if (!key || key === 'update') continue;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function logoFromPath(filePath) {
  if (!filePath) return { logo: null, logoMime: null };
  const abs = path.resolve(filePath);
  const ext = path.extname(abs).toLowerCase();
  const logoMime = ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : '';
  if (!logoMime) throw new Error('Logo must be a .png or .jpg file');
  return { logo: fs.readFileSync(abs), logoMime };
}

async function main() {
  try {
    assertLiveWriteAllowed(process.env.DATABASE_URL, process.env.CONFIRM_LIVE_SHELTER);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  let args;
  try {
    args = readArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(1);
  }

  const { createShelterWithAdmin, updateShelterBrand } = require('../services/shelterProvision');
  const { closePool } = require('../config/database');
  try {
    const file = logoFromPath(args.logo);
    if (args.update) {
      const result = await updateShelterBrand({
        slug: args.slug,
        name: args.name || null,
        logo: file.logo,
        logoMime: file.logoMime,
      });
      console.log(`Updated shelter ${result.slug}.`);
      return;
    }
    const result = await createShelterWithAdmin({
      name: args.name,
      slug: args.slug,
      adminName: args['admin-name'],
      adminEmail: args['admin-email'],
      adminPassword: args['admin-password'],
      logo: file.logo,
      logoMime: file.logoMime,
    });
    console.log(`Created shelter ${result.name} (${result.slug}), id ${result.shelterId}.`);
    console.log(`Admin ${result.adminEmail} can log in. The password was not stored in this output.`);
  } catch (error) {
    console.error(error.message || 'Shelter command failed');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main();
}
