'use strict';

// SL-DAY-15: private staff notes on a volunteer profile. Staff-only,
// tenant-scoped via RLS, author and time shown, edits audit-logged,
// never visible to the volunteer or in their data export.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

for (const mod of [
  '../models/StaffNote',
  '../controllers/staffNoteController',
  '../middleware/auth',
  '../models/Gdpr',
]) {
  const resolved = require.resolve(mod);
  delete require.cache[resolved];
}

const StaffNote = require('../models/StaffNote');
const {
  listVolunteerStaffNotes,
  createVolunteerStaffNote,
  updateVolunteerStaffNote,
  deleteVolunteerStaffNote,
} = require('../controllers/staffNoteController');
const Gdpr = require('../models/Gdpr');
const { TENANT_TABLES, runWithShelter } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/071_volunteer_staff_notes.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const ADMIN_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const VOL_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/volunteers.js'), 'utf8');
const GDPR = fs.readFileSync(path.join(ROOT, 'models/Gdpr.js'), 'utf8');
const AUDIT = fs.readFileSync(path.join(ROOT, 'middleware/auditLog.js'), 'utf8');
const BODIES = fs.readFileSync(path.join(ROOT, 'validation/bodies.js'), 'utf8');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'utils/notify/index.js'), 'utf8');
const SMS = fs.readFileSync(path.join(ROOT, 'utils/notify/smsProvider.js'), 'utf8');
const DASH_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/volunteer/dashboard.js'), 'utf8');
const PROFILE_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/volunteer/complete-profile.js'),
  'utf8'
);
const TENANT_RUN = fs.readFileSync(path.join(ROOT, 'test/tenantIsolation.run.js'), 'utf8');

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
    session: { userId: 1, role: 'staff' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/admin/volunteers/2/staff-notes',
    ...overrides,
  };
}

test('migration 071 creates volunteer_staff_notes with tenant isolation', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS volunteer_staff_notes/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /tenant_isolation/);
  assert.match(MIGRATION, /assert_same_shelter/);
  assert.match(MIGRATION, /author_user_id/);
  assert.match(MIGRATION, /updated_by/);
  assert.match(SCHEMA, /CREATE TABLE volunteer_staff_notes/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*volunteer_staff_notes/);
  assert.match(SETUP_DB, /071_volunteer_staff_notes\.pg\.sql/);
  assert.ok(TENANT_TABLES.includes('volunteer_staff_notes'));
});

test('staff routes expose notes; volunteer UI and SMS stay clear', () => {
  assert.match(ADMIN_ROUTES, /\/volunteers\/:userId\/staff-notes/);
  assert.match(ADMIN_ROUTES, /staff-notes\/:noteId/);
  assert.match(ADMIN_ROUTES, /bodies\.volunteerStaffNote/);
  assert.match(BODIES, /volunteerStaffNote/);
  assert.match(AUDIT, /volunteer\.staff_note\.create/);
  assert.match(AUDIT, /volunteer\.staff_note\.update/);
  assert.match(AUDIT, /volunteer\.staff_note\.delete/);
  assert.match(VOL_JS, /\/admin\/volunteers\/\$\{userId\}\/staff-notes/);
  assert.match(VOL_JS, /Staff notes/);
  assert.match(VOL_JS, /Not shown to the volunteer/);
  assert.doesNotMatch(DASH_JS, /staff-notes|staffNotes|Staff notes/i);
  assert.doesNotMatch(PROFILE_JS, /staff-notes|staffNotes|Staff notes/i);
  assert.doesNotMatch(NOTIFY, /staff.?note/i);
  assert.match(SMS, /disabled|switched off|never/i);
});

test('GDPR export never selects staff notes; erase deletes them', () => {
  assert.match(GDPR, /volunteer_staff_notes are staff-only/);
  assert.doesNotMatch(GDPR, /SELECT[^;]*FROM volunteer_staff_notes/i);
  assert.match(GDPR, /DELETE FROM volunteer_staff_notes WHERE volunteer_user_id/);
  assert.ok(!/\bstaff_notes\s*:/.test(GDPR), 'export object must not include staff_notes');
});

test('tenant isolation denies cross-shelter staff note routes', () => {
  assert.match(TENANT_RUN, /\/api\/admin\/volunteers\/2\/staff-notes/);
});

