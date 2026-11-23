'use strict';

// SL-NOW-02: per-shelter minimum age and guardian consent for under-18s.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const noop = async () => {};
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: new Proxy({}, { get: () => noop }),
};

const { runWithShelter, TENANT_TABLES, mentionsTenantTable } = require('../utils/shelterContext');
const ageRules = require('../utils/ageRules');
const appCtrl = require('../controllers/applicationController');
const swapCtrl = require('../controllers/swapController');
const consentCtrl = require('../controllers/guardianConsentController');
const { bodies } = require('../validation/bodies');

const SHIFT_START = '2027-06-01 10:00:00';
const DOB_15 = '2011-06-02'; // 15 on the shift date, 16 the next day
const DOB_16 = '2011-06-01'; // 16 on the shift date
const DOB_ADULT = '1990-01-01';

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 2, role: 'volunteer' },
    body: { opportunityId: 1 },
    params: {},
    query: {},
    ...overrides,
  };
}

/**
 * One mock database for apply, accept, and claim.
 * minAge: shelter_settings.min_volunteer_age (undefined = no row)
 * consent: active guardian_consents row or null
 */
function db({ dob = null, minAge, consent = null, appStatus = 'pending' } = {}) {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM shelter_settings/i.test(sql)) {
      return [minAge === undefined ? [] : [{ min_volunteer_age: minAge, updated_at: 'then' }]];
    }
    if (/INSERT INTO shelter_settings/i.test(sql)) return [Object.assign([], { affectedRows: 1 })];
    if (/FROM guardian_consents/i.test(sql)) return [consent ? [consent] : []];
    if (/INSERT INTO guardian_consents/i.test(sql)) {
      return [Object.assign([{ id: 40 }], { insertId: 40, affectedRows: 1 })];
    }
    if (/UPDATE guardian_consents/i.test(sql)) return [{ affectedRows: consent ? 1 : 0 }];
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: 1, user_email: 'v@x.com', date_of_birth: dob }]];
    }
    if (/FROM users/i.test(sql) && /user_id = \?/i.test(sql)) {
      return [[{ user_id: 2, name: 'Young Volunteer', email: 'v@x.com', role: 'volunteer', shelter_id: 1 }]];
    }
    if (/AS current_count/i.test(sql)) return [[{ current_count: 0 }]];
    if (/application_id, status\s+FROM applications/i.test(sql)) return [[]];
    if (/FROM swap_requests/i.test(sql)) {
      return [[{
        id: 50,
        application_id: 5,
        status: 'open',
        public_at: '2026-01-01 00:00:00',
        original_user_id: 9,
        opportunity_id: 1,
        application_status: 'accepted',
        opportunity_title: 'Dog Walk',
      }]];
    }
    if (/FROM opportunities/i.test(sql)) {
      return [[{
        opportunity_id: 1,
        title: 'Dog Walk',
        status: 'open',
        max_volunteers: 5,
        start_date: SHIFT_START,
      }]];
    }
    if (/INSERT INTO applications/i.test(sql)) return [{ insertId: 9 }];
    if (/FROM applications/i.test(sql) && /application_id = \?/i.test(sql)) {
      return [[{
        application_id: 9,
        user_id: 2,
        opportunity_id: 1,
        status: appStatus,
        email: 'v@x.com',
        title: 'Dog Walk',
      }]];
    }
    if (/UPDATE applications/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
}

const inShelter = (fn) => runWithShelter(1, fn);
const inserted = (re) => mock.calls.some((c) => re.test(c.sql));

const ACTIVE_CONSENT = {
  id: 40,
  user_id: 2,
  guardian_name: 'Pat Guardian',
  guardian_relationship: 'Mother',
  guardian_phone: '07700 900000',
  guardian_email: null,
  consented_at: '2026-11-01 10:00:00',
  withdrawn_at: null,
};

// --- Pure rules --------------------------------------------------------------

