'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('./helpers/mockDb');
const Foster = require('../models/Foster');

function baseProfile(overrides = {}) {
  return {
    foster_approved: 1,
    home_type: 'house',
    has_garden: 1,
    garden_secure: 1,
    has_other_dogs: 0,
    has_other_cats: 0,
    has_children_under_16: 0,
    can_medicate: 1,
    max_foster_size: 'large',
    ...overrides,
  };
}

test('matchRequestToProfile requires foster_approved', () => {
  const requirements = { has_garden: 1 };
  assert.equal(
    Foster.matchRequestToProfile(requirements, baseProfile({ foster_approved: 0 })),
    false
  );
  assert.equal(
    Foster.matchRequestToProfile(requirements, baseProfile({ foster_approved: 1 })),
    true
  );
  assert.equal(Foster.matchRequestToProfile(requirements, null), false);
});

test('matchRequestToProfile: has_other_cats blocks cat-free home request', () => {
  const requirements = { has_other_cats: 0 };
  assert.equal(
    Foster.matchRequestToProfile(requirements, baseProfile({ has_other_cats: 1 })),
    false,
    'other cats in home should not match a no-cats requirement'
  );
  assert.equal(
    Foster.matchRequestToProfile(requirements, baseProfile({ has_other_cats: 0 })),
    true
  );
});

test('matchRequestToProfile: max_foster_size must meet or exceed requirement', () => {
  const requirements = { max_foster_size: 'medium' };
  assert.equal(
    Foster.matchRequestToProfile(requirements, baseProfile({ max_foster_size: 'small' })),
    false
  );
  assert.equal(
    Foster.matchRequestToProfile(requirements, baseProfile({ max_foster_size: 'medium' })),
    true
  );
  assert.equal(
    Foster.matchRequestToProfile(requirements, baseProfile({ max_foster_size: 'large' })),
    true
  );
});

test('matchRequestToProfile: missing required boolean fails', () => {
  const requirements = { can_medicate: 1 };
  assert.equal(
    Foster.matchRequestToProfile(requirements, baseProfile({ can_medicate: null })),
    false
  );
  assert.equal(
    Foster.matchRequestToProfile(requirements, baseProfile({ can_medicate: 0 })),
    false
  );
});

test('confirmOffer is atomic: placement + animal foster + request matched + reject siblings', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM foster_offers fo/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return [[
        {
          id: 9,
          request_id: 3,
          user_id: 5,
          status: 'pending',
          animal_id: 2,
          request_status: 'open',
          needed_from: '2026-09-01',
          expected_duration_days: 14,
        },
      ]];
    }
    if (/INSERT INTO foster_placements/i.test(sql)) {
      return [{ insertId: 44 }];
    }
    if (/UPDATE animals SET status/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE foster_requests SET status/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE foster_offers SET status = 'accepted'/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE foster_offers[\s\S]*rejected/i.test(sql)) {
      return [{ affectedRows: 2 }];
    }
    if (/FROM foster_placements fp/i.test(sql)) {
      return [[
        {
          id: 44,
          animal_id: 2,
          user_id: 5,
          request_id: 3,
          started_on: '2026-09-01',
          expected_end_on: '2026-09-15',
          status: 'active',
          animal_name: 'Milo',
          email: 'carer@example.com',
          first_name: 'Sam',
        },
      ]];
    }
    if (/FROM foster_offers fo/i.test(sql)) {
      return [[{ id: 9, request_id: 3, user_id: 5, status: 'accepted' }]];
    }
    if (/FROM foster_requests fr/i.test(sql)) {
      return [[
        {
          id: 3,
          animal_id: 2,
          created_by: 1,
          status: 'matched',
          requirements_json: null,
        },
      ]];
    }
    return [[]];
  });

  const result = await Foster.confirmOffer(9);
  assert.ok(result.placement);
  assert.equal(result.placement.id, 44);
  assert.equal(result.placement.status, 'active');

  const sqls = mock.calls.map((c) => c.sql);
  assert.ok(sqls.some((s) => /INSERT INTO foster_placements/i.test(s)));
  assert.ok(sqls.some((s) => /UPDATE animals SET status = 'foster'/i.test(s)));
  assert.ok(sqls.some((s) => /UPDATE foster_requests SET status = 'matched'/i.test(s)));
  assert.ok(sqls.some((s) => /UPDATE foster_offers SET status = 'accepted'/i.test(s)));
  assert.ok(sqls.some((s) => /status = 'rejected'/i.test(s)));

  const animalUpdate = mock.calls.find((c) => /UPDATE animals SET status = 'foster'/i.test(c.sql));
  assert.deepEqual(animalUpdate.params, [2]);
});

test('confirmOffer rejects when the animal already has an active placement', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM foster_offers fo/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return [[
        {
          id: 9,
          request_id: 3,
          user_id: 5,
          status: 'pending',
          animal_id: 2,
          request_status: 'open',
          needed_from: '2026-09-01',
          expected_duration_days: 14,
        },
      ]];
    }
    if (/FROM foster_placements/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      // Animal 2 already has an active placement (e.g. from a second, stale
      // open request nobody cancelled) — confirming this offer must not
      // double-place it.
      return [[{ id: 100 }]];
    }
    return [[]];
  });

  await assert.rejects(
    () => Foster.confirmOffer(9),
    (err) => err.status === 409 && /already has an active foster placement/.test(err.message)
  );
  assert.ok(!mock.calls.some((c) => /INSERT INTO foster_placements/i.test(c.sql)));
  assert.ok(!mock.calls.some((c) => /UPDATE foster_offers SET status = 'accepted'/i.test(c.sql)));
});

test('createRequest rejects opening a new request for an animal with an active placement', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM foster_placements WHERE animal_id/i.test(sql)) {
      return [[{ id: 100 }]];
    }
    return [[]];
  });

  await assert.rejects(
    () => Foster.createRequest({ animalId: 2, createdBy: 1, neededFrom: '2026-10-01' }),
    (err) => err.status === 409 && /already has an active foster placement/.test(err.message)
  );
  assert.ok(!mock.calls.some((c) => /INSERT INTO foster_requests/i.test(c.sql)));
});

test('confirmOffer rejects non-pending offers without mutating', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FOR UPDATE/i.test(sql)) {
      return [[{ id: 9, status: 'accepted', request_status: 'open', animal_id: 2 }]];
    }
    return [[]];
  });
  await assert.rejects(() => Foster.confirmOffer(9), /not pending/);
  assert.ok(!mock.calls.some((c) => /INSERT INTO foster_placements/i.test(c.sql)));
});

test('endPlacement restores animal availability', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM foster_placements WHERE id/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return [[{ id: 7, animal_id: 2, user_id: 5, status: 'active' }]];
    }
    if (/UPDATE foster_placements/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE animals SET status/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/FROM foster_placements fp/i.test(sql)) {
      return [[
        {
          id: 7,
          animal_id: 2,
          user_id: 5,
          status: 'ended',
          ended_on: '2026-09-20',
          animal_name: 'Milo',
        },
      ]];
    }
    return [[]];
  });

  const placement = await Foster.endPlacement(7, {
    status: 'ended',
    animalStatus: 'available',
    notes: 'Returned well',
  });
  assert.equal(placement.status, 'ended');
  const animalUpdate = mock.calls.find((c) => /UPDATE animals SET status/i.test(c.sql));
  assert.equal(animalUpdate.params[0], 'available');
  assert.equal(animalUpdate.params[1], 2);
});
