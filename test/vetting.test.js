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
  } finally {
    Waiver.findPendingForUser = originalPending;
    Qualification.findMissingForUser = originalMissing;
    Animal.findMissingQualificationsForUser = originalAnimal;
  }
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
