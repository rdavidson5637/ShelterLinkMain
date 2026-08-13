'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mock = require('./helpers/mockDb');

// Stub email service before controllers load it so tests never hit SMTP.
const emailPath = require.resolve('../utils/emailService');
const emailCalls = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async (...args) => { emailCalls.push(['sendEmail', ...args]); },
    sendApplicationConfirmation: async (...args) => { emailCalls.push(['confirm', ...args]); },
    sendApplicationApproval: async (...args) => { emailCalls.push(['approval', ...args]); },
    sendApplicationCancellation: async (...args) => { emailCalls.push(['cancel', ...args]); },
    sendApplicationRejection: async (...args) => { emailCalls.push(['reject', ...args]); },
    sendWaitlistPromotion: async (...args) => { emailCalls.push(['promote', ...args]); },
    sendHoursApproval: async () => {},
    sendVolunteerApprovalNotification: async () => {},
  },
};

const appCtrl = require('../controllers/applicationController');
const Application = require('../models/Application');

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

function resetEmail() {
  emailCalls.length = 0;
}

function scenario({
  approvedProfile = 1,
  oppStatus = 'open',
  maxVol = 5,
  capacity = 0,
  existing = null,
  insertId = 9,
} = {}) {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: approvedProfile, user_email: 'v@x.com' }]];
    }
    if (/AS current_count/i.test(sql)) {
      return [[{ current_count: capacity }]];
    }
    if (/application_id, status\s+FROM applications/i.test(sql)) {
      return [existing ? [existing] : []];
    }
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id/i.test(sql)) {
      return [[{
        opportunity_id: 1,
        id: 1,
        title: 'Dog Walk',
        status: oppStatus,
        max_volunteers: maxVol,
      }]];
    }
    if (/INSERT INTO applications/i.test(sql)) {
      return [{ insertId }];
    }
    if (/a\.\*|FROM applications a/i.test(sql) && /application_id = \?/i.test(sql)) {
      return [[{
        application_id: insertId,
        user_id: 2,
        opportunity_id: 1,
        status: params?.includes?.('waitlisted') ? 'waitlisted' : 'pending',
        applied_at: 'now',
        title: 'Dog Walk',
      }]];
    }
    if (/INSERT INTO applications/i.test(sql) === false && /SELECT a\.\*/i.test(sql)) {
      const status = mock.calls.some((c) => c.params && c.params[2] === 'waitlisted')
        ? 'waitlisted'
        : 'pending';
      return [[{
        application_id: insertId,
        user_id: 2,
        opportunity_id: 1,
        status,
        applied_at: 'now',
        title: 'Dog Walk',
      }]];
    }
    return [[]];
  });
}

test('REGRESSION: cannot apply to a non-open opportunity', async () => {
  resetEmail();
  scenario({ oppStatus: 'cancelled' });
  const res = makeRes();
  await appCtrl.applyForOpportunity(makeReq(), res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /no longer open/i);
});

test('cannot apply with an unapproved profile', async () => {
  resetEmail();
  scenario({ approvedProfile: 0 });
  const res = makeRes();
  await appCtrl.applyForOpportunity(makeReq(), res);
  assert.strictEqual(res.statusCode, 403);
});

