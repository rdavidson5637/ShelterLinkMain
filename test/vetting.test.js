'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const emailCalls = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async (...args) => {
      emailCalls.push(args);
    },
  },
};

const Vetting = require('../models/Vetting');
const vettingCtrl = require('../controllers/vettingController');
const appCtrl = require('../controllers/applicationController');

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

test('toSafeReference omits comments unless includeComments', () => {
  const row = {
    id: 1,
    user_id: 2,
    referee_name: 'Pat',
    referee_email: 'pat@ex.com',
    referee_relationship: 'manager',
    requested_at: '2026-01-01',
    expires_at: '2026-01-22',
    responded_at: null,
    is_suitable: 1,
    comments: 'SECRET',
    status: 'received',
  };
  const safe = Vetting.toSafeReference(row, { includeComments: false });
  assert.equal(safe.comments, undefined);
  assert.equal(safe.referee_name, 'Pat');
  const staff = Vetting.toSafeReference(row, { includeComments: true });
  assert.equal(staff.comments, 'SECRET');
});

test('listMyReferences never returns comments', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM volunteer_references/i.test(sql)) {
      return [[
        {
          id: 9,
          user_id: 3,
          referee_name: 'Sam',
          referee_email: 'sam@ex.com',
          referee_relationship: null,
          requested_at: '2026-08-01',
          expires_at: '2026-08-22',
          responded_at: '2026-08-02',
          is_suitable: 1,
          comments: 'Do not leak',
          status: 'received',
        },
      ]];
    }
    return [[]];
  });

  const res = makeRes();
  await vettingCtrl.listMyReferences({ session: { userId: 3 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].comments, undefined);
  assert.equal(res.body[0].status, 'received');
});

test('hasClearCheck requires matching clear non-expired type', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /status = 'clear'/i);
    assert.equal(params[1], 'accessni_basic');
    return [[{ id: 1 }]];
  });
  assert.equal(await Vetting.hasClearCheck(5, 'accessni_basic'), true);

  mock.setHandler(async () => [[]]);
  assert.equal(await Vetting.hasClearCheck(5, 'accessni_enhanced'), false);
});

test('applyForOpportunity gates on required background check', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: 1, user_email: 'v@x.com' }]];
    }
    if (/application_id, status\s+FROM applications/i.test(sql)) {
      return [[]];
    }
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id/i.test(sql)) {
      return [[{
        opportunity_id: 10,
        title: 'Secure shift',
        status: 'open',
        max_volunteers: 5,
        required_background_check_type: 'accessni_basic',
      }]];
    }
    if (/FROM background_checks/i.test(sql)) return [[]];
    return [[]];
  });

  const Waiver = require('../models/Waiver');
  const originalPending = Waiver.findPendingForUser;
  Waiver.findPendingForUser = async () => [];

  const Qualification = require('../models/Qualification');
  const originalMissing = Qualification.findMissingForUser;
  Qualification.findMissingForUser = async () => [];

  const Animal = require('../models/Animal');
  const originalAnimal = Animal.findMissingQualificationsForUser;
  Animal.findMissingQualificationsForUser = async () => [];

  try {
    const res = makeRes();
    await appCtrl.applyForOpportunity(
      { session: { userId: 2 }, body: { opportunityId: 10 } },
      res
    );
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /background check/i);
    assert.equal(res.body.required_background_check_type, 'accessni_basic');
    assert.equal(res.body.check_expires_before_shift, false);
  } finally {
    Waiver.findPendingForUser = originalPending;
    Qualification.findMissingForUser = originalMissing;
    Animal.findMissingQualificationsForUser = originalAnimal;
  }
});

