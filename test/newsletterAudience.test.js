'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
const mock = require('./helpers/mockDb');
const Profile = require('../models/VolunteerProfile');
const ctrl = require('../controllers/newsletterAudienceController');
const syncModule = require('../utils/newsletter/syncProvider');
const { runWithShelter } = require('../utils/shelterContext');

function makeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  return res;
}

test('marketing consent defaults off and is not a notification pref alias', () => {
  assert.ok(Profile.ALLOWED_PROFILE_FIELDS.has('marketing_consent'));
  assert.equal(Profile.ALLOWED_PROFILE_FIELDS.has('marketing_consent_at'), false);
});

test('create stores marketing_consent_at only when the volunteer opts in', async () => {
  mock.resetCalls();
  let inserted = null;
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO volunteer_profiles/i.test(sql)) {
      inserted = { sql, params };
      return [{ insertId: 1, affectedRows: 1 }];
    }
    if (/FROM volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 9, marketing_consent: 1, marketing_consent_at: params?.[2] || null }]];
    }
    return [[]];
  });

  await Profile.create(9, { availability: 'Weekends', marketing_consent: 1 });
  assert.match(inserted.sql, /marketing_consent/);
  assert.match(inserted.sql, /marketing_consent_at/);
  const consentIdx = inserted.sql.indexOf('marketing_consent');
  const atIdx = inserted.sql.indexOf('marketing_consent_at');
  assert.ok(consentIdx > 0 && atIdx > consentIdx);
  assert.equal(inserted.params[0], 9);
  assert.ok(inserted.params.includes(1));
  assert.ok(inserted.params.some((p) => p instanceof Date));
});

test('create without marketing_consent does not invent an opt-in', async () => {
  mock.resetCalls();
  let inserted = null;
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO volunteer_profiles/i.test(sql)) {
      inserted = { sql, params };
      return [{ insertId: 1, affectedRows: 1 }];
    }
    if (/FROM volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 3, marketing_consent: 0, marketing_consent_at: null }]];
    }
    return [[]];
  });

  await Profile.create(3, { availability: 'Flexible', skills: 'Dogs' });
  assert.doesNotMatch(inserted.sql, /marketing_consent/);
});

test('update clears consent date when the volunteer opts out', async () => {
  mock.resetCalls();
  let updated = null;
  mock.setHandler(async (sql, params) => {
    if (/UPDATE volunteer_profiles SET/i.test(sql)) {
      updated = { sql, params };
      return [{ affectedRows: 1 }];
    }
    if (/FROM volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 4, marketing_consent: 0, marketing_consent_at: null }]];
    }
    return [[]];
  });

  await Profile.update(4, { marketing_consent: 0 });
  assert.match(updated.sql, /marketing_consent = \?/);
  assert.match(updated.sql, /marketing_consent_at = \?/);
  assert.deepEqual(updated.params.slice(0, 2), [0, null]);
  assert.equal(updated.params[2], 4);
});

test('newsletter sync provider ships disabled with no vendor deps', async () => {
  const provider = syncModule.getNewsletterSyncProvider();
  assert.equal(provider.name, 'disabled');
  assert.equal(provider.isEnabled(), false);
  assert.ok(Object.isFrozen(provider));
  assert.ok(syncModule.isNewsletterSyncProvider(provider));
  assert.deepEqual(
    await provider.syncAudience({ contacts: [{ email: 'a@example.com' }], shelterId: 1 }),
    { synced: false, skipped: true, reason: 'newsletter_sync_disabled', count: 0 }
  );

  const saved = {
    NEWSLETTER_SYNC_PROVIDER: process.env.NEWSLETTER_SYNC_PROVIDER,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    MAILCHIMP_API_KEY: process.env.MAILCHIMP_API_KEY,
  };
  process.env.NEWSLETTER_SYNC_PROVIDER = 'brevo';
  process.env.BREVO_API_KEY = 'not-a-real-key';
  process.env.MAILCHIMP_API_KEY = 'not-a-real-key';
  try {
    assert.equal(syncModule.getNewsletterSyncProvider().isEnabled(), false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  for (const banned of ['@getbrevo/brevo', 'brevo', '@mailchimp/mailchimp_marketing', 'mailchimp']) {
    assert.ok(!deps.includes(banned), `${banned} must not be a dependency`);
  }
  assert.ok(syncModule.FUTURE_PROVIDER_NAMES.includes('brevo'));
  assert.ok(syncModule.FUTURE_PROVIDER_NAMES.includes('mailchimp'));
});

test('isNewsletterSyncProvider rejects incomplete objects', () => {
  assert.equal(syncModule.isNewsletterSyncProvider(null), false);
  assert.equal(syncModule.isNewsletterSyncProvider({ name: 'x', syncAudience() {} }), false);
  assert.equal(syncModule.isNewsletterSyncProvider({ isEnabled() {}, syncAudience() {} }), false);
  assert.equal(
    syncModule.isNewsletterSyncProvider({ name: 'x', isEnabled() {}, syncAudience() {} }),
    true
  );
});

test('fetchNewsletterAudience only returns explicit marketing consent with a date', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users u/i.test(sql) && /marketing_consent = 1/i.test(sql)) {
      return [[
        {
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
          phone: '07000',
          marketing_consent_at: new Date('2026-11-01T12:00:00Z'),
        },
      ]];
    }
    return [[]];
  });

  const rows = await ctrl.fetchNewsletterAudience();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'ada@example.com');
  assert.equal(rows[0].marketing_consent_at, '2026-11-01');

  const call = mock.calls.find((c) => /marketing_consent = 1/i.test(c.sql));
  assert.ok(call);
  assert.match(call.sql, /marketing_consent_at IS NOT NULL/);
  assert.match(call.sql, /anonymised_at IS NULL/);
  assert.match(call.sql, /role = 'volunteer'/);
  assert.doesNotMatch(call.sql, /prefer_reminders|prefer_urgent|prefer_threads/);
});

