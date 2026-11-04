'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  REGULATORS,
  MESSAGES,
  isRegulator,
  normaliseCharityNumber,
  validateCharityNumber,
  isValidCharityNumber,
} = require('../services/charityRegister/formats');

function ok(regulator, raw, value) {
  assert.deepEqual(validateCharityNumber(regulator, raw), { ok: true, regulator, value });
}

function bad(regulator, raw, error) {
  assert.deepEqual(validateCharityNumber(regulator, raw), { ok: false, error });
}

test('REGULATORS matches the CHECK lists in migration 036', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', '036_self_serve_shelters.pg.sql'), 'utf8');
  const lists = [...sql.matchAll(/regulator IN \(([^)]*)\)/g)].map((m) => m[1].replace(/'/g, '').split(','));
  assert.equal(lists.length, 2);
  for (const list of lists) assert.deepEqual(list, [...REGULATORS]);
  assert.ok(Object.isFrozen(REGULATORS));
});

test('unknown or missing regulator is rejected before the number is looked at', () => {
  assert.equal(isRegulator('ccew'), true);
  assert.equal(isRegulator('chy'), false);
  bad('', '1234567', MESSAGES.regulator);
  bad(undefined, '1234567', MESSAGES.regulator);
  bad('hmrc', '1234567', MESSAGES.regulator);
  assert.deepEqual(validateCharityNumber(' CCEW ', '1234567'), { ok: true, regulator: 'ccew', value: '1234567' });
});

test('empty number is rejected with the required message', () => {
  for (const reg of REGULATORS) {
    bad(reg, '', MESSAGES.required);
    bad(reg, '   ', MESSAGES.required);
    bad(reg, null, MESSAGES.required);
  }
});

test('CCEW: 6 or 7 digits with an optional subsidiary suffix', () => {
  ok('ccew', '123456', '123456');
  ok('ccew', '1234567', '1234567');
  ok('ccew', '1234567-1', '1234567-1');
  ok('ccew', ' 1234567-12 ', '1234567-12');
  ok('ccew', '123 4567', '1234567');
  for (const raw of ['12345', '12345678', '1234567-', '1234567-1234', 'A234567', '1234567/1', 'SC012345']) {
    bad('ccew', raw, MESSAGES.ccew);
  }
});

test('OSCR: SC followed by 6 digits', () => {
  ok('oscr', 'SC012345', 'SC012345');
  ok('oscr', 'sc012345', 'SC012345');
  ok('oscr', 'SC 012345', 'SC012345');
  for (const raw of ['012345', 'SC12345', 'SC0123456', 'SO012345', 'SCO12345']) {
    bad('oscr', raw, MESSAGES.oscr);
  }
});

test('CCNI: NIC followed by 6 digits; XN and XR get their own message', () => {
  ok('ccni', 'NIC100001', 'NIC100001');
  ok('ccni', 'nic 100001', 'NIC100001');
  for (const raw of ['100001', 'NIC10001', 'NIC1000011', 'NI100001']) {
    bad('ccni', raw, MESSAGES.ccni);
  }
  bad('ccni', 'XN12345', MESSAGES.ccniLegacy);
  bad('ccni', 'XR12345', MESSAGES.ccniLegacy);
  bad('ccni', 'xr 12345', MESSAGES.ccniLegacy);
});

test('CRI: 8 digit RCN; CHY numbers get their own message', () => {
  ok('cri', '20012345', '20012345');
  ok('cri', 'RCN 20012345', '20012345');
  ok('cri', 'rcn:20012345', '20012345');
  for (const raw of ['2001234', '200123456', '2001234X']) {
    bad('cri', raw, MESSAGES.cri);
  }
  bad('cri', 'CHY12345', MESSAGES.criChy);
  bad('cri', 'chy 12345', MESSAGES.criChy);
});

test('each regulator has its own error message', () => {
  const messages = REGULATORS.map((reg) => validateCharityNumber(reg, '!').error);
  assert.equal(new Set(messages).size, REGULATORS.length);
});

test('normaliseCharityNumber and isValidCharityNumber', () => {
  assert.equal(normaliseCharityNumber('oscr', ' sc 012 345 '), 'SC012345');
  assert.equal(normaliseCharityNumber('ccew', 'RCN123456'), 'RCN123456');
  assert.equal(normaliseCharityNumber('cri', undefined), '');
  assert.equal(isValidCharityNumber('ccni', 'NIC100001'), true);
  assert.equal(isValidCharityNumber('ccni', 'XN12345'), false);
});

test('formats.js makes no network calls', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'charityRegister', 'formats.js'), 'utf8');
  assert.doesNotMatch(src, /require\(['"](https?|node:https?|axios|node-fetch|undici)['"]\)|\bfetch\(/);
});
