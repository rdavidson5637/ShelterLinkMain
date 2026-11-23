'use strict';

// SL-DAY-11: optional after-shift notes from volunteers (short text, no rating).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.EMAIL_HOST = 'smtp.test';
process.env.EMAIL_FROM = 'shelterlink@test';

const mock = require('./helpers/mockDb');

const emailCalls = [];

for (const mod of [
  '../models/VolunteerShiftNote',
  '../models/Opportunity',
  '../controllers/volunteerShiftNoteController',
  '../middleware/auth',
  '../utils/emailService',
  '../utils/emailConfig',
  '../utils/emailPreview',
]) {
  const resolved = require.resolve(mod);
  delete require.cache[resolved];
}

const emailConfigPath = require.resolve('../utils/emailConfig');
require.cache[emailConfigPath] = {
  id: emailConfigPath,
  filename: emailConfigPath,
  loaded: true,
  exports: {
    isEmailConfigured: () => true,
  },
};

// Load real builders first, then wrap send so notify tests can assert.
const realEmail = require('../utils/emailService');
const emailPath = require.resolve('../utils/emailService');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    ...realEmail,
    sendVolunteerShiftNoteAlert: async (...args) => {
      emailCalls.push(args);
      return { messageId: 'test' };
    },
  },
};

delete require.cache[require.resolve('../controllers/volunteerShiftNoteController')];
delete require.cache[require.resolve('../models/VolunteerShiftNote')];

const VolunteerShiftNote = require('../models/VolunteerShiftNote');
const {
  listMine,
  saveMine,
  listForOpportunity,
  listForVolunteer,
} = require('../controllers/volunteerShiftNoteController');
const { buildVolunteerShiftNoteAlert } = require('../utils/emailService');
const { catalogIds } = require('../utils/emailPreview');
const { TENANT_TABLES, runWithShelter } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/068_volunteer_shift_notes.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const ADMIN_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const NOTE_ROUTES = fs.readFileSync(
  path.join(ROOT, 'routes/volunteerShiftNotes.js'),
  'utf8'
);
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const VOL_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/volunteers.js'), 'utf8');
const OPP_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/opportunities.js'), 'utf8');
const OPP_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/opportunities.html'),
  'utf8'
);
const HOURS_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/volunteer/my-hours.js'), 'utf8');
const HOURS_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/volunteer/my-hours.html'),
  'utf8'
);
const GDPR = fs.readFileSync(path.join(ROOT, 'models/Gdpr.js'), 'utf8');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'utils/notify/index.js'), 'utf8');
const SMS = fs.readFileSync(path.join(ROOT, 'utils/notify/smsProvider.js'), 'utf8');
const BODIES = fs.readFileSync(path.join(ROOT, 'validation/bodies.js'), 'utf8');

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
    session: { userId: 2, role: 'volunteer' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/volunteer-shift-notes/mine',
    ...overrides,
  };
}

test('migration 067 creates volunteer_shift_notes with tenant isolation', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS volunteer_shift_notes/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /tenant_isolation/);
  assert.match(MIGRATION, /assert_same_shelter/);
  assert.match(MIGRATION, /UNIQUE \(application_id\)/);
  assert.match(MIGRATION, /char_length\(body\) <= 500/);
  assert.match(SCHEMA, /CREATE TABLE volunteer_shift_notes/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*volunteer_shift_notes/);
  assert.match(SETUP_DB, /068_volunteer_shift_notes\.pg\.sql/);
  assert.ok(TENANT_TABLES.includes('volunteer_shift_notes'));
});

