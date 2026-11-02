'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { convertToCSV } = require('../utils/csvExport');

test('convertToCSV produces header + rows for given fields', () => {
  const csv = convertToCSV(
    [{ name: 'Alex', hours: 5 }, { name: 'Bethan', hours: 3 }],
    ['name', 'hours']
  );
  const lines = csv.split('\n');
  assert.match(lines[0], /"name","hours"/);
  assert.match(csv, /"Alex",5/);
  assert.match(csv, /"Bethan",3/);
});

test('convertToCSV rejects non-array input', () => {
  assert.throws(() => convertToCSV({}, ['a']), /must be an array/);
});

test('convertToCSV quotes commas, quotes and newlines', () => {
  const csv = convertToCSV(
    [{ name: 'Ada, Grace', note: 'She said "yes"', detail: 'line one\nline two' }],
    ['name', 'note', 'detail']
  );
  assert.match(csv, /"Ada, Grace"/);
  assert.match(csv, /"She said ""yes"""/);
  assert.match(csv, /"line one\nline two"/);
});

test('convertToCSV prefixes formula characters so spreadsheets treat them as text', () => {
  const csv = convertToCSV(
    [{ name: '=1+1', note: '@SUM(A1)', plain: 'Ada' }],
    ['name', 'note', 'plain']
  );
  assert.match(csv, /'=1\+1/);
  assert.match(csv, /'@SUM\(A1\)/);
  assert.match(csv, /Ada/);
  assert.doesNotMatch(csv, /(^|,)"?=1\+1/);
});

test('convertToCSV serialises dates, objects and arrays before the formula check', () => {
  const when = new Date('2026-11-02T13:00:00.000Z');
  const csv = convertToCSV(
    [{ when, meta: { a: 1 }, tags: ['=1'], name: 'Ada' }],
    ['when', 'meta', 'tags', 'name']
  );
  assert.match(csv, /"2026-11-02T13:00:00.000Z"/);
  assert.match(csv, /"\{""a"":1\}"/);
  assert.match(csv, /"\[""=1""\]"/);
  assert.doesNotMatch(csv, /(^|,)=1(,|$)/);
});