test('apply is refused when a clear check expires before the shift', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: 1, user_email: 'v@x.com' }]];
    }
    if (/application_id, status\s+FROM applications/i.test(sql)) {
      return [[]];
    }
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id/i.test(sql)) {
      return [[{
        opportunity_id: 10,
        title: 'Future secure shift',
        status: 'open',
        max_volunteers: 5,
        start_date: '2099-06-01 09:00:00',
        required_background_check_type: 'accessni_basic',
      }]];
    }
    if (/FROM background_checks/i.test(sql)) {
      const day = String(params[2] || '');
      if (day.startsWith('2099')) return [[]];
      return [[{ id: 1 }]];
    }
    return [[]];
  });

  const Waiver = require('../models/Waiver');
  const originalPending = Waiver.findPendingForUser;
  Waiver.findPendingForUser = async () => [];
  const Qualification = require('../models/Qualification');
  const originalMissing = Qualification.findMissingForUser;
  Qualification.findMissingForUser = async () => [];
  const Animal = require('../models/Animal');
  const originalAnimal = Animal.findMissingQualificationsForUser;
  Animal.findMissingQualificationsForUser = async () => [];

  try {
    const res = makeRes();
    await appCtrl.applyForOpportunity(
      { session: { userId: 2 }, body: { opportunityId: 10 } },
      res
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.check_expires_before_shift, true);
    assert.match(res.body.error, /2099-06-01/);
    assert.equal(res.body.required_background_check_type, 'accessni_basic');
  } finally {
    Waiver.findPendingForUser = originalPending;
    Qualification.findMissingForUser = originalMissing;
    Animal.findMissingQualificationsForUser = originalAnimal;
  }
});

test('accept is refused when the check expires before the shift', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM applications a/i.test(sql) && /application_id/i.test(sql)) {
      return [[{
        application_id: 8,
        user_id: 3,
        opportunity_id: 10,
        status: 'pending',
        email: 'v@x.com',
        opportunity_title: 'Future secure shift',
      }]];
    }
    if (/FROM opportunities/i.test(sql)) {
      return [[{
        opportunity_id: 10,
        status: 'open',
        max_volunteers: 5,
        start_date: '2099-06-01 09:00:00',
        required_background_check_type: 'accessni_enhanced',
      }]];
    }
    if (/AS current_count/i.test(sql)) return [[{ current_count: 0 }]];
    if (/FROM background_checks/i.test(sql)) {
      const day = String(params[2] || '');
      if (day.startsWith('2099')) return [[]];
      return [[{ id: 1 }]];
    }
    return [[]];
  });

  const res = makeRes();
  await appCtrl.updateApplicationStatus(
    {
      session: { userId: 1, role: 'admin' },
      user: { role: 'admin' },
      params: { id: 8 },
      body: { status: 'accepted' },
    },
    res
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.check_expires_before_shift, true);
  assert.match(res.body.error, /cannot be accepted|still be valid/i);
});

