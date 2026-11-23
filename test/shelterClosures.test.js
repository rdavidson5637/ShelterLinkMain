'use strict';
// SL-LATER-30: shelter closure dates. Closed days refuse new shifts and
// repeating series, show as Closed on the public board and volunteer browse,
// and list already-booked shifts for staff without cancelling anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mock = require('./helpers/mockDb');

const { runWithShelter, TENANT_TABLES } = require('../utils/shelterContext');
const closureDates = require('../utils/closureDates');
const ShelterClosure = require('../models/ShelterClosure');
const closureCtrl = require('../controllers/closureController');
const { bodies, queries } = require('../validation/bodies');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'database');
const MIGRATION = '058_shelter_closures.pg.sql';
const migration = fs.readFileSync(path.join(DB, MIGRATION), 'utf8');
const schema = fs.readFileSync(path.join(DB, 'schema.pg.sql'), 'utf8');
const setupDb = fs.readFileSync(path.join(ROOT, 'scripts', 'setup-db.js'), 'utf8');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/**
 * In-memory closures for two shelters. Each query is answered only with rows
 * for the shelter_id it binds, the way RLS plus the WHERE clause would.
 */
function closureWorld({ closures = [], booked = [], extra } = {}) {
  const rows = closures.map((c, i) => ({ id: i + 1, created_at: '2026-11-01 09:00:00', ...c }));
  const writes = [];
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    const q = String(sql);
    if (/INSERT INTO shelter_closures/i.test(q)) {
      writes.push(q);
      const row = { id: rows.length + 1, shelter_id: params[0], starts_on: params[1], ends_on: params[2], reason: params[3], created_at: '2026-11-23 06:30:00' };
      rows.push(row);
      return [[row]];
    }
    if (/DELETE FROM shelter_closures/i.test(q)) {
      writes.push(q);
      const idx = rows.findIndex((r) => r.shelter_id === params[0] && r.id === params[1]);
      if (idx < 0) return [{ affectedRows: 0 }];
      rows.splice(idx, 1);
      return [{ affectedRows: 1 }];
    }
    if (/FROM shelter_closures/i.test(q)) {
      const shelterId = params[0];
      let out = rows.filter((r) => r.shelter_id === shelterId);
      if (/AND id = \?/.test(q)) out = out.filter((r) => r.id === params[1]);
      if (/starts_on <= \? AND ends_on >= \?/.test(q)) {
        out = out.filter((r) => r.starts_on <= params[1] && r.ends_on >= params[2]);
      } else if (/ends_on >= \?/.test(q)) {
        out = out.filter((r) => r.ends_on >= params[1]);
      }
      return [out];
    }
    if (/FROM opportunities o\s+JOIN applications a/i.test(q)) {
      const shelterId = params[0];
      return [booked.filter((b) => b.shelter_id === shelterId && b.day >= params[1] && b.day <= params[2])];
    }
    if (/^\s*(UPDATE|DELETE|INSERT)\b/i.test(q)) writes.push(q);
    if (extra) return extra(q, params);
    return [[]];
  });
  return { rows, writes };
}

const CHRISTMAS = { shelter_id: 1, starts_on: '2026-12-24', ends_on: '2026-12-26', reason: 'Christmas' };
const TRAINING_B = { shelter_id: 2, starts_on: '2026-12-10', ends_on: '2026-12-10', reason: 'MarkerB training' };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('parseClosureInput accepts a single day or a range and trims the reason', () => {
  assert.deepEqual(closureDates.parseClosureInput({ starts_on: '2026-12-25', reason: '  Christmas  Day ' }).value, {
    starts_on: '2026-12-25',
    ends_on: '2026-12-25',
    reason: 'Christmas Day',
  });
  assert.deepEqual(
    closureDates.parseClosureInput({ starts_on: '2026-12-24', ends_on: '2026-12-26', reason: 'Christmas' }).value,
    { starts_on: '2026-12-24', ends_on: '2026-12-26', reason: 'Christmas' }
  );
});

