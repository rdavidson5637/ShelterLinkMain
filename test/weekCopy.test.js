'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { runWithShelter, currentShelterId } = require('../utils/shelterContext');
const WeekCopy = require('../models/WeekCopy');
const { getCopyPreview, postCopyWeek } = require('../controllers/weekCopyController');
const { queries, bodies } = require('../validation/bodies');

const ROOT = path.join(__dirname, '..');
const ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'frontend/pages/admin/week-sheet.html'), 'utf8');
const PAGE_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/week-sheet.js'), 'utf8');
const OPP_CONTROLLER = fs.readFileSync(
  path.join(ROOT, 'controllers/opportunityController.js'),
  'utf8'
);
const TENANT_ISO = fs.readFileSync(path.join(ROOT, 'test/tenantIsolation.run.js'), 'utf8');

const SOURCE = '2099-06-01';
const TARGET = '2099-06-08';

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
    session: { userId: 5, role: 'staff' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/admin/week-sheet/copy-preview',
    ...overrides,
  };
}

function opp(id, shelterId, title, start, end, extra = {}) {
  return {
    opportunity_id: id,
    shelter_id: shelterId,
    title,
    description: `${title} notes`,
    requirements: null,
    location: 'Yard',
    start_date: start,
    end_date: end,
    max_volunteers: 4,
    status: 'open',
    cancellation_cutoff_hours: 24,
    required_background_check_type: null,
    ...extra,
  };
}

/**
 * In-memory stand-in for the database. Rows carry shelter_id and every read
 * filters by the current shelter context, the way RLS does in Postgres.
 * Inserts record the shelter context they ran under.
 */
function installDb(state) {
  state.inserted = state.inserted || [];
  state.animalLinks = state.animalLinks || [];
  state.qualLinks = state.qualLinks || [];
  state.sql = [];
  let nextId = 1000;
  const visible = (rows) => rows.filter((r) => r.shelter_id === currentShelterId());

  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    state.sql.push(sql);
    if (/pg_advisory_xact_lock/.test(sql)) return [[]];
    if (/FROM opportunities o/.test(sql) && /start_date::date >=/.test(sql)) {
      const [from, to] = params;
      return [
        visible(state.opportunities).filter(
          (o) =>
            o.status !== 'cancelled' &&
            o.start_date.slice(0, 10) >= from &&
            o.start_date.slice(0, 10) <= to
        ),
      ];
    }
    if (/FROM opportunity_animals oa/.test(sql)) {
      const ids = params.map(Number);
      return [
        visible(state.animals || []).filter((a) => ids.includes(a.opportunity_id)),
      ];
    }
    if (/FROM opportunity_qualifications oq/.test(sql)) {
      const ids = params.map(Number);
      return [
        visible(state.quals || []).filter((q) => ids.includes(q.opportunity_id)),
      ];
    }
    if (/INSERT INTO opportunities/.test(sql)) {
      const id = nextId++;
      const [title, , , location, start, end, max, createdBy, code] = params;
      const row = {
        opportunity_id: id,
        shelter_id: currentShelterId(),
        title,
        location,
        start_date: start,
        end_date: end,
        max_volunteers: max,
        created_by: createdBy,
        check_in_code: code,
        status: 'open',
      };
      state.inserted.push(row);
      state.opportunities.push(row);
      const result = [row];
      result.insertId = id;
      return [result];
    }
    if (/INSERT INTO opportunity_animals/.test(sql)) {
      for (let i = 0; i < params.length; i += 2) {
        state.animalLinks.push({ opportunity_id: params[i], animal_id: params[i + 1] });
      }
      return [[]];
    }
    if (/INSERT INTO opportunity_qualifications/.test(sql)) {
      for (let i = 0; i < params.length; i += 2) {
        state.qualLinks.push({ opportunity_id: params[i], qualification_id: params[i + 1] });
      }
      return [[]];
    }
    if (/INSERT INTO audit_log/i.test(sql)) return [[]];
    return [[]];
  });
  return state;
}

