'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function shift(id, iso) {
  return { opportunity_id: id, start_date: iso, title: `Shift ${id}` };
}

test('groupShiftsByPeriod returns empty array for empty input', async () => {
  const { groupShiftsByPeriod } = await import('../frontend/js/utils/groupShifts.js');
  assert.deepEqual(groupShiftsByPeriod([]), []);
  assert.deepEqual(groupShiftsByPeriod(null), []);
});

test('groupShiftsByPeriod places today and tomorrow on their own headings', async () => {
  const { groupShiftsByPeriod } = await import('../frontend/js/utils/groupShifts.js');
  const now = new Date(2026, 7, 14, 10, 0, 0); // Friday 14 Aug 2026
  const groups = groupShiftsByPeriod(
    [
      shift(1, '2026-08-14 09:00:00'),
      shift(2, '2026-08-15 09:00:00'),
      shift(3, '2026-08-16 13:00:00'),
    ],
    now
  );
  assert.equal(groups[0].heading, 'Today');
  assert.equal(groups[0].shifts.length, 1);
  assert.equal(groups[1].heading, 'Tomorrow');
  assert.equal(groups[2].heading, 'This week');
  assert.equal(groups[2].shifts[0].opportunity_id, 3);
});

test('groupShiftsByPeriod week rollover on a Sunday', async () => {
  const { groupShiftsByPeriod } = await import('../frontend/js/utils/groupShifts.js');
  const now = new Date(2026, 7, 16, 8, 0, 0); // Sunday 16 Aug 2026
  const groups = groupShiftsByPeriod(
    [
      shift(1, '2026-08-16 09:00:00'),
      shift(2, '2026-08-17 09:00:00'),
      shift(3, '2026-08-19 13:00:00'),
    ],
    now
  );
  const headings = groups.map((g) => g.heading);
  assert.deepEqual(headings, ['Today', 'Tomorrow', 'Next week']);
  assert.equal(groups.find((g) => g.heading === 'This week'), undefined);
  assert.equal(groups.find((g) => g.heading === 'Next week').shifts.length, 1);
  assert.equal(groups.find((g) => g.heading === 'Next week').shifts[0].opportunity_id, 3);
});

test('groupShiftsByPeriod month and year rollover', async () => {
  const { groupShiftsByPeriod } = await import('../frontend/js/utils/groupShifts.js');
  const now = new Date(2026, 7, 14, 10, 0, 0); // Friday 14 Aug; next week is 17-23 Aug
  const groups = groupShiftsByPeriod(
    [
      shift(1, '2026-08-25 09:00:00'),
      shift(2, '2026-09-02 09:00:00'),
      shift(3, '2027-01-10 09:00:00'),
    ],
    now
  );
  const headings = groups.map((g) => g.heading);
  assert.deepEqual(headings, ['Later in August', 'September 2026', 'January 2027']);
});