test('parseClosureInput refuses bad dates, backwards ranges, huge ranges and blank reasons', () => {
  assert.match(closureDates.parseClosureInput({ starts_on: '2026-02-30', reason: 'x' }).error, /first closed day/);
  assert.match(closureDates.parseClosureInput({ starts_on: '2026-12-26', ends_on: '2026-12-24', reason: 'x' }).error, /on or after/);
  assert.match(closureDates.parseClosureInput({ starts_on: '2026-01-01', ends_on: '2027-06-01', reason: 'x' }).error, /at most 366 days/);
  assert.match(closureDates.parseClosureInput({ starts_on: '2026-12-25', reason: '   ' }).error, /short reason/);
  assert.match(closureDates.parseClosureInput({ starts_on: '2026-12-25', reason: 'x'.repeat(121) }).error, /under 120/);
});

test('closureOn matches the shift start day inclusively and ignores odd rows', () => {
  const list = closureDates.normaliseClosures([CHRISTMAS, { starts_on: 'nope', ends_on: null }, { title: 'opp row' }]);
  assert.equal(list.length, 1);
  assert.equal(closureDates.closureOn(list, '2026-12-24 09:00:00').reason, 'Christmas');
  assert.equal(closureDates.closureOn(list, '2026-12-26 18:00:00').reason, 'Christmas');
  assert.equal(closureDates.closureOn(list, '2026-12-27 09:00:00'), null);
  assert.equal(closureDates.closureOn(list, null), null);
});

test('closedDayMessage names the day and the reason in plain words', () => {
  const msg = closureDates.closedDayMessage({ reason: 'Christmas' }, '2026-12-25');
  assert.equal(msg, 'The shelter is closed on Fri 25 Dec 2026 (Christmas). Pick another date or remove the closure first.');
  assert.doesNotMatch(msg, /—/);
});

test('validation: closure body is strict and the list query only takes include_past', () => {
  assert.equal(bodies.shelterClosure.safeParse({ starts_on: '2026-12-25', reason: 'Christmas' }).success, true);
  assert.equal(bodies.shelterClosure.safeParse({ starts_on: '2026-12-25', reason: 'x', shelter_id: 2 }).success, false);
  assert.equal(queries.closures.safeParse({ include_past: 'true' }).success, true);
  assert.equal(queries.closures.safeParse({ shelter: '2' }).success, false);
});

// ---------------------------------------------------------------------------
// Migration and schema
// ---------------------------------------------------------------------------

test('058 is the next free migration number and fresh setup applies it after 057', () => {
  const numbers = fs.readdirSync(DB).filter((f) => /^\d{3}_/.test(f)).map((f) => f.slice(0, 3));
  assert.equal(numbers.filter((n) => n === '058').length, 1);
  const at057 = setupDb.indexOf("loadSql('057_tenant_hot_path_indexes.pg.sql')");
  const at058 = setupDb.indexOf(`loadSql('${MIGRATION}')`);
  assert.ok(at057 > 0 && at058 > at057);
});

