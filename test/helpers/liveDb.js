'use strict';

// Helpers for test runners that need a real, local Postgres (SL-LATER-36).
// Same approach as test/tenantIsolation.run.js: CI points at its localhost
// service container; a developer machine gets a throwaway cluster from initdb.
// Every entry point refuses a database that is not on localhost or whose name
// is not the one the caller expects.

const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..', '..');

function assertLocalTestUrl(connectionString, expectedDbName) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('Refusing to run: database URL is not parseable.');
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('Refusing to run against a non-local database.');
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (dbName !== expectedDbName) {
    throw new Error(`Refusing test database name ${dbName}; expected ${expectedDbName}`);
  }
  return parsed;
}

// Swap the database name in a local service URL (CI shares one container).
function withDatabase(connectionString, dbName) {
  const url = new URL(connectionString);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function resolvePgBin() {
  if (process.env.PG_BIN) {
    if (fs.existsSync(path.join(process.env.PG_BIN, 'initdb'))) return process.env.PG_BIN;
    throw new Error(`PG_BIN does not contain initdb: ${process.env.PG_BIN}`);
  }
  const found = spawnSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf8' });
  const initdb = (found.stdout || '').trim();
  return initdb ? path.dirname(initdb) : '';
}

/**
 * A throwaway local cluster. Returns { stop }.
 */
function startCluster({ dataDir, port, dbName }) {
  const pgBin = resolvePgBin();
  if (!pgBin || !fs.existsSync(path.join(pgBin, 'initdb'))) {
    throw new Error('Postgres initdb was not found on PATH. Install Postgres client tools, set PG_BIN, or set TENANT_DATABASE_URL to a local Postgres service.');
  }
  const run = (name, args, { allowFail = false } = {}) => {
    const result = spawnSync(path.join(pgBin, name), args, { encoding: 'utf8' });
    if (!allowFail && result.status !== 0) {
      const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      throw new Error(`${name} failed (${result.status}): ${detail}`);
    }
    return result;
  };
  run('pg_ctl', ['-D', dataDir, 'stop', '-m', 'immediate', '-w'], { allowFail: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  run('initdb', ['-D', dataDir, '-U', 'postgres', '--auth-local=trust', '--auth-host=trust', '--no-instructions']);
  run('pg_ctl', [
    '-D', dataDir,
    '-l', path.join(dataDir, 'server.log'),
    '-w',
    '-o', `-p ${port} -k /tmp -c listen_addresses=127.0.0.1`,
    'start',
  ]);
  run('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', dbName]);
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      run('pg_ctl', ['-D', dataDir, 'stop', '-m', 'immediate', '-w'], { allowFail: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function withMaintenance(connectionString, fn) {
  const url = new URL(connectionString);
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function assertSafeName(dbName) {
  if (!/^shelterlink_[a-z_]+_test$/.test(dbName)) throw new Error(`Unsafe database name ${dbName}`);
}

async function dropServiceDatabase(connectionString, dbName) {
  assertSafeName(dbName);
  await withMaintenance(connectionString, async (client) => {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [dbName]
    );
    await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
  });
}

async function resetServiceDatabase(connectionString, dbName) {
  await dropServiceDatabase(connectionString, dbName);
  await withMaintenance(connectionString, (client) => client.query(`CREATE DATABASE ${dbName}`));
}

/** Fresh schema, tenancy and self-serve shelters, plus the session table. */
async function applySchema(admin) {
  const read = (file) => fs.readFileSync(path.join(ROOT, 'database', file), 'utf8');
  const { applySql } = require('../../scripts/applySql');
  await admin.query(read('schema.pg.sql'));
  await applySql(admin, read('033_add_shelters.pg.sql'));
  await applySql(admin, read('036_self_serve_shelters.pg.sql'));
  await admin.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL,
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      PRIMARY KEY ("sid")
    )
  `);
  await admin.query('CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")');
  await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session TO shelterlink_tenant');
  await admin.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shelterlink_tenant');
  await applySql(admin, read('062_app_roles_no_bypass.pg.sql'));
}

function request(port, method, urlPath, { json, cookie } = {}) {
  const payload = json == null ? null : Buffer.from(JSON.stringify(json));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        ...(cookie ? { cookie } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, text, body, setCookie: res.headers['set-cookie'] || [] });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sessionCookie(setCookie) {
  let cookie = '';
  for (const line of setCookie) {
    const pair = String(line).split(';')[0];
    if (pair.startsWith('connect.sid=')) cookie = pair;
  }
  return cookie;
}

module.exports = {
  assertLocalTestUrl,
  withDatabase,
  startCluster,
  resetServiceDatabase,
  dropServiceDatabase,
  applySchema,
  request,
  sessionCookie,
};
