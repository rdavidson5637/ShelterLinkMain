'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  truncate,
  buildUrgentPayload,
  buildReminderPayload,
  buildThreadPayload,
  buildFosterPayload,
} = require('../utils/pushPayloads');

test('truncate collapses whitespace and caps length', () => {
  assert.equal(truncate('  hello\n\nworld  ', 20), 'hello world');
  assert.equal(truncate('abcdefghij', 4), 'abcd');
});

test('thread URLs follow volunteer vs staff role', () => {
  assert.equal(
    buildThreadPayload({ subject: 'Kennels', body: 'Hi', threadId: 9, role: 'volunteer' }).url,
    '/pages/volunteer/messages.html?thread=9'
  );
  assert.equal(
    buildThreadPayload({ subject: 'Kennels', body: 'Hi', threadId: 9, role: 'staff' }).url,
    '/pages/admin/threads.html?thread=9'
  );
});

test('handling notes never leak into title or body', () => {
  const source = {
    title: 'Walk dogs',
    handling_notes: 'Do not approach from behind',
    notes: 'medical: insulin',
    animal_species: 'dog',
    needed_from: '2026-06-11 10:00:00',
    start_date: '2026-06-11 10:00:00',
    location: 'Yard',
    opportunityId: 1,
    application_id: 2,
  };
  const payloads = [
    buildUrgentPayload(source),
    buildReminderPayload(source),
    buildThreadPayload({ ...source, body: 'Can you cover?' }),
    buildFosterPayload(source),
  ];
  for (const payload of payloads) {
    assert.equal(JSON.stringify(payload).includes('insulin'), false);
    assert.equal(JSON.stringify(payload).includes('behind'), false);
  }
});
