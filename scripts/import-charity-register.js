#!/usr/bin/env node
'use strict';

/**
 * Load a regulator's published register CSV into charity_register_cache
 * (migration 037). CCNI only for now.
 *
 * Usage:
 *   node scripts/import-charity-register.js --regulator ccni --file ./ccni.csv --dry-run
 *   node scripts/import-charity-register.js --regulator ccni --file ./ccni.csv
 *
 * --dry-run parses the file and prints counts without touching the database.
 * Run against a non-production database first. Production imports need the
 * same approval as any other production write.
 */

const fs = require('fs');
const path = require('path');

const IMPORTERS = {
  ccni: () => require('../services/charityRegister/ccni'),
};

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--regulator') out.regulator = String(argv[(i += 1)] || '').toLowerCase();
    else if (a === '--file') out.file = argv[(i += 1)];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.regulator || !IMPORTERS[out.regulator]) {
    throw new Error(`--regulator must be one of: ${Object.keys(IMPORTERS).join(', ')}`);
  }
  if (!out.file) throw new Error('--file is required');
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const importer = IMPORTERS[args.regulator]();
  const text = fs.readFileSync(path.resolve(args.file), 'utf8');
  const { rows, skipped, total } = importer.parseCcniCsv(text);
  const byStatus = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

  console.log(`${args.regulator}: ${total} data rows, ${rows.length} usable, ${skipped} skipped.`);
  console.log(`  by status: ${JSON.stringify(byStatus)}`);
  if (!rows.length) throw new Error('No usable rows. Nothing imported.');

  if (args.dryRun) {
    console.log('Dry run: database not touched.');
    return { rows: rows.length, written: 0 };
  }

  require('dotenv').config();
  const { pool, closePool } = require('../config/database');
  const { runWithoutShelter } = require('../utils/shelterContext');
  const source = `${importer.SOURCE}:${path.basename(args.file)}`.slice(0, 255);
  try {
    const written = await runWithoutShelter(async () => {
      const conn = await pool.getConnection();
      try {
        return await importer.writeCache(conn, rows, { source });
      } finally {
        conn.release();
      }
    });
    console.log(`Wrote ${written} rows to charity_register_cache.`);
    return { rows: rows.length, written };
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Import failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
