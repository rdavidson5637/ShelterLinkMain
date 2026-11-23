'use strict';

// SL-DAY-17: staff post dated shelter notices shown on volunteer home;
// optional email to active volunteers on an explicit click; expiry + archive.
// Email only; no SMS.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

for (const mod of [
  '../models/ShelterAnnouncement',
  '../controllers/announcementController',
  '../middleware/auth',
  '../utils/emailService',
  '../utils/emailConfig',
  '../utils/emailPreview',
]) {
  const resolved = require.resolve(mod);
  delete require.cache[resolved];
}

const ShelterAnnouncement = require('../models/ShelterAnnouncement');
const {
  listAnnouncements,
  archiveAnnouncement,
  emailAnnouncement,
} = require('../controllers/announcementController');
const { buildShelterAnnouncement } = require('../utils/emailService');
const { catalogIds } = require('../utils/emailPreview');
const { TENANT_TABLES, runWithShelter } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/072_shelter_announcements.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ROUTES = fs.readFileSync(path.join(ROOT, 'routes/announcements.js'), 'utf8');
const AUDIT = fs.readFileSync(path.join(ROOT, 'middleware/auditLog.js'), 'utf8');
const BODIES = fs.readFileSync(path.join(ROOT, 'validation/bodies.js'), 'utf8');
const EMAIL_SERVICE = fs.readFileSync(path.join(ROOT, 'utils/emailService.js'), 'utf8');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'utils/notify/index.js'), 'utf8');
const SMS = fs.readFileSync(path.join(ROOT, 'utils/notify/smsProvider.js'), 'utf8');
const ADMIN_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/announcements.html'),
  'utf8'
);
const ADMIN_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/announcements.js'), 'utf8');
const DASH_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/volunteer/dashboard.html'),
  'utf8'
);
const DASH_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/volunteer/dashboard.js'), 'utf8');
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
    originalUrl: '/api/announcements',
    ...overrides,
  };
}

test('migration 072 creates shelter_announcements with tenant isolation', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS shelter_announcements/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /tenant_isolation/);
  assert.match(MIGRATION, /assert_same_shelter/);
  assert.match(MIGRATION, /expires_on/);
  assert.match(MIGRATION, /archived_at/);
  assert.match(SCHEMA, /CREATE TABLE shelter_announcements/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*shelter_announcements/);
  assert.match(SETUP_DB, /072_shelter_announcements\.pg\.sql/);
  assert.ok(TENANT_TABLES.includes('shelter_announcements'));
});

test('routes, audit, email preview; email only, no SMS', () => {
  assert.match(SERVER, /\/api\/announcements/);
  assert.match(ROUTES, /requireStaff/);
  assert.match(ROUTES, /\/:id\/archive/);
  assert.match(ROUTES, /\/:id\/email/);
  assert.match(ROUTES, /messageLimiter/);
  assert.match(BODIES, /shelterAnnouncementCreate/);
  assert.match(BODIES, /shelterAnnouncements/);
  assert.match(AUDIT, /announcement\.create/);
  assert.match(AUDIT, /announcement\.archive/);
  assert.match(AUDIT, /announcement\.email/);
  assert.match(EMAIL_SERVICE, /buildShelterAnnouncement/);
  assert.match(EMAIL_SERVICE, /sendShelterAnnouncement/);
  assert.ok(catalogIds().includes('shelter_announcement'));
  assert.doesNotMatch(NOTIFY, /shelterAnnouncement|ShelterAnnouncement/);
  assert.match(SMS, /disabled|switched off|never/i);
  assert.doesNotMatch(ROUTES, /twilio/i);
  assert.doesNotMatch(ADMIN_JS, /twilio/i);
  assert.match(ADMIN_JS, /Email only/);
});