test('ageOn counts whole years and handles birthdays and leap days', () => {
  assert.equal(ageRules.ageOn('2011-06-02', '2027-06-01'), 15);
  assert.equal(ageRules.ageOn('2011-06-01', '2027-06-01'), 16);
  assert.equal(ageRules.ageOn('2008-02-29', '2026-02-28'), 17);
  assert.equal(ageRules.ageOn('2008-02-29', '2026-03-01'), 18);
  assert.equal(ageRules.ageOn(null, '2027-06-01'), null);
  assert.equal(ageRules.ageOn('2011-02-30', '2027-06-01'), null);
  assert.equal(ageRules.ageOn('2030-01-01', '2027-06-01'), null);
});

test('there is no global minimum: an unset shelter minimum enforces none', () => {
  assert.equal(ageRules.normaliseMinAge(null), null);
  assert.equal(ageRules.normaliseMinAge(''), null);
  assert.equal(ageRules.normaliseMinAge(0), null);
  assert.equal(ageRules.normaliseMinAge(16), 16);
  assert.equal(ageRules.allowsMinors(null), true);
  assert.equal(ageRules.allowsMinors(14), true);
  assert.equal(ageRules.allowsMinors(18), false);

  const r = ageRules.assessAge({ dateOfBirth: '2020-01-01', minAge: null, hasConsent: true, onDay: '2027-06-01' });
  assert.equal(r.ok, true);
  assert.equal(r.needsConsent, true);
});

test('assessAge: under minimum, missing consent, missing date of birth', () => {
  const day = '2027-06-01';
  assert.equal(ageRules.assessAge({ dateOfBirth: DOB_15, minAge: 16, hasConsent: true, onDay: day }).code, 'under_min_age');
  assert.equal(ageRules.assessAge({ dateOfBirth: DOB_16, minAge: 16, hasConsent: false, onDay: day }).code, 'consent_missing');
  assert.equal(ageRules.assessAge({ dateOfBirth: DOB_16, minAge: 16, hasConsent: true, onDay: day }).ok, true);
  assert.equal(ageRules.assessAge({ dateOfBirth: DOB_ADULT, minAge: 18, hasConsent: false, onDay: day }).ok, true);
  assert.equal(ageRules.assessAge({ dateOfBirth: null, minAge: 16, hasConsent: false, onDay: day }).code, 'dob_missing');
  assert.equal(ageRules.assessAge({ dateOfBirth: null, minAge: null, hasConsent: false, onDay: day }).ok, true);
});

// --- Booking ---------------------------------------------------------------

test('apply: blocked when under the shelter minimum on the shift date', async () => {
  db({ dob: DOB_15, minAge: 16, consent: ACTIVE_CONSENT });
  const res = makeRes();
  await inShelter(() => appCtrl.applyForOpportunity(makeReq(), res));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.age_rule, 'under_min_age');
  assert.match(res.body.error, /minimum volunteer age is 16/);
  assert.ok(!inserted(/INSERT INTO applications/i));
});

test('apply: under 18 without guardian consent is blocked', async () => {
  db({ dob: DOB_16, minAge: 16, consent: null });
  const res = makeRes();
  await inShelter(() => appCtrl.applyForOpportunity(makeReq(), res));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.age_rule, 'consent_missing');
  assert.match(res.body.error, /parent or guardian/);
  assert.ok(!inserted(/INSERT INTO applications/i));
});

test('apply: under 18 with active guardian consent can book', async () => {
  db({ dob: DOB_16, minAge: 16, consent: ACTIVE_CONSENT });
  const res = makeRes();
  await inShelter(() => appCtrl.applyForOpportunity(makeReq(), res));
  assert.equal(res.statusCode, 201);
  assert.ok(inserted(/INSERT INTO applications/i));
});

test('apply: shelter with no minimum still needs consent for under-18s', async () => {
  db({ dob: DOB_15, minAge: undefined, consent: null });
  const res = makeRes();
  await inShelter(() => appCtrl.applyForOpportunity(makeReq(), res));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.age_rule, 'consent_missing');
});

test('apply: adult-only shelter (minimum 18) blocks a 17-year-old outright', async () => {
  db({ dob: '2010-01-01', minAge: 18, consent: ACTIVE_CONSENT });
  const res = makeRes();
  await inShelter(() => appCtrl.applyForOpportunity(makeReq(), res));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.age_rule, 'under_min_age');
});

