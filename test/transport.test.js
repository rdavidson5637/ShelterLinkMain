'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('./helpers/mockDb');
const Transport = require('../models/Transport');

test('deriveRunStatus: open → part_covered → covered → completed', () => {
  assert.equal(Transport.deriveRunStatus([]), 'open');
  assert.equal(
    Transport.deriveRunStatus([
      { claimed_by: null, completed_at: null },
      { claimed_by: null, completed_at: null },
    ]),
    'open'
  );
  assert.equal(
    Transport.deriveRunStatus([
      { claimed_by: 1, completed_at: null },
      { claimed_by: null, completed_at: null },
    ]),
    'part_covered'
  );
  assert.equal(
    Transport.deriveRunStatus([
      { claimed_by: 1, completed_at: null },
      { claimed_by: 2, completed_at: null },
    ]),
    'covered'
  );
  assert.equal(
    Transport.deriveRunStatus([
      { claimed_by: 1, completed_at: '2026-08-01' },
      { claimed_by: 2, completed_at: '2026-08-01' },
    ]),
    'completed'
  );
});

test('claimLeg is atomic: FOR UPDATE then claim only when unclaimed', async () => {
  mock.resetCalls();
  let claimed = false;
  mock.setHandler(async (sql, params) => {
    if (/FROM transport_legs tl/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return [
        [
          {
            id: 5,
            run_id: 2,
            leg_order: 1,
            from_location: 'A',
            to_location: 'B',
            claimed_by: claimed ? 99 : null,
            claimed_at: null,
            completed_at: null,
            run_status: 'open',
            animal_id: 3,
          },
        ],
      ];
    }
    if (/UPDATE transport_legs[\s\S]*claimed_by/i.test(sql)) {
      if (claimed) return [{ affectedRows: 0 }];
      claimed = true;
      return [{ affectedRows: 1 }];
    }
    if (/SELECT claimed_by, completed_at FROM transport_legs/i.test(sql)) {
      return [[{ claimed_by: 7, completed_at: null }]];
    }
    if (/SELECT status FROM transport_runs/i.test(sql)) {
      return [[{ status: 'open' }]];
    }
    if (/UPDATE transport_runs SET status/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/FROM transport_legs tl/i.test(sql) && /WHERE tl\.id = \?/i.test(sql)) {
      return [
        [
          {
            id: 5,
            run_id: 2,
            leg_order: 1,
            from_location: 'A',
            to_location: 'B',
            claimed_by: 7,
            claimed_at: '2026-08-26',
            completed_at: null,
            distance_miles: null,
            notes: null,
            expense_claimed: 0,
            run_title: 'Demo',
            run_date: '2026-08-30',
            run_status: 'part_covered',
            animal_id: 3,
            animal_name: 'Rex',
          },
        ],
      ];
    }
    if (/FROM transport_legs tl/i.test(sql) && /WHERE tl\.run_id = \?/i.test(sql)) {
      return [
        [
          {
            id: 5,
            run_id: 2,
            leg_order: 1,
            from_location: 'A',
            to_location: 'B',
            claimed_by: 7,
            claimed_at: '2026-08-26',
            completed_at: null,
            expense_claimed: 0,
          },
          {
            id: 6,
            run_id: 2,
            leg_order: 2,
            from_location: 'B',
            to_location: 'C',
            claimed_by: null,
            claimed_at: null,
            completed_at: null,
            expense_claimed: 0,
          },
        ],
      ];
    }
    return [[]];
  });

  const result = await Transport.claimLeg(5, 7);
  assert.equal(result.leg.id, 5);
  assert.equal(result.claimed_by, 7);
  assert.equal(result.previous_leg.exists, false);
  assert.equal(result.next_leg.exists, true);
  assert.equal(result.next_leg.leg_order, 2);
  assert.ok(result.coordination);
  assert.equal(result.message_context.context_type, 'transport_run');
  assert.equal(result.message_context.context_id, 2);

  const sqls = mock.calls.map((c) => c.sql);
  assert.ok(sqls.some((s) => /FOR UPDATE/i.test(s)));
  assert.ok(sqls.some((s) => /claimed_by = \?/i.test(s)));
});

test('completeLeg rejects completing a leg on a cancelled run', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM transport_legs tl/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return [[{
        id: 5, run_id: 2, claimed_by: 7, completed_at: null,
        distance_miles: null, run_status: 'cancelled', animal_id: 3,
      }]];
    }
    return [[]];
  });

  await assert.rejects(
    () => Transport.completeLeg(5, 7, {}),
    (err) => err.status === 400 && /no longer open for completion/.test(err.message)
  );
  assert.ok(!mock.calls.some((c) => /UPDATE transport_legs[\s\S]*completed_at/i.test(c.sql)));
});

test('completeLeg rejects a non-numeric distance_miles instead of storing NaN', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM transport_legs tl/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return [[{
        id: 5, run_id: 2, claimed_by: 7, completed_at: null,
        distance_miles: null, run_status: 'open', animal_id: 3,
      }]];
    }
    return [[]];
  });

  await assert.rejects(
    () => Transport.completeLeg(5, 7, { distanceMiles: 'abc' }),
    (err) => err.status === 400 && /distance_miles must be a non-negative number/.test(err.message)
  );
  assert.ok(!mock.calls.some((c) => /UPDATE transport_legs[\s\S]*completed_at/i.test(c.sql)));
});

