'use strict';

// SL-DAY-20: one-off shelter events (open days, fundraisers, clean-up days)
// separate from regular shifts. Staff create; volunteers sign up/cancel;
// staff email attendees on an explicit click. Email only; no SMS.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

for (const mod of [
  '../models/ShelterEvent',
  '../controllers/eventController',
  '../middleware/auth',
  '../utils/emailService',
  '../utils/emailConfig',
  '../utils/emailPreview',
]) {
  const resolved = require.resolve(mod);
  delete require.cache[resolved];
}

const ShelterEvent = require('../models/ShelterEvent');
const {
  listEvents,
  archiveEvent,
  emailAttendees,
  signUp,
  cancelSignup,
} = require('../controllers/eventController');
const { buildShelterEventAttendees } = require('../utils/emailService');
const { catalogIds } = require('../utils/emailPreview');
const { TENANT_TABLES, runWithShelter } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/074_shelter_events.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ROUTES = fs.readFileSync(path.join(ROOT, 'routes/events.js'), 'utf8');
const AUDIT = fs.readFileSync(path.join(ROOT, 'middleware/auditLog.js'), 'utf8');
const BODIES = fs.readFileSync(path.join(ROOT, 'validation/bodies.js'), 'utf8');
const EMAIL_SERVICE = fs.readFileSync(path.join(ROOT, 'utils/emailService.js'), 'utf8');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'utils/notify/index.js'), 'utf8');
const SMS = fs.readFileSync(path.join(ROOT, 'utils/notify/smsProvider.js'), 'utf8');
const ADMIN_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/events.html'),
  'utf8'
);
const ADMIN_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/events.js'), 'utf8');
const VOL_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/volunteer/events.html'),
  'utf8'
);
const VOL_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/volunteer/events.js'), 'utf8');
const NAV = fs.readFileSync(path.join(ROOT, 'frontend/js/components/navConfig.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'frontend/public/css/custom.css'), 'utf8');

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
    originalUrl: '/api/events',
    ...overrides,
  };
}

function futureDate(daysAhead = 14) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

test('migration 074 creates shelter_events and signups with tenant isolation', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS shelter_events/);
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS shelter_event_signups/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /tenant_isolation/);
  assert.match(MIGRATION, /assert_same_shelter/);
  assert.match(MIGRATION, /capacity/);
  assert.match(MIGRATION, /event_date/);
  assert.match(MIGRATION, /cancelled_at/);
  assert.match(SCHEMA, /CREATE TABLE shelter_events/);
  assert.match(SCHEMA, /CREATE TABLE shelter_event_signups/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*shelter_event_signups/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*shelter_events/);
  assert.match(SETUP_DB, /074_shelter_events\.pg\.sql/);
  assert.ok(TENANT_TABLES.includes('shelter_events'));
  assert.ok(TENANT_TABLES.includes('shelter_event_signups'));
});

test('routes, audit, email preview; email only, no SMS', () => {
  assert.match(SERVER, /\/api\/events/);
  assert.match(ROUTES, /requireStaff/);
  assert.match(ROUTES, /\/:id\/archive/);
  assert.match(ROUTES, /\/:id\/email/);
  assert.match(ROUTES, /\/:id\/signup/);
  assert.match(ROUTES, /\/:id\/cancel/);
  assert.match(ROUTES, /messageLimiter/);
  assert.match(BODIES, /shelterEventCreate/);
  assert.match(BODIES, /shelterEvents/);
  assert.match(AUDIT, /event\.create/);
  assert.match(AUDIT, /event\.archive/);
  assert.match(AUDIT, /event\.email/);
  assert.match(AUDIT, /event\.signup/);
  assert.match(AUDIT, /event\.cancel/);
  assert.match(EMAIL_SERVICE, /buildShelterEventAttendees/);
  assert.match(EMAIL_SERVICE, /sendShelterEventAttendees/);
  assert.ok(catalogIds().includes('shelter_event_attendees'));
  assert.doesNotMatch(NOTIFY, /shelterEvent|ShelterEvent/);
  assert.match(SMS, /disabled|switched off|never/i);
  assert.doesNotMatch(ROUTES, /twilio/i);
  assert.doesNotMatch(ADMIN_JS, /twilio/i);
  assert.match(ADMIN_JS, /Email only/);
});

