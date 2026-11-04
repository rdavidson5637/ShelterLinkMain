'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const register = require('../services/charityRegister');
const { REGULATORS } = require('../services/charityRegister/formats');

const NOW = new Date('2026-11-04T12:00:00Z');
const SHAPE = ['found', 'name', 'status', 'removedAt', 'source', 'checkedAt'];

test('every regulator has an adapter; launch regulators are ccew and ccni', () => {
  assert.deepEqual(Object.keys(register.ADAPTERS).sort(), [...REGULATORS].sort());
  assert.deepEqual([...register.LIVE_REGULATORS], ['ccew', 'ccni']);
});

test('lookupCharity dispatches by regulator (case and spaces ignored)', async () => {
  const fetch = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ charity_name: 'EW', reg_status: 'R' }) });
  const ew = await register.lookupCharity(' CCEW ', '1234567', { apiKey: 'k', fetch, now: NOW });
  assert.equal(ew.source, 'ccew_api');
  assert.equal(ew.name, 'EW');

  const db = { query: async () => [[{ name: 'NI', status: 'registered', removed_at: null, imported_at: NOW }]] };
  const ni = await register.lookupCharity('ccni', 'NIC100001', { db, now: NOW });
  assert.equal(ni.source, 'ccni_csv');
  assert.equal(ni.name, 'NI');
});

test('unknown regulator: invalid_format with the regulator message', async () => {
  const result = await register.lookupCharity('hmrc', '1234567', { now: NOW });
  assert.equal(result.status, 'invalid_format');
  assert.equal(result.found, null);
  assert.equal(result.message, register.MESSAGES.regulator);
});

test('OSCR and CRI are stubs: not_configured for valid numbers, invalid_format otherwise', async () => {
  for (const [reg, good, bad] of [
    ['oscr', 'SC012345', '1234567'],
    ['cri', 'RCN 20012345', 'CHY1234'],
  ]) {
    const ok = await register.lookupCharity(reg, good, { now: NOW });
    assert.equal(ok.status, 'not_configured', reg);
    assert.equal(ok.found, null);
    assert.match(ok.message, /by hand/);
    const no = await register.lookupCharity(reg, bad, { now: NOW });
    assert.equal(no.status, 'invalid_format', reg);
  }
});

test('every result carries the brief section 6 shape', async () => {
  const results = await Promise.all([
    register.lookupCharity('ccew', '1234567', { apiKey: '', now: NOW }),
    register.lookupCharity('oscr', 'SC012345', { now: NOW }),
    register.lookupCharity('cri', '20012345', { now: NOW }),
    register.lookupCharity('nope', 'x', { now: NOW }),
  ]);
  for (const r of results) {
    for (const key of SHAPE) assert.ok(key in r, `${key} missing from ${r.source}`);
    assert.ok(register.STATUSES.includes(r.status));
    assert.equal(r.checkedAt, '2026-11-04T12:00:00.000Z');
  }
});

test('needsHandCheck is false only for a registered, found charity', () => {
  assert.equal(register.needsHandCheck({ found: true, status: 'registered' }), false);
  for (const r of [
    null,
    { found: true, status: 'removed' },
    { found: false, status: 'not_found' },
    { found: null, status: 'unavailable' },
    { found: null, status: 'not_configured' },
  ]) {
    assert.equal(register.needsHandCheck(r), true);
  }
});

test('result.js rejects unknown statuses and only sets removedAt when removed', () => {
  const { registerResult, toDateOnly } = require('../services/charityRegister/result');
  assert.throws(() => registerResult({ found: true, status: 'verified', source: 'x' }), /Unknown register status/);
  assert.equal(registerResult({ found: true, status: 'registered', removedAt: '2020-01-01', source: 'x' }).removedAt, null);
  assert.equal(toDateOnly('5/4/2021'), '2021-04-05');
  assert.equal(toDateOnly('garbage'), null);
});
