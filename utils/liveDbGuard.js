'use strict';

const parseConnectionString = require('pg-connection-string');

function assertLiveWriteAllowed(databaseUrl, confirmFlag) {
  const url = String(databaseUrl || '');
  if (/supabase\.com/i.test(url) && confirmFlag !== 'yes') {
    const error = new Error(
      'Refusing to write a shelter to the live Supabase database. Set CONFIRM_LIVE_SHELTER=yes when you mean to.'
    );
    error.code = 'LIVE_DB_REFUSED';
    throw error;
  }
}

function stripTrailingDot(host) {
  const name = String(host || '').trim().toLowerCase();
  return name.endsWith('.') ? name.slice(0, -1) : name;
}

function hostNames(host) {
  return String(host || '')
    .split(',')
    .map(stripTrailingDot)
    .filter(Boolean);
}

function unresolved(message) {
  const error = new Error(message);
  error.code = 'DB_HOST_UNRESOLVED';
  return error;
}

/**
 * Host pg will actually connect to.
 * Query param host wins over the URL hostname. An empty host uses PGHOST.
 * pg then defaults a missing host to localhost. An unparseable URL is refused.
 */
function databaseHost({ databaseUrl, dbHost, pgHost } = {}) {
  const url = String(databaseUrl || '').trim();
  if (url) {
    let parsed;
    try {
      parsed = parseConnectionString(url);
    } catch {
      throw unresolved('Refusing to use a database URL that does not parse.');
    }
    let host = String(parsed.host || '').trim();
    if (!host) {
      const fromPg = pgHost !== undefined ? pgHost : process.env.PGHOST;
      host = String(fromPg || '').trim();
    }
    if (!host) host = 'localhost';
    const names = hostNames(host);
    if (names.length === 0) {
      throw unresolved('Refusing to use a database host that cannot be determined.');
    }
    return names.join(',');
  }
  const fallback = String(dbHost || '').trim() || 'localhost';
  const names = hostNames(fallback);
  if (names.length === 0) {
    throw unresolved('Refusing to use a database host that cannot be determined.');
  }
  return names.join(',');
}

function isLocalDatabaseHost(host) {
  const names = hostNames(host);
  return names.length > 0 && names.every((name) => name === 'localhost' || name === '127.0.0.1');
}

function isSupabaseHost(host) {
  return hostNames(host).some((name) => (
    name === 'supabase.com'
    || name.endsWith('.supabase.com')
    || name === 'supabase.co'
    || name.endsWith('.supabase.co')
  ));
}

function assertSetupAllowed({ databaseUrl, dbHost, pgHost, seed, confirmFlag } = {}) {
  assertLiveWriteAllowed(databaseUrl, confirmFlag);
  const host = databaseHost({ databaseUrl, dbHost, pgHost });
  if (isSupabaseHost(host) && confirmFlag !== 'yes') {
    const error = new Error(
      'Refusing to rebuild a Supabase database. Set CONFIRM_LIVE_SHELTER=yes when you mean to.'
    );
    error.code = 'LIVE_DB_REFUSED';
    throw error;
  }
  if (seed && !isLocalDatabaseHost(host)) {
    const error = new Error(
      'Refusing to load demo passwords into a database that is not on localhost.'
    );
    error.code = 'DEMO_SEED_REFUSED';
    throw error;
  }
}

function assertLocalDatabase({ databaseUrl, dbHost, pgHost } = {}) {
  const host = databaseHost({ databaseUrl, dbHost, pgHost });
  if (!isLocalDatabaseHost(host)) {
    const error = new Error(
      'Refusing to start against a database that is not on localhost.'
    );
    error.code = 'LOCAL_DB_REFUSED';
    throw error;
  }
}

module.exports = {
  assertLiveWriteAllowed,
  assertSetupAllowed,
  assertLocalDatabase,
  databaseHost,
  isLocalDatabaseHost,
  isSupabaseHost,
};