test('CSV export downloads opted-in rows only', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/marketing_consent = 1/i.test(sql)) {
      return [[
        {
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
          phone: '',
          marketing_consent_at: '2026-11-02 09:00:00',
        },
      ]];
    }
    return [[]];
  });

  const res = makeRes();
  await runWithShelter(1, () => ctrl.getNewsletterAudienceCsv({}, res));
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.equal(
    res.headers['content-disposition'],
    'attachment; filename="newsletter-audience.csv"'
  );
  const csv = String(res.body);
  assert.match(csv, /first_name.*marketing_consent_at/);
  assert.match(csv, /Ada.*ada@example\.com.*2026-11-02/);
});

test('sync status and sync POST stay disabled', async () => {
  const statusRes = makeRes();
  await ctrl.getNewsletterSyncStatus({}, statusRes);
  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.body.enabled, false);
  assert.equal(statusRes.body.provider, 'disabled');

  const syncRes = makeRes();
  await ctrl.postNewsletterSync({}, syncRes);
  assert.equal(syncRes.statusCode, 503);
  assert.equal(syncRes.body.reason, 'newsletter_sync_disabled');
});

test('newsletter audience routes are staff/admin only', () => {
  const router = require('../routes/admin');
  const paths = [
    '/reports/newsletter-audience.csv',
    '/reports/newsletter-sync',
  ];
  for (const pathName of paths) {
    const layer = router.stack.find((l) => l.route && l.route.path === pathName);
    assert.ok(layer, `missing route ${pathName}`);
    const names = layer.route.stack.map((s) => s.name);
    assert.ok(names.includes('isAuthenticated'), `${pathName} needs isAuthenticated`);
    assert.ok(names.includes('requireRoleMiddleware'), `${pathName} needs a role guard`);
  }

  const csvLayer = router.stack.find(
    (l) => l.route && l.route.path === '/reports/newsletter-audience.csv'
  );
  const guard = csvLayer.route.stack.find((s) => s.name === 'requireRoleMiddleware').handle;

  mock.setHandler(async (sql) => {
    if (/FROM users/i.test(sql)) return [[{ user_id: 5, role: 'volunteer' }]];
    return [[]];
  });
  const volRes = makeRes();
  let nextCalled = false;
  return Promise.resolve(guard({ session: { userId: 5, role: 'volunteer' } }, volRes, () => {
    nextCalled = true;
  })).then(async () => {
    assert.equal(nextCalled, false);
    assert.equal(volRes.statusCode, 403);

    mock.setHandler(async (sql) => {
      if (/FROM users/i.test(sql)) return [[{ user_id: 6, role: 'staff' }]];
      return [[]];
    });
    const staffRes = makeRes();
    let staffNext = false;
    await guard({ session: { userId: 6, role: 'staff' } }, staffRes, () => { staffNext = true; });
    assert.equal(staffNext, true);
  });
});

test('profile UI ships marketing consent unticked by default', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'frontend/pages/volunteer/complete-profile.html'),
    'utf8'
  );
  assert.match(html, /id="marketing_consent"/);
  assert.doesNotMatch(html, /id="marketing_consent"[^>]*checked/);
  assert.match(html, /Shelter newsletter/);
});

test('migration 050 is the next free number after 049 and is additive', () => {
  const dir = path.join(__dirname, '..', 'database');
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.+\.pg\.sql$/.test(f)).sort();
  assert.ok(files.includes('049_shelter_logo_storage.pg.sql'));
  assert.ok(files.includes('050_newsletter_marketing_consent.pg.sql'));
  const after049 = files.filter((f) => f > '049_shelter_logo_storage.pg.sql');
  assert.equal(after049[0], '050_newsletter_marketing_consent.pg.sql');

  const sql = fs.readFileSync(path.join(dir, '050_newsletter_marketing_consent.pg.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS marketing_consent/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS marketing_consent_at/);
  assert.match(sql, /DEFAULT 0/);
  assert.doesNotMatch(sql, /DROP TABLE/i);

  const schema = fs.readFileSync(path.join(dir, 'schema.pg.sql'), 'utf8');
  assert.match(schema, /marketing_consent\s+SMALLINT\s+NOT NULL\s+DEFAULT 0/);
  assert.match(schema, /marketing_consent_at\s+TIMESTAMP/);
});

test('tenant isolation suite covers newsletter export', () => {
  const source = fs.readFileSync(path.join(__dirname, 'tenantIsolation.run.js'), 'utf8');
  assert.match(source, /\/api\/admin\/reports\/newsletter-audience\.csv/);
  assert.match(source, /\/api\/admin\/reports\/newsletter-sync/);
});
