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

test('a printed sheet uses a real date, not Today or Tomorrow', async () => {
  const { formatSheetDay, formatSheetWhen } = await import('../frontend/js/utils/dateFormat.js');
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 9, 0, 0);
  const end = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 12, 0, 0);
  const day = formatSheetDay(tomorrow);
  assert.match(day, /Nov|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Dec/);
  assert.equal(day.includes('Today'), false);
  assert.equal(day.includes('Tomorrow'), false);
  assert.equal(day.includes(String(tomorrow.getFullYear())), true);
  const line = formatSheetWhen(
    `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')} 09:00:00`,
    `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')} 12:00:00`
  );
  assert.equal(line.startsWith(`${day}, 09:00 - 12:00`), true);
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