test('UI: staff and volunteer ruled lists; no emoji or gradient blobs', () => {
  assert.match(ADMIN_HTML, /Shelter events/);
  assert.match(ADMIN_HTML, /eventForm/);
  assert.match(ADMIN_HTML, /Capacity/);
  assert.match(ADMIN_JS, /\/events\/\$\{id\}\/email/);
  assert.match(ADMIN_JS, /\/events\/\$\{id\}\/archive/);
  assert.match(ADMIN_JS, /Email attendees/);
  assert.match(VOL_HTML, /Shelter events/);
  assert.match(VOL_JS, /\/events\/\$\{id\}\/signup/);
  assert.match(VOL_JS, /\/events\/\$\{id\}\/cancel/);
  assert.match(NAV, /admin\/events\.html/);
  assert.match(NAV, /volunteer\/events\.html/);
  assert.match(CSS, /SL-DAY-20/);
  assert.match(CSS, /\.event-ruled-list\b/);
  const dayCss = CSS.slice(CSS.indexOf('/* SL-DAY-20:'));
  assert.doesNotMatch(dayCss, /🎉|😀|gradient|rounded-2xl|card-grid/i);
  assert.doesNotMatch(ADMIN_HTML, /🎉|😀/);
  assert.doesNotMatch(VOL_HTML, /🎉|😀/);
});

test('buildShelterEventAttendees includes title, date and place', () => {
  const parts = buildShelterEventAttendees(
    {
      firstName: 'Alex',
      title: 'Spring open day',
      description: 'Help welcome visitors.',
      eventDate: '2026-12-06',
      location: 'Main yard gate',
    },
    { name: 'Demo Shelter', signoff: 'ShelterLink, Demo Shelter' }
  );
  assert.match(parts.subject, /Spring open day/);
  assert.match(parts.html, /Alex/);
  assert.match(parts.html, /Spring open day/);
  assert.match(parts.html, /Help welcome visitors/);
  assert.match(parts.html, /2026-12-06/);
  assert.match(parts.html, /Main yard gate/);
  assert.match(parts.text, /Spring open day/);
});

test('create and list upcoming events; archive hides from volunteers', async () => {
  const store = { rows: [], nextId: 1 };
  const date = futureDate(10);

  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO shelter_events/i.test(sql)) {
      const id = store.nextId++;
      const row = {
        id,
        title: params[0],
        description: params[1],
        event_date: params[2],
        location: params[3],
        capacity: params[4],
        archived_at: null,
        emailed_at: null,
        email_count: 0,
        created_by: params[5],
        created_at: '2026-11-23T10:00:00.000Z',
        updated_at: '2026-11-23T10:00:00.000Z',
        author_first_name: 'Sam',
        author_last_name: 'Staff',
        author_name: null,
        signup_count: 0,
      };
      store.rows.unshift(row);
      return [{ insertId: id }];
    }
    if (/FROM shelter_events e/i.test(sql) && /WHERE e\.id = \?/i.test(sql)) {
      const id = Number(params[0]);
      return [store.rows.filter((r) => r.id === id)];
    }
    if (/FROM shelter_events e/i.test(sql) && /event_date >= CURRENT_DATE/i.test(sql)) {
      const today = new Date().toISOString().slice(0, 10);
      return [
        store.rows.filter(
          (r) => !r.archived_at && String(r.event_date).slice(0, 10) >= today
        ),
      ];
    }
    if (/FROM shelter_events e/i.test(sql) && /ORDER BY e\.event_date DESC/i.test(sql)) {
      return [store.rows.slice()];
    }
    if (/SET archived_at = CURRENT_TIMESTAMP/i.test(sql)) {
      const id = Number(params[0]);
      const row = store.rows.find((r) => r.id === id);
      if (row) {
        row.archived_at = '2026-11-23T12:00:00.000Z';
        row.updated_at = row.archived_at;
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (/FROM shelter_event_signups/i.test(sql)) {
      return [[]];
    }
    throw new Error(`Unexpected SQL in create/list test: ${sql.slice(0, 120)}`);
  });

  await runWithShelter(1, async () => {
    const created = await ShelterEvent.create({
      title: 'Spring open day',
      description: 'Help welcome visitors at the gate.',
      eventDate: date,
      location: 'Main yard gate',
      capacity: 20,
      createdBy: 5,
    });
    assert.equal(created.title, 'Spring open day');
    assert.equal(created.status, 'upcoming');
    assert.equal(created.capacity, 20);

    const upcoming = await ShelterEvent.listEvents({ upcomingOnly: true });
    assert.equal(upcoming.length, 1);

    const archived = await ShelterEvent.archive(created.id);
    assert.equal(archived.status, 'archived');

    const after = await ShelterEvent.listEvents({ upcomingOnly: true });
    assert.equal(after.length, 0);

    const all = await ShelterEvent.listEvents({
      upcomingOnly: false,
      includeArchived: true,
    });
    assert.equal(all.length, 1);
  });

  mock.resetCalls();
});