function baseState() {
  return {
    opportunities: [
      opp(1, 1, 'Morning dog walks', '2099-06-01 09:00:00', '2099-06-01 11:00:00'),
      opp(2, 1, 'Cattery clean', '2099-06-03 14:00:00', '2099-06-03 16:00:00', {
        max_volunteers: 2,
        required_background_check_type: 'accessni_basic',
      }),
      opp(3, 1, 'Cancelled thing', '2099-06-04 10:00:00', '2099-06-04 11:00:00', {
        status: 'cancelled',
      }),
      opp(9, 2, 'Other shelter walk', '2099-06-02 09:00:00', '2099-06-02 10:00:00'),
    ],
    animals: [
      { opportunity_id: 1, shelter_id: 1, animal_id: 11, name: 'Biscuit' },
      { opportunity_id: 1, shelter_id: 1, animal_id: 12, name: 'Rolo' },
      { opportunity_id: 9, shelter_id: 2, animal_id: 91, name: 'OtherDog' },
    ],
    quals: [
      { opportunity_id: 2, shelter_id: 1, qualification_id: 21, name: 'Cat handling' },
    ],
  };
}

test('pure helpers shift whole weeks and keep wall-clock time', () => {
  assert.equal(WeekCopy.dayOffset(SOURCE, TARGET), 7);
  assert.equal(WeekCopy.dayOffset('2026-10-19', '2026-11-02'), 14);
  assert.equal(WeekCopy.shiftTimestamp('2099-06-01 09:00:00', 7), '2099-06-08 09:00:00');
  assert.equal(WeekCopy.shiftTimestamp('2099-06-01T09:30:00', 7), '2099-06-08 09:30:00');
  // Across the October clock change the local time stays 09:00.
  assert.equal(WeekCopy.shiftTimestamp('2026-10-19 09:00:00', 7), '2026-10-26 09:00:00');
  assert.equal(WeekCopy.shiftTimestamp(null, 7), null);
  assert.equal(
    WeekCopy.duplicateKey(' Morning Dog Walks ', '2099-06-08T09:00:00'),
    WeekCopy.duplicateKey('morning dog walks', '2099-06-08 09:00:00')
  );
});

test('planCopy refuses to run without shelter context', async () => {
  installDb(baseState());
  await assert.rejects(() => WeekCopy.planCopy(SOURCE, TARGET), { status: 403 });
  await assert.rejects(() => WeekCopy.executeCopy(SOURCE, TARGET), { status: 403 });
});

test('planCopy validates weeks', async () => {
  installDb(baseState());
  await runWithShelter(1, async () => {
    await assert.rejects(() => WeekCopy.planCopy('2099-06-02', TARGET), /source_week must be a Monday/);
    await assert.rejects(() => WeekCopy.planCopy(SOURCE, 'nope'), /target_week must be YYYY-MM-DD/);
    await assert.rejects(() => WeekCopy.planCopy(SOURCE, SOURCE), /must be different/);
    await assert.rejects(
      () => WeekCopy.planCopy('2026-11-09', '2026-11-16', { today: '2026-11-23' }),
      /already ended/
    );
    // The current week is still a valid target.
    await WeekCopy.planCopy('2026-11-16', '2026-11-23', { today: '2026-11-23' });
  });
});

test('preview lists each shift with new times, capacity, animals and qualifications, and writes nothing', async () => {
  const state = installDb(baseState());
  const plan = await runWithShelter(1, () => WeekCopy.planCopy(SOURCE, TARGET));

  assert.equal(plan.target_week_end, '2099-06-14');
  assert.deepEqual(plan.counts, { source: 2, create: 2, skip: 0 });
  const [walks, cattery] = plan.rows;
  assert.equal(walks.title, 'Morning dog walks');
  assert.equal(walks.start_date, '2099-06-08 09:00:00');
  assert.equal(walks.end_date, '2099-06-08 11:00:00');
  assert.equal(walks.max_volunteers, 4);
  assert.deepEqual(walks.animals.map((a) => a.name), ['Biscuit', 'Rolo']);
  assert.equal(walks.action, 'create');
  assert.equal(cattery.start_date, '2099-06-10 14:00:00');
  assert.equal(cattery.max_volunteers, 2);
  assert.deepEqual(cattery.qualifications, [{ id: 21, name: 'Cat handling' }]);
  assert.equal(cattery.required_background_check_type, 'accessni_basic');
  assert.ok(!plan.rows.some((r) => r.title === 'Cancelled thing'));

  assert.equal(state.inserted.length, 0);
  assert.ok(!state.sql.some((s) => /INSERT|UPDATE|DELETE/i.test(s)));
});