test('wiring: routes, server mount, UI, GDPR, validation, no SMS', () => {
  assert.match(NOTE_ROUTES, /\/mine/);
  assert.match(NOTE_ROUTES, /volunteerShiftNote/);
  assert.match(SERVER, /\/api\/volunteer-shift-notes/);
  assert.match(ADMIN_ROUTES, /volunteers\/:userId\/shift-notes/);
  assert.match(ADMIN_ROUTES, /opportunities\/:id\/volunteer-notes/);
  assert.match(HOURS_HTML, /After-shift notes/);
  assert.match(HOURS_JS, /volunteer-shift-notes/);
  assert.match(OPP_HTML, /Volunteer after-shift notes/);
  assert.match(OPP_JS, /volunteer-notes/);
  assert.match(VOL_JS, /shift-notes/);
  assert.match(VOL_JS, /After-shift notes/);
  assert.match(GDPR, /volunteer_shift_notes/);
  assert.match(BODIES, /volunteerShiftNote/);
  assert.match(BODIES, /max\(500\)/);
  assert.doesNotMatch(NOTIFY, /twilio/i);
  assert.match(SMS, /disabled|not configured|SMS_ENABLED|false/i);
});

test('email catalog includes after-shift note alert', () => {
  assert.ok(catalogIds().includes('volunteer_shift_note'));
  const brand = {
    name: 'Assisi',
    namePlain: 'Assisi',
    signoff: 'ShelterLink, Assisi',
    signoffPlain: 'ShelterLink, Assisi',
  };
  const parts = buildVolunteerShiftNoteAlert(
    {
      volunteerName: 'Alex',
      title: 'Morning walk',
      date: 'Saturday',
      body: 'Gate latch sticks.',
    },
    brand
  );
  assert.match(parts.subject, /after-shift note/i);
  assert.match(parts.html, /Gate latch sticks/);
  assert.match(parts.text, /Gate latch sticks/);
  assert.doesNotMatch(parts.html, /rating|score/i);
});

test('createOrUpdate inserts note when eligible via check-in', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM applications a/i.test(sql) && /can_note/i.test(sql)) {
      return [
        [
          {
            application_id: 10,
            user_id: 2,
            opportunity_id: 3,
            status: 'accepted',
            no_show: 0,
            checked_in_at: '2026-11-20 09:00:00',
            checked_out_at: null,
            opportunity_title: 'Morning walk',
            opportunity_start_date: '2026-11-20 09:00:00',
            opportunity_end_date: '2026-11-20 12:00:00',
            can_note: 1,
          },
        ],
      ];
    }
    if (/FROM volunteer_shift_notes n/i.test(sql) && /application_id = \?/i.test(sql)) {
      // first findByApplicationId before insert → empty; after insert → mapped
      const calls = mock.calls.filter((c) => /FROM volunteer_shift_notes n/i.test(c.sql));
      if (calls.length <= 1) return [[]];
      return [
        [
          {
            id: 5,
            application_id: 10,
            user_id: 2,
            opportunity_id: 3,
            body: 'Gate latch sticks.',
            notify: 0,
            notify_emailed_at: null,
            created_at: '2026-11-20 13:00:00',
            updated_at: '2026-11-20 13:00:00',
            first_name: 'Alex',
            last_name: 'Volunteer',
            volunteer_name: 'Alex Volunteer',
            opportunity_title: 'Morning walk',
            opportunity_start_date: '2026-11-20 09:00:00',
            opportunity_end_date: '2026-11-20 12:00:00',
          },
        ],
      ];
    }
    if (/INSERT INTO volunteer_shift_notes/i.test(sql)) {
      assert.equal(params[0], 10);
      assert.equal(params[3], 'Gate latch sticks.');
      return [{ insertId: 5 }];
    }
    if (/FROM volunteer_shift_notes n/i.test(sql) && /WHERE n\.id = \?/i.test(sql)) {
      return [
        [
          {
            id: 5,
            application_id: 10,
            user_id: 2,
            opportunity_id: 3,
            body: 'Gate latch sticks.',
            notify: 0,
            notify_emailed_at: null,
            created_at: '2026-11-20 13:00:00',
            updated_at: '2026-11-20 13:00:00',
            first_name: 'Alex',
            last_name: 'Volunteer',
            volunteer_name: 'Alex Volunteer',
            opportunity_title: 'Morning walk',
            opportunity_start_date: '2026-11-20 09:00:00',
            opportunity_end_date: '2026-11-20 12:00:00',
          },
        ],
      ];
    }
    return [[]];
  });

  const note = await runWithShelter(1, () =>
    VolunteerShiftNote.createOrUpdate({
      applicationId: 10,
      userId: 2,
      body: 'Gate latch sticks.',
      notify: 0,
    })
  );
  assert.equal(note.id, 5);
  assert.equal(note.body, 'Gate latch sticks.');
  assert.equal(note.notify, 0);
});

