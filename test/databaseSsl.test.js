'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ConnectionParameters = require('pg/lib/connection-parameters');

const { databaseHost } = require('../utils/liveDbGuard');
const { applyDatabaseSsl, databaseSsl, resetDatabaseSslWarning } = require('../utils/databaseSsl');

const pem = execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048',
  '-keyout', '/dev/null',
  '-out', '/dev/stdout',
  '-days', '1',
  '-nodes',
  '-subj', '/CN=shelterlink-test',
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

test('localhost and ::1 stay without TLS, and a remote host verifies when a CA is set', () => {
  resetDatabaseSslWarning();
  assert.equal(databaseSsl('127.0.0.1', { DB_SSL_CA: pem, NODE_ENV: 'production' }), false);
  assert.equal(databaseSsl('::1', { DB_SSL_CA: pem, NODE_ENV: 'production' }), false);
  const ssl = databaseSsl('db.example.com', { DB_SSL_CA: pem, NODE_ENV: 'production' });
  assert.equal(ssl.rejectUnauthorized, true);
  assert.match(ssl.ca, /BEGIN CERTIFICATE/);
});

test('a remote host without a CA does not verify, and production warns once', () => {
  resetDatabaseSslWarning();
  const warnings = [];
  const logger = { warn(message) { warnings.push(message); } };
  const url = 'postgresql://u:p@db.example.com/shelterlink?sslmode=require';
  const first = applyDatabaseSsl(url, 'db.example.com', { NODE_ENV: 'production' }, logger);
  const second = applyDatabaseSsl(url, 'db.example.com', { NODE_ENV: 'production' }, logger);
  assert.equal(first.connectionString, url);
  assert.deepEqual(first.ssl, { rejectUnauthorized: false });
  assert.deepEqual(second.ssl, { rejectUnauthorized: false });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /DB_SSL_CA/);

  const quiet = [];
  databaseSsl('db.example.com', { NODE_ENV: 'development' }, { warn(message) { quiet.push(message); } });
  assert.equal(quiet.length, 0);
});

test('DB_SSL_CA can be a file path, and a missing or invalid value is refused', () => {
  resetDatabaseSslWarning();
  const file = path.join(os.tmpdir(), `shelterlink-ca-${process.pid}.pem`);
  fs.writeFileSync(file, pem);
  try {
    assert.match(databaseSsl('db.example.com', { DB_SSL_CA: file }).ca, /BEGIN CERTIFICATE/);
    assert.throws(
      () => databaseSsl('db.example.com', { DB_SSL_CA: path.join(os.tmpdir(), 'missing-ca.pem') }),
      (error) => error.code === 'DB_SSL_CA'
    );
    assert.throws(
      () => databaseSsl('db.example.com', { DB_SSL_CA: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----' }),
      (error) => error.code === 'DB_SSL_CA'
    );
  } finally {
    fs.unlinkSync(file);
  }
});

test('a CA is kept when the URL asks for sslmode or ssl, and pg sees that CA', () => {
  resetDatabaseSslWarning();
  const literal = pem.trim().replace(/\n/g, '\\n');
  const spaced = pem.replace(/\s+/g, ' ');
  for (const value of [pem, literal, spaced]) {
    for (const suffix of ['?sslmode=require', '?sslmode=no-verify', '?ssl=true']) {
      const url = `postgresql://u:p@db.example.com/shelterlink${suffix}`;
      const applied = applyDatabaseSsl(url, 'db.example.com', { DB_SSL_CA: value });
      assert.equal(applied.connectionString.includes('ssl'), false);
      const seen = new ConnectionParameters(applied);
      assert.equal(seen.ssl.rejectUnauthorized, true);
      assert.equal(seen.ssl.ca, applied.ssl.ca);
    }
  }
});

test('a query host is the host used for TLS, not the URL hostname', () => {
  resetDatabaseSslWarning();
  const url = 'postgresql://u:p@localhost/shelterlink?host=db.example.com';
  const host = databaseHost({ databaseUrl: url });
  assert.equal(host, 'db.example.com');
  const applied = applyDatabaseSsl(url, host, { DB_SSL_CA: pem });
  const seen = new ConnectionParameters(applied);
  assert.equal(seen.host, 'db.example.com');
  assert.equal(seen.ssl.rejectUnauthorized, true);
  assert.match(seen.ssl.ca, /BEGIN CERTIFICATE/);
});
