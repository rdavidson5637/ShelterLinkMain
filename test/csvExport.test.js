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
