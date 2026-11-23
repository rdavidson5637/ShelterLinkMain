'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { runWithShelter, currentShelterId } = require('../utils/shelterContext');
const VolunteerMerge = require('../models/VolunteerMerge');
const { previewMerge, runMerge } = require('../controllers/volunteerMergeController');
const { bodies } = require('../validation/bodies');

const ROOT = path.join(__dirname, '..');
const ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'database/062_volunteer_archive_merge.pg.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'frontend/pages/admin/volunteer-merge.html'), 'utf8');
const PAGE_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/volunteer-merge.js'), 'utf8');
const VOL_PAGE = fs.readFileSync(path.join(ROOT, 'frontend/pages/admin/volunteers.html'), 'utf8');
const TENANT_ISO = fs.readFileSync(path.join(ROOT, 'test/tenantIsolation.run.js'), 'utf8');
const PROFILE = fs.readFileSync(path.join(ROOT, 'controllers/profileController.js'), 'utf8');

const SHELTER_A = 1;
const SHELTER_B = 2;

function makeRes() {
  const res = { statusCode: 200, body: undefined, locals: {} };
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
    session: { userId: 9, role: 'staff' },
    body: {},
    params: {},
    query: {},
    method: 'POST',
    originalUrl: '/api/admin/volunteers/merge/preview',
    ...overrides,
  };
}

function volunteer(id, shelterId, extra = {}) {
  return {
    user_id: id,
    first_name: extra.first_name || `Vol${id}`,
    last_name: extra.last_name || 'Test',
    name: extra.name || `Vol${id} Test`,
    email: extra.email || `vol${id}@example.test`,
    phone: extra.phone || null,
    role: 'volunteer',
    shelter_id: shelterId,
    archived_at: extra.archived_at || null,
    anonymised_at: extra.anonymised_at || null,
    merged_into_user_id: extra.merged_into_user_id || null,
    approved: extra.approved == null ? 1 : extra.approved,
    password: extra.password || '$2b$12$dummy',
  };
}

/**
 * In-memory DB that filters users/rows by current shelter_id the way RLS does.
 */