test('submitPublicReference records suitable response', async () => {
  mock.resetCalls();
  let updated = false;
  mock.setHandler(async (sql) => {
    if (/FROM volunteer_references WHERE token_hash/i.test(sql)) {
      return [[{
        id: 4,
        user_id: 2,
        referee_name: 'Ref',
        referee_email: 'r@x.com',
        status: 'requested',
        expires_at: '2099-01-01',
        comments: null,
        is_suitable: null,
        requested_at: '2026-08-01',
        responded_at: null,
        referee_relationship: null,
      }]];
    }
    if (/UPDATE volunteer_references/i.test(sql)) {
      updated = true;
      return [{ affectedRows: 1 }];
    }
    if (/FROM volunteer_references WHERE id/i.test(sql)) {
      return [[{
        id: 4,
        user_id: 2,
        referee_name: 'Ref',
        referee_email: 'r@x.com',
        status: 'received',
        expires_at: '2099-01-01',
        comments: 'Good',
        is_suitable: 1,
        requested_at: '2026-08-01',
        responded_at: '2026-08-26',
        referee_relationship: null,
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await vettingCtrl.submitPublicReference(
    { params: { token: 'abc' }, body: { is_suitable: true, comments: 'Good' } },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.ok(updated);
});

test('submitPublicReference stores null suitability when the field is omitted, not 0', async () => {
  mock.resetCalls();
  let storedSuitable;
  mock.setHandler(async (sql, params) => {
    if (/FROM volunteer_references WHERE token_hash/i.test(sql)) {
      return [[{
        id: 4, user_id: 2, referee_name: 'Ref', referee_email: 'r@x.com',
        status: 'requested', expires_at: '2099-01-01', comments: null,
        is_suitable: null, requested_at: '2026-08-01', responded_at: null,
        referee_relationship: null,
      }]];
    }
    if (/UPDATE volunteer_references/i.test(sql)) {
      storedSuitable = params[1]; // status, is_suitable, comments, id
      return [{ affectedRows: 1 }];
    }
    if (/FROM volunteer_references WHERE id/i.test(sql)) {
      return [[{ id: 4, user_id: 2, status: 'received', is_suitable: null }]];
    }
    return [[]];
  });

  const res = makeRes();
  // No is_suitable/isSuitable in the body at all.
  await vettingCtrl.submitPublicReference(
    { params: { token: 'abc' }, body: { comments: 'left blank by mistake' } },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.strictEqual(storedSuitable, null, 'omitted answer must store NULL, not 0/false');
});

test('classifyOnboardingStage walks the pipeline in order', () => {
  assert.equal(
    Vetting.classifyOnboardingStage({
      hasProfile: false,
      approved: false,
      waiversComplete: false,
      referencesReceived: 0,
      hasClearCheck: false,
    }),
    'needs_profile'
  );
  assert.equal(
    Vetting.classifyOnboardingStage({
      hasProfile: true,
      approved: false,
      waiversComplete: true,
      referencesReceived: 2,
      hasClearCheck: true,
    }),
    'awaiting_approval'
  );
  assert.equal(
    Vetting.classifyOnboardingStage({
      hasProfile: true,
      approved: true,
      waiversComplete: false,
      referencesReceived: 0,
      hasClearCheck: false,
    }),
    'needs_waiver'
  );
  assert.equal(
    Vetting.classifyOnboardingStage({
      hasProfile: true,
      approved: true,
      waiversComplete: true,
      referencesReceived: 0,
      hasClearCheck: false,
    }),
    'needs_references'
  );
  assert.equal(
    Vetting.classifyOnboardingStage({
      hasProfile: true,
      approved: true,
      waiversComplete: true,
      referencesReceived: 1,
      hasClearCheck: false,
    }),
    'needs_accessni'
  );
  assert.equal(
    Vetting.classifyOnboardingStage({
      hasProfile: true,
      approved: true,
      waiversComplete: true,
      referencesReceived: 2,
      hasClearCheck: true,
    }),
    'ready'
  );
});

test('classifyOnboardingStage blocks ready when a reference is flagged unsuitable', () => {
  assert.equal(
    Vetting.classifyOnboardingStage({
      hasProfile: true,
      approved: true,
      waiversComplete: true,
      referencesReceived: 1,
      referencesFlagged: 1,
      hasClearCheck: true,
    }),
    'reference_flagged'
  );
  // A flagged reference blocks 'ready' even when everything else is complete —
  // it must never be silently absorbed into "references received".
  assert.notEqual(
    Vetting.classifyOnboardingStage({
      hasProfile: true,
      approved: true,
      waiversComplete: true,
      referencesReceived: 1,
      referencesFlagged: 1,
      hasClearCheck: true,
    }),
    'ready'
  );
});

test('getOnboardingPipeline groups a volunteer with a flagged reference into reference_flagged, not ready', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users u/i.test(sql) && /LEFT JOIN volunteer_profiles/i.test(sql)) {
      return [[{
        user_id: 9,
        email: 'flagged@example.com',
        first_name: 'Flagged',
        last_name: 'Volunteer',
        phone: null,
        created_at: '2026-01-03',
        profile_id: 3,
        approved: 1,
        references_received: 1,
        references_flagged: 1,
        clear_checks: 1,
      }]];
    }
    if (/FROM waivers/i.test(sql) || /waiver_acceptances/i.test(sql)) {
      return [[]];
    }
    return [[]];
  });

  const result = await Vetting.getOnboardingPipeline();
  assert.ok(result.pipeline.reference_flagged.some((v) => v.user_id === 9));
  assert.ok(!result.pipeline.ready.some((v) => v.user_id === 9));
  assert.equal(result.counts.reference_flagged, 1);
});

test('getOnboardingPipeline groups volunteers by stage', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users u/i.test(sql) && /LEFT JOIN volunteer_profiles/i.test(sql)) {
      return [
        [
          {
            user_id: 7,
            email: 'maeve@example.com',
            first_name: 'Maeve',
            last_name: 'Williams',
            phone: null,
            created_at: '2026-01-01',
            profile_id: 6,
            approved: 0,
            references_received: 0,
            clear_checks: 0,
          },
          {
            user_id: 2,
            email: 'alex@example.com',
            first_name: 'Alex',
            last_name: 'Jenkins',
            phone: null,
            created_at: '2026-01-02',
            profile_id: 1,
            approved: 1,
            references_received: 1,
            clear_checks: 1,
          },
        ],
      ];
    }
    // Waiver.findPendingForUser
    if (/FROM waivers/i.test(sql) || /waiver_acceptances/i.test(sql)) {
      return [[]];
    }
    return [[]];
  });

  const result = await Vetting.getOnboardingPipeline();
  assert.ok(result.pipeline.awaiting_approval.some((v) => v.user_id === 7));
  assert.ok(result.pipeline.ready.some((v) => v.user_id === 2));
  assert.equal(result.counts.awaiting_approval, 1);
  assert.equal(result.counts.ready, 1);
});

