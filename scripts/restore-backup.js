#!/usr/bin/env node
/**
 * Decrypt a ShelterLink backup to a .sql file.
 * Does not connect to a database and does not run the SQL.
 *
 *   BACKUP_ENCRYPTION_KEY='...' node scripts/restore-backup.js backups/shelterlink-YYYY-MM-DD.sql.gz.enc --out /tmp/shelterlink-restore.sql
 *
 * Then load that file into an empty scratch database. See docs/BACKUP-RESTORE.md.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
require('dotenv').config();
const { decryptBuffer } = require('../utils/backupCrypto');

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || !process.argv[index + 1]) return '';
  return process.argv[index + 1];
}

function run() {
  const input = process.argv[2];
  const out = argValue('--out');
  const passphrase = process.env.BACKUP_ENCRYPTION_KEY;
  if (!input || input.startsWith('--') || !out) {
    console.error('Usage: node scripts/restore-backup.js <file.sql.gz.enc> --out <file.sql>');
    process.exit(1);
  }
  if (!passphrase) {
    console.error('Set BACKUP_ENCRYPTION_KEY to the key used when the backup was taken.');
    process.exit(1);
  }

  const outPath = path.resolve(out);
  const backupDir = path.resolve(path.join(__dirname, '..', 'backups'));
  if (outPath.startsWith(`${backupDir}${path.sep}`) || outPath === backupDir) {
    console.error('Refusing to write the decrypted dump inside backups/.');
    process.exit(1);
  }

  const gzipped = decryptBuffer(fs.readFileSync(path.resolve(input)), passphrase);
  const sql = zlib.gunzipSync(gzipped);
  fs.writeFileSync(outPath, sql);
  console.log(`Decrypted ${sql.length} bytes to ${outPath}`);
  console.log('Next: load this file into an empty scratch database. Do not point the app at it until the row counts match.');
}

run();
