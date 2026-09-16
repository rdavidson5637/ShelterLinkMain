'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mock = require('./helpers/mockDb');
const Opportunity = require('../models/Opportunity');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function nonOpenOpportunityHandler() {
  return async (sql, params) => {
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id = \?/i.test(sql)) {
      return [[{ opportunity_id: 5, title: 'Closed shift', status: 'closed' }]];
    }
    if (/FROM applications/i.test(sql) && /WHERE user_id = \? AND opportunity_id = \?/i.test(sql)) {
      // Only user 2 has an application to this opportunity.
      return Number(params[0]) === 2
        ? [[{ application_id: 99, status: 'accepted' }]]
        : [[]];
    }
    return [[]];
  };
}

test('getOpportunity 404s a non-open shift for a volunteer who never applied', async () => {
  mock.resetCalls();
  mock.setHandler(nonOpenOpportunityHandler());
  const { getOpportunity } = require('../controllers/opportunityController');

  const res = makeRes();
  await getOpportunity({ params: { id: 5 }, session: { userId: 3, role: 'volunteer' } }, res);
  assert.strictEqual(res.statusCode, 404);
});

test('getOpportunity still shows a non-open shift to a volunteer who applied to it', async () => {
  // Regression: a shift stops being 'open' the moment it fills, ends, or is
  // cancelled — exactly when My Applications needs to fetch its details for
  // a volunteer who already applied. This 404'd for every past/closed shift
  // and, via the frontend's global error interceptor, took the whole My
  // Applications page down to a "page not found" screen.
  mock.resetCalls();
  mock.setHandler(nonOpenOpportunityHandler());
  const { getOpportunity } = require('../controllers/opportunityController');

  const res = makeRes();
  await getOpportunity({ params: { id: 5 }, session: { userId: 2, role: 'volunteer' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.title, 'Closed shift');
});

test('create inserts all columns with created_by and default status', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/INSERT INTO/i.test(sql)) return [{ insertId: 42 }];
    return [[{ opportunity_id: 42, title: 'X', status: 'open', recurrence_rule: 'none' }]];
  });
  const opp = await Opportunity.create({ title: 'Dog Walk', created_by: 1 });
  assert.strictEqual(opp.id, 42, 'maps opportunity_id -> id');
  const insert = mock.calls.find(c => /INSERT INTO/i.test(c.sql));
  assert.strictEqual(insert.params.length, 15, 'fifteen bound params including background check type');
  assert.strictEqual(insert.params[7], 'open', 'defaults status to open');
  assert.strictEqual(insert.params[8], 1, 'created_by preserved');
  assert.strictEqual(insert.params[9], 'none', 'defaults recurrence_rule to none');
  assert.ok(insert.params[12], 'generates check_in_code');
  assert.strictEqual(insert.params[13], 24, 'defaults cancellation_cutoff_hours to 24');
  assert.strictEqual(insert.params[14], null, 'defaults required_background_check_type to null');
});

test('update only allows whitelisted fields and builds SET clause', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
    return [[{ opportunity_id: 7, recurrence_rule: 'none' }]];
  });
  await Opportunity.update(7, { title: 'New', hacker_field: 'DROP', max_volunteers: 5 });
  const upd = mock.calls.find(c => /UPDATE/i.test(c.sql));
  assert.match(upd.sql, /title = \?/);
  assert.match(upd.sql, /max_volunteers = \?/);
  assert.doesNotMatch(upd.sql, /hacker_field/, 'unknown field rejected');
  assert.deepStrictEqual(upd.params, ['New', 5, 7]);
});

test('update throws when no valid fields supplied', async () => {
  await assert.rejects(() => Opportunity.update(1, { bogus: 'x' }), /No opportunity fields/);
});

test('findAll adds status filter only when provided', async () => {
  mock.setHandler(async () => [[]]);
  await Opportunity.findAll({});
  assert.deepStrictEqual(mock.lastCall().params, [], 'no params when unfiltered');
  await Opportunity.findAll({ status: 'open' });
  assert.match(mock.lastCall().sql, /WHERE status = \?/i);
  assert.deepStrictEqual(mock.lastCall().params, ['open']);
});