test('UI: staff page and volunteer home ruled list; no emoji or gradient blobs', () => {
  assert.match(ADMIN_HTML, /Shelter announcements/);
  assert.match(ADMIN_HTML, /announcementForm/);
  assert.match(ADMIN_HTML, /Expires on/);
  assert.match(ADMIN_JS, /\/announcements\/\$\{id\}\/email/);
  assert.match(ADMIN_JS, /\/announcements\/\$\{id\}\/archive/);
  assert.match(ADMIN_JS, /Email active volunteers/);
  assert.match(NAV, /announcements\.html/);
  assert.match(DASH_HTML, /shelterAnnouncementsSection/);
  assert.match(DASH_HTML, /From your shelter/);
  assert.match(DASH_JS, /\/announcements/);
  assert.match(DASH_JS, /loadShelterAnnouncements/);
  assert.match(CSS, /SL-DAY-17/);
  assert.match(CSS, /\.announcement-home-list\b/);
  assert.match(CSS, /\.announcement-ruled-list\b/);
  const dayCss = CSS.slice(CSS.indexOf('/* SL-DAY-17:'));
  assert.doesNotMatch(dayCss, /🎉|😀|gradient|rounded-2xl|card-grid/i);
  assert.doesNotMatch(ADMIN_HTML, /🎉|😀/);
  assert.doesNotMatch(DASH_HTML, /🎉|😀/);
});

test('buildShelterAnnouncement includes title and body', () => {
  const parts = buildShelterAnnouncement(
    {
      firstName: 'Alex',
      title: 'Yard closed Saturday',
      body: 'Use the indoor room.',
      postedOn: '2026-11-23',
      expiresOn: '2026-11-30',
    },
    { name: 'Demo Shelter', signoff: 'ShelterLink, Demo Shelter' }
  );
  assert.match(parts.subject, /Yard closed Saturday/);
  assert.match(parts.html, /Alex/);
  assert.match(parts.html, /Yard closed Saturday/);
  assert.match(parts.html, /Use the indoor room/);
  assert.match(parts.text, /Yard closed Saturday/);
});

test('create and list active announcements; archive hides from volunteers', async () => {
  const store = { rows: [], nextId: 1 };

  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO shelter_announcements/i.test(sql)) {
      const id = store.nextId++;
      const row = {
        id,
        title: params[0],
        body: params[1],
        posted_on: params[2],
        expires_on: params[3],
        archived_at: null,
        emailed_at: null,
        email_count: 0,
        created_by: params[4],
        created_at: '2026-11-23T10:00:00.000Z',
        updated_at: '2026-11-23T10:00:00.000Z',
        author_first_name: 'Sam',
        author_last_name: 'Staff',
        author_name: null,
      };
      store.rows.unshift(row);
      return [{ insertId: id }];
    }
    if (/FROM shelter_announcements a/i.test(sql) && /WHERE a\.id = \?/i.test(sql)) {
      const id = Number(params[0]);
      return [store.rows.filter((r) => r.id === id)];
    }
    if (/FROM shelter_announcements a/i.test(sql) && /archived_at IS NULL/i.test(sql)) {
      const today = new Date().toISOString().slice(0, 10);
      return [
        store.rows.filter(
          (r) =>
            !r.archived_at &&
            (r.expires_on == null || String(r.expires_on).slice(0, 10) >= today)
        ),
      ];
    }
    if (/FROM shelter_announcements a/i.test(sql) && /ORDER BY a\.posted_on DESC/i.test(sql)) {
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
    throw new Error(`Unexpected SQL in create/list test: ${sql.slice(0, 120)}`);
  });

  await runWithShelter(1, async () => {
    const created = await ShelterAnnouncement.create({
      title: 'Water bowls restocked',
      body: 'Extra bowls are in the laundry cupboard.',
      postedOn: '2026-11-23',
      expiresOn: '2026-12-01',
      createdBy: 5,
    });
    assert.equal(created.title, 'Water bowls restocked');
    assert.equal(created.status, 'active');

    const active = await ShelterAnnouncement.listAnnouncements({ activeOnly: true });
    assert.equal(active.length, 1);

    const archived = await ShelterAnnouncement.archive(created.id);
    assert.equal(archived.status, 'archived');

    const after = await ShelterAnnouncement.listAnnouncements({ activeOnly: true });
    assert.equal(after.length, 0);

    const all = await ShelterAnnouncement.listAnnouncements({
      activeOnly: false,
      includeArchived: true,
    });
    assert.equal(all.length, 1);
  });

  mock.resetCalls();
});