test('apply when full creates waitlisted application', async () => {
  resetEmail();
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: 1, user_email: 'v@x.com' }]];
    }
    if (/AS current_count/i.test(sql)) return [[{ current_count: 2 }]];
    if (/application_id, status\s+FROM applications/i.test(sql)) return [[]];
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 1, title: 'Dog Walk', status: 'open', max_volunteers: 2 }]];
    }
    if (/INSERT INTO applications/i.test(sql)) {
      assert.strictEqual(params[2], 'waitlisted');
      return [{ insertId: 9 }];
    }
    if (/application_id = \?/i.test(sql)) {
      return [[{
        application_id: 9,
        user_id: 2,
        opportunity_id: 1,
        status: 'waitlisted',
        applied_at: 'now',
        title: 'Dog Walk',
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await appCtrl.applyForOpportunity(makeReq(), res);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.status, 'waitlisted');
});

test('happy path: open + approved + space → 201 pending', async () => {
  resetEmail();
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: 1, user_email: 'v@x.com' }]];
    }
    if (/AS current_count/i.test(sql)) return [[{ current_count: 0 }]];
    if (/application_id, status\s+FROM applications/i.test(sql)) return [[]];
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 1, title: 'Dog Walk', status: 'open', max_volunteers: 5 }]];
    }
    if (/INSERT INTO applications/i.test(sql)) {
      assert.strictEqual(params[2], 'pending');
      return [{ insertId: 9 }];
    }
    if (/application_id = \?/i.test(sql)) {
      return [[{
        application_id: 9,
        user_id: 2,
        opportunity_id: 1,
        status: 'pending',
        applied_at: 'now',
        title: 'Dog Walk',
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await appCtrl.applyForOpportunity(makeReq(), res);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.status, 'pending');
});

test('cancellation of accepted application promotes oldest waitlisted and emails', async () => {
  resetEmail();
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/DELETE FROM applications/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE applications SET status = \?/i.test(sql)) {
      assert.strictEqual(params[0], 'pending');
      return [{ affectedRows: 1 }];
    }
    if (/status = 'waitlisted'/i.test(sql)) {
      return [[{
        application_id: 8,
        user_id: 3,
        opportunity_id: 1,
        status: 'waitlisted',
        email: 'wait@x.com',
        opportunity_title: 'Dog Walk',
        applied_at: '2026-01-01',
      }]];
    }
    if (/AS current_count/i.test(sql)) return [[{ current_count: 0 }]];
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 1, status: 'open', max_volunteers: 1 }]];
    }
    if (/WHERE a\.application_id = \?/i.test(sql) || /WHERE application_id = \?/i.test(sql)) {
      if (Number(params[0]) === 5) {
        return [[{
          application_id: 5,
          user_id: 2,
          opportunity_id: 1,
          status: 'accepted',
          email: 'accepter@x.com',
          opportunity_title: 'Dog Walk',
        }]];
      }
      return [[{
        application_id: 8,
        user_id: 3,
        opportunity_id: 1,
        status: 'pending',
        email: 'wait@x.com',
        opportunity_title: 'Dog Walk',
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await appCtrl.cancelApplication(
    makeReq({ params: { id: 5 }, body: {} }),
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.ok(emailCalls.some((c) => c[0] === 'promote'));
  assert.ok(emailCalls.some((c) => c[0] === 'promote' && c[1] === 'wait@x.com'));
});

test('accepting from waitlist respects capacity', async () => {
  resetEmail();
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/WHERE a\.application_id = \?/i.test(sql) || /WHERE application_id = \?/i.test(sql)) {
      return [[{
        application_id: 8,
        user_id: 3,
        opportunity_id: 1,
        status: 'waitlisted',
        email: 'wait@x.com',
        opportunity_title: 'Dog Walk',
      }]];
    }
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 1, status: 'open', max_volunteers: 1 }]];
    }
    if (/AS current_count/i.test(sql)) return [[{ current_count: 1 }]];
    return [[]];
  });

  const res = makeRes();
  await appCtrl.updateApplicationStatus(
    makeReq({
      session: { userId: 1, role: 'admin' },
      params: { id: 8 },
      body: { status: 'accepted' },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /full capacity/i);
});

test('create accepts waitlisted status argument', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO applications/i.test(sql)) {
      assert.deepStrictEqual(params, [2, 1, 'waitlisted']);
      return [{ insertId: 11 }];
    }
    return [[{
      application_id: 11,
      user_id: 2,
      opportunity_id: 1,
      status: 'waitlisted',
      applied_at: 'now',
    }]];
  });
  const app = await Application.create(2, 1, 'waitlisted');
  assert.strictEqual(app.status, 'waitlisted');
});