test('StaffNote.create stores a note with author; update records editor', async () => {
  const volunteer = {
    user_id: 10,
    first_name: 'New',
    last_name: 'Volunteer',
    name: 'New Volunteer',
    email: 'new@example.com',
    role: 'volunteer',
    archived_at: null,
    anonymised_at: null,
  };
  const author = {
    user_id: 1,
    first_name: 'Staff',
    last_name: 'Member',
    name: 'Staff Member',
  };
  let noteRow = null;
  let insertCount = 0;
  let updateCount = 0;

  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM users[\s\S]*role = 'volunteer'/i.test(sql)) {
      const id = Number(params[0]);
      return [id === 10 ? [volunteer] : []];
    }
    if (/INSERT INTO volunteer_staff_notes/i.test(sql)) {
      insertCount += 1;
      noteRow = {
        id: 5,
        volunteer_user_id: Number(params[0]),
        author_user_id: Number(params[1]),
        body: params[2],
        created_at: '2026-11-23 10:00:00',
        updated_at: '2026-11-23 10:00:00',
        updated_by: null,
        author_first_name: author.first_name,
        author_last_name: author.last_name,
        author_name: author.name,
        editor_first_name: null,
        editor_last_name: null,
        editor_name: null,
      };
      return [{ insertId: 5, affectedRows: 1 }];
    }
    if (/FROM volunteer_staff_notes n/i.test(sql) && /n\.id = \?/i.test(sql)) {
      return [noteRow ? [noteRow] : []];
    }
    if (/UPDATE volunteer_staff_notes/i.test(sql)) {
      updateCount += 1;
      noteRow = {
        ...noteRow,
        body: params[0],
        updated_by: Number(params[1]),
        updated_at: '2026-11-23 11:00:00',
        editor_first_name: 'Staff',
        editor_last_name: 'Member',
        editor_name: 'Staff Member',
      };
      return [{ affectedRows: 1 }];
    }
    if (/FROM volunteer_staff_notes n/i.test(sql) && /volunteer_user_id = \?/i.test(sql)) {
      return [noteRow ? [noteRow] : []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  await runWithShelter(1, async () => {
    const created = await StaffNote.create({
      volunteerUserId: 10,
      authorUserId: 1,
      body: ' First contact went well. ',
    });
    assert.equal(insertCount, 1);
    assert.equal(created.note.body, 'First contact went well.');
    assert.equal(created.note.author.name, 'Staff Member');
    assert.equal(created.note.edited, false);

    const updated = await StaffNote.update({
      noteId: 5,
      volunteerUserId: 10,
      editorUserId: 1,
      body: 'First contact went well. Follow up next week.',
    });
    assert.equal(updateCount, 1);
    assert.equal(updated.changed, true);
    assert.equal(updated.previous_body, 'First contact went well.');
    assert.equal(updated.note.edited, true);
    assert.equal(updated.note.updated_by.name, 'Staff Member');

    await assert.rejects(
      () => StaffNote.create({ volunteerUserId: 10, authorUserId: 1, body: '   ' }),
      { status: 400 }
    );
    await assert.rejects(
      () => StaffNote.create({ volunteerUserId: 999, authorUserId: 1, body: 'Hello' }),
      { status: 404 }
    );
  });
});

test('controllers require staff and return notes with author metadata', async () => {
  const volunteer = {
    user_id: 10,
    first_name: 'New',
    last_name: 'Volunteer',
    name: 'New Volunteer',
    email: 'new@example.com',
    role: 'volunteer',
    archived_at: null,
    anonymised_at: null,
  };
  let noteRow = {
    id: 5,
    volunteer_user_id: 10,
    author_user_id: 1,
    body: 'Private observation',
    created_at: '2026-11-23 10:00:00',
    updated_at: '2026-11-23 10:00:00',
    updated_by: null,
    author_first_name: 'Staff',
    author_last_name: 'Member',
    author_name: 'Staff Member',
    editor_first_name: null,
    editor_last_name: null,
    editor_name: null,
  };

  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM users[\s\S]*role = 'volunteer'/i.test(sql)) {
      return [Number(params[0]) === 10 ? [volunteer] : []];
    }
    if (/INSERT INTO volunteer_staff_notes/i.test(sql)) {
      noteRow = {
        ...noteRow,
        volunteer_user_id: Number(params[0]),
        author_user_id: Number(params[1]),
        body: params[2],
      };
      return [{ insertId: 5, affectedRows: 1 }];
    }
    if (/UPDATE volunteer_staff_notes/i.test(sql)) {
      noteRow = {
        ...noteRow,
        body: params[0],
        updated_by: Number(params[1]),
        updated_at: '2026-11-23 11:00:00',
        editor_first_name: 'Staff',
        editor_last_name: 'Member',
        editor_name: 'Staff Member',
      };
      return [{ affectedRows: 1 }];
    }
    if (/DELETE FROM volunteer_staff_notes/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/FROM volunteer_staff_notes n/i.test(sql)) {
      return [[noteRow]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  await runWithShelter(1, async () => {
    const forbidden = makeRes();
    await listVolunteerStaffNotes(
      makeReq({ session: { userId: 10, role: 'volunteer' }, params: { userId: '10' } }),
      forbidden
    );
    assert.equal(forbidden.statusCode, 403);

    const listRes = makeRes();
    await listVolunteerStaffNotes(
      makeReq({ params: { userId: '10' } }),
      listRes
    );
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.body.notes.length, 1);
    assert.equal(listRes.body.notes[0].author.name, 'Staff Member');

    const createRes = makeRes();
    await createVolunteerStaffNote(
      makeReq({
        method: 'POST',
        params: { userId: '10' },
        body: { body: 'Private observation' },
      }),
      createRes
    );
    assert.equal(createRes.statusCode, 201);

    const updateRes = makeRes();
    await updateVolunteerStaffNote(
      makeReq({
        method: 'PUT',
        params: { userId: '10', noteId: '5' },
        body: { body: 'Updated observation' },
      }),
      updateRes
    );
    assert.equal(updateRes.statusCode, 200);
    assert.equal(updateRes.body.changed, true);
    assert.equal(updateRes.body.note.body, 'Updated observation');

    const deleteRes = makeRes();
    await deleteVolunteerStaffNote(
      makeReq({
        method: 'DELETE',
        params: { userId: '10', noteId: '5' },
      }),
      deleteRes
    );
    assert.equal(deleteRes.statusCode, 200);
    assert.equal(deleteRes.body.deleted, true);
  });
});

test('buildVolunteerExport payload has no staff_notes key', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users WHERE user_id/i.test(sql)) {
      return [
        [
          {
            user_id: 4,
            first_name: 'Vol',
            last_name: 'One',
            name: 'Vol One',
            phone: null,
            email: 'vol@example.test',
            role: 'volunteer',
            created_at: '2026-01-01',
            last_login: null,
            anonymised_at: null,
          },
        ],
      ];
    }
    return [[]];
  });
  const payload = await Gdpr.buildVolunteerExport(4);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'staff_notes'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'volunteer_staff_notes'), false);
  assert.ok(payload.shift_notes);
});
