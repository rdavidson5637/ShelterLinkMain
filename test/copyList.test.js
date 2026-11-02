'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('species words, dates, headings and the thread title', async () => {
  const { speciesLabel } = await import('../frontend/js/utils/speciesLabel.js');
  const { formatDateOnly } = await import('../frontend/js/utils/dateFormat.js');

  assert.equal(speciesLabel('small_animal'), 'Small animal');
  assert.equal(speciesLabel('dog'), 'Dog');
  assert.equal(speciesLabel('cat'), 'Cat');
  assert.equal(speciesLabel('other'), 'Other');
  assert.equal(speciesLabel(''), '');

  const born = formatDateOnly('2002-01-08');
  assert.match(born, /2002/);
  assert.match(born, /Jan/);
  assert.notEqual(born, '2002-01-08');

  assert.match(read('frontend/js/admin/animals.js'), /speciesLabel\(animal\.species\)/);
  assert.match(read('frontend/js/admin/fosters.js'), /speciesLabel\(a\.species\)/);
  assert.match(read('frontend/js/admin/transport.js'), /speciesLabel\(a\.species\)/);
  assert.match(read('frontend/js/admin/transport.js'), /formatDateOnly\(run\.run_date\)/);
  assert.match(read('frontend/js/volunteer/transport.js'), /formatDateOnly\(leg\.run_date\)/);
  assert.match(read('frontend/js/volunteer/calendar.js'), /buttonText: \{ today: 'Today' \}/);
  assert.match(read('frontend/pages/admin/reports.html'), /<h1>Reports and exports<\/h1>/);
  assert.doesNotMatch(read('frontend/pages/admin/reports.html'), /Reports & Exports/);
  assert.match(read('frontend/js/components/threadsUi.js'), /context !== title/);
  assert.match(read('frontend/js/admin/volunteers.js'), /formatDateOnly\(profile\.date_of_birth\)/);
  assert.match(read('frontend/public/css/custom.css'), /min-width: var\(--tap\)/);
  assert.match(read('frontend/public/css/admin.css'), /\.guide-steps a \{[\s\S]*min-height: var\(--tap\)/);
});
