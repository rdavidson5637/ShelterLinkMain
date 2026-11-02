'use strict';

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

function databaseHost({ databaseUrl, dbHost } = {}) {
  const url = String(databaseUrl || '').trim();
  if (url) {
    try {
      const hostname = new URL(url).hostname;
      if (hostname) return hostname.toLowerCase();
    } catch {
      // A URL that does not parse falls through to DB_HOST, then localhost.
    }
  }
  const host = String(dbHost || '').trim().toLowerCase();
  return host || 'localhost';
}

function isLocalDatabaseHost(host) {
  const name = String(host || '').trim().toLowerCase();
  return name === 'localhost' || name === '127.0.0.1';
}

function isSupabaseHost(host) {
  const name = String(host || '').trim().toLowerCase();
  return name === 'supabase.com'
    || name.endsWith('.supabase.com')
    || name === 'supabase.co'
    || name.endsWith('.supabase.co');
}

function assertSetupAllowed({ databaseUrl, dbHost, seed, confirmFlag } = {}) {
  assertLiveWriteAllowed(databaseUrl, confirmFlag);
  const host = databaseHost({ databaseUrl, dbHost });
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

module.exports = {
  assertLiveWriteAllowed,
  assertSetupAllowed,
  databaseHost,
  isLocalDatabaseHost,
  isSupabaseHost,
};
