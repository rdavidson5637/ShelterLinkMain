'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ccni = require('../services/charityRegister/ccni');
const { parseCsv } = require('../services/charityRegister/csv');
const importScript = require('../scripts/import-charity-register');

const NOW = new Date('2026-11-04T12:00:00Z');
const IMPORTED = new Date('2026-10-01T09:00:00Z');

const SAMPLE = [
  '﻿Reg charity number,Sub charity number,Charity name,Date registered,Status,Date removed',
  '100001,0,"Ulster Paws, Belfast",01/02/2015,Registered,',
  'NIC100002,0,Old Dogs Home,01/02/2015,Removed,31/03/2022',
  '100003,1,Branch Of Something,01/02/2015,Registered,',
  'XN12345,0,Legacy,01/02/2015,Registered,',
  '100004,0,,01/02/2015,Registered,',
  '100005,0,"Cats ""R"" Us",01/02/2015,Registered (late),',
  '100006,0,Odd One,01/02/2015,Something else,',
  '',
].join('\r\n');

function fakeDb(handlers) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [re, fn] of handlers) if (re.test(sql)) return fn(params);
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

test('parseCsv handles quotes, doubled quotes, embedded newlines, CRLF, BOM', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",z\n\n'), [
    ['a', 'b'],
    ['x, y', 'he said "hi"'],
    ['multi\nline', 'z'],
  ]);
  assert.deepEqual(parseCsv('a,b'), [['a', 'b']]);
  assert.throws(() => parseCsv('a,"b'), /quoted field/);
});

test('parseCcniCsv keeps main charities, normalises numbers, maps status, skips junk', () => {
  const { rows, skipped, total } = ccni.parseCcniCsv(SAMPLE);
  assert.equal(total, 7);
  assert.equal(skipped, 3); // subsidiary, XN legacy number, missing name
  assert.deepEqual(rows, [
    { charity_number: 'NIC100001', name: 'Ulster Paws, Belfast', status: 'registered', removed_at: null },
    { charity_number: 'NIC100002', name: 'Old Dogs Home', status: 'removed', removed_at: '2022-03-31' },
    { charity_number: 'NIC100005', name: 'Cats "R" Us', status: 'registered', removed_at: null },
    { charity_number: 'NIC100006', name: 'Odd One', status: 'unknown', removed_at: null },
  ]);
});

test('parseCcniCsv refuses a file without number, name, and status columns', () => {
  assert.throws(() => ccni.parseCcniCsv(''), /empty/);
  assert.throws(() => ccni.parseCcniCsv('Foo,Charity name\n1,2'), /missing number, status/);
});

test('normaliseNumber', () => {
  assert.equal(ccni.normaliseNumber('100001'), 'NIC100001');
  assert.equal(ccni.normaliseNumber(' nic 100001 '), 'NIC100001');
  assert.equal(ccni.normaliseNumber('12345'), null);
  assert.equal(ccni.normaliseNumber('XN12345'), null);
});

test('lookup: registered row in cache', async () => {
  const db = fakeDb([
    [/WHERE regulator = \? AND charity_number = \?/, () => [[{ name: 'Ulster Paws', status: 'registered', removed_at: null, imported_at: IMPORTED }]]],
  ]);
  const result = await ccni.lookup('nic100001', { db, now: NOW });
  assert.deepEqual(result, {
    found: true,
    name: 'Ulster Paws',
    status: 'registered',
    removedAt: null,
    source: 'ccni_csv',
    checkedAt: '2026-11-04T12:00:00.000Z',
    cachedAt: '2026-10-01T09:00:00.000Z',
  });
  assert.deepEqual(db.calls[0].params, ['ccni', 'NIC100001']);
});

test('lookup: removed row reports removedAt', async () => {
  const db = fakeDb([
    [/charity_number = \?/, () => [[{ name: 'Old', status: 'removed', removed_at: '2022-03-31', imported_at: IMPORTED }]]],
  ]);
  const result = await ccni.lookup('NIC100002', { db, now: NOW });
  assert.equal(result.status, 'removed');
  assert.equal(result.found, true);
  assert.equal(result.removedAt, '2022-03-31');
});

test('lookup: unknown status in cache is unavailable, not registered', async () => {
  const db = fakeDb([[/charity_number = \?/, () => [[{ name: 'Odd', status: 'unknown', removed_at: null, imported_at: IMPORTED }]]]]);
  const result = await ccni.lookup('NIC100006', { db, now: NOW });
  assert.equal(result.found, null);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error, 'ccni_unknown_status');
});

