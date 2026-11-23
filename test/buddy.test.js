'use strict';

// SL-DAY-08: staff assign an existing volunteer as a buddy. Both see it on
// home/profile. Optional email to the buddy on assign only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

for (const mod of [
  '../models/Buddy',
  '../controllers/buddyController',
  '../middleware/auth',
  '../utils/emailService',
  '../utils/emailConfig',
  '../utils/emailPreview',
]) {
  const resolved = require.resolve(mod);
  delete require.cache[resolved];
}

const Buddy = require('../models/Buddy');
const {
  getVolunteerBuddy,
  assignVolunteerBuddy,
  clearVolunteerBuddy,
  getMyBuddy,
} = require('../controllers/buddyController');
const { buildBuddyAssigned } = require('../utils/emailService');
const { catalogIds } = require('../utils/emailPreview');
const { TENANT_TABLES, runWithShelter } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'database/065_volunteer_buddies.pg.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const ADMIN_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const BUDDY_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/buddy.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const VOL_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/volunteers.js'), 'utf8');
const DASH_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/volunteer/dashboard.js'), 'utf8');
const DASH_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/volunteer/dashboard.html'),
  'utf8'
);
const PROFILE_JS = fs.readFileSync(
  path.join(ROOT, 'frontend/js/volunteer/complete-profile.js'),
  'utf8'
);
const PROFILE_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/volunteer/complete-profile.html'),
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
    session: { userId: 1, role: 'staff' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/admin/volunteers/2/buddy',
    ...overrides,
  };
}

test('migration 065 creates volunteer_buddies with tenant isolation and not-self check', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS volunteer_buddies/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /tenant_isolation/);
  assert.match(MIGRATION, /assert_same_shelter/);
  assert.match(MIGRATION, /volunteer_user_id <> buddy_user_id/);
  assert.match(MIGRATION, /UNIQUE \(volunteer_user_id\)/);
  assert.match(SCHEMA, /CREATE TABLE volunteer_buddies/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*volunteer_buddies/);
  assert.match(SETUP_DB, /065_volunteer_buddies\.pg\.sql/);
  assert.ok(TENANT_TABLES.includes('volunteer_buddies'));
});

test('staff and volunteer routes expose buddy pairing; no SMS path', () => {
  assert.match(ADMIN_ROUTES, /\/volunteers\/:userId\/buddy/);
  assert.match(ADMIN_ROUTES, /messageLimiter/);
  assert.match(ADMIN_ROUTES, /bodies\.volunteerBuddy/);
  assert.match(BUDDY_ROUTES, /\/me/);
  assert.match(SERVER, /\/api\/buddy/);
  assert.match(BODIES, /volunteerBuddy/);
  assert.doesNotMatch(NOTIFY, /buddy/i);
  assert.match(SMS, /disabled|switched off|never/i);
});

test('staff profile and volunteer home/profile show the pairing', () => {
  assert.match(VOL_JS, /\/admin\/volunteers\/\$\{userId\}\/buddy/);
  assert.match(VOL_JS, /Email the buddy about this pairing/);
  assert.match(VOL_JS, /Clear buddy/);
  assert.match(DASH_HTML, /buddyCard/);
  assert.match(DASH_JS, /\/buddy\/me/);
  assert.match(DASH_JS, /Your buddy is/);
  assert.match(DASH_JS, /You are a buddy for/);
  assert.match(PROFILE_HTML, /buddyProfileCard/);
  assert.match(PROFILE_JS, /\/buddy\/me/);
});

test('GDPR erase removes buddy rows for the volunteer', () => {
  assert.match(GDPR, /DELETE FROM volunteer_buddies/);
  assert.match(GDPR, /volunteer_user_id = \? OR buddy_user_id = \?/);
});

