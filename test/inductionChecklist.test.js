'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { runWithShelter } = require('../utils/shelterContext');
const InductionChecklist = require('../models/InductionChecklist');
const {
  listItems,
  createItem,
  seedStarterItems,
  getVolunteerInduction,
  setVolunteerInductionItem,
  getMyProgress,
} = require('../controllers/inductionChecklistController');
const { bodies } = require('../validation/bodies');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/061_induction_checklist.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const ADMIN_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const GDPR = fs.readFileSync(path.join(ROOT, 'models/Gdpr.js'), 'utf8');
const VOLUNTEERS_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/admin/volunteers.js'),
  'utf8'
);
const NAV = fs.readFileSync(path.join(ROOT, 'frontend/js/components/navConfig.js'), 'utf8');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 2, role: 'staff' },
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

test('migration 061 creates induction tables with tenant isolation', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS induction_checklist_items/);
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS induction_checklist_progress/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /tenant_isolation/);
  assert.match(MIGRATION, /assert_same_shelter/);
  assert.match(SCHEMA, /CREATE TABLE induction_checklist_items/);
  assert.match(SCHEMA, /CREATE TABLE induction_checklist_progress/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*induction_checklist_progress/);
  assert.match(SETUP_DB, /061_induction_checklist\.pg\.sql/);
});

test('routes expose staff item management and volunteer progress ticks', () => {
  assert.match(SERVER, /\/api\/induction-checklist/);
  assert.match(ADMIN_ROUTES, /volunteers\/:userId\/induction/);
  assert.match(ADMIN_ROUTES, /volunteers\/:userId\/induction\/:itemId/);
  assert.match(GDPR, /DELETE FROM induction_checklist_progress/);
  assert.match(NAV, /induction\.html/);
  assert.match(VOLUNTEERS_JS, /induction-tick/);
});

test('inductionItem and inductionProgress bodies validate', () => {
  assert.equal(bodies.inductionItem.safeParse({ title: 'Site tour' }).success, true);
  assert.equal(bodies.inductionProgress.safeParse({ done: true }).success, true);
  assert.equal(bodies.inductionProgress.safeParse({}).success, false);
});

test('normaliseTitle trims and rejects empty titles', () => {
  assert.equal(InductionChecklist.normaliseTitle('  Site tour  '), 'Site tour');
  assert.throws(() => InductionChecklist.normaliseTitle('   '), /title/i);
});

test('createItem inserts an active checklist row', async () => {
  mock.resetCalls();
  let nextId = 10;
  mock.setHandler(async (sql, params) => {
    if (/COUNT\(\*\)::int AS count/.test(sql) && /induction_checklist_items/.test(sql)) {
      return [[{ count: 0 }]];
    }
    if (/MAX\(sort_order\)/.test(sql)) {
      return [[{ max_order: -1 }]];
    }
    if (/INSERT INTO induction_checklist_items/.test(sql)) {
      assert.equal(params[0], 'Site tour');
      assert.equal(params[1], 0);
      const id = nextId;
      nextId += 1;
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (/FROM induction_checklist_items/.test(sql) && /WHERE id =/.test(sql)) {
      return [[
        {
          id: 10,
          title: 'Site tour',
          sort_order: 0,
          active: 1,
          created_at: '2026-11-23T00:00:00.000Z',
        },
      ]];
    }
    return [[]];
  });

  const item = await runWithShelter(1, () =>
    InductionChecklist.createItem({ title: '  Site tour  ' })
  );
  assert.equal(item.id, 10);
  assert.equal(item.title, 'Site tour');
  assert.equal(item.active, true);
});

test('seedStarterItems creates the four example rows when empty', async () => {
  mock.resetCalls();
  const created = [];
  mock.setHandler(async (sql, params) => {
    if (/FROM induction_checklist_items/.test(sql) && /ORDER BY sort_order/.test(sql)) {
      return [created.map((row) => ({ ...row }))];
    }
    if (/COUNT\(\*\)::int AS count/.test(sql)) {
      return [[{ count: created.length }]];
    }
    if (/MAX\(sort_order\)/.test(sql)) {
      return [[{ max_order: created.length - 1 }]];
    }
    if (/INSERT INTO induction_checklist_items/.test(sql)) {
      const id = created.length + 1;
      created.push({
        id,
        title: params[0],
        sort_order: params[1],
        active: 1,
        created_at: '2026-11-23T00:00:00.000Z',
      });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (/FROM induction_checklist_items/.test(sql) && /WHERE id =/.test(sql)) {
      const row = created.find((r) => r.id === Number(params[0]));
      return [[row]];
    }
    return [[]];
  });

  const items = await runWithShelter(1, () => InductionChecklist.seedStarterItems());
  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((i) => i.title),
    InductionChecklist.STARTER_TITLES
  );
});

test('getVolunteerProgress joins active items with ticks', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM users/.test(sql) && /role = 'volunteer'/.test(sql)) {
      assert.equal(params[0], 5);
      return [[{ user_id: 5 }]];
    }
    if (/FROM induction_checklist_items i/.test(sql)) {
      return [[
        {
          id: 1,
          title: 'Site tour',
          sort_order: 0,
          active: 1,
          completed_at: '2026-11-20T10:00:00.000Z',
          completed_by: 2,
        },
        {
          id: 2,
          title: 'Shadow shift',
          sort_order: 1,
          active: 1,
          completed_at: null,
          completed_by: null,
        },
      ]];
    }
    return [[]];
  });

  const progress = await runWithShelter(1, () =>
    InductionChecklist.getVolunteerProgress(5)
  );
  assert.equal(progress.total, 2);
  assert.equal(progress.doneCount, 1);
  assert.equal(progress.complete, false);
  assert.equal(progress.items[0].done, true);
  assert.equal(progress.items[1].done, false);
});

