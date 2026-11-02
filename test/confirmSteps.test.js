'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from !== -1 && to !== -1, `${start} .. ${end}`);
  return source.slice(from, to);
}

test('chase, cancel and decline ask before the same requests', () => {
  const transport = read('frontend/js/admin/transport.js');
  const bookings = read('frontend/js/admin/group-bookings.js');

  const chase = between(transport, "querySelectorAll('.chase-btn')", "querySelectorAll('.cancel-btn')");
  assert.match(chase, /Ask for cover\?/);
  assert.match(chase, /This emails volunteers who can take a leg/);
  assert.ok(chase.indexOf('showConfirm') < chase.indexOf('/chase'));
  assert.match(chase, /if \(choice !== 'confirm'\) return/);
  assert.match(chase, /method: 'POST', body: \{\}/);

  const cancel = transport.slice(transport.indexOf("querySelectorAll('.cancel-btn')"));
  assert.match(cancel, /Cancel this run\?/);
  assert.match(cancel, /This marks the run as cancelled/);
  assert.ok(cancel.indexOf('showConfirm') < cancel.indexOf('/status'));
  assert.match(cancel, /if \(choice !== 'confirm'\) return/);
  assert.match(cancel, /method: 'PUT'/);
  assert.match(cancel, /status: 'cancelled'/);

  assert.match(bookings, /act\(row\.id, 'confirm'\)/);
  const decline = between(bookings, 'declineBtn.addEventListener', 'actions.appendChild(declineBtn)');
  assert.match(decline, /Decline this booking\?/);
  assert.match(decline, /emails the group contact/);
  assert.ok(decline.indexOf('showConfirm') < decline.indexOf("act(row.id, 'decline')"));
  assert.match(decline, /if \(choice !== 'confirm'\) return/);
  assert.match(bookings, /`\/group-bookings\/\$\{id\}\/\$\{action\}`/);
  assert.doesNotMatch(
    between(bookings, 'confirmBtn.addEventListener', 'declineBtn.type'),
    /showConfirm/
  );
});
