'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { assertLiveWriteAllowed } = require('../utils/liveDbGuard');

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