test('updateRunStatus cancels a run', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/UPDATE transport_runs SET status/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/FROM transport_runs tr/i.test(sql)) {
      return [[{ id: 2, status: 'cancelled' }]];
    }
    return [[]];
  });
  const run = await Transport.updateRunStatus(2, 'cancelled');
  assert.equal(run.status, 'cancelled');
});

test('updateRunStatus rejects a derived status instead of silently reverting it', async () => {
  mock.resetCalls();
  await assert.rejects(
    () => Transport.updateRunStatus(2, 'completed'),
    (err) => err.status === 400 && /derived from leg state/.test(err.message)
  );
  // Must not have issued any UPDATE — a caller requesting a derived status
  // should get a clear error, not a write that immediately gets reverted.
  assert.ok(!mock.calls.some((c) => /UPDATE transport_runs/i.test(c.sql)));
});

test('claimLeg rejects already-claimed leg with 409', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FOR UPDATE/i.test(sql)) {
      return [
        [
          {
            id: 5,
            run_id: 2,
            claimed_by: 9,
            run_status: 'part_covered',
            animal_id: null,
          },
        ],
      ];
    }
    return [[]];
  });

  await assert.rejects(() => Transport.claimLeg(5, 7), (err) => {
    assert.equal(err.status, 409);
    return true;
  });
});

test('volunteer-safe adjacent legs never include email or phone', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FOR UPDATE/i.test(sql)) {
      return [
        [
          {
            id: 10,
            run_id: 4,
            leg_order: 2,
            from_location: 'B',
            to_location: 'C',
            claimed_by: null,
            run_status: 'open',
            animal_id: null,
          },
        ],
      ];
    }
    if (/UPDATE transport_legs[\s\S]*claimed_by/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/SELECT claimed_by, completed_at FROM transport_legs/i.test(sql)) {
      return [
        [
          { claimed_by: 1, completed_at: null },
          { claimed_by: 3, completed_at: null },
          { claimed_by: null, completed_at: null },
        ],
      ];
    }
    if (/SELECT status FROM transport_runs/i.test(sql)) {
      return [[{ status: 'open' }]];
    }
    if (/UPDATE transport_runs SET status/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/WHERE tl\.id = \?/i.test(sql)) {
      return [
        [
          {
            id: 10,
            run_id: 4,
            leg_order: 2,
            from_location: 'B',
            to_location: 'C',
            claimed_by: 3,
            claimed_at: 'now',
            completed_at: null,
            distance_miles: 12,
            notes: null,
            expense_claimed: 0,
            run_title: 'Relay',
            run_date: '2026-09-01',
            run_status: 'part_covered',
            animal_id: null,
            claimer_email: 'secret@example.com',
            claimer_phone: '07700900000',
          },
        ],
      ];
    }
    if (/WHERE tl\.run_id = \?/i.test(sql)) {
      return [
        [
          {
            id: 9,
            run_id: 4,
            leg_order: 1,
            from_location: 'A',
            to_location: 'B',
            claimed_by: 1,
            claimer_email: 'driver1@example.com',
            claimer_phone: '01111',
            completed_at: null,
            expense_claimed: 0,
          },
          {
            id: 10,
            run_id: 4,
            leg_order: 2,
            from_location: 'B',
            to_location: 'C',
            claimed_by: 3,
            completed_at: null,
            expense_claimed: 0,
          },
          {
            id: 11,
            run_id: 4,
            leg_order: 3,
            from_location: 'C',
            to_location: 'D',
            claimed_by: null,
            completed_at: null,
            expense_claimed: 0,
          },
        ],
      ];
    }
    return [[]];
  });

  const result = await Transport.claimLeg(10, 3);
  const blob = JSON.stringify(result);
  assert.equal(blob.includes('secret@example.com'), false);
  assert.equal(blob.includes('driver1@example.com'), false);
  assert.equal(blob.includes('07700900000'), false);
  assert.equal(blob.includes('01111'), false);
  assert.ok(!('claimer_email' in (result.previous_leg || {})));
  assert.ok(!('claimer_phone' in (result.previous_leg || {})));
  assert.equal(result.previous_leg.exists, true);
  assert.equal(result.next_leg.exists, true);
  assert.match(result.coordination, /shelter/i);
});

test('toVolunteerSafeLeg strips contact fields', () => {
  const safe = Transport.toVolunteerSafeLeg({
    id: 1,
    run_id: 2,
    leg_order: 1,
    from_location: 'A',
    to_location: 'B',
    claimed_by: 9,
    claimer_email: 'x@y.com',
    claimer_phone: '123',
    claimer_name: 'Sam',
  });
  assert.equal(safe.claimer_email, undefined);
  assert.equal(safe.claimer_phone, undefined);
  assert.ok(!('claimer_name' in safe));
});
