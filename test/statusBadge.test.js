'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const STATUSES = [
  'pending',
  'approved',
  'accepted',
  'rejected',
  'cancelled',
  'waitlisted',
  'open',
  'closed',
  'confirmed',
  'declined',
  'no-show',
];

test('status badge maps every known status to a sentence-case label and class', async () => {
  const { statusLabel, statusClassName, normalizeStatus, STATUS_LABELS } = await import(
    '../frontend/js/components/statusBadge.js'
  );

  for (const status of STATUSES) {
    assert.equal(normalizeStatus(status), status);
    assert.equal(statusClassName(status), `badge badge--${status}`);
    assert.equal(statusLabel(status), STATUS_LABELS[status]);
    assert.match(statusLabel(status), /^[A-Z]/);
  }
});

test('status badge treats no_show like no-show', async () => {
  const { normalizeStatus, statusLabel, statusClassName } = await import(
    '../frontend/js/components/statusBadge.js'
  );
  assert.equal(normalizeStatus('no_show'), 'no-show');
  assert.equal(statusLabel('no_show'), 'No-show');
  assert.equal(statusClassName('NO_SHOW'), 'badge badge--no-show');
});

test('status badge supports an optional suffix', async () => {
  const { statusLabel } = await import('../frontend/js/components/statusBadge.js');
  assert.equal(statusLabel('waitlisted', { suffix: ' (#2)' }), 'Waitlisted (#2)');
});

test('unknown status falls back to a neutral badge', async () => {
  const { normalizeStatus, statusLabel, statusClassName } = await import(
    '../frontend/js/components/statusBadge.js'
  );
  assert.equal(normalizeStatus('mystery'), 'neutral');
  assert.equal(statusClassName('mystery'), 'badge badge--neutral');
  assert.equal(statusLabel('mystery'), 'Mystery');
  assert.equal(normalizeStatus(''), 'neutral');
  assert.equal(statusLabel(''), 'Unknown');
  assert.equal(statusClassName(null), 'badge badge--neutral');
});
