'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('upcomingFirst drops finished shifts and sorts urgent then soonest', async () => {
  const { upcomingFirst } = await import('../frontend/js/utils/dateFormat.js');
  const now = new Date(2026, 8, 14, 12, 0, 0); // 14 Sep 2026
  const result = upcomingFirst(
    [
      { id: 1, start_date: '2026-09-10 09:00:00', end_date: '2026-09-10 12:00:00' },
      { id: 2, start_date: '2026-09-20 09:00:00', end_date: '2026-09-20 12:00:00' },
      { id: 3, start_date: '2026-09-15 09:00:00', end_date: '2026-09-15 12:00:00' },
      { id: 4, is_urgent: 1, start_date: '2026-09-21 09:00:00', end_date: '2026-09-21 12:00:00' },
    ],
    now
  );
  assert.deepEqual(
    result.map((o) => o.id),
    [4, 3, 2]
  );
});

test('upcomingFirst keeps ISO timestamps and undated shifts', async () => {
  const { upcomingFirst } = await import('../frontend/js/utils/dateFormat.js');
  const now = new Date(2026, 8, 14, 12, 0, 0);
  const result = upcomingFirst(
    [
      { id: 1, start_date: '2026-09-20T09:00:00.000Z', end_date: '2026-09-20T12:00:00.000Z' },
      { id: 2, title: 'Flexible' },
      { id: 3, start: '2026-09-16 09:00:00', end: '2026-09-16 11:00:00' },
    ],
    now
  );
  assert.deepEqual(
    result.map((o) => o.id),
    [3, 1, 2]
  );
});