test('apply: no date of birth is blocked only where the shelter set a minimum', async () => {
  db({ dob: null, minAge: 16 });
  let res = makeRes();
  await inShelter(() => appCtrl.applyForOpportunity(makeReq(), res));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.age_rule, 'dob_missing');

  db({ dob: null, minAge: undefined });
  res = makeRes();
  await inShelter(() => appCtrl.applyForOpportunity(makeReq(), res));
  assert.equal(res.statusCode, 201);
});

test('apply: adults are unaffected and never trigger a consent lookup', async () => {
  db({ dob: DOB_ADULT, minAge: 16 });
  const res = makeRes();
  await inShelter(() => appCtrl.applyForOpportunity(makeReq(), res));
  assert.equal(res.statusCode, 201);
  assert.ok(!mock.calls.some((c) => /FROM guardian_consents/i.test(c.sql)));
});

test('staff accept: blocked when consent has since been withdrawn', async () => {
  db({ dob: DOB_16, minAge: 16, consent: null });
  const res = makeRes();
  await inShelter(() => appCtrl.updateApplicationStatus(
    makeReq({ session: { userId: 1, role: 'staff' }, params: { id: 9 }, body: { status: 'accepted' } }),
    res
  ));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.age_rule, 'consent_missing');
  assert.match(res.body.error, /This volunteer is under 18/);
  assert.ok(!mock.calls.some((c) => /UPDATE applications/i.test(c.sql)));
});

test('swap claim: blocked for a volunteer under the shelter minimum', async () => {
  db({ dob: DOB_15, minAge: 16, consent: ACTIVE_CONSENT });
  const res = makeRes();
  await inShelter(() => swapCtrl.claimSwap(makeReq({ params: { id: 50 }, body: {} }), res));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.age_rule, 'under_min_age');
  assert.match(res.body.error, /claim this shift/);
  assert.ok(!inserted(/INSERT INTO applications/i));
});

// --- Consent and settings endpoints ---------------------------------------

test('volunteer consent form: guardian must confirm and give a contact', async () => {
  db({ dob: '2010-06-01', minAge: 14 });
  const res = makeRes();
  await inShelter(() => consentCtrl.giveMyGuardianConsent(
    makeReq({ body: { guardian_name: 'Pat Guardian', guardian_relationship: 'Mother' } }),
    res
  ));
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.fields.confirm);
  assert.ok(res.body.fields.guardian_phone);
  assert.ok(!inserted(/INSERT INTO guardian_consents/i));
});

test('volunteer consent form: recorded with the volunteer as recorder', async () => {
  db({ dob: '2010-06-01', minAge: 14, consent: ACTIVE_CONSENT });
  const res = makeRes();
  await inShelter(() => consentCtrl.giveMyGuardianConsent(
    makeReq({
      body: {
        guardian_name: 'Pat Guardian',
        guardian_relationship: 'Mother',
        guardian_phone: '07700 900000',
        confirm: true,
      },
    }),
    res
  ));
  assert.equal(res.statusCode, 201);
  const ins = mock.calls.find((c) => /INSERT INTO guardian_consents/i.test(c.sql));
  assert.ok(ins);
  assert.equal(ins.params[0], 2);
  assert.equal(ins.params[5], 2);
  // Any earlier active consent is withdrawn first.
  assert.ok(mock.calls.some((c) => /UPDATE guardian_consents/i.test(c.sql)));
});

test('volunteer consent form: refused for adults and below the shelter minimum', async () => {
  const body = { guardian_name: 'A', guardian_relationship: 'B', guardian_phone: '1', confirm: true };
  db({ dob: DOB_ADULT, minAge: 14 });
  let res = makeRes();
  await inShelter(() => consentCtrl.giveMyGuardianConsent(makeReq({ body }), res));
  assert.equal(res.statusCode, 400);

  db({ dob: '2016-01-01', minAge: 14 });
  res = makeRes();
  await inShelter(() => consentCtrl.giveMyGuardianConsent(makeReq({ body }), res));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /minimum volunteer age is 14/);
  assert.ok(!inserted(/INSERT INTO guardian_consents/i));
});

