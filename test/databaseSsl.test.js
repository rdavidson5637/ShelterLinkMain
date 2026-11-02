'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { databaseSsl, resetDatabaseSslWarning } = require('../utils/databaseSsl');

test('localhost stays without TLS, and a remote host verifies when a CA is set', () => {
  resetDatabaseSslWarning();
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
  assert.equal(databaseSsl('127.0.0.1', { DB_SSL_CA: pem, NODE_ENV: 'production' }), false);
  assert.deepEqual(databaseSsl('db.example.com', { DB_SSL_CA: pem, NODE_ENV: 'production' }), {
    rejectUnauthorized: true,
    ca: pem,
  });
});

test('a remote host without a CA does not verify, and production warns once', () => {
  resetDatabaseSslWarning();
  const warnings = [];
  const logger = { warn(message) { warnings.push(message); } };
  const first = databaseSsl('db.example.com', { NODE_ENV: 'production' }, logger);
  const second = databaseSsl('db.example.com', { NODE_ENV: 'production' }, logger);
  assert.deepEqual(first, { rejectUnauthorized: false });
  assert.deepEqual(second, { rejectUnauthorized: false });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /DB_SSL_CA/);

  const quiet = [];
  databaseSsl('db.example.com', { NODE_ENV: 'development' }, { warn(message) { quiet.push(message); } });
  assert.equal(quiet.length, 0);
});

test('DB_SSL_CA can be a file path, and a missing file is refused', () => {
  resetDatabaseSslWarning();
  const file = path.join(os.tmpdir(), `shelterlink-ca-${process.pid}.pem`);
  const pem = '-----BEGIN CERTIFICATE-----\nFILE\n-----END CERTIFICATE-----';
  fs.writeFileSync(file, pem);
  try {
    assert.equal(databaseSsl('db.example.com', { DB_SSL_CA: file }).ca, pem);
    assert.throws(
      () => databaseSsl('db.example.com', { DB_SSL_CA: path.join(os.tmpdir(), 'missing-ca.pem') }),
      /DB_SSL_CA/
    );
  } finally {
    fs.unlinkSync(file);
  }
});
