'use strict';

// SL-DAY-12: staff expiry dashboard for checks, documents, and qualifications.
// Optional staff-triggered email reminder only. No SMS. No auto-send.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

for (const mod of [
  '../models/ExpiryDashboard',
  '../controllers/expiryDashboardController',
  '../middleware/auth',
  '../utils/emailService',
  '../utils/emailConfig',
  '../utils/emailPreview',
]) {
  const resolved = require.resolve(mod);
  delete require.cache[resolved];
}

const ExpiryDashboard = require('../models/ExpiryDashboard');
const {
  listExpiringItems,
  sendExpiryReminder,
} = require('../controllers/expiryDashboardController');
const { buildExpiryReminder } = require('../utils/emailService');
const { catalogIds } = require('../utils/emailPreview');
const { runWithShelter } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/066_document_expiry_dashboard.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const ADMIN_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const NAV = fs.readFileSync(path.join(ROOT, 'frontend/js/components/navConfig.js'), 'utf8');
const PAGE = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/expiry-dashboard.html'),
  'utf8'
);
const PAGE_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/admin/expiry-dashboard.js'),
  'utf8'
);
const NOTIFY = fs.readFileSync(path.join(ROOT, 'utils/notify/index.js'), 'utf8');
const SMS = fs.readFileSync(path.join(ROOT, 'utils/notify/smsProvider.js'), 'utf8');
const EMAIL_SERVICE = fs.readFileSync(path.join(ROOT, 'utils/emailService.js'), 'utf8');
const AUDIT = fs.readFileSync(path.join(ROOT, 'middleware/auditLog.js'), 'utf8');

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
    session: { userId: 1, role: 'staff' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/admin/expiry-dashboard',
    ...overrides,
  };
}

test('migration 066 adds staff reminder columns on existing expiry tables', () => {
  assert.match(MIGRATION, /background_checks/);
  assert.match(MIGRATION, /user_documents/);
  assert.match(MIGRATION, /volunteer_qualifications/);
  assert.match(MIGRATION, /last_staff_reminder_sent_at/);
  assert.match(SCHEMA, /last_staff_reminder_sent_at/);
  assert.match(SETUP_DB, /066_document_expiry_dashboard\.pg\.sql/);
});

test('staff routes expose list and remind; email only, no SMS path', () => {
  assert.match(ADMIN_ROUTES, /\/expiry-dashboard/);
  assert.match(ADMIN_ROUTES, /\/expiry-dashboard\/remind/);
  assert.match(ADMIN_ROUTES, /messageLimiter/);
  assert.match(ADMIN_ROUTES, /sendExpiryReminder/);
  assert.match(NAV, /expiry-dashboard\.html/);
  assert.match(PAGE, /Expiring documents and checks/);
  assert.match(PAGE_JS, /Send reminder email/);
  assert.match(AUDIT, /expiry\.reminder\.email/);
  assert.doesNotMatch(NOTIFY, /expiryReminder|ExpiryDashboard/);
  assert.match(SMS, /disabled|switched off|never/i);
  assert.match(EMAIL_SERVICE, /buildExpiryReminder/);
  assert.match(EMAIL_SERVICE, /sendExpiryReminder/);
  assert.ok(catalogIds().includes('expiry_reminder'));
});

test('clampDays defaults to 30 and caps at 90', () => {
  assert.equal(ExpiryDashboard.clampDays(undefined), 30);
  assert.equal(ExpiryDashboard.clampDays('abc'), 30);
  assert.equal(ExpiryDashboard.clampDays(0), 1);
  assert.equal(ExpiryDashboard.clampDays(45), 45);
  assert.equal(ExpiryDashboard.clampDays(999), 90);
});

test('listExpiring merges checks, documents and qualifications within the window', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM background_checks/i.test(sql)) {
      return [
        [
          {
            id: 11,
            user_id: 5,
            check_type: 'accessni_basic',
            status: 'clear',
            expires_on: '2026-12-01',
            last_staff_reminder_sent_at: null,
            first_name: 'Pat',
            last_name: 'Lee',
            name: 'Pat Lee',
            email: 'pat@example.com',
          },
        ],
      ];
    }
    if (/FROM user_documents/i.test(sql)) {
      return [
        [
          {
            id: 22,
            user_id: 6,
            label: 'Volunteer waiver scan',
            original_name: 'waiver.pdf',
            expires_at: '2026-11-28',
            last_staff_reminder_sent_at: null,
            first_name: 'Sam',
            last_name: 'Ng',
            name: 'Sam Ng',
            email: 'sam@example.com',
          },
        ],
      ];
    }
    if (/FROM volunteer_qualifications/i.test(sql)) {
      return [
        [
          {
            id: 33,
            user_id: 7,
            expires_at: '2026-12-10',
            last_staff_reminder_sent_at: '2026-11-01T10:00:00.000Z',
            qualification_name: 'Dog walking',
            first_name: 'Jo',
            last_name: 'Kim',
            name: 'Jo Kim',
            email: 'jo@example.com',
          },
        ],
      ];
    }
    return [[], []];
  });

  const result = await runWithShelter(1, () =>
    ExpiryDashboard.listExpiring({ days: 30, now: new Date('2026-11-23T12:00:00.000Z') })
  );

  assert.equal(result.days, 30);
  assert.equal(result.from, '2026-11-23');
  assert.equal(result.until, '2026-12-23');
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].kind, 'document');
  assert.equal(result.items[0].label, 'Volunteer waiver scan');
  assert.equal(result.items[1].kind, 'background_check');
  assert.equal(result.items[1].label, 'AccessNI Basic');
  assert.equal(result.items[2].kind, 'qualification');
  assert.equal(result.items[2].label, 'Dog walking');
  assert.ok(result.items.every((item) => !Object.prototype.hasOwnProperty.call(item, 'email')));
  assert.match(result.items[0].href, /volunteers\.html\?user=6/);
});