const STORED_CHECK = {
  id: 4,
  user_id: 5,
  check_type: 'accessni_basic',
  reference_number: 'KEEP-REF',
  issued_on: '2026-01-01',
  expires_on: '2027-01-01',
  status: 'clear',
  notes: 'KEEP-NOTES',
  updated_by: 1,
  updated_at: '2026-01-02',
};

function vettingDb(sql) {
  if (/FROM users\s+WHERE user_id/i.test(sql)) {
    return [[{
      user_id: 5,
      name: 'Alex Jenkins',
      email: 'alex@example.com',
      role: 'volunteer',
      shelter_id: 1,
    }]];
  }
  if (/UPDATE background_checks/i.test(sql) && /reference_number/i.test(sql)) {
    return [{ affectedRows: 1 }];
  }
  if (/INSERT INTO background_checks/i.test(sql)) {
    return [{ insertId: 8, affectedRows: 1 }];
  }
  if (/FROM background_checks/i.test(sql)) {
    return [[STORED_CHECK]];
  }
  return [[]];
}

test('toSafeCheck hides reference number and notes unless asked', () => {
  const hidden = Vetting.toSafeCheck(STORED_CHECK);
  assert.equal(hidden.reference_number, undefined);
  assert.equal(hidden.notes, undefined);
  assert.equal(hidden.updated_by, undefined);
  assert.equal(hidden.status, 'clear');
  const volunteer = Vetting.toSafeCheck(STORED_CHECK, { includeReference: true });
  assert.equal(volunteer.reference_number, 'KEEP-REF');
  assert.equal(volunteer.notes, undefined);
  const admin = Vetting.toSafeCheck(STORED_CHECK, { includeReference: true, includeNotes: true });
  assert.equal(admin.notes, 'KEEP-NOTES');
  assert.equal(admin.updated_by, 1);
});