test('lookup: number missing from a populated cache is not_found', async () => {
  const db = fakeDb([
    [/charity_number = \?/, () => [[]]],
    [/MAX\(imported_at\)/, () => [[{ imported_at: IMPORTED }]]],
  ]);
  const result = await ccni.lookup('NIC999999', { db, now: NOW });
  assert.equal(result.found, false);
  assert.equal(result.status, 'not_found');
  assert.equal(result.cachedAt, '2026-10-01T09:00:00.000Z');
});

test('lookup: empty cache is not_configured, never not_found', async () => {
  const db = fakeDb([
    [/charity_number = \?/, () => [[]]],
    [/MAX\(imported_at\)/, () => [[{ imported_at: null }]]],
  ]);
  const result = await ccni.lookup('NIC100001', { db, now: NOW });
  assert.equal(result.found, null);
  assert.equal(result.status, 'not_configured');
  assert.equal(result.error, 'ccni_cache_empty');
});

test('lookup: database error is unavailable and does not throw', async () => {
  const db = fakeDb([[/charity_number = \?/, () => { throw new Error('connection refused'); }]]);
  const result = await ccni.lookup('NIC100001', { db, now: NOW });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error, 'ccni_cache_error');
  assert.doesNotMatch(JSON.stringify(result), /connection refused/);
});

test('lookup: bad format and legacy XN numbers never reach the database', async () => {
  const db = fakeDb([]);
  for (const raw of ['100001', 'XN12345', '']) {
    const result = await ccni.lookup(raw, { db, now: NOW });
    assert.equal(result.status, 'invalid_format');
    assert.ok(result.message);
  }
  assert.equal(db.calls.length, 0);
});

test('writeCache upserts in batches inside one transaction', async () => {
  const log = [];
  const conn = {
    beginTransaction: async () => log.push('BEGIN'),
    commit: async () => log.push('COMMIT'),
    rollback: async () => log.push('ROLLBACK'),
    execute: async (sql, params) => log.push({ sql, params }),
  };
  const rows = Array.from({ length: 501 }, (_, i) => ({
    charity_number: `NIC${String(100000 + i)}`,
    name: `C${i}`,
    status: 'registered',
    removed_at: null,
  }));
  const n = await ccni.writeCache(conn, rows, { source: 'ccni_csv:test.csv' });
  assert.equal(n, 501);
  assert.equal(log[0], 'BEGIN');
  assert.equal(log.at(-1), 'COMMIT');
  const inserts = log.filter((e) => typeof e === 'object');
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].sql, /ON CONFLICT \(regulator, charity_number\) DO UPDATE/);
  assert.equal(inserts[0].params.length, 500 * 6);
  assert.deepEqual(inserts[1].params, ['ccni', 'NIC100500', 'C500', 'registered', null, 'ccni_csv:test.csv']);
});

test('writeCache rolls back on error', async () => {
  const log = [];
  const conn = {
    beginTransaction: async () => log.push('BEGIN'),
    commit: async () => log.push('COMMIT'),
    rollback: async () => log.push('ROLLBACK'),
    execute: async () => { throw new Error('nope'); },
  };
  await assert.rejects(ccni.writeCache(conn, [{ charity_number: 'NIC100001', name: 'x', status: 'registered' }]), /nope/);
  assert.deepEqual(log, ['BEGIN', 'ROLLBACK']);
});

test('import script: argument checks and dry run touch no database', async () => {
  assert.throws(() => importScript.parseArgs(['--file', 'x.csv']), /--regulator/);
  assert.throws(() => importScript.parseArgs(['--regulator', 'ccew', '--file', 'x.csv']), /--regulator/);
  assert.throws(() => importScript.parseArgs(['--regulator', 'ccni']), /--file/);
  assert.throws(() => importScript.parseArgs(['--bogus']), /Unknown argument/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccni-'));
  const file = path.join(dir, 'ccni.csv');
  fs.writeFileSync(file, SAMPLE);
  const origLog = console.log;
  console.log = () => {};
  try {
    const out = await importScript.main(['--regulator', 'ccni', '--file', file, '--dry-run']);
    assert.deepEqual(out, { rows: 4, written: 0 });
  } finally {
    console.log = origLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lookup: cachedAt passes the database timestamp string through unchanged', async () => {
  const db = fakeDb([
    [/charity_number = \?/, () => [[{ name: 'S', status: 'registered', removed_at: null, imported_at: '2026-10-01 09:00:00' }]]],
  ]);
  const result = await ccni.lookup('NIC100001', { db, now: NOW });
  assert.equal(result.cachedAt, '2026-10-01 09:00:00');
});