test('volunteer signup respects capacity and cancel frees a place', async () => {
  const date = futureDate(7);
  const event = {
    id: 4,
    title: 'Clean-up morning',
    description: 'Tidy the yard and sheds.',
    event_date: date,
    location: 'Yard',
    capacity: 1,
    archived_at: null,
    emailed_at: null,
    email_count: 0,
    created_by: 5,
    created_at: '2026-11-23T10:00:00.000Z',
    updated_at: '2026-11-23T10:00:00.000Z',
    author_first_name: 'Sam',
    author_last_name: 'Staff',
    author_name: null,
    signup_count: 0,
  };
  const signups = [];
  let nextSignupId = 1;

  mock.setHandler(async (sql, params) => {
    if (/FROM shelter_events e/i.test(sql) && /WHERE e\.id = \?/i.test(sql)) {
      event.signup_count = signups.filter((s) => !s.cancelled_at).length;
      return [[event]];
    }
    if (
      /FROM shelter_event_signups/i.test(sql) &&
      /event_id = \?/i.test(sql) &&
      /user_id = \?/i.test(sql) &&
      /cancelled_at IS NULL/i.test(sql) &&
      /SELECT id/i.test(sql)
    ) {
      const eventId = Number(params[0]);
      const userId = Number(params[1]);
      return [
        signups.filter(
          (s) => s.event_id === eventId && s.user_id === userId && !s.cancelled_at
        ),
      ];
    }
    if (
      /FROM shelter_event_signups/i.test(sql) &&
      /event_id = \?/i.test(sql) &&
      /user_id = \?/i.test(sql) &&
      /SELECT id, cancelled_at/i.test(sql)
    ) {
      const eventId = Number(params[0]);
      const userId = Number(params[1]);
      return [signups.filter((s) => s.event_id === eventId && s.user_id === userId)];
    }
    if (/COUNT\(\*\)::int AS n/i.test(sql)) {
      return [[{ n: signups.filter((s) => !s.cancelled_at).length }]];
    }
    if (/INSERT INTO shelter_event_signups/i.test(sql)) {
      const row = {
        id: nextSignupId++,
        event_id: Number(params[0]),
        user_id: Number(params[1]),
        cancelled_at: null,
      };
      signups.push(row);
      return [{ insertId: row.id }];
    }
    if (/SET cancelled_at = CURRENT_TIMESTAMP/i.test(sql)) {
      const id = Number(params[0]);
      const row = signups.find((s) => s.id === id);
      if (row) row.cancelled_at = '2026-11-23T15:00:00.000Z';
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (/FROM users u/i.test(sql) && /volunteer_profiles/i.test(sql)) {
      return [
        [
          {
            user_id: Number(params[0]),
            role: 'volunteer',
            approved: 1,
          },
        ],
      ];
    }
    throw new Error(`Unexpected SQL in signup test: ${sql.slice(0, 140)}`);
  });

  await runWithShelter(1, async () => {
    const first = await ShelterEvent.signUp(4, 11);
    assert.equal(first.my_signup, true);
    assert.equal(first.spots_filled, 1);

    await assert.rejects(() => ShelterEvent.signUp(4, 12), /full/i);

    const cancelled = await ShelterEvent.cancelSignup(4, 11);
    assert.equal(cancelled.my_signup, false);
    assert.equal(cancelled.spots_filled, 0);

    const second = await ShelterEvent.signUp(4, 12);
    assert.equal(second.my_signup, true);
  });

  mock.resetCalls();
});

test('email endpoint emails attendees only on staff click', async () => {
  const date = futureDate(5);
  const event = {
    id: 9,
    title: 'Fundraiser stall',
    description: 'Help on the stall at the village hall.',
    event_date: date,
    location: 'Village hall',
    capacity: 10,
    archived_at: null,
    emailed_at: null,
    email_count: 0,
    created_by: 5,
    created_at: '2026-11-23T10:00:00.000Z',
    updated_at: '2026-11-23T10:00:00.000Z',
    author_first_name: 'Sam',
    author_last_name: 'Staff',
    author_name: null,
    signup_count: 2,
  };
  const attendees = [
    {
      id: 1,
      user_id: 11,
      email: 'active@example.org',
      first_name: 'Alex',
      last_name: 'Volunteer',
      name: 'Alex Volunteer',
      signed_up_at: '2026-11-20T10:00:00.000Z',
    },
    {
      id: 2,
      user_id: 12,
      email: 'also@example.org',
      first_name: 'Blake',
      last_name: 'Helper',
      name: 'Blake Helper',
      signed_up_at: '2026-11-21T10:00:00.000Z',
    },
  ];
  const sent = [];

  mock.setHandler(async (sql, params) => {
    if (/FROM shelter_events e/i.test(sql) && /WHERE e\.id = \?/i.test(sql)) {
      return [[event]];
    }
    if (/FROM shelter_event_signups s/i.test(sql) && /cancelled_at IS NULL/i.test(sql)) {
      return [attendees];
    }
    if (/SET emailed_at = CURRENT_TIMESTAMP/i.test(sql)) {
      event.emailed_at = '2026-11-23T13:00:00.000Z';
      event.email_count = Number(params[0]) || 0;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL in email test: ${sql.slice(0, 120)}`);
  });

  const emailMod = require('../utils/emailService');
  const originalSend = emailMod.sendShelterEventAttendees;
  emailMod.sendShelterEventAttendees = async (to, details) => {
    sent.push({ to, details });
    return { messageId: 'test' };
  };

  try {
    await runWithShelter(1, async () => {
      const res = makeRes();
      await emailAttendees(
        makeReq({
          method: 'POST',
          params: { id: '9' },
          originalUrl: '/api/events/9/email',
        }),
        res
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.sent, 2);
      assert.equal(sent.length, 2);
      assert.equal(sent[0].to, 'active@example.org');
      assert.equal(sent[0].details.title, 'Fundraiser stall');
      assert.equal(res.body.item.email_count, 2);
    });
  } finally {
    emailMod.sendShelterEventAttendees = originalSend;
    mock.resetCalls();
  }
});

test('volunteer list returns upcoming; staff-only create path uses requireStaff', async () => {
  const date = futureDate(3);
  mock.setHandler(async (sql) => {
    if (/FROM shelter_events e/i.test(sql)) {
      return [
        [
          {
            id: 1,
            title: 'Visible open day',
            description: 'Come along',
            event_date: date,
            location: 'Gate',
            capacity: 15,
            archived_at: null,
            emailed_at: null,
            email_count: 0,
            created_by: 5,
            created_at: '2026-11-23T10:00:00.000Z',
            updated_at: '2026-11-23T10:00:00.000Z',
            author_first_name: 'Sam',
            author_last_name: 'Staff',
            author_name: null,
            signup_count: 0,
          },
        ],
      ];
    }
    if (/FROM shelter_event_signups/i.test(sql)) {
      return [[]];
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
  });

  await runWithShelter(1, async () => {
    const volRes = makeRes();
    await listEvents(
      makeReq({ session: { userId: 11, role: 'volunteer' }, query: {} }),
      volRes
    );
    assert.equal(volRes.statusCode, 200);
    assert.equal(volRes.body.total, 1);
    assert.equal(volRes.body.items[0].title, 'Visible open day');
  });

  assert.match(ROUTES, /requireStaff[\s\S]*shelterEventCreate|shelterEventCreate[\s\S]*requireStaff/);
  mock.resetCalls();
});

test('archive controller marks event archived', async () => {
  const date = futureDate(20);
  const row = {
    id: 3,
    title: 'Old fundraiser',
    description: 'Done',
    event_date: date,
    location: 'Hall',
    capacity: 8,
    archived_at: null,
    emailed_at: null,
    email_count: 0,
    created_by: 5,
    created_at: '2026-11-01T10:00:00.000Z',
    updated_at: '2026-11-01T10:00:00.000Z',
    author_first_name: 'Sam',
    author_last_name: 'Staff',
    author_name: null,
    signup_count: 0,
  };

  mock.setHandler(async (sql, params) => {
    if (/FROM shelter_events e/i.test(sql) && /WHERE e\.id = \?/i.test(sql)) {
      return [[row]];
    }
    if (/SET archived_at = CURRENT_TIMESTAMP/i.test(sql)) {
      row.archived_at = '2026-11-23T14:00:00.000Z';
      return [{ affectedRows: 1 }];
    }
    if (/FROM shelter_event_signups/i.test(sql)) {
      return [[]];
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
  });

  await runWithShelter(1, async () => {
    const res = makeRes();
    await archiveEvent(
      makeReq({
        method: 'POST',
        params: { id: '3' },
        originalUrl: '/api/events/3/archive',
      }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.item.status, 'archived');
  });

  mock.resetCalls();
});

test('create rejects blank title; signup rejects staff role via controller', async () => {
  await runWithShelter(1, async () => {
    await assert.rejects(
      () =>
        ShelterEvent.create({
          title: '   ',
          description: 'Body text',
          eventDate: futureDate(2),
          location: 'Yard',
          capacity: 5,
          createdBy: 5,
        }),
      /title/i
    );

    const res = makeRes();
    await signUp(
      makeReq({
        method: 'POST',
        session: { userId: 5, role: 'staff' },
        params: { id: '1' },
        originalUrl: '/api/events/1/signup',
      }),
      res
    );
    assert.equal(res.statusCode, 403);

    const cancelRes = makeRes();
    await cancelSignup(
      makeReq({
        method: 'POST',
        session: { userId: 5, role: 'staff' },
        params: { id: '1' },
        originalUrl: '/api/events/1/cancel',
      }),
      cancelRes
    );
    assert.equal(cancelRes.statusCode, 403);
  });
});
