#!/usr/bin/env node
/**
 * ShelterLink — Postgres backup
 * ---------------------------------------------------------------------------
 * Dumps DATABASE_URL (or DB_* local settings) to
 * backups/shelterlink-YYYY-MM-DD.sql.gz and deletes dumps older than 14 days.
 *
 * Usage:
 *   npm run backup
 *   node scripts/backup.js
 *
 * Cron on the host (example, 02:30 daily):
 *   30 2 * * * cd /app && npm run backup
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
require('dotenv').config();

const MAX_AGE_DAYS = 14;
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const user = encodeURIComponent(process.env.DB_USER || 'postgres');
  const password = encodeURIComponent(process.env.DB_PASSWORD || '');
  const name = process.env.DB_NAME || 'shelterlink';
  return `postgresql://${user}:${password}@${host}:${port}/${name}`;
}

function pruneOld(dir) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    if (!/^shelterlink-\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(full);
      console.log(`  pruned ${name}`);
    }
  }
}

async function run() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outFile = path.join(BACKUP_DIR, `shelterlink-${stamp}.sql.gz`);
  const url = connectionString();

  console.log(`ShelterLink backup → ${outFile}`);

  const child = spawn('pg_dump', [url], { stdio: ['ignore', 'pipe', 'pipe'] });
  const gzip = zlib.createGzip();
  const dest = fs.createWriteStream(outFile);

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await pipeline(child.stdout, gzip, dest);
  } catch (err) {
    try { fs.unlinkSync(outFile); } catch { /* ignore */ }
    console.error('✗ Backup failed:', err.message);
    if (stderr.trim()) console.error(stderr.trim());
    process.exit(1);
  }

  const code = await new Promise((resolve) => {
    if (child.exitCode != null) return resolve(child.exitCode);
    child.on('close', resolve);
  });

  if (code !== 0) {
    try { fs.unlinkSync(outFile); } catch { /* ignore */ }
    console.error('✗ pg_dump exited with', code);
    if (stderr.trim()) console.error(stderr.trim());
    process.exit(1);
  }

  pruneOld(BACKUP_DIR);
  console.log('✓ Backup complete.');
}

run();