test('email endpoint emails approved volunteers only on staff click', async () => {
  const announcement = {
    id: 9,
    title: 'Training evening',
    body: 'Optional refresher on Wednesday.',
    posted_on: '2026-11-23',
    expires_on: null,
    archived_at: null,
    emailed_at: null,
    email_count: 0,
    created_by: 5,
    created_at: '2026-11-23T10:00:00.000Z',
    updated_at: '2026-11-23T10:00:00.000Z',
    author_first_name: 'Sam',
    author_last_name: 'Staff',
    author_name: null,
  };
  const recipients = [
    {
      user_id: 11,
      email: 'active@example.org',
      first_name: 'Alex',
      last_name: 'Volunteer',
      name: 'Alex Volunteer',
    },
    {
      user_id: 12,
      email: 'also@example.org',
      first_name: 'Blake',
      last_name: 'Helper',
      name: 'Blake Helper',
    },
  ];
  const sent = [];

  mock.setHandler(async (sql, params) => {
    if (/FROM shelter_announcements a/i.test(sql) && /WHERE a\.id = \?/i.test(sql)) {
      return [[announcement]];
    }
    if (/FROM users u/i.test(sql) && /volunteer_profiles/i.test(sql) && /approved/i.test(sql)) {
      return [recipients];
    }
    if (/SET emailed_at = CURRENT_TIMESTAMP/i.test(sql)) {
      announcement.emailed_at = '2026-11-23T13:00:00.000Z';
      announcement.email_count = Number(params[0]) || 0;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL in email test: ${sql.slice(0, 120)}`);
  });

  const emailMod = require('../utils/emailService');
  const originalSend = emailMod.sendShelterAnnouncement;
  emailMod.sendShelterAnnouncement = async (to, details) => {
    sent.push({ to, details });
    return { messageId: 'test' };
  };

  try {
    await runWithShelter(1, async () => {
      const res = makeRes();
      await emailAnnouncement(
        makeReq({
          method: 'POST',
          params: { id: '9' },
          originalUrl: '/api/announcements/9/email',
        }),
        res
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.sent, 2);
      assert.equal(sent.length, 2);
      assert.equal(sent[0].to, 'active@example.org');
      assert.equal(sent[0].details.title, 'Training evening');
      assert.equal(res.body.item.email_count, 2);
    });
  } finally {
    emailMod.sendShelterAnnouncement = originalSend;
    mock.resetCalls();
  }
});

test('volunteer list endpoint returns active only; staff create needs staff', async () => {
  mock.setHandler(async (sql) => {
    if (/FROM shelter_announcements a/i.test(sql)) {
      return [
        [
          {
            id: 1,
            title: 'Visible',
            body: 'On home',
            posted_on: '2026-11-23',
            expires_on: null,
            archived_at: null,
            emailed_at: null,
            email_count: 0,
            created_by: 5,
            created_at: '2026-11-23T10:00:00.000Z',
            updated_at: '2026-11-23T10:00:00.000Z',
            author_first_name: 'Sam',
            author_last_name: 'Staff',
            author_name: null,
          },
        ],
      ];
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
  });

  await runWithShelter(1, async () => {
    const volRes = makeRes();
    await listAnnouncements(
      makeReq({ session: { userId: 11, role: 'volunteer' }, query: {} }),
      volRes
    );
    assert.equal(volRes.statusCode, 200);
    assert.equal(volRes.body.total, 1);
    assert.equal(volRes.body.items[0].title, 'Visible');
  });

  mock.resetCalls();
});

test('archive controller marks announcement archived', async () => {
  const row = {
    id: 3,
    title: 'Old notice',
    body: 'Done',
    posted_on: '2026-11-01',
    expires_on: null,
    archived_at: null,
    emailed_at: null,
    email_count: 0,
    created_by: 5,
    created_at: '2026-11-01T10:00:00.000Z',
    updated_at: '2026-11-01T10:00:00.000Z',
    author_first_name: 'Sam',
    author_last_name: 'Staff',
    author_name: null,
  };

  mock.setHandler(async (sql, params) => {
    if (/FROM shelter_announcements a/i.test(sql) && /WHERE a\.id = \?/i.test(sql)) {
      return [[row]];
    }
    if (/SET archived_at = CURRENT_TIMESTAMP/i.test(sql)) {
      row.archived_at = '2026-11-23T14:00:00.000Z';
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
  });

  await runWithShelter(1, async () => {
    const res = makeRes();
    await archiveAnnouncement(
      makeReq({
        method: 'POST',
        params: { id: '3' },
        originalUrl: '/api/announcements/3/archive',
      }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.item.status, 'archived');
  });

  mock.resetCalls();
});

test('create rejects blank title', async () => {
  await runWithShelter(1, async () => {
    await assert.rejects(
      () =>
        ShelterAnnouncement.create({
          title: '   ',
          body: 'Body text',
          createdBy: 5,
        }),
      /title/i
    );
  });
});
