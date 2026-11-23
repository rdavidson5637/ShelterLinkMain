'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { runWithShelter, isBypass } = require('../utils/shelterContext');
const SetupChecklist = require('../models/SetupChecklist');
const {
  getSetupChecklist,
  dismissSetupChecklist,
  getPrivacyContact,
  updatePrivacyContact,
} = require('../controllers/setupChecklistController');
const { bodies } = require('../validation/bodies');
const { inferFromRequest } = require('../middleware/auditLog');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/052_setup_checklist_dismiss.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const DASHBOARD_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/dashboard.html'),
  'utf8'
);
const DASHBOARD_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/admin/dashboard.js'),
  'utf8'
);
const PRIVACY_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/privacy.html'),
  'utf8'
);

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
    session: { userId: 1, role: 'admin' },
    body: {},
    ...overrides,
  };
}

function flags(overrides = {}) {
  return {
    primary_colour: null,
    privacy_contact_email: null,
    setup_checklist_dismissed_at: null,
    has_logo: false,
    has_policy: false,
    has_age: false,
    opportunity_count: 0,
    invite_count: 0,
    staff_count: 1,
    ...overrides,
  };
}

function installDb(state) {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM shelters/.test(sql) && /setup_checklist_dismissed_at/.test(sql)) {
      return [[
        {
          primary_colour: state.primary_colour,
          privacy_contact_email: state.privacy_contact_email,
          setup_checklist_dismissed_at: state.setup_checklist_dismissed_at,
          has_logo: state.has_logo,
        },
      ]];
    }
    if (/FROM shelter_booking_policy/.test(sql)) {
      return [state.has_policy ? [{ ok: 1 }] : []];
    }
    if (/FROM shelter_settings/.test(sql)) {
      return [state.has_age ? [{ ok: 1 }] : []];
    }
    if (/FROM opportunities/.test(sql)) {
      return [[{ count: state.opportunity_count }]];
    }
    if (/FROM admin_invites/.test(sql)) {
      return [[{ count: state.invite_count }]];
    }
    if (/FROM users/.test(sql) && /role IN \('staff', 'admin'\)/.test(sql)) {
      return [[{ count: state.staff_count }]];
    }
    if (/UPDATE shelters\s+SET setup_checklist_dismissed_at/.test(sql)) {
      assert.equal(isBypass(), true);
      state.setup_checklist_dismissed_at = '2026-11-23T12:00:00.000Z';
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE shelters SET privacy_contact_email/.test(sql)) {
      assert.equal(isBypass(), true);
      state.privacy_contact_email = params[0];
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });
}

test('052 adds setup_checklist_dismissed_at without rewriting shelters', () => {
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS setup_checklist_dismissed_at/);
  assert.doesNotMatch(MIGRATION, /CREATE TABLE shelters/i);
  assert.match(SCHEMA, /setup_checklist_dismissed_at TIMESTAMP NULL/);
  assert.match(SETUP_DB, /loadSql\('052_setup_checklist_dismiss\.pg\.sql'\)/);
});

test('admin routes expose setup checklist and privacy contact', () => {
  assert.match(ROUTES, /\/setup-checklist/);
  assert.match(ROUTES, /\/setup-checklist\/dismiss/);
  assert.match(ROUTES, /\/settings\/privacy-contact/);
  assert.match(ROUTES, /adminOnly.*getSetupChecklist|getSetupChecklist/);
});

test('dashboard shows a ruled setup list, not a card or icon grid', () => {
  assert.match(DASHBOARD_HTML, /id="setupChecklistSection"/);
  assert.match(DASHBOARD_HTML, /class="action-list" id="setupChecklistList"/);
  assert.doesNotMatch(DASHBOARD_HTML, /setupChecklistSection[\s\S]*stat-card/);
  assert.doesNotMatch(DASHBOARD_JS, /emoji|✅|☐|☑/);
  assert.match(DASHBOARD_JS, /\/admin\/setup-checklist/);
  assert.match(PRIVACY_HTML, /id="privacyContactForm"/);
  assert.match(PRIVACY_HTML, /id="privacy_contact_email"/);
});

test('privacyContact body rejects client-supplied shelter_id', () => {
  assert.equal(
    bodies.privacyContact.safeParse({ privacy_contact_email: 'a@b.co' }).success,
    true
  );
  assert.equal(
    bodies.privacyContact.safeParse({
      privacy_contact_email: 'a@b.co',
      shelter_id: 1,
    }).success,
    false
  );
  assert.equal(bodies.privacyContact.safeParse({ privacy_contact_email: '' }).success, true);
});

