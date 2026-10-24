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
