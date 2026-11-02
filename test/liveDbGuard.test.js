'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { assertLiveWriteAllowed, assertSetupAllowed } = require('../utils/liveDbGuard');

test('live shelter writes are refused without an explicit confirmation', () => {
  assert.throws(
    () => assertLiveWriteAllowed('postgresql://postgres.example.supabase.com:5432/postgres', undefined),
    (error) => error.code === 'LIVE_DB_REFUSED'
  );
});

test('live shelter writes proceed when CONFIRM_LIVE_SHELTER is yes', () => {
  assert.doesNotThrow(() => assertLiveWriteAllowed(
    'postgresql://postgres.example.supabase.com:5432/postgres',
    'yes'
  ));
});

test('local shelter writes do not need the confirmation flag', () => {
  assert.doesNotThrow(() => assertLiveWriteAllowed(
    'postgresql://postgres@127.0.0.1:54329/shelterlink_tenant_test',
    undefined
  ));
});

test('setup refuses a supabase.com host unless CONFIRM_LIVE_SHELTER is yes', () => {
  assert.throws(
    () => assertSetupAllowed({
      databaseUrl: 'postgresql://postgres.example.supabase.com:5432/postgres',
      seed: false,
    }),
    (error) => error.code === 'LIVE_DB_REFUSED'
  );
  assert.doesNotThrow(() => assertSetupAllowed({
    databaseUrl: 'postgresql://postgres.example.supabase.com:5432/postgres',
    seed: false,
    confirmFlag: 'yes',
  }));
});

test('setup refuses a supabase.co host unless CONFIRM_LIVE_SHELTER is yes', () => {
  assert.throws(
    () => assertSetupAllowed({
      databaseUrl: 'postgresql://postgres:secret@db.abc.supabase.co:5432/postgres',
      seed: false,
    }),
    (error) => error.code === 'LIVE_DB_REFUSED'
  );
  assert.doesNotThrow(() => assertSetupAllowed({
    databaseUrl: 'postgresql://postgres:secret@db.abc.supabase.co:5432/postgres',
    seed: false,
    confirmFlag: 'yes',
  }));
});

test('setup loads demo data on localhost and 127.0.0.1 without a flag', () => {
  assert.doesNotThrow(() => assertSetupAllowed({
    databaseUrl: 'postgresql://postgres@localhost:5432/shelterlink_dev',
    seed: true,
  }));
  assert.doesNotThrow(() => assertSetupAllowed({
    databaseUrl: 'postgresql://postgres@127.0.0.1:5432/shelterlink_dev',
    seed: true,
  }));
  assert.doesNotThrow(() => assertSetupAllowed({
    dbHost: 'localhost',
    seed: true,
  }));
});

test('setup refuses demo passwords on a non-local host even when the live write is confirmed', () => {
  assert.throws(
    () => assertSetupAllowed({
      databaseUrl: 'postgresql://postgres@db.example.com:5432/shelterlink',
      seed: true,
      confirmFlag: 'yes',
    }),
    (error) => error.code === 'DEMO_SEED_REFUSED'
  );
  assert.throws(
    () => assertSetupAllowed({
      databaseUrl: 'postgresql://postgres:secret@db.abc.supabase.co:5432/postgres',
      seed: true,
      confirmFlag: 'yes',
    }),
    (error) => error.code === 'DEMO_SEED_REFUSED'
  );
  assert.doesNotThrow(() => assertSetupAllowed({
    databaseUrl: 'postgresql://postgres@db.example.com:5432/shelterlink',
    seed: false,
  }));
});
