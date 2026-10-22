#!/usr/bin/env node
/**
 * ShelterLink — encrypted Postgres backup
 * ---------------------------------------------------------------------------
 * Dumps DATABASE_URL (or DB_* local settings) to
 * backups/shelterlink-YYYY-MM-DD.sql.gz.enc and deletes dumps older than 14 days.
 *
 * The file is gzipped, then encrypted with AES-256-GCM. The key comes from
 * BACKUP_ENCRYPTION_KEY. This script refuses to write a plaintext dump.
 *
 * Usage:
 *   BACKUP_ENCRYPTION_KEY='long random secret' npm run backup
 *
 * Cron on the host (example, 02:30 daily):
 *   30 2 * * * cd /app && npm run backup
 *
 * Restore steps: docs/BACKUP-RESTORE.md
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { Writable } = require('stream');
const { pipeline } = require('stream/promises');
require('dotenv').config();
const { encryptBuffer } = require('../utils/backupCrypto');

const MAX_AGE_DAYS = 14;
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const DUMP_NAME = /^shelterlink-\d{4}-\d{2}-\d{2}(-\d{6})?\.sql\.gz(\.enc)?$/;

function connectionParts() {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      host: url.hostname,
      port: url.port || '5432',
      user: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: String(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'shelterlink',
  };
}

function pgpassLine(parts) {
  const escape = (value) => String(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  return [parts.host, parts.port, '*', parts.user, parts.password].map(escape).join(':');
}

function pruneOld(dir) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    if (!DUMP_NAME.test(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(full);
      console.log(`  pruned ${name}`);
    }
  }
}

async function dumpGzip(parts) {
  const passfile = path.join(require('os').tmpdir(), `sl-pgpass-${process.pid}-${Date.now()}`);
  fs.writeFileSync(passfile, `${pgpassLine(parts)}\n`, { mode: 0o600 });
  const env = {
    ...process.env,
    PGHOST: parts.host,
    PGPORT: String(parts.port),
    PGUSER: parts.user,
    PGDATABASE: parts.database,
    PGPASSFILE: passfile,
  };
  delete env.PGPASSWORD;
  const child = spawn('pg_dump', [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  const chunks = [];
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  try {
    try {
      await pipeline(child.stdout, zlib.createGzip(), sink);
    } catch (error) {
      throw new Error(stderr.trim() || error.message);
    }
    const code = await new Promise((resolve) => {
      if (child.exitCode != null) return resolve(child.exitCode);
      child.on('close', resolve);
    });
    if (code !== 0) {
      throw new Error(`pg_dump exited with ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
    }
    return Buffer.concat(chunks);
  } finally {
    try {
      fs.unlinkSync(passfile);
    } catch (_) {
      // already gone
    }
  }
}

async function run() {
  const passphrase = process.env.BACKUP_ENCRYPTION_KEY;
  if (!passphrase || String(passphrase).length < 16) {
    console.error('✗ BACKUP_ENCRYPTION_KEY is missing or shorter than 16 characters.');
    console.error('  Refusing to write an unencrypted backup. Set the key, then re-run.');
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outFile = path.join(BACKUP_DIR, `shelterlink-${stamp}.sql.gz.enc`);
  const parts = connectionParts();

  console.log(`ShelterLink backup → ${outFile}`);

  let gzipped;
  try {
    gzipped = await dumpGzip(parts);
  } catch (err) {
    console.error('✗ Backup failed:', err.message);
    process.exit(1);
  }

  if (!gzipped.length) {
    console.error('✗ pg_dump produced an empty file');
    process.exit(1);
  }

  fs.writeFileSync(outFile, encryptBuffer(gzipped, passphrase));
  pruneOld(BACKUP_DIR);
  console.log('✓ Encrypted backup complete.');
}

run();