test('staff background-check list omits reference number and notes', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => vettingDb(sql));
  const res = makeRes();
  await vettingCtrl.listBackgroundChecks({
    session: { userId: 9, role: 'staff' },
    user: { role: 'staff' },
    params: { userId: '5' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body[0].status, 'clear');
  assert.equal(res.body[0].reference_number, undefined);
  assert.equal(res.body[0].notes, undefined);
});

test('admin background-check list includes reference number and notes', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => vettingDb(sql));
  const res = makeRes();
  await vettingCtrl.listBackgroundChecks({
    session: { userId: 1, role: 'admin' },
    user: { role: 'admin' },
    params: { userId: '5' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body[0].reference_number, 'KEEP-REF');
  assert.equal(res.body[0].notes, 'KEEP-NOTES');
});

test('volunteer sees their own reference number and not admin notes', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => vettingDb(sql));
  const res = makeRes();
  await vettingCtrl.listMyBackgroundChecks({
    session: { userId: 5, role: 'volunteer' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body[0].reference_number, 'KEEP-REF');
  assert.equal(res.body[0].notes, undefined);
});

test('staff update keeps the stored reference number and notes', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => vettingDb(sql));
  const res = makeRes();
  await vettingCtrl.upsertBackgroundCheck({
    session: { userId: 9, role: 'staff' },
    user: { role: 'staff' },
    params: { userId: '5' },
    body: {
      id: 4,
      check_type: 'accessni_basic',
      status: 'clear',
      reference_number: 'OVERWRITE',
      notes: 'OVERWRITE NOTES',
    },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reference_number, undefined);
  assert.equal(res.body.notes, undefined);
  const update = mock.calls.find((call) => /UPDATE background_checks/i.test(call.sql));
  assert.ok(update);
  assert.equal(update.params[1], 'KEEP-REF');
  assert.equal(update.params[5], 'KEEP-NOTES');
  const audit = mock.calls.find((call) => /INSERT INTO audit_log/i.test(call.sql));
  assert.equal(audit, undefined);
});

test('admin update stores the reference number and notes', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => vettingDb(sql));
  const res = makeRes();
  await vettingCtrl.upsertBackgroundCheck({
    session: { userId: 1, role: 'admin' },
    user: { role: 'admin' },
    params: { userId: '5' },
    body: {
      id: 4,
      check_type: 'accessni_basic',
      status: 'clear',
      reference_number: 'ADMIN-REF',
      notes: 'Operational note',
    },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reference_number, 'KEEP-REF');
  assert.equal(res.body.notes, 'KEEP-NOTES');
  const update = mock.calls.find((call) => /UPDATE background_checks/i.test(call.sql));
  assert.equal(update.params[1], 'ADMIN-REF');
  assert.equal(update.params[5], 'Operational note');
  const audit = mock.calls.find((call) => /INSERT INTO audit_log/i.test(call.sql));
  assert.ok(audit);
  assert.equal(audit.params[1], 'background_check.sensitive_update');
  const detail = JSON.parse(audit.params[4]);
  assert.equal(detail.reference_changed, true);
  assert.equal(detail.notes_changed, true);
  const packed = JSON.stringify(detail);
  assert.equal(packed.includes('ADMIN-REF'), false);
  assert.equal(packed.includes('KEEP-REF'), false);
  assert.equal(packed.includes('Operational'), false);
  assert.equal(packed.includes('KEEP-NOTES'), false);
});

test('staff insert does not store a reference number or notes', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => vettingDb(sql));
  const res = makeRes();
  await vettingCtrl.upsertBackgroundCheck({
    session: { userId: 9, role: 'staff' },
    user: { role: 'staff' },
    params: { userId: '5' },
    body: {
      check_type: 'accessni_enhanced',
      status: 'pending',
      reference_number: 'NEW-REF',
      notes: 'NEW NOTES',
    },
  }, res);
  assert.equal(res.statusCode, 201);
  const insert = mock.calls.find((call) => /INSERT INTO background_checks/i.test(call.sql));
  assert.ok(insert);
  assert.equal(insert.params[2], null);
  assert.equal(insert.params[6], null);
});