function installDb(state) {
  state.users = state.users || [];
  state.applications = state.applications || [];
  state.notes = state.notes || [];
  state.quals = state.quals || [];
  state.memberships = state.memberships || [];
  state.sessionsDeleted = [];
  state.sql = [];

  const visibleUsers = () =>
    state.users.filter((u) => Number(u.shelter_id) === Number(currentShelterId()));

  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    state.sql.push({ sql, params, shelter: currentShelterId() });

    if (/FROM users u/.test(sql) && /WHERE u\.user_id = \?/.test(sql)) {
      const id = Number(params[0]);
      const row = visibleUsers().find((u) => u.user_id === id);
      return [row ? [row] : []];
    }

    if (/FROM applications WHERE user_id = \?/.test(sql) && /COUNT/.test(sql)) {
      const id = Number(params[0]);
      const n = state.applications.filter((a) => a.user_id === id).length;
      return [[{ n }]];
    }
    if (/FROM applications d/.test(sql) && /COUNT/.test(sql)) {
      const keepId = Number(params[0]);
      const dupId = Number(params[1]);
      const keepOps = new Set(
        state.applications.filter((a) => a.user_id === keepId).map((a) => a.opportunity_id)
      );
      const n = state.applications.filter(
        (a) => a.user_id === dupId && keepOps.has(a.opportunity_id)
      ).length;
      return [[{ n }]];
    }
    if (/DELETE FROM applications d/.test(sql)) {
      const dupId = Number(params[0]);
      const keepId = Number(params[1]);
      const keepOps = new Set(
        state.applications.filter((a) => a.user_id === keepId).map((a) => a.opportunity_id)
      );
      const before = state.applications.length;
      state.applications = state.applications.filter(
        (a) => !(a.user_id === dupId && keepOps.has(a.opportunity_id))
      );
      return [{ affectedRows: before - state.applications.length }];
    }
    if (/UPDATE applications SET user_id = \? WHERE user_id = \?/.test(sql)) {
      const [keepId, dupId] = params.map(Number);
      let n = 0;
      for (const a of state.applications) {
        if (a.user_id === dupId) {
          a.user_id = keepId;
          n += 1;
        }
      }
      return [{ affectedRows: n }];
    }

    if (/FROM shift_notes WHERE author_id = \?/.test(sql) && /COUNT/.test(sql)) {
      const id = Number(params[0]);
      return [[{ n: state.notes.filter((n) => n.author_id === id).length }]];
    }
    if (/UPDATE shift_notes SET author_id = \? WHERE author_id = \?/.test(sql)) {
      const [keepId, dupId] = params.map(Number);
      let n = 0;
      for (const note of state.notes) {
        if (note.author_id === dupId) {
          note.author_id = keepId;
          n += 1;
        }
      }
      return [{ affectedRows: n }];
    }

    if (/DELETE FROM volunteer_shift_notes d/.test(sql)) {
      return [{ affectedRows: 0 }];
    }
    if (/UPDATE volunteer_shift_notes SET user_id = \? WHERE user_id = \?/.test(sql)) {
      return [{ affectedRows: 0 }];
    }

    if (/FROM volunteer_qualifications WHERE user_id = \?/.test(sql) && /COUNT/.test(sql)) {
      const id = Number(params[0]);
      return [[{ n: state.quals.filter((q) => q.user_id === id).length }]];
    }
    if (/FROM volunteer_qualifications d/.test(sql) && /COUNT/.test(sql)) {
      const keepId = Number(params[0]);
      const dupId = Number(params[1]);
      const keepQ = new Set(
        state.quals.filter((q) => q.user_id === keepId).map((q) => q.qualification_id)
      );
      const n = state.quals.filter(
        (q) => q.user_id === dupId && keepQ.has(q.qualification_id)
      ).length;
      return [[{ n }]];
    }
    if (/DELETE FROM volunteer_qualifications d/.test(sql)) {
      const dupId = Number(params[0]);
      const keepId = Number(params[1]);
      const keepQ = new Set(
        state.quals.filter((q) => q.user_id === keepId).map((q) => q.qualification_id)
      );
      const before = state.quals.length;
      state.quals = state.quals.filter(
        (q) => !(q.user_id === dupId && keepQ.has(q.qualification_id))
      );
      return [{ affectedRows: before - state.quals.length }];
    }
    if (/UPDATE volunteer_qualifications SET user_id = \? WHERE user_id = \?/.test(sql)) {
      const [keepId, dupId] = params.map(Number);
      let n = 0;
      for (const q of state.quals) {
        if (q.user_id === dupId) {
          q.user_id = keepId;
          n += 1;
        }
      }
      return [{ affectedRows: n }];
    }

    if (/FROM memberships WHERE user_id = \? AND shelter_id = \?/.test(sql) && /COUNT/.test(sql)) {
      const [uid, sid] = params.map(Number);
      const n = state.memberships.filter((m) => m.user_id === uid && m.shelter_id === sid).length;
      return [[{ n }]];
    }
    if (/DELETE FROM memberships WHERE user_id = \? AND shelter_id = \?/.test(sql)) {
      const [uid, sid] = params.map(Number);
      const before = state.memberships.length;
      state.memberships = state.memberships.filter(
        (m) => !(m.user_id === uid && m.shelter_id === sid)
      );
      return [{ affectedRows: before - state.memberships.length }];
    }

    if (/UPDATE users SET[\s\S]*archived_at = NOW\(\)/.test(sql)) {
      const [keepId, email, password, dupId] = params;
      const row = state.users.find((u) => u.user_id === Number(dupId));
      if (row) {
        row.archived_at = new Date().toISOString();
        row.merged_into_user_id = Number(keepId);
        row.email = email;
        row.password = password;
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (/DELETE FROM session/.test(sql)) {
      state.sessionsDeleted.push(String(params[0]));
      return [{ affectedRows: 1 }];
    }

    throw new Error(`Unhandled SQL in volunteerMerge test: ${sql.slice(0, 120)}`);
  });

  return state;
}

test('migration 062 and schema add archived_at and merged_into_user_id', () => {
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS archived_at/);
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS merged_into_user_id/);
  assert.match(SCHEMA, /archived_at\s+TIMESTAMP/);
  assert.match(SCHEMA, /merged_into_user_id\s+INTEGER/);
  assert.match(SCHEMA, /users_merged_into_user_id_fkey/);
});

test('routes mount merge before :userId and require staff', () => {
  assert.match(
    ROUTES,
    /\/volunteers\/merge\/preview'[\s\S]*staffOrAdmin[\s\S]*validateBody\(bodies\.volunteerMerge\)[\s\S]*previewMerge/
  );
  assert.match(
    ROUTES,
    /\/volunteers\/merge'[\s\S]*staffOrAdmin[\s\S]*validateBody\(bodies\.volunteerMerge\)[\s\S]*runMerge/
  );
  const mergeIdx = ROUTES.indexOf("/volunteers/merge'");
  const paramIdx = ROUTES.indexOf("/volunteers/:userId'");
  assert.ok(mergeIdx > 0 && mergeIdx < paramIdx);
});