test('058 is additive, transactional and safe to re-run', () => {
  const code = migration.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  assert.match(code, /^BEGIN;/m);
  assert.match(code, /^COMMIT;/m);
  assert.match(code, /CREATE TABLE IF NOT EXISTS shelter_closures/);
  assert.match(code, /CREATE INDEX IF NOT EXISTS shelter_closures_shelter_dates_idx/);
  assert.doesNotMatch(code, /ALTER TABLE (?!shelter_closures)\w+/);
  assert.doesNotMatch(code, /\bDROP TABLE\b/i);
  assert.doesNotMatch(code, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(code, /\bINSERT INTO\b/i);
});

test('shelter_closures is a tenant table with row level security, same-shelter trigger and grants', () => {
  assert.ok(TENANT_TABLES.includes('shelter_closures'));
  assert.match(migration, /ALTER TABLE shelter_closures ENABLE ROW LEVEL SECURITY;/);
  assert.match(migration, /CREATE POLICY tenant_isolation ON shelter_closures[\s\S]*USING \(shelter_id = NULLIF\(current_setting\('app\.shelter_id', true\), ''\)::integer\)[\s\S]*WITH CHECK/);
  assert.match(migration, /CREATE TRIGGER trg_same_shelter\s+BEFORE INSERT OR UPDATE ON shelter_closures/);
  assert.match(migration, /assert_same_shelter\(NEW\.shelter_id, 'users', 'user_id', NEW\.created_by\)/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON shelter_closures TO shelterlink_tenant;/);
  assert.match(migration, /GRANT USAGE, SELECT ON SEQUENCE shelter_closures_id_seq TO shelterlink_tenant;/);
  assert.match(migration, /CHECK \(ends_on >= starts_on\)/);
});

test('schema.pg.sql defines shelter_closures the same way as 058 and drops it first', () => {
  function tableBody(sql) {
    const m = /CREATE TABLE (?:IF NOT EXISTS )?shelter_closures \(([\s\S]*?)\n\);/.exec(sql);
    assert.ok(m, 'shelter_closures table not found');
    return m[1].split('\n').map((l) => l.trim().replace(/,$/, '').replace(/\s+/g, ' ')).filter(Boolean);
  }
  assert.deepEqual(tableBody(schema), tableBody(migration));
  const drop = /DROP TABLE IF EXISTS([\s\S]*?)CASCADE;/.exec(schema);
  assert.match(drop[1], /\bshelter_closures\b/);
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test('every closure query binds the current shelter id', async () => {
  closureWorld({ closures: [CHRISTMAS, TRAINING_B] });
  await runWithShelter(1, async () => {
    await ShelterClosure.list({ includePast: true });
    await ShelterClosure.findOverlapping('2026-12-01', '2026-12-31');
    await ShelterClosure.findById(1);
    await ShelterClosure.bookedShiftsBetween('2026-12-24', '2026-12-26');
    await ShelterClosure.create({ starts_on: '2027-01-01', ends_on: '2027-01-01', reason: 'New year' }, 9);
    await ShelterClosure.remove(99);
  });
  const closureCalls = mock.calls.filter((c) => /shelter_closures|FROM opportunities o/.test(c.sql));
  assert.equal(closureCalls.length, 6);
  for (const call of closureCalls) {
    assert.match(call.sql, /shelter_id = \?|\(shelter_id,/);
    assert.equal(call.params[0], 1, `query not scoped to shelter 1: ${call.sql}`);
  }
});

test('model refuses writes and returns nothing without shelter context', async () => {
  closureWorld({ closures: [CHRISTMAS] });
  assert.deepEqual(await ShelterClosure.list({ includePast: true }), []);
  assert.deepEqual(await ShelterClosure.findOverlapping('2026-12-01', '2026-12-31'), []);
  assert.equal(await ShelterClosure.findById(1), null);
  await assert.rejects(() => ShelterClosure.create({ starts_on: '2026-12-25', ends_on: '2026-12-25', reason: 'x' }), /Shelter context is missing/);
  await assert.rejects(() => ShelterClosure.remove(1), /Shelter context is missing/);
  assert.equal(mock.calls.length, 0);
});

test('shelter B cannot list, read, inspect or delete shelter A closures', async () => {
  const world = closureWorld({
    closures: [CHRISTMAS, TRAINING_B],
    booked: [{ shelter_id: 1, day: '2026-12-25', opportunity_id: 7, title: 'MarkerA walk', start_date: '2026-12-25 09:00:00' }],
  });
  await runWithShelter(2, async () => {
    const listRes = makeRes();
    await closureCtrl.listClosures({ query: { include_past: 'true' }, session: { userId: 20 } }, listRes);
    assert.equal(listRes.statusCode, 200);
    assert.deepEqual(listRes.body.closures.map((c) => c.reason), ['MarkerB training']);

    const affected = makeRes();
    await closureCtrl.getAffectedShifts({ params: { closureId: '1' }, session: { userId: 20 } }, affected);
    assert.equal(affected.statusCode, 404);

    const del = makeRes();
    await closureCtrl.deleteClosure({ params: { closureId: '1' }, session: { userId: 20 } }, del);
    assert.equal(del.statusCode, 404);

    const upcoming = makeRes();
    await closureCtrl.listUpcomingClosures({ session: { userId: 21 } }, upcoming);
    assert.doesNotMatch(JSON.stringify(upcoming.body), /Christmas/);
  });
  assert.equal(world.rows.filter((r) => r.shelter_id === 1).length, 1, 'shelter A closure still there');
});

test('a closure created by shelter B never reports shelter A booked shifts', async () => {
  closureWorld({
    booked: [{ shelter_id: 1, day: '2026-12-25', opportunity_id: 7, title: 'MarkerA walk', start_date: '2026-12-25 09:00:00', confirmed_count: 2 }],
  });
  await runWithShelter(2, async () => {
    const res = makeRes();
    await closureCtrl.createClosure({
      body: { starts_on: '2026-12-24', ends_on: '2026-12-26', reason: 'Christmas' },
      session: { userId: 20 },
    }, res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body.affected_shifts, []);
    assert.doesNotMatch(JSON.stringify(res.body), /MarkerA/);
  });
});

// ---------------------------------------------------------------------------
// Admin flow: list booked shifts, cancel nothing
// ---------------------------------------------------------------------------

test('creating a closure lists booked shifts inside it and cancels or emails nothing', async () => {
  const world = closureWorld({
    booked: [
      { shelter_id: 1, day: '2026-12-25', opportunity_id: 7, title: 'Morning walk', start_date: '2026-12-25 09:00:00', end_date: '2026-12-25 12:00:00', status: 'open', confirmed_count: '2', pending_count: '1', waitlisted_count: '0' },
      { shelter_id: 1, day: '2026-12-29', opportunity_id: 8, title: 'Outside range', start_date: '2026-12-29 09:00:00' },
    ],
  });
  await runWithShelter(1, async () => {
    const res = makeRes();
    await closureCtrl.createClosure({
      body: { starts_on: '2026-12-24', ends_on: '2026-12-26', reason: 'Christmas' },
      session: { userId: 1 },
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.closure.reason, 'Christmas');
    assert.equal(res.body.affected_shifts.length, 1);
    assert.equal(res.body.affected_shifts[0].opportunity_id, 7);
    assert.equal(res.body.affected_shifts[0].confirmed_count, 2);
    assert.equal(res.body.affected_shifts[0].pending_count, 1);
    assert.match(res.body.message, /1 shift has bookings inside it\. Nothing has been cancelled\./);
  });
  assert.deepEqual(world.writes.map((w) => /INSERT INTO shelter_closures/.test(w)), [true], 'only the closure row is written');
  const bookedSql = mock.calls.find((c) => /FROM opportunities o/.test(c.sql)).sql;
  assert.match(bookedSql, /a\.status IN \('pending', 'accepted', 'approved', 'waitlisted'\)/);
  assert.match(bookedSql, /o\.status = 'open'/);
});

test('createClosure returns 400 with a plain message for bad input', async () => {
  closureWorld();
  await runWithShelter(1, async () => {
    const res = makeRes();
    await closureCtrl.createClosure({ body: { starts_on: '2026-12-26', ends_on: '2026-12-01', reason: 'x' }, session: { userId: 1 } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /on or after/);
  });
  assert.equal(mock.calls.length, 0);
});

test('admin routes: staff can view, only admins add or remove, all mutations audited', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'routes', 'admin.js'), 'utf8');
  assert.match(routes, /router\.get\('\/closures', isAuthenticated, staffOrAdmin, validateQuery\(queries\.closures\), listClosures\)/);
  assert.match(routes, /router\.post\('\/closures', isAuthenticated, adminOnly, validateBody\(bodies\.shelterClosure\), createClosure\)/);
  assert.match(routes, /router\.delete\('\/closures\/:closureId', isAuthenticated, adminOnly, deleteClosure\)/);
  assert.match(routes, /router\.param\('closureId', positiveParam\('closureId'\)\)/);
  assert.ok(routes.indexOf('router.use(auditMutations)') < routes.indexOf("'/closures'"));
});

// ---------------------------------------------------------------------------
// Shift creation refused on closed days
// ---------------------------------------------------------------------------

const oppCtrl = require('../controllers/opportunityController');

function shiftBody(extra = {}) {
  return {
    title: 'Dog walk',
    description: 'Walk the dogs',
    location: 'Yard',
    start_date: '2026-12-25 09:00:00',
    end_date: '2026-12-25 12:00:00',
    max_volunteers: 3,
    ...extra,
  };
}

test('creating a single shift on a closed day is refused with the date and reason', async () => {
  const world = closureWorld({ closures: [CHRISTMAS] });
  await runWithShelter(1, async () => {
    const res = makeRes();
    await oppCtrl.createOpportunity({ body: shiftBody(), session: { userId: 1, role: 'admin' } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'The shelter is closed on Fri 25 Dec 2026 (Christmas). Pick another date or remove the closure first.');
    assert.equal(res.body.closed_date, '2026-12-25');
    assert.deepEqual(res.body.closure, { starts_on: '2026-12-24', ends_on: '2026-12-26', reason: 'Christmas' });
  });
  assert.ok(!mock.calls.some((c) => /INSERT INTO opportunities/i.test(c.sql)), 'no shift inserted');
  assert.deepEqual(world.writes, []);
});

test('a repeating series that would land on a closed day is refused before any insert', async () => {
  closureWorld({ closures: [CHRISTMAS] });
  await runWithShelter(1, async () => {
    const res = makeRes();
    await oppCtrl.createOpportunity({
      body: shiftBody({
        start_date: '2026-12-18 09:00:00',
        end_date: '2026-12-18 12:00:00',
        recurrence_rule: 'weekly',
        recurrence_until: '2027-01-15',
      }),
      session: { userId: 1, role: 'staff' },
    }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /^This repeating shift would land on Fri 25 Dec 2026, when the shelter is closed \(Christmas\)\./);
    assert.equal(res.body.closed_date, '2026-12-25');
  });
  assert.ok(!mock.calls.some((c) => /INSERT INTO opportunities/i.test(c.sql)));
  const lookup = mock.calls.find((c) => /FROM shelter_closures/.test(c.sql));
  assert.deepEqual(lookup.params, [1, '2027-01-15', '2026-12-18'], 'one lookup spans the whole series');
});

test('a shift on an open day, or a closure in another shelter, does not block creation', async () => {
  for (const [shelterId, closures] of [[1, [CHRISTMAS]], [2, [CHRISTMAS]]]) {
    closureWorld({
      closures,
      extra: (q) => {
        if (/INSERT INTO opportunities/i.test(q)) return [[{ opportunity_id: 42 }]];
        return [[]];
      },
    });
    const body = shelterId === 1
      ? shiftBody({ start_date: '2026-12-27 09:00:00', end_date: '2026-12-27 12:00:00' })
      : shiftBody();
    await runWithShelter(shelterId, async () => {
      const res = makeRes();
      await oppCtrl.createOpportunity({ body, session: { userId: 1, role: 'admin' } }, res);
      assert.notEqual(res.statusCode, 409);
    });
    assert.ok(mock.calls.some((c) => /INSERT INTO opportunities/i.test(c.sql)), `shelter ${shelterId} inserted`);
  }
});

test('moving an existing shift onto a closed day is refused', async () => {
  closureWorld({
    closures: [CHRISTMAS],
    extra: (q) => {
      if (/FROM opportunities/i.test(q)) {
        return [[{ opportunity_id: 5, title: 'Walk', start_date: '2026-12-20 09:00:00', max_volunteers: 3, status: 'open' }]];
      }
      return [[]];
    },
  });
  await runWithShelter(1, async () => {
    const res = makeRes();
    await oppCtrl.updateOpportunity({
      params: { id: '5' },
      body: { start_date: '2026-12-24 09:00:00' },
      session: { userId: 1, role: 'admin' },
    }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /Thu 24 Dec 2026 \(Christmas\)/);
  });
  assert.ok(!mock.calls.some((c) => /^\s*UPDATE opportunities/i.test(c.sql)));
});

// ---------------------------------------------------------------------------
// Public board and volunteer browse show Closed
// ---------------------------------------------------------------------------

test('public board marks shifts on closed days and stops sign-ups for them', async () => {
  const { listPublicOpportunities } = require('../controllers/publicController');
  // Far-future dates so the board's upcoming filter keeps both shifts.
  closureWorld({
    closures: [{ ...CHRISTMAS, starts_on: '2099-12-24', ends_on: '2099-12-26' }],
    extra: (q) => {
      if (/FROM opportunities/i.test(q)) {
        return [[
          { opportunity_id: 1, title: 'Boxing day walk', status: 'open', start_date: '2099-12-26 09:00:00', end_date: '2099-12-26 12:00:00', max_volunteers: 4, spots_filled: 1 },
          { opportunity_id: 2, title: 'New year walk', status: 'open', start_date: '2099-12-27 09:00:00', end_date: '2099-12-27 12:00:00', max_volunteers: 4, spots_filled: 1 },
        ]];
      }
      return [[]];
    },
  });
  await runWithShelter(1, async () => {
    const res = makeRes();
    await listPublicOpportunities({ query: {}, headers: {}, get: () => undefined }, res);
    assert.equal(res.statusCode, 200);
    const byTitle = Object.fromEntries(res.body.map((o) => [o.title, o]));
    assert.equal(byTitle['Boxing day walk'].closed_reason, 'Christmas');
    assert.equal(byTitle['Boxing day walk'].accepting_applications, false);
    assert.equal(byTitle['New year walk'].closed_reason, null);
    assert.equal(byTitle['New year walk'].accepting_applications, true);
  });
});

test('public closures endpoint returns only dates and reason for the resolved shelter', async () => {
  closureWorld({ closures: [{ ...CHRISTMAS, starts_on: '2099-12-24', ends_on: '2099-12-26' }, TRAINING_B] });
  await runWithShelter(1, async () => {
    const res = makeRes();
    await closureCtrl.listPublicClosures({ query: {}, headers: {}, get: () => undefined }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, [{ starts_on: '2099-12-24', ends_on: '2099-12-26', reason: 'Christmas' }]);
  });
});

test('volunteer shift list carries closed_reason from the closure lookup', async () => {
  const marked = await runWithShelter(1, async () => {
    closureWorld({ closures: [CHRISTMAS] });
    return closureCtrl.markClosedShifts([
      { opportunity_id: 1, start_date: '2026-12-25 09:00:00' },
      { opportunity_id: 2, start_date: '2026-12-28 09:00:00' },
    ]);
  });
  assert.equal(marked[0].closed_reason, 'Christmas');
  assert.equal(marked[1].closed_reason, undefined);
});

test('a failed closure lookup never breaks the shift list', async () => {
  mock.resetCalls();
  mock.setHandler(async () => { throw new Error('db down'); });
  const list = [{ opportunity_id: 1, start_date: '2026-12-25 09:00:00' }];
  const out = await runWithShelter(1, () => closureCtrl.markClosedShifts(list));
  assert.deepEqual(out, list);
});

test('client helpers format ranges and the public board labels closed shifts', async () => {
  const { formatClosureRange, closureOnDay, dayCount } = await import('../frontend/js/utils/closures.js');
  const { isAcceptingSignups, closedShiftLabel } = await import('../frontend/js/public/publicBoard.js');
  assert.equal(formatClosureRange({ starts_on: '2026-12-25', ends_on: '2026-12-25' }), 'Fri 25 Dec 2026');
  assert.equal(formatClosureRange({ starts_on: '2026-12-24', ends_on: '2026-12-26' }), 'Thu 24 Dec to Sat 26 Dec 2026');
  assert.equal(formatClosureRange({ starts_on: '2026-12-31', ends_on: '2027-01-01' }), 'Thu 31 Dec 2026 to Fri 1 Jan 2027');
  assert.equal(dayCount({ starts_on: '2026-12-24', ends_on: '2026-12-26' }), 3);
  assert.equal(closureOnDay([CHRISTMAS], '2026-12-26 10:00:00').reason, 'Christmas');
  assert.equal(isAcceptingSignups({ title: 'Walk', closed_reason: 'Christmas', spots_remaining: 3 }), false);
  assert.equal(closedShiftLabel({ closed_reason: 'Christmas' }), 'Closed: Christmas');
});

test('pages: public board and browse load closures; admin page uses ruled tables, no cards', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, 'frontend', p), 'utf8');
  assert.match(read('pages/opportunities.html'), /id="closedDays"/);
  assert.match(read('js/public/opportunities.js'), /\/api\/public\/closures/);
  assert.match(read('pages/volunteer/browse-shifts.html'), /id="closedDays"/);
  assert.match(read('js/volunteer/browse-shifts.js'), /'\/opportunities\/closures'/);
  const admin = read('pages/admin/closures.html');
  assert.match(admin, /<h1>Closure dates<\/h1>/);
  assert.match(admin, /<table>[\s\S]*Upcoming closures/);
  assert.match(admin, /Nothing has been cancelled and no one has been emailed/);
  assert.doesNotMatch(admin, /card|gradient|emoji|style=/i);
  assert.doesNotMatch(admin, /<script>(?!<\/)/);
  const js = read('js/admin/closures.js');
  assert.match(js, /\/opportunities\/\$\{shift\.opportunity_id\}`, \{ method: 'DELETE' \}/, 'uses the existing close-shift path');
  assert.doesNotMatch(js, /innerHTML/);
  const css = read('public/css/custom.css');
  const block = css.slice(css.indexOf('SL-LATER-30'));
  assert.doesNotMatch(block, /gradient|box-shadow|border-radius/);
});

test('a volunteer cannot book a shift that falls on a closed day', async () => {
  const appCtrl = require('../controllers/applicationController');
  closureWorld({
    closures: [CHRISTMAS],
    extra: (q) => {
      if (/FROM volunteer_profiles/i.test(q)) return [[{ user_id: 3, approved: 1 }]];
      if (/FROM waivers/i.test(q)) return [[]];
      if (/WHERE user_id = \? AND opportunity_id = \?/i.test(q)) return [[]];
      if (/FROM opportunities/i.test(q)) {
        return [[{ opportunity_id: 5, title: 'Walk', status: 'open', start_date: '2026-12-25 09:00:00', max_volunteers: 3 }]];
      }
      return [[]];
    },
  });
  await runWithShelter(1, async () => {
    const res = makeRes();
    await appCtrl.applyForOpportunity({ body: { opportunityId: 5 }, session: { userId: 3, role: 'volunteer' } }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /closed that day \(Christmas\)/);
  });
  assert.ok(!mock.calls.some((c) => /INSERT INTO applications/i.test(c.sql)), 'no booking written');
});
