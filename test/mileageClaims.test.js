'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('./helpers/mockDb');

// Require after mockDb so the model uses the stub pool.
const MileageClaim = require('../models/MileageClaim');

function legRow(overrides = {}) {
  return {
    id: 12,
    claimed_by: 7,
    completed_at: '2026-11-20T10:00:00Z',
    distance_miles: 18.5,
    from_location: 'Assisi',
    to_location: 'Vet',
    run_title: 'Vet run',
    run_date: '2026-11-20',
    ...overrides,
  };
}

test('createFromTransportLeg rejects another volunteer claiming the leg', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM transport_legs tl/i.test(sql)) return [[legRow({ claimed_by: 99 })]];
    return [[], []];
  });
  await assert.rejects(
    () => MileageClaim.createFromTransportLeg({ userId: 7, legId: 12 }),
    (err) => err.status === 403
  );
});

test('createFromTransportLeg requires the leg to be completed', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM transport_legs tl/i.test(sql)) return [[legRow({ completed_at: null })]];
    return [[], []];
  });
  await assert.rejects(
    () => MileageClaim.createFromTransportLeg({ userId: 7, legId: 12 }),
    (err) => err.status === 400 && /Complete the leg/i.test(err.message)
  );
});

test('createFromTransportLeg inserts a pending claim from the leg distance', async () => {
  mock.resetCalls();
  let inserted = null;
  mock.setHandler(async (sql, params) => {
    if (/FROM transport_legs tl/i.test(sql) && /WHERE tl\.id/i.test(sql)) {
      return [[legRow()]];
    }
    if (/FROM mileage_claims mc/i.test(sql) && /transport_leg_id = \?/i.test(sql)) {
      return [[], []];
    }
    if (/INSERT INTO mileage_claims/i.test(sql)) {
      inserted = params;
      return [{ insertId: 55, affectedRows: 1 }];
    }
    if (/FROM mileage_claims mc/i.test(sql) && /WHERE mc\.id = \?/i.test(sql)) {
      return [
        [
          {
            id: 55,
            user_id: 7,
            travel_date: '2026-11-20',
            miles: 18.5,
            purpose: 'Vet run: Assisi → Vet',
            transport_leg_id: 12,
            opportunity_id: null,
            status: 'pending',
            reviewed_by: null,
            reviewed_at: null,
            created_at: '2026-11-21',
            first_name: 'Ada',
            last_name: 'Lovelace',
            email: 'ada@example.com',
          },
        ],
      ];
    }
    return [[], []];
  });

  const claim = await MileageClaim.createFromTransportLeg({ userId: 7, legId: 12 });
  assert.equal(claim.id, 55);
  assert.equal(claim.status, 'pending');
  assert.equal(claim.miles, 18.5);
  assert.equal(claim.transport_leg_id, 12);
  assert.deepEqual(inserted, [7, '2026-11-20', 18.5, 'Vet run: Assisi → Vet', 12]);
});

test('create rejects future travel dates and non-positive miles', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[], []]);
  await assert.rejects(
    () =>
      MileageClaim.create({
        userId: 7,
        travelDate: '2099-01-01',
        miles: 10,
        purpose: 'Travel to shift',
      }),
    (err) => err.status === 400
  );
  await assert.rejects(
    () =>
      MileageClaim.create({
        userId: 7,
        travelDate: '2026-11-01',
        miles: 0,
        purpose: 'Travel to shift',
      }),
    (err) => err.status === 400
  );
});

test('setStatus approve marks the linked transport leg expense_claimed', async () => {
  mock.resetCalls();
  const updates = [];
  mock.setHandler(async (sql, params) => {
    if (/FROM mileage_claims mc/i.test(sql) && /WHERE mc\.id = \?/i.test(sql)) {
      return [
        [
          {
            id: 9,
            user_id: 7,
            travel_date: '2026-11-20',
            miles: 12,
            purpose: 'Leg claim',
            transport_leg_id: 12,
            opportunity_id: null,
            status: updates.length ? 'approved' : 'pending',
            reviewed_by: updates.length ? 3 : null,
            reviewed_at: updates.length ? '2026-11-21' : null,
            created_at: '2026-11-20',
            first_name: 'Ada',
            last_name: 'Lovelace',
            email: 'ada@example.com',
          },
        ],
      ];
    }
    if (/UPDATE mileage_claims/i.test(sql)) {
      updates.push({ sql, params });
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE transport_legs SET expense_claimed/i.test(sql)) {
      updates.push({ sql, params });
      return [{ affectedRows: 1 }];
    }
    return [[], []];
  });

  const claim = await MileageClaim.setStatus(9, 'approved', 3);
  assert.equal(claim.status, 'approved');
  assert.equal(updates.length, 2);
  assert.match(updates[0].sql, /UPDATE mileage_claims/i);
  assert.deepEqual(updates[0].params, ['approved', 3, 9]);
  assert.match(updates[1].sql, /expense_claimed = 1/i);
  assert.deepEqual(updates[1].params, [12]);
});

test('setStatus rejects a second review', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM mileage_claims mc/i.test(sql)) {
      return [
        [
          {
            id: 9,
            user_id: 7,
            travel_date: '2026-11-20',
            miles: 12,
            purpose: 'Leg claim',
            transport_leg_id: null,
            opportunity_id: null,
            status: 'approved',
            reviewed_by: 3,
            reviewed_at: '2026-11-21',
            created_at: '2026-11-20',
            first_name: 'Ada',
            last_name: 'Lovelace',
            email: 'ada@example.com',
          },
        ],
      ];
    }
    return [[], []];
  });
  await assert.rejects(
    () => MileageClaim.setStatus(9, 'rejected', 3),
    (err) => err.status === 400 && /already approved/i.test(err.message)
  );
});