test('expiring checks list is name, type, status and date only', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/expires_on >=/.test(sql)) {
      return [[{
        ...STORED_CHECK,
        first_name: 'Alex',
        last_name: 'Jenkins',
        email: 'alex@example.com',
      }]];
    }
    return [[]];
  });
  const res = makeRes();
  await vettingCtrl.listExpiringChecks({
    session: { userId: 9, role: 'staff' },
    user: { role: 'staff' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body[0]).sort(), [
    'check_type',
    'expires_on',
    'first_name',
    'last_name',
    'status',
    'user_id',
  ]);
  assert.equal(JSON.stringify(res.body).includes('KEEP-REF'), false);
  assert.equal(JSON.stringify(res.body).includes('KEEP-NOTES'), false);
  assert.equal(JSON.stringify(res.body).includes('alex@example.com'), false);
});

test('expiry email escapes volunteer names and omits the reference number', async () => {
  mock.resetCalls();
  emailCalls.length = 0;
  const prev = {
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_FROM: process.env.EMAIL_FROM,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };
  process.env.EMAIL_HOST = 'smtp.example.test';
  process.env.EMAIL_FROM = 'ops@example.test';
  process.env.ADMIN_EMAIL = 'staff@example.test';
  mock.setHandler(async (sql) => {
    if (/expires_on >=/.test(sql)) {
      return [[{
        ...STORED_CHECK,
        first_name: '<Ann>',
        last_name: 'Smith',
        reference_number: 'SECRET-REF',
        notes: 'SECRET-NOTES',
      }]];
    }
    return [{ affectedRows: 0, insertId: 1 }];
  });
  try {
    const job = require('../jobs/backgroundCheckExpiry');
    await job.runBackgroundCheckExpiry(new Date('2026-06-01T00:00:00Z'));
    assert.equal(emailCalls.length, 1);
    const html = emailCalls[0][2];
    assert.match(html, /&lt;Ann&gt;/);
    assert.equal(html.includes('<Ann>'), false);
    assert.equal(html.includes('SECRET-REF'), false);
    assert.equal(html.includes('SECRET-NOTES'), false);
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('staff email lists accepted shifts whose check does not cover the date', async () => {
  mock.resetCalls();
  emailCalls.length = 0;
  const prev = {
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_FROM: process.env.EMAIL_FROM,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };
  process.env.EMAIL_HOST = 'smtp.example.test';
  process.env.EMAIL_FROM = 'ops@example.test';
  process.env.ADMIN_EMAIL = 'staff@example.test';
  mock.setHandler(async (sql) => {
    if (/NOT EXISTS/i.test(sql) && /required_background_check_type/i.test(sql)) {
      return [[{
        user_id: 3,
        first_name: '<Bea>',
        last_name: 'Jones',
        opportunity_id: 10,
        title: 'Kennel <shift>',
        start_date: '2099-06-01 09:00:00',
        check_type: 'accessni_basic',
        reference_number: 'SECRET-REF',
        notes: 'SECRET-NOTES',
      }]];
    }
    return [{ affectedRows: 0, insertId: 1 }];
  });
  try {
    const job = require('../jobs/backgroundCheckExpiry');
    const result = await job.runBackgroundCheckExpiry(new Date('2026-06-01T12:00:00Z'));
    assert.equal(emailCalls.length, 1);
    const html = emailCalls[0][2];
    assert.match(html, /&lt;Bea&gt;/);
    assert.match(html, /Kennel &lt;shift&gt;/);
    assert.match(html, /2099-06-01/);
    assert.match(html, /accessni basic/);
    assert.equal(html.includes('<Bea>'), false);
    assert.equal(html.includes('SECRET-REF'), false);
    assert.equal(html.includes('SECRET-NOTES'), false);
    assert.match(result.detail, /roster_gaps=1/);
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