test('directory SQL hides archived and anonymised volunteers', () => {
  assert.match(PROFILE, /u\.archived_at IS NULL/);
  assert.match(PROFILE, /u\.anonymised_at IS NULL/);
});

test('tenant isolation denies cross-shelter merge', () => {
  assert.match(TENANT_ISO, /\/api\/admin\/volunteers\/merge\/preview/);
  assert.match(TENANT_ISO, /\/api\/admin\/volunteers\/merge'/);
  assert.match(TENANT_ISO, /keep_user_id: 2[\s\S]*duplicate_user_id: 4/);
  assert.match(TENANT_ISO, /keep_user_id: 4[\s\S]*duplicate_user_id: 2/);
});

test('validation schema requires both ids and rejects extras', () => {
  assert.equal(
    bodies.volunteerMerge.safeParse({ keep_user_id: 1, duplicate_user_id: 2 }).success,
    true
  );
  assert.equal(bodies.volunteerMerge.safeParse({ keep_user_id: 1 }).success, false);
  assert.equal(
    bodies.volunteerMerge.safeParse({
      keep_user_id: 1,
      duplicate_user_id: 2,
      shelter_id: 9,
    }).success,
    false
  );
});

test('UI is a ruled preview table with confirm, no cards or icon grids', () => {
  assert.match(PAGE, /Merge duplicate volunteers/);
  assert.match(PAGE, /id="mergeForm"/);
  assert.match(PAGE, /id="previewSection"/);
  assert.match(PAGE, /id="confirmButton"/);
  assert.match(VOL_PAGE, /volunteer-merge\.html/);
  assert.match(PAGE_JS, /\/admin\/volunteers\/merge\/preview/);
  assert.match(PAGE_JS, /\/admin\/volunteers\/merge'/);
  assert.doesNotMatch(PAGE, /feature-grid|card-grid|stat-card/);
  assert.doesNotMatch(PAGE_JS, /✅|☐|☑|emoji/);
});

test('preview lists counts for same-shelter volunteers', async () => {
  const keep = volunteer(10, SHELTER_A, { first_name: 'Keep' });
  const dup = volunteer(11, SHELTER_A, { first_name: 'Dup' });
  const state = installDb({
    users: [keep, dup, volunteer(20, SHELTER_B)],
    applications: [
      { user_id: 10, opportunity_id: 1 },
      { user_id: 11, opportunity_id: 1 },
      { user_id: 11, opportunity_id: 2 },
    ],
    notes: [{ author_id: 11, body: 'hello' }],
    quals: [
      { user_id: 10, qualification_id: 5 },
      { user_id: 11, qualification_id: 5 },
      { user_id: 11, qualification_id: 6 },
    ],
    memberships: [
      { user_id: 11, shelter_id: SHELTER_A },
      { user_id: 11, shelter_id: SHELTER_B },
    ],
  });

  const preview = await runWithShelter(SHELTER_A, () =>
    VolunteerMerge.previewMerge(10, 11)
  );
  assert.equal(preview.keep.user_id, 10);
  assert.equal(preview.duplicate.user_id, 11);
  assert.equal(preview.counts.bookings.move, 1);
  assert.equal(preview.counts.bookings.conflicts, 1);
  assert.equal(preview.counts.notes.move, 1);
  assert.equal(preview.counts.qualifications.move, 1);
  assert.equal(preview.counts.qualifications.conflicts, 1);
  assert.equal(preview.counts.memberships.drop, 1);
  // Preview must not mutate.
  assert.equal(state.applications.filter((a) => a.user_id === 11).length, 2);
});

test('merge cannot see a volunteer from another shelter (fail closed)', async () => {
  installDb({
    users: [volunteer(10, SHELTER_A), volunteer(20, SHELTER_B)],
    applications: [],
    notes: [],
    quals: [],
    memberships: [],
  });

  await assert.rejects(
    () => runWithShelter(SHELTER_A, () => VolunteerMerge.previewMerge(10, 20)),
    (err) => err.status === 404
  );
  await assert.rejects(
    () => runWithShelter(SHELTER_A, () => VolunteerMerge.executeMerge(10, 20)),
    (err) => err.status === 404
  );
  await assert.rejects(
    () => runWithShelter(SHELTER_B, () => VolunteerMerge.executeMerge(10, 20)),
    (err) => err.status === 404
  );
});

test('execute moves rows, drops conflicts, archives duplicate, leaves other-shelter membership', async () => {
  const keep = volunteer(10, SHELTER_A);
  const dup = volunteer(11, SHELTER_A, { email: 'dup@example.test' });
  const state = installDb({
    users: [keep, dup],
    applications: [
      { user_id: 10, opportunity_id: 1 },
      { user_id: 11, opportunity_id: 1 },
      { user_id: 11, opportunity_id: 2 },
    ],
    notes: [
      { author_id: 11, body: 'a' },
      { author_id: 11, body: 'b' },
    ],
    quals: [
      { user_id: 10, qualification_id: 5 },
      { user_id: 11, qualification_id: 5 },
      { user_id: 11, qualification_id: 7 },
    ],
    memberships: [
      { user_id: 10, shelter_id: SHELTER_A },
      { user_id: 11, shelter_id: SHELTER_A },
      { user_id: 11, shelter_id: SHELTER_B },
    ],
  });

  const result = await runWithShelter(SHELTER_A, () =>
    VolunteerMerge.executeMerge(10, 11)
  );

  assert.equal(result.moved.bookings, 1);
  assert.equal(result.moved.notes, 2);
  assert.equal(result.moved.qualifications, 1);
  assert.equal(result.moved.memberships_dropped, 1);
  assert.equal(result.moved.booking_conflicts_dropped, 1);

  assert.deepEqual(
    state.applications.map((a) => [a.user_id, a.opportunity_id]).sort(),
    [
      [10, 1],
      [10, 2],
    ]
  );
  assert.equal(state.notes.every((n) => n.author_id === 10), true);
  assert.deepEqual(
    state.quals.map((q) => [q.user_id, q.qualification_id]).sort(),
    [
      [10, 5],
      [10, 7],
    ]
  );
  // This-shelter membership removed; other shelter left alone (fail closed).
  assert.equal(
    state.memberships.some((m) => m.user_id === 11 && m.shelter_id === SHELTER_A),
    false
  );
  assert.equal(
    state.memberships.some((m) => m.user_id === 11 && m.shelter_id === SHELTER_B),
    true
  );

  const archived = state.users.find((u) => u.user_id === 11);
  assert.ok(archived.archived_at);
  assert.equal(archived.merged_into_user_id, 10);
  assert.match(archived.email, /^merged\+11@archived\.invalid$/);
  assert.notEqual(archived.password, '$2b$12$dummy');
  assert.match(archived.password, /^\$2[aby]\$/);
  assert.equal(state.sessionsDeleted.includes('11'), true);
});

test('controller refuses non-staff and wires preview/merge', async () => {
  installDb({
    users: [volunteer(10, SHELTER_A), volunteer(11, SHELTER_A)],
    applications: [],
    notes: [],
    quals: [],
    memberships: [
      { user_id: 10, shelter_id: SHELTER_A },
      { user_id: 11, shelter_id: SHELTER_A },
    ],
  });

  const forbidden = makeRes();
  await previewMerge(
    makeReq({ session: { userId: 3, role: 'volunteer' }, body: { keep_user_id: 10, duplicate_user_id: 11 } }),
    forbidden
  );
  assert.equal(forbidden.statusCode, 403);

  await runWithShelter(SHELTER_A, async () => {
    const res = makeRes();
    await previewMerge(
      makeReq({ body: { keep_user_id: 10, duplicate_user_id: 11 } }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.keep.user_id, 10);

    const merged = makeRes();
    await runMerge(
      makeReq({
        originalUrl: '/api/admin/volunteers/merge',
        body: { keep_user_id: 10, duplicate_user_id: 11 },
      }),
      merged
    );
    assert.equal(merged.statusCode, 200);
    assert.equal(merged.body.duplicate.user_id, 11);
  });
});

test('same id, archived, or missing shelter context are rejected', async () => {
  installDb({
    users: [
      volunteer(10, SHELTER_A),
      volunteer(11, SHELTER_A, { archived_at: '2026-01-01' }),
    ],
    applications: [],
    notes: [],
    quals: [],
    memberships: [],
  });

  await assert.rejects(
    () => runWithShelter(SHELTER_A, () => VolunteerMerge.previewMerge(10, 10)),
    (err) => err.status === 400
  );
  await assert.rejects(
    () => runWithShelter(SHELTER_A, () => VolunteerMerge.previewMerge(10, 11)),
    (err) => err.status === 400
  );
  await assert.rejects(() => VolunteerMerge.previewMerge(10, 11), (err) => err.status === 403);
});