test('setItemDone inserts or deletes progress rows', async () => {
  mock.resetCalls();
  let done = false;
  mock.setHandler(async (sql, params) => {
    if (/FROM induction_checklist_items/.test(sql) && /WHERE id =/.test(sql)) {
      return [[{ id: 1, title: 'Site tour', sort_order: 0, active: 1, created_at: null }]];
    }
    if (/FROM users/.test(sql) && /role = 'volunteer'/.test(sql)) {
      return [[{ user_id: 5 }]];
    }
    if (/INSERT INTO induction_checklist_progress/.test(sql)) {
      done = true;
      assert.equal(params[0], 5);
      assert.equal(params[1], 1);
      assert.equal(params[2], 2);
      return [{ insertId: 99, affectedRows: 1 }];
    }
    if (/DELETE FROM induction_checklist_progress/.test(sql)) {
      done = false;
      return [{ affectedRows: 1 }];
    }
    if (/FROM induction_checklist_items i/.test(sql)) {
      return [[
        {
          id: 1,
          title: 'Site tour',
          sort_order: 0,
          active: 1,
          completed_at: done ? '2026-11-23T08:00:00.000Z' : null,
          completed_by: done ? 2 : null,
        },
      ]];
    }
    return [[]];
  });

  const marked = await runWithShelter(1, () =>
    InductionChecklist.setItemDone(5, 1, { done: true, completedBy: 2 })
  );
  assert.equal(marked.items[0].done, true);

  const cleared = await runWithShelter(1, () =>
    InductionChecklist.setItemDone(5, 1, { done: false, completedBy: 2 })
  );
  assert.equal(cleared.items[0].done, false);
});

test('controllers return expected status codes', async () => {
  mock.resetCalls();
  const rows = [];
  let progressDone = false;
  mock.setHandler(async (sql, params) => {
    if (/FROM induction_checklist_items/.test(sql) && /ORDER BY sort_order/.test(sql)) {
      return [rows.map((row) => ({ ...row }))];
    }
    if (/COUNT\(\*\)::int AS count/.test(sql)) return [[{ count: rows.filter((r) => r.active).length }]];
    if (/MAX\(sort_order\)/.test(sql)) {
      return [[{ max_order: rows.length ? rows[rows.length - 1].sort_order : -1 }]];
    }
    if (/INSERT INTO induction_checklist_items/.test(sql)) {
      const id = rows.length + 1;
      rows.push({
        id,
        title: params[0],
        sort_order: params[1],
        active: 1,
        created_at: null,
      });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (/FROM induction_checklist_items/.test(sql) && /WHERE id =/.test(sql)) {
      const row = rows.find((r) => r.id === Number(params[0]));
      return [[row]];
    }
    if (/FROM users/.test(sql)) return [[{ user_id: 5 }]];
    if (/FROM induction_checklist_items i/.test(sql)) {
      return [
        rows
          .filter((r) => r.active)
          .map((r) => ({
            ...r,
            completed_at: progressDone ? '2026-11-23T08:00:00.000Z' : null,
            completed_by: progressDone ? 2 : null,
          })),
      ];
    }
    if (/INSERT INTO induction_checklist_progress/.test(sql)) {
      progressDone = true;
      return [{ insertId: 1, affectedRows: 1 }];
    }
    return [[]];
  });

  await runWithShelter(1, async () => {
    const listRes = makeRes();
    await listItems(makeReq(), listRes);
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.body.total, 0);

    const createRes = makeRes();
    await createItem(makeReq({ body: { title: 'Welcome email seen' } }), createRes);
    assert.equal(createRes.statusCode, 201);

    const starterRes = makeRes();
    await seedStarterItems(makeReq(), starterRes);
    assert.equal(starterRes.statusCode, 400);

    const getRes = makeRes();
    await getVolunteerInduction(makeReq({ params: { userId: '5' } }), getRes);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.total, 1);

    const tickRes = makeRes();
    await setVolunteerInductionItem(
      makeReq({
        params: { userId: '5', itemId: '1' },
        body: { done: true },
        session: { userId: 2, role: 'staff' },
      }),
      tickRes
    );
    assert.equal(tickRes.statusCode, 200);

    const meRes = makeRes();
    await getMyProgress(makeReq({ session: { userId: 5, role: 'volunteer' } }), meRes);
    assert.equal(meRes.statusCode, 200);
  });
});