test('email preview catalog includes the buddy assignment template', () => {
  assert.ok(catalogIds().includes('buddy'));
  const parts = buildBuddyAssigned(
    { buddyFirstName: 'Sam', volunteerName: 'Alex' },
    { name: 'Assisi', signoff: 'ShelterLink, Assisi' }
  );
  assert.match(parts.subject, /buddy/i);
  assert.match(parts.html, /Alex/);
  assert.match(parts.text, /Sam/);
  assert.doesNotMatch(parts.subject, /SMS|text message/i);
});

test('Buddy.assign pairs two volunteers and rejects self or missing buddy', async () => {
  const users = {
    10: {
      user_id: 10,
      first_name: 'New',
      last_name: 'Volunteer',
      name: 'New Volunteer',
      email: 'new@example.com',
      role: 'volunteer',
      archived_at: null,
      anonymised_at: null,
    },
    11: {
      user_id: 11,
      first_name: 'Experienced',
      last_name: 'Buddy',
      name: 'Experienced Buddy',
      email: 'buddy@example.com',
      role: 'volunteer',
      archived_at: null,
      anonymised_at: null,
    },
  };
  let pairing = null;
  let insertCount = 0;

  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM users[\s\S]*role = 'volunteer'/i.test(sql)) {
      const id = Number(params[0]);
      return [users[id] ? [users[id]] : []];
    }
    if (/FROM volunteer_buddies b/i.test(sql) && /volunteer_user_id = \?/i.test(sql)) {
      return [pairing ? [pairing] : []];
    }
    if (/INSERT INTO volunteer_buddies/i.test(sql)) {
      insertCount += 1;
      pairing = {
        id: 1,
        volunteer_user_id: Number(params[0]),
        buddy_user_id: Number(params[1]),
        assigned_by: params[2],
        assigned_at: '2026-11-23 09:00:00',
        notify_emailed_at: null,
        volunteer_first_name: users[10].first_name,
        volunteer_last_name: users[10].last_name,
        volunteer_name: users[10].name,
        volunteer_email: users[10].email,
        buddy_first_name: users[11].first_name,
        buddy_last_name: users[11].last_name,
        buddy_name: users[11].name,
        buddy_email: users[11].email,
      };
      return [{ insertId: 1, affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  await runWithShelter(1, async () => {
    await assert.rejects(() => Buddy.assign({ volunteerUserId: 10, buddyUserId: 10 }), {
      status: 400,
    });
    await assert.rejects(() => Buddy.assign({ volunteerUserId: 10, buddyUserId: 999 }), {
      status: 400,
    });

    const result = await Buddy.assign({
      volunteerUserId: 10,
      buddyUserId: 11,
      assignedBy: 1,
    });
    assert.equal(result.changed, true);
    assert.equal(result.pairing.buddy_user_id, 11);
    assert.equal(result.pairing.volunteer_user_id, 10);
    assert.equal(insertCount, 1);

    const again = await Buddy.assign({
      volunteerUserId: 10,
      buddyUserId: 11,
      assignedBy: 1,
    });
    assert.equal(again.changed, false);
    assert.equal(insertCount, 1);
  });
});

test('assignVolunteerBuddy emails only when notify is set and pairing changed', async () => {
  const previousEmail = process.env.EMAIL_HOST;
  const previousFrom = process.env.EMAIL_FROM;
  process.env.EMAIL_HOST = 'smtp.example.test';
  process.env.EMAIL_FROM = 'noreply@example.test';

  for (const mod of [
    '../utils/emailConfig',
    '../utils/emailService',
    '../controllers/buddyController',
    '../models/Buddy',
  ]) {
    delete require.cache[require.resolve(mod)];
  }
  const emailService = require('../utils/emailService');
  const BuddyFresh = require('../models/Buddy');
  const {
    assignVolunteerBuddy: assignFresh,
  } = require('../controllers/buddyController');

  let sendCalls = 0;
  const originalAssign = BuddyFresh.assign;
  const originalMark = BuddyFresh.markNotified;
  const originalSend = emailService.sendBuddyAssigned;

  BuddyFresh.assign = async () => ({
    pairing: {
      id: 1,
      volunteer_user_id: 10,
      buddy_user_id: 11,
      buddy: { name: 'Sam', first_name: 'Sam', email: 'sam@example.com' },
      volunteer: { name: 'Alex', first_name: 'Alex' },
    },
    changed: true,
    volunteer: { first_name: 'Alex', name: 'Alex' },
    buddy: { first_name: 'Sam', name: 'Sam', email: 'sam@example.com' },
  });
  BuddyFresh.markNotified = async () => ({
    pairing: {
      id: 1,
      volunteer_user_id: 10,
      buddy_user_id: 11,
      notify_emailed_at: '2026-11-23 09:05:00',
      buddy: { name: 'Sam' },
    },
  });
  emailService.sendBuddyAssigned = async () => {
    sendCalls += 1;
    return { messageId: 'x' };
  };

  try {
    const resNoEmail = makeRes();
    await assignFresh(
      makeReq({
        params: { userId: '10' },
        body: { buddy_user_id: 11, notify: false },
        method: 'PUT',
      }),
      resNoEmail
    );
    assert.equal(resNoEmail.statusCode, 200);
    assert.equal(resNoEmail.body.emailed, false);
    assert.equal(sendCalls, 0);

    const resEmail = makeRes();
    await assignFresh(
      makeReq({
        params: { userId: '10' },
        body: { buddy_user_id: 11, notify: true },
        method: 'PUT',
      }),
      resEmail
    );
    assert.equal(resEmail.statusCode, 200);
    assert.equal(resEmail.body.emailed, true);
    assert.equal(sendCalls, 1);
  } finally {
    BuddyFresh.assign = originalAssign;
    BuddyFresh.markNotified = originalMark;
    emailService.sendBuddyAssigned = originalSend;
    if (previousEmail === undefined) delete process.env.EMAIL_HOST;
    else process.env.EMAIL_HOST = previousEmail;
    if (previousFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = previousFrom;
  }
});

test('getMyBuddy returns as_volunteer and as_buddy for the signed-in user', async () => {
  const original = Buddy.forMe;
  Buddy.forMe = async (userId) => {
    assert.equal(userId, 11);
    return {
      as_volunteer: null,
      as_buddy: [
        {
          volunteer_user_id: 10,
          buddy_user_id: 11,
          volunteer: { name: 'Alex' },
          buddy: { name: 'Sam' },
        },
      ],
    };
  };
  try {
    const res = makeRes();
    await getMyBuddy(makeReq({ session: { userId: 11, role: 'volunteer' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.as_buddy.length, 1);
    assert.equal(res.body.as_buddy[0].volunteer.name, 'Alex');
  } finally {
    Buddy.forMe = original;
  }
});

test('staff get and clear buddy endpoints wire through the model', async () => {
  const originalFor = Buddy.forVolunteer;
  const originalClear = Buddy.clear;
  Buddy.forVolunteer = async (id) => {
    assert.equal(Number(id), 10);
    return {
      volunteer: { user_id: 10, name: 'Alex' },
      pairing: {
        volunteer_user_id: 10,
        buddy_user_id: 11,
        buddy: { name: 'Sam' },
      },
    };
  };
  Buddy.clear = async (id) => {
    assert.equal(Number(id), 10);
    return {
      cleared: true,
      pairing: { volunteer_user_id: 10, buddy_user_id: 11 },
    };
  };
  try {
    const getRes = makeRes();
    await getVolunteerBuddy(makeReq({ params: { userId: '10' } }), getRes);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.pairing.buddy_user_id, 11);

    const clearRes = makeRes();
    await clearVolunteerBuddy(
      makeReq({ params: { userId: '10' }, method: 'DELETE' }),
      clearRes
    );
    assert.equal(clearRes.statusCode, 200);
    assert.equal(clearRes.body.cleared, true);
    assert.equal(clearRes.body.pairing, null);
  } finally {
    Buddy.forVolunteer = originalFor;
    Buddy.clear = originalClear;
  }
});