test('duplicates at the same time in the target week are skipped, other times are not', async () => {
  const state = baseState();
  state.opportunities.push(
    // Same title, same start: duplicate.
    opp(50, 1, 'morning dog walks', '2099-06-08 09:00:00', '2099-06-08 10:00:00'),
    // Same title at a different time: not a duplicate of the cattery shift.
    opp(51, 1, 'Cattery clean', '2099-06-10 09:00:00', '2099-06-10 10:00:00')
  );
  installDb(state);
  const plan = await runWithShelter(1, () => WeekCopy.planCopy(SOURCE, TARGET));
  assert.deepEqual(plan.counts, { source: 2, create: 1, skip: 1 });
  const walks = plan.rows.find((r) => r.source_opportunity_id === 1);
  assert.equal(walks.action, 'skip');
  assert.equal(walks.existing_opportunity_id, 50);
  assert.match(walks.skip_reason, /already starts at this time/);
  assert.equal(plan.rows.find((r) => r.source_opportunity_id === 2).action, 'create');
});

test('a cancelled shift in the target week does not block the copy', async () => {
  const state = baseState();
  state.opportunities.push(
    opp(60, 1, 'Morning dog walks', '2099-06-08 09:00:00', '2099-06-08 11:00:00', {
      status: 'cancelled',
    })
  );
  installDb(state);
  const plan = await runWithShelter(1, () => WeekCopy.planCopy(SOURCE, TARGET));
  assert.equal(plan.counts.create, 2);
});

test('two identical source rows only create one shift', async () => {
  const state = baseState();
  state.opportunities.push(
    opp(4, 1, 'Morning dog walks', '2099-06-01 09:00:00', '2099-06-01 11:00:00')
  );
  installDb(state);
  const plan = await runWithShelter(1, () => WeekCopy.planCopy(SOURCE, TARGET));
  assert.deepEqual(plan.counts, { source: 3, create: 2, skip: 1 });
  assert.match(plan.rows.find((r) => r.action === 'skip').skip_reason, /earlier row/);
});

test('executeCopy creates open shifts with links, new codes and no bookings, skipping duplicates', async () => {
  const state = baseState();
  state.opportunities.push(
    opp(50, 1, 'Cattery clean', '2099-06-10 14:00:00', '2099-06-10 16:00:00')
  );
  installDb(state);
  const result = await runWithShelter(1, () =>
    WeekCopy.executeCopy(SOURCE, TARGET, { createdBy: 5 })
  );

  assert.deepEqual(result.counts, { source: 2, create: 1, skip: 1 });
  assert.equal(state.inserted.length, 1);
  const created = state.inserted[0];
  assert.equal(created.title, 'Morning dog walks');
  assert.equal(created.start_date, '2099-06-08 09:00:00');
  assert.equal(created.max_volunteers, 4);
  assert.equal(created.created_by, 5);
  assert.equal(created.shelter_id, 1);
  assert.match(created.check_in_code, /^[A-Z0-9]{6}$/);
  assert.deepEqual(
    state.animalLinks.map((l) => l.animal_id).sort(),
    [11, 12]
  );
  assert.ok(state.animalLinks.every((l) => l.opportunity_id === created.opportunity_id));
  assert.equal(state.qualLinks.length, 0);
  assert.deepEqual(result.created, [
    {
      opportunity_id: created.opportunity_id,
      source_opportunity_id: 1,
      title: 'Morning dog walks',
      start_date: '2099-06-08 09:00:00',
    },
  ]);

  assert.ok(state.sql.some((s) => /pg_advisory_xact_lock/.test(s)));
  // Bookings are never read or written.
  assert.ok(!state.sql.some((s) => /applications|waitlist_offers/i.test(s)));

  // Running the same copy again is a no-op: everything is now a duplicate.
  const again = await runWithShelter(1, () => WeekCopy.executeCopy(SOURCE, TARGET));
  assert.equal(again.counts.create, 0);
  assert.equal(state.inserted.length, 1);
});