test('createOrUpdate refuses before attendance or shift end', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM applications a/i.test(sql) && /can_note/i.test(sql)) {
      return [
        [
          {
            application_id: 10,
            user_id: 2,
            opportunity_id: 3,
            status: 'accepted',
            no_show: 0,
            checked_in_at: null,
            checked_out_at: null,
            opportunity_title: 'Future walk',
            opportunity_start_date: '2099-01-01 09:00:00',
            opportunity_end_date: '2099-01-01 12:00:00',
            can_note: 0,
          },
        ],
      ];
    }
    return [[]];
  });

  await assert.rejects(
    () =>
      runWithShelter(1, () =>
        VolunteerShiftNote.createOrUpdate({
          applicationId: 10,
          userId: 2,
          body: 'Too early',
        })
      ),
    /attended|shift ends/i
  );
});

test('saveMine emails staff only when notify is set and a note is left', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  let noteRow = null;
  mock.setHandler(async (sql, params) => {
    if (/FROM applications a/i.test(sql) && /can_note/i.test(sql)) {
      return [
        [
          {
            application_id: 10,
            user_id: 2,
            opportunity_id: 3,
            status: 'accepted',
            no_show: 0,
            checked_in_at: '2026-11-20 09:00:00',
            checked_out_at: null,
            opportunity_title: 'Morning walk',
            opportunity_start_date: '2026-11-20 09:00:00',
            opportunity_end_date: '2026-11-20 12:00:00',
            can_note: 1,
          },
        ],
      ];
    }
    if (/INSERT INTO volunteer_shift_notes/i.test(sql)) {
      noteRow = {
        id: 7,
        application_id: 10,
        user_id: 2,
        opportunity_id: 3,
        body: params[3],
        notify: params[4],
        notify_emailed_at: null,
        created_at: '2026-11-20 13:00:00',
        updated_at: '2026-11-20 13:00:00',
        first_name: 'Alex',
        last_name: 'Volunteer',
        volunteer_name: 'Alex Volunteer',
        opportunity_title: 'Morning walk',
        opportunity_start_date: '2026-11-20 09:00:00',
        opportunity_end_date: '2026-11-20 12:00:00',
      };
      return [{ insertId: 7 }];
    }
    if (/FROM volunteer_shift_notes n/i.test(sql)) {
      return noteRow ? [[noteRow]] : [[]];
    }
    if (/SELECT email[\s\S]*FROM users[\s\S]*role IN/i.test(sql)) {
      return [[{ email: 'staff@example.test' }]];
    }
    if (/UPDATE volunteer_shift_notes[\s\S]*notify_emailed_at/i.test(sql)) {
      if (noteRow) noteRow.notify_emailed_at = '2026-11-20 13:01:00';
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const res = makeRes();
  await runWithShelter(1, () =>
    saveMine(
      makeReq({
        method: 'POST',
        body: { application_id: 10, body: 'Gate latch sticks.', notify: true },
        originalUrl: '/api/volunteer-shift-notes',
      }),
      res
    )
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.emailed, 1);
  assert.equal(emailCalls.length, 1);
  assert.equal(emailCalls[0][0], 'staff@example.test');
});

test('saveMine does not email when notify is false', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  let noteRow = null;
  mock.setHandler(async (sql, params) => {
    if (/FROM applications a/i.test(sql) && /can_note/i.test(sql)) {
      return [
        [
          {
            application_id: 10,
            user_id: 2,
            opportunity_id: 3,
            status: 'accepted',
            no_show: 0,
            checked_in_at: '2026-11-20 09:00:00',
            checked_out_at: null,
            opportunity_title: 'Morning walk',
            opportunity_start_date: '2026-11-20 09:00:00',
            opportunity_end_date: '2026-11-20 12:00:00',
            can_note: 1,
          },
        ],
      ];
    }
    if (/INSERT INTO volunteer_shift_notes/i.test(sql)) {
      noteRow = {
        id: 8,
        application_id: 10,
        user_id: 2,
        opportunity_id: 3,
        body: params[3],
        notify: 0,
        notify_emailed_at: null,
        created_at: '2026-11-20 13:00:00',
        updated_at: '2026-11-20 13:00:00',
        first_name: 'Alex',
        last_name: 'Volunteer',
        volunteer_name: 'Alex Volunteer',
        opportunity_title: 'Morning walk',
        opportunity_start_date: '2026-11-20 09:00:00',
        opportunity_end_date: '2026-11-20 12:00:00',
      };
      return [{ insertId: 8 }];
    }
    if (/FROM volunteer_shift_notes n/i.test(sql)) {
      return noteRow ? [[noteRow]] : [[]];
    }
    return [[]];
  });

  const res = makeRes();
  await runWithShelter(1, () =>
    saveMine(
      makeReq({
        method: 'POST',
        body: { application_id: 10, body: 'Quiet note.', notify: false },
      }),
      res
    )
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.emailed, 0);
  assert.equal(emailCalls.length, 0);
});

test('staff list endpoints require staff and return notes', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities/i.test(sql) && /WHERE/i.test(sql)) {
      return [[{ opportunity_id: 3, title: 'Morning walk' }]];
    }
    if (/SELECT user_id FROM users WHERE user_id = \?/i.test(sql)) {
      return [[{ user_id: 2 }]];
    }
    if (/FROM volunteer_shift_notes n/i.test(sql)) {
      return [
        [
          {
            id: 5,
            application_id: 10,
            user_id: 2,
            opportunity_id: 3,
            body: 'Gate latch sticks.',
            notify: 1,
            notify_emailed_at: null,
            created_at: '2026-11-20 13:00:00',
            updated_at: '2026-11-20 13:00:00',
            first_name: 'Alex',
            last_name: 'Volunteer',
            volunteer_name: 'Alex Volunteer',
            opportunity_title: 'Morning walk',
            opportunity_start_date: '2026-11-20 09:00:00',
            opportunity_end_date: '2026-11-20 12:00:00',
          },
        ],
      ];
    }
    return [[]];
  });

  const denied = makeRes();
  await runWithShelter(1, () =>
    listForOpportunity(
      makeReq({
        session: { userId: 2, role: 'volunteer' },
        params: { id: '3' },
      }),
      denied
    )
  );
  assert.equal(denied.statusCode, 403);

  const ok = makeRes();
  await runWithShelter(1, () =>
    listForOpportunity(
      makeReq({
        session: { userId: 1, role: 'staff' },
        params: { id: '3' },
      }),
      ok
    )
  );
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.length, 1);
  assert.equal(ok.body[0].body, 'Gate latch sticks.');

  const vol = makeRes();
  await runWithShelter(1, () =>
    listForVolunteer(
      makeReq({
        session: { userId: 1, role: 'admin' },
        params: { userId: '2' },
      }),
      vol
    )
  );
  assert.equal(vol.statusCode, 200);
  assert.equal(vol.body[0].volunteer_name, 'Alex Volunteer');
});

test('listMine returns eligible shifts for the volunteer', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM applications a/i.test(sql) && /LEFT JOIN volunteer_shift_notes/i.test(sql)) {
      return [
        [
          {
            application_id: 10,
            user_id: 2,
            opportunity_id: 3,
            checked_in_at: '2026-11-20 09:00:00',
            checked_out_at: null,
            opportunity_title: 'Morning walk',
            opportunity_start_date: '2026-11-20 09:00:00',
            opportunity_end_date: '2026-11-20 12:00:00',
            id: null,
            body: null,
            notify: null,
            notify_emailed_at: null,
            created_at: null,
            updated_at: null,
            can_note: 1,
            has_note: 0,
          },
        ],
      ];
    }
    return [[]];
  });

  const res = makeRes();
  await runWithShelter(1, () => listMine(makeReq(), res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].can_note, true);
  assert.equal(res.body[0].has_note, false);
});