test('audit log names setup checklist dismiss and privacy contact update', () => {
  assert.equal(
    inferFromRequest({
      method: 'POST',
      originalUrl: '/api/admin/setup-checklist/dismiss',
    }).action,
    'shelter.setup_checklist.dismiss'
  );
  assert.equal(
    inferFromRequest({
      method: 'PUT',
      originalUrl: '/api/admin/settings/privacy-contact',
    }).action,
    'shelter.privacy_contact.update'
  );
});

test('checklist progress comes from real data flags', async () => {
  const state = flags({
    primary_colour: '#0f766e',
    has_policy: true,
    has_age: true,
    opportunity_count: 2,
    invite_count: 1,
    privacy_contact_email: 'privacy@hope.test',
  });
  installDb(state);

  const checklist = await runWithShelter(2, () => SetupChecklist.getChecklist());
  assert.equal(checklist.total, 6);
  assert.equal(checklist.doneCount, 6);
  assert.equal(checklist.complete, true);
  assert.equal(checklist.visible, true);
  assert.deepEqual(
    checklist.items.map((item) => [item.id, item.done]),
    [
      ['branding', true],
      ['booking_policy', true],
      ['minimum_age', true],
      ['first_shift', true],
      ['invite_staff', true],
      ['privacy_notice', true],
    ]
  );
});

test('incomplete shelters stay incomplete until each real step exists', async () => {
  installDb(flags({ staff_count: 1 }));
  const checklist = await runWithShelter(2, () => SetupChecklist.getChecklist());
  assert.equal(checklist.complete, false);
  assert.equal(checklist.doneCount, 0);
  assert.equal(checklist.items.every((item) => item.done === false), true);
});

test('invite_staff is done when a second staff account exists', async () => {
  installDb(flags({ staff_count: 2 }));
  const checklist = await runWithShelter(2, () => SetupChecklist.getChecklist());
  const invite = checklist.items.find((item) => item.id === 'invite_staff');
  assert.equal(invite.done, true);
});

test('logo alone completes branding', async () => {
  installDb(flags({ has_logo: true }));
  const checklist = await runWithShelter(2, () => SetupChecklist.getChecklist());
  assert.equal(checklist.items.find((item) => item.id === 'branding').done, true);
});

test('dismiss is refused until every step is done', async () => {
  installDb(flags());
  const res = makeRes();
  await runWithShelter(2, () => dismissSetupChecklist(makeReq(), res));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Finish every setup step/);
});

test('dismiss hides the checklist once complete', async () => {
  const state = flags({
    primary_colour: '#0f766e',
    has_policy: true,
    has_age: true,
    opportunity_count: 1,
    invite_count: 1,
    privacy_contact_email: 'privacy@hope.test',
  });
  installDb(state);

  const res = makeRes();
  await runWithShelter(2, () => dismissSetupChecklist(makeReq(), res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dismissed, true);
  assert.equal(res.body.visible, false);
  assert.ok(state.setup_checklist_dismissed_at);
});

test('getSetupChecklist returns JSON for an admin shelter context', async () => {
  installDb(flags({ opportunity_count: 1 }));
  const res = makeRes();
  await runWithShelter(2, () => getSetupChecklist(makeReq(), res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.find((item) => item.id === 'first_shift').done, true);
  assert.equal(res.body.visible, true);
});

test('privacy contact can be saved and cleared', async () => {
  const state = flags();
  installDb(state);

  const save = makeRes();
  await runWithShelter(2, () =>
    updatePrivacyContact(
      makeReq({ body: { privacy_contact_email: ' Privacy@Hope.Test ' } }),
      save
    )
  );
  assert.equal(save.statusCode, 200);
  assert.equal(save.body.privacy_contact_email, 'privacy@hope.test');

  const read = makeRes();
  await runWithShelter(2, () => getPrivacyContact(makeReq(), read));
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.privacy_contact_email, 'privacy@hope.test');

  const clear = makeRes();
  await runWithShelter(2, () =>
    updatePrivacyContact(makeReq({ body: { privacy_contact_email: '' } }), clear)
  );
  assert.equal(clear.statusCode, 200);
  assert.equal(clear.body.privacy_contact_email, null);
});

test('privacy contact rejects a bad email', async () => {
  installDb(flags());
  const res = makeRes();
  await runWithShelter(2, () =>
    updatePrivacyContact(makeReq({ body: { privacy_contact_email: 'not-an-email' } }), res)
  );
  assert.equal(res.statusCode, 400);
});