test('isolation: another shelter only sees and copies its own shifts', async () => {
  const state = installDb(baseState());

  const plan = await runWithShelter(2, () => WeekCopy.planCopy(SOURCE, TARGET));
  assert.deepEqual(plan.rows.map((r) => r.title), ['Other shelter walk']);
  assert.deepEqual(plan.rows[0].animals.map((a) => a.name), ['OtherDog']);
  const json = JSON.stringify(plan);
  assert.doesNotMatch(json, /Morning dog walks|Biscuit|Cat handling/);

  await runWithShelter(2, () => WeekCopy.executeCopy(SOURCE, TARGET));
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0].shelter_id, 2);
  assert.equal(state.inserted[0].title, 'Other shelter walk');
  assert.deepEqual(state.animalLinks.map((l) => l.animal_id), [91]);

  // Shelter 1's copy is unaffected by shelter 2's new shift.
  const own = await runWithShelter(1, () => WeekCopy.planCopy(SOURCE, TARGET));
  assert.equal(own.counts.create, 2);
});

test('controller: preview for staff, 403 for volunteers, 400 for bad weeks', async () => {
  installDb(baseState());

  const ok = makeRes();
  await runWithShelter(1, () =>
    getCopyPreview(makeReq({ query: { source_week: SOURCE, target_week: TARGET } }), ok)
  );
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.counts.create, 2);

  const forbidden = makeRes();
  await runWithShelter(1, () =>
    getCopyPreview(
      makeReq({
        session: { userId: 9, role: 'volunteer' },
        query: { source_week: SOURCE, target_week: TARGET },
      }),
      forbidden
    )
  );
  assert.equal(forbidden.statusCode, 403);

  const bad = makeRes();
  await runWithShelter(1, () =>
    getCopyPreview(makeReq({ query: { source_week: '2099-06-02', target_week: TARGET } }), bad)
  );
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error, /Monday/);
});

test('controller: confirm creates shifts and audits the copy', async () => {
  const state = installDb(baseState());
  const res = makeRes();
  await runWithShelter(1, () =>
    postCopyWeek(
      makeReq({
        method: 'POST',
        originalUrl: '/api/admin/week-sheet/copy',
        body: { source_week: SOURCE, target_week: TARGET },
      }),
      res
    )
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.counts.create, 2);
  assert.equal(state.inserted.length, 2);
  assert.ok(state.inserted.every((r) => r.created_by === 5));
  assert.deepEqual(state.qualLinks, [
    { opportunity_id: state.inserted[1].opportunity_id, qualification_id: 21 },
  ]);
});

test('validation schemas reject extra fields and missing weeks', () => {
  assert.equal(queries.weekCopy.safeParse({ source_week: SOURCE, target_week: TARGET }).success, true);
  assert.equal(
    queries.weekCopy.safeParse({ source_week: SOURCE, target_week: TARGET, shelter_id: '2' }).success,
    false
  );
  assert.equal(bodies.weekCopy.safeParse({ source_week: SOURCE }).success, false);
  assert.equal(bodies.weekCopy.safeParse({ source_week: SOURCE, target_week: TARGET }).success, true);
});

test('routes, isolation probe and opportunityController wiring', () => {
  assert.match(ROUTES, /\/week-sheet\/copy-preview'.*staffOrAdmin.*getCopyPreview/);
  assert.match(ROUTES, /router\.post\('\/week-sheet\/copy'.*staffOrAdmin.*validateBody\(bodies\.weekCopy\).*postCopyWeek/);
  assert.match(TENANT_ISO, /\/api\/admin\/week-sheet\/copy-preview/);
  assert.doesNotMatch(OPP_CONTROLLER, /WeekCopy|copyWeek/);
});

test('week sheet copy UI is a ruled preview table with a confirm step, no cards or icon grids', () => {
  assert.match(PAGE, /id="weekCopySection"/);
  assert.match(PAGE, /class="week-copy no-print"/);
  assert.match(PAGE, /id="copySourceWeek"/);
  assert.match(PAGE, /id="copyTargetWeek"/);
  assert.match(PAGE, /Bookings, waitlists and check-in codes are not copied/);
  assert.doesNotMatch(PAGE, /weekCopySection[\s\S]*(stat-card|feature-grid|card-grid)/);
  assert.doesNotMatch(PAGE, /\.week-copy[\s\S]{0,600}(linear-gradient|radial-gradient)/);
  assert.match(PAGE_JS, /\/admin\/week-sheet\/copy-preview/);
  assert.match(PAGE_JS, /\/admin\/week-sheet\/copy'/);
  assert.match(PAGE_JS, /week-copy-table/);
  assert.match(PAGE_JS, /copyConfirmButton/);
  assert.doesNotMatch(PAGE_JS, /✅|☐|☑|emoji/);
});