test('staff can withdraw consent; volunteers cannot use staff endpoints', async () => {
  db({ dob: DOB_16, minAge: 16, consent: ACTIVE_CONSENT });
  let res = makeRes();
  await inShelter(() => consentCtrl.withdrawVolunteerGuardianConsent(
    makeReq({ session: { userId: 1, role: 'staff' }, params: { userId: 2 }, body: {} }),
    res
  ));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.withdrawn, true);

  res = makeRes();
  await inShelter(() => consentCtrl.withdrawVolunteerGuardianConsent(
    makeReq({ params: { userId: 2 }, body: {} }),
    res
  ));
  assert.equal(res.statusCode, 403);
});

test('age settings: only admins set them, within 1 to 99 or empty for none', async () => {
  db({ minAge: 16 });
  let res = makeRes();
  await inShelter(() => consentCtrl.updateAgeSettings(
    makeReq({ session: { userId: 1, role: 'staff' }, body: { min_volunteer_age: 14 } }),
    res
  ));
  assert.equal(res.statusCode, 403);

  res = makeRes();
  await inShelter(() => consentCtrl.updateAgeSettings(
    makeReq({ session: { userId: 1, role: 'admin' }, body: { min_volunteer_age: 0 } }),
    res
  ));
  assert.equal(res.statusCode, 400);

  res = makeRes();
  await inShelter(() => consentCtrl.updateAgeSettings(
    makeReq({ session: { userId: 1, role: 'admin' }, body: { min_volunteer_age: 16 } }),
    res
  ));
  assert.equal(res.statusCode, 200);
  const up = mock.calls.find((c) => /INSERT INTO shelter_settings/i.test(c.sql));
  assert.deepEqual(up.params, [1, 16, 1]);

  db({});
  res = makeRes();
  await inShelter(() => consentCtrl.updateAgeSettings(
    makeReq({ session: { userId: 1, role: 'admin' }, body: { min_volunteer_age: '' } }),
    res
  ));
  assert.equal(res.statusCode, 200);
  const cleared = mock.calls.find((c) => /INSERT INTO shelter_settings/i.test(c.sql));
  assert.equal(cleared.params[1], null);
});

test('request bodies reject unknown fields and shelter ids', () => {
  assert.equal(bodies.ageSettings.safeParse({ min_volunteer_age: 16, shelter_id: 2 }).success, false);
  assert.equal(bodies.ageSettings.safeParse({ min_volunteer_age: 100 }).success, false);
  assert.equal(bodies.guardianConsent.safeParse({ guardian_name: 'x', user_id: 3 }).success, false);
});

// --- Migration and schema --------------------------------------------------

const DB = path.join(__dirname, '..', 'database');
const migration = fs.readFileSync(path.join(DB, '041_under_18_guardian_consent.pg.sql'), 'utf8');
const schema = fs.readFileSync(path.join(DB, 'schema.pg.sql'), 'utf8');
const setupDb = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-db.js'), 'utf8');

function tableBody(sql, table) {
  const m = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  assert.ok(m, `${table} table not found`);
  return m[1].split('\n').map((l) => l.trim().replace(/,$/, '').replace(/\s+/g, ' ')).filter(Boolean);
}

for (const table of ['shelter_settings', 'guardian_consents']) {
  test(`041 ${table}: matches schema.pg.sql, row level security, tenant table`, () => {
    assert.deepEqual(tableBody(schema, table), tableBody(migration, table));
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`CREATE POLICY tenant_isolation ON ${table}`));
    assert.match(migration, new RegExp(`CREATE TRIGGER trg_same_shelter\\s+BEFORE INSERT OR UPDATE ON ${table}`));
    const drop = /DROP TABLE IF EXISTS([\s\S]*?)CASCADE;/.exec(schema);
    assert.match(drop[1], new RegExp(`\\b${table}\\b`));
    assert.ok(TENANT_TABLES.includes(table));
    assert.equal(mentionsTenantTable(`SELECT * FROM ${table}`), true);
  });
}

test('041 runs on fresh setup and has no global default age', () => {
  assert.match(setupDb, /041_under_18_guardian_consent\.pg\.sql/);
  assert.match(migration, /min_volunteer_age\s+SMALLINT,/);
  assert.doesNotMatch(migration, /min_volunteer_age\s+SMALLINT[^,\n]*DEFAULT/);
  assert.match(migration, /guardian_consents_active_key[\s\S]*WHERE withdrawn_at IS NULL/);
  assert.match(migration, /Rollback:/);
});
