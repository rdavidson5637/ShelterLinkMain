'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('a thread time uses the app date, and a shift chat does not show an id', async () => {
  global.window = { location: { origin: 'http://127.0.0.1:3000' } };
  const { formatWhen, contextLabel } = await import('../frontend/js/components/threadsUi.js');

  assert.equal(formatWhen('2026-11-02 16:15:10'), '2 Nov 2026, 16:15');
  assert.equal(formatWhen(''), '');
  assert.equal(formatWhen('not a date'), 'not a date');

  assert.equal(
    contextLabel({ context_type: 'opportunity', context_id: 16, subject: 'Reception cover' }),
    'Reception cover'
  );
  assert.equal(
    contextLabel({ context_type: 'opportunity', context_id: 16, subject: 'Shift chat #16' }),
    'Shift chat'
  );
  assert.equal(
    contextLabel({ context_type: 'opportunity', context_id: 16 }),
    'Shift chat'
  );
  assert.equal(contextLabel({ context_type: 'announcement' }), 'Announcement');
});