test('listExpiringItems rejects non-staff', async () => {
  const res = makeRes();
  await listExpiringItems(
    makeReq({ session: { userId: 9, role: 'volunteer' } }),
    res
  );
  assert.equal(res.statusCode, 403);
});

test('listExpiringItems returns payload for staff', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[], []]);
  const res = makeRes();
  await runWithShelter(1, () => listExpiringItems(makeReq({ query: { days: '14' } }), res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.days, 14);
  assert.deepEqual(res.body.items, []);
});

test('sendExpiryReminder rejects volunteers and missing items', async () => {
  const forbidden = makeRes();
  await sendExpiryReminder(
    makeReq({
      session: { userId: 9, role: 'volunteer' },
      method: 'POST',
      body: { kind: 'document', id: 1, send_email: true },
    }),
    forbidden
  );
  assert.equal(forbidden.statusCode, 403);

  mock.resetCalls();
  mock.setHandler(async () => [[], []]);
  const missing = makeRes();
  await runWithShelter(1, () =>
    sendExpiryReminder(
      makeReq({
        method: 'POST',
        body: { kind: 'document', id: 99, send_email: true },
      }),
      missing
    )
  );
  assert.equal(missing.statusCode, 404);
});

test('sendExpiryReminder emails only on explicit send and records the timestamp', async () => {
  const emailCalls = [];
  const emailService = require('../utils/emailService');
  const originalSend = emailService.sendExpiryReminder;
  emailService.sendExpiryReminder = async (...args) => {
    emailCalls.push(args);
    return { messageId: 'test' };
  };

  const prevHost = process.env.EMAIL_HOST;
  const prevFrom = process.env.EMAIL_FROM;
  process.env.EMAIL_HOST = 'smtp.example.test';
  process.env.EMAIL_FROM = 'shelter@example.test';

  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM user_documents/i.test(sql) && /WHERE d\.id/i.test(sql)) {
      return [
        [
          {
            id: 22,
            user_id: 6,
            label: 'First aid cert',
            original_name: 'fa.pdf',
            expires_on: '2026-12-01',
            last_staff_reminder_sent_at: null,
            first_name: 'Sam',
            last_name: 'Ng',
            name: 'Sam Ng',
            email: 'sam@example.com',
            archived_at: null,
            anonymised_at: null,
          },
        ],
      ];
    }
    if (/SET last_staff_reminder_sent_at/i.test(sql)) {
      return [{ affectedRows: 1 }, []];
    }
    return [[], []];
  });

  try {
    const res = makeRes();
    await runWithShelter(1, () =>
      sendExpiryReminder(
        makeReq({
          method: 'POST',
          originalUrl: '/api/admin/expiry-dashboard/remind',
          body: {
            kind: 'document',
            id: 22,
            send_email: true,
            message: 'Please bring a renewed copy next shift.',
          },
        }),
        res
      )
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.email_sent, true);
    assert.equal(emailCalls.length, 1);
    assert.equal(emailCalls[0][0], 'sam@example.com');
    assert.match(emailCalls[0][1].itemLabel, /First aid/);
    assert.match(emailCalls[0][1].message, /renewed copy/);
    assert.ok(
      mock.calls.some((c) => /SET last_staff_reminder_sent_at/i.test(c.sql))
    );
  } finally {
    emailService.sendExpiryReminder = originalSend;
    if (prevHost === undefined) delete process.env.EMAIL_HOST;
    else process.env.EMAIL_HOST = prevHost;
    if (prevFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = prevFrom;
  }
});

test('buildExpiryReminder escapes names and includes plain text', () => {
  const parts = buildExpiryReminder(
    {
      firstName: '<script>x</script>',
      itemLabel: 'AccessNI Basic & Standard',
      kind: 'background_check',
      expiresOn: '2026-12-15',
      message: 'Line one\nLine two',
    },
    { name: 'Assisi', signoff: 'ShelterLink, Assisi', namePlain: 'Assisi' }
  );
  assert.match(parts.subject, /AccessNI Basic/);
  assert.match(parts.html, /&lt;script&gt;/);
  assert.doesNotMatch(parts.html, /<script>/);
  assert.match(parts.html, /background check/);
  assert.match(parts.html, /&amp;/);
  assert.match(parts.text, /AccessNI Basic/);
  assert.match(parts.text, /Line one/);
  assert.ok(parts.text && parts.text.trim());
});