test('getCurrentCapacity counts accepted applications plus confirmed groups', async () => {
  mock.setHandler(async () => [[{ current_count: 3 }]]);
  const n = await Opportunity.getCurrentCapacity(9);
  assert.strictEqual(n, 3);
  assert.match(mock.lastCall().sql, /IN \('accepted', 'approved'\)/);
});

test('weekly generation produces expected child count', () => {
  const offsets = Opportunity.buildOccurrenceOffsets(
    'weekly',
    '2026-08-03',
    '2026-08-31'
  );
  // Parent Aug 3; children Aug 10,17,24,31 => 4 children
  assert.deepStrictEqual(offsets, [7, 14, 21, 28]);
});

test('recurrence caps at 26 total occurrences (25 children)', () => {
  const offsets = Opportunity.buildOccurrenceOffsets(
    'daily',
    '2026-01-01',
    '2026-12-31'
  );
  assert.strictEqual(offsets.length, Opportunity.MAX_OCCURRENCES - 1);
  assert.strictEqual(offsets[offsets.length - 1], 25);
});

test('createWithRecurrence weekly inserts parent then children', async () => {
  mock.resetCalls();
  let nextId = 1;
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO/i.test(sql)) {
      const id = nextId++;
      return [{ insertId: id }];
    }
    if (/WHERE opportunity_id = \?/i.test(sql)) {
      const id = params[0];
      return [[{
        opportunity_id: id,
        title: 'Walk',
        status: 'open',
        recurrence_rule: id === 1 ? 'weekly' : 'none',
        parent_opportunity_id: id === 1 ? null : 1,
        start_date: '2026-08-03',
      }]];
    }
    return [[]];
  });

  const result = await Opportunity.createWithRecurrence({
    title: 'Walk',
    description: 'd',
    location: 'Yard',
    start_date: '2026-08-03',
    end_date: '2026-08-03',
    created_by: 1,
    recurrence_rule: 'weekly',
    recurrence_until: '2026-08-31',
  });

  assert.strictEqual(result.total, 5);
  assert.strictEqual(result.children.length, 4);
  const inserts = mock.calls.filter((c) => /INSERT INTO/i.test(c.sql));
  assert.strictEqual(inserts.length, 5);
  assert.strictEqual(inserts[0].params[9], 'weekly');
  assert.strictEqual(inserts[1].params[9], 'none');
  assert.strictEqual(inserts[1].params[11], 1, 'child links to parent');
  assert.strictEqual(inserts[1].params[4], '2026-08-10');
});

test('deleteSeries skips opportunities with accepted applications', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/OR parent_opportunity_id = \?/i.test(sql)) {
      return [[
        { opportunity_id: 1, parent_opportunity_id: null, title: 'Parent', status: 'open' },
        { opportunity_id: 2, parent_opportunity_id: 1, title: 'Child A', status: 'open' },
        { opportunity_id: 3, parent_opportunity_id: 1, title: 'Child B', status: 'open' },
      ]];
    }
    if (/AS current_count/i.test(sql)) {
      const id = params[0];
      // Child A (id 2) has an accepted application
      return [[{ current_count: id === 2 ? 1 : 0 }]];
    }
    if (/DELETE FROM/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id = \?/i.test(sql)) {
      return [[{
        opportunity_id: 1,
        title: 'Parent',
        status: 'open',
        recurrence_rule: 'weekly',
        parent_opportunity_id: null,
      }]];
    }
    return [[]];
  });

  const result = await Opportunity.deleteSeries(1);
  assert.strictEqual(result.deleted, 2);
  assert.strictEqual(result.skipped, 1);
  assert.deepStrictEqual(result.skippedIds, [2]);

  const deletes = mock.calls.filter((c) => /DELETE FROM/i.test(c.sql));
  assert.strictEqual(deletes.length, 2);
  assert.deepStrictEqual(
    deletes.map((d) => d.params[0]).sort(),
    [1, 3]
  );
});
