'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-feedback-secret';
process.env.FEEDBACK_TOKEN_SECRET = 'test-feedback-secret';

const mock = require('./helpers/mockDb');

const emailCalls = [];
const emailPath = require.resolve('../utils/emailService');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async () => {},
    sendFeedbackRequest: async (...args) => {
      emailCalls.push(['request', ...args]);
    },
    sendFeedbackConcernAlert: async (...args) => {
      emailCalls.push(['concern', ...args]);
    },
  },
};

const jobLogPath = require.resolve('../utils/jobLog');
const jobRuns = [];
require.cache[jobLogPath] = {
  id: jobLogPath,
  filename: jobLogPath,
  loaded: true,
  exports: {
    recordJobRun: async (name, status, detail) => {
      jobRuns.push({ name, status, detail });
      return jobRuns.length;
    },
  },
};

const {
  createFeedbackToken,
  verifyFeedbackToken,
} = require('../utils/feedbackToken');
const { averageRating, averagesByOpportunity } = require('../utils/feedbackMath');
const ShiftFeedback = require('../models/ShiftFeedback');
const { runFeedbackRequests } = require('../jobs/feedbackRequests');
const feedbackCtrl = require('../controllers/feedbackController');

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

test('feedback token validates and rejects tampering', () => {
  const token = createFeedbackToken(42);
  const ok = verifyFeedbackToken(token);
  assert.deepStrictEqual(ok, { applicationId: 42 });

  assert.strictEqual(verifyFeedbackToken(null), null);
  assert.strictEqual(verifyFeedbackToken(''), null);
  assert.strictEqual(verifyFeedbackToken('not.a.valid.token'), null);

  const [payload] = token.split('.');
  assert.strictEqual(verifyFeedbackToken(`${payload}.bogussignaturexxxxxx`), null);

  const other = createFeedbackToken(99);
  const [, sig] = other.split('.');
  assert.strictEqual(verifyFeedbackToken(`${payload}.${sig}`), null);
});

test('averages math: overall and by opportunity', () => {
  assert.strictEqual(averageRating([]), null);
  assert.strictEqual(averageRating([5, 4, 3]), 4);
  assert.strictEqual(averageRating([5, 5, 4]), 4.67);

  const byOpp = averagesByOpportunity([
    { opportunity_id: 1, opportunity_title: 'Walk dogs', rating: 5 },
    { opportunity_id: 1, opportunity_title: 'Walk dogs', rating: 3 },
    { opportunity_id: 2, opportunity_title: 'Feed cats', rating: 4 },
  ]);
  assert.strictEqual(byOpp.length, 2);
  const walk = byOpp.find((r) => r.opportunity_id === 1);
  const feed = byOpp.find((r) => r.opportunity_id === 2);
  assert.strictEqual(walk.average, 4);
  assert.strictEqual(walk.count, 2);
  assert.strictEqual(feed.average, 4);
  assert.strictEqual(feed.count, 1);
});

test('one feedback request email per application via feedback_requested_at', async () => {
  mock.resetCalls();
  emailCalls.length = 0;
  jobRuns.length = 0;

  let marked = false;
  mock.setHandler(async (sql) => {
    if (/feedback_requested_at IS NULL/i.test(sql) && /SELECT/i.test(sql)) {
      if (marked) return [[]];
      return [[
        {
          application_id: 7,
          email: 'v@x.com',
          first_name: 'Sam',
          name: 'Sam Volunteer',
          opportunity_title: 'Dog walk',
          opportunity_start_date: '2026-08-10 10:00:00',
          feedback_requested_at: null,
        },
      ]];
    }
    if (/SET feedback_requested_at/i.test(sql)) {
      marked = true;
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const first = await runFeedbackRequests(new Date('2026-08-11T12:00:00Z'));
  assert.match(first, /sent=1/);
  assert.strictEqual(emailCalls.filter((c) => c[0] === 'request').length, 1);

  const second = await runFeedbackRequests(new Date('2026-08-11T13:00:00Z'));
  assert.match(second, /sent=0/);
  assert.strictEqual(emailCalls.filter((c) => c[0] === 'request').length, 1);
  assert.ok(jobRuns.length >= 2);
});

test('submitting with flag_concern emails all admins', async () => {
  mock.resetCalls();
  emailCalls.length = 0;

  const token = createFeedbackToken(11);
  mock.setHandler(async (sql) => {
    if (/FROM applications/i.test(sql) && /application_id = \?/i.test(sql) && /SELECT/i.test(sql)) {
      // Application.findById
      if (/LEFT JOIN users/i.test(sql) || /INNER JOIN users/i.test(sql) || /o\.title/i.test(sql)) {
        return [[
          {
            application_id: 11,
            user_id: 2,
            opportunity_id: 3,
            status: 'accepted',
            name: 'Alex Volunteer',
            email: 'alex@x.com',
            opportunity_title: 'Kennel clean',
            opportunity_start_date: '2026-08-10 09:00:00',
          },
        ]];
      }
    }
    if (/FROM shift_feedback/i.test(sql) && /application_id = \?/i.test(sql) && /SELECT/i.test(sql)) {
      return [[]];
    }
    if (/INSERT INTO shift_feedback/i.test(sql)) {
      return [{ insertId: 50, affectedRows: 1 }];
    }
    if (/FROM shift_feedback f/i.test(sql) && /f\.id = \?/i.test(sql)) {
      return [[
        {
          id: 50,
          application_id: 11,
          rating: 2,
          comment: 'Unsafe tools',
          flag_concern: 1,
          handled_at: null,
          created_at: '2026-08-11 10:00:00',
          user_id: 2,
          opportunity_id: 3,
          volunteer_email: 'alex@x.com',
          volunteer_name: 'Alex Volunteer',
          opportunity_title: 'Kennel clean',
          opportunity_start_date: '2026-08-10 09:00:00',
        },
      ]];
    }
    if (/role = 'admin'/i.test(sql)) {
      return [[{ email: 'a1@x.com' }, { email: 'a2@x.com' }]];
    }
    return [[]];
  });

  // Application.findById uses specific SQL — ensure it matches
  mock.setHandler(async (sql, params) => {
    if (/SELECT[\s\S]*FROM applications a/i.test(sql) && /a\.application_id = \?/i.test(sql)) {
      return [[
        {
          application_id: 11,
          user_id: 2,
          opportunity_id: 3,
          status: 'accepted',
          name: 'Alex Volunteer',
          email: 'alex@x.com',
          opportunity_title: 'Kennel clean',
          opportunity_start_date: '2026-08-10 09:00:00',
        },
      ]];
    }
    if (/FROM shift_feedback f?\s*WHERE f?\.?application_id/i.test(sql) ||
        (/FROM shift_feedback/i.test(sql) && /application_id = \?/i.test(sql) && /SELECT/i.test(sql) && !/INNER JOIN/i.test(sql))) {
      return [[]];
    }
    if (/INSERT INTO shift_feedback/i.test(sql)) {
      assert.strictEqual(params[0], 11);
      assert.strictEqual(params[1], 2);
      assert.strictEqual(params[3], 1);
      return [{ insertId: 50, affectedRows: 1 }];
    }
    if (/FROM shift_feedback f/i.test(sql) && /f\.id = \?/i.test(sql)) {
      return [[
        {
          id: 50,
          application_id: 11,
          rating: 2,
          comment: 'Unsafe tools',
          flag_concern: 1,
          handled_at: null,
          created_at: '2026-08-11 10:00:00',
          user_id: 2,
          opportunity_id: 3,
          volunteer_email: 'alex@x.com',
          volunteer_name: 'Alex Volunteer',
          opportunity_title: 'Kennel clean',
          opportunity_start_date: '2026-08-10 09:00:00',
        },
      ]];
    }
    if (/role = 'admin'/i.test(sql)) {
      return [[{ email: 'a1@x.com' }, { email: 'a2@x.com' }]];
    }
    return [[]];
  });

  const res = makeRes();
  await feedbackCtrl.submitFeedback(
    {
      body: {
        token,
        rating: 2,
        comment: 'Unsafe tools',
        flag_concern: true,
      },
    },
    res
  );

  assert.strictEqual(res.statusCode, 201);
  const concernMails = emailCalls.filter((c) => c[0] === 'concern');
  assert.strictEqual(concernMails.length, 2);
  assert.strictEqual(concernMails[0][1], 'a1@x.com');
  assert.strictEqual(concernMails[1][1], 'a2@x.com');
});

test('invalid token is rejected on submit', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  await feedbackCtrl.submitFeedback(
    { body: { token: 'bad.token', rating: 5 } },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /Invalid/i);
});

test('duplicate feedback is rejected', async () => {
  mock.resetCalls();
  const token = createFeedbackToken(11);
  mock.setHandler(async (sql) => {
    if (/FROM applications a/i.test(sql) && /a\.application_id = \?/i.test(sql)) {
      return [[
        {
          application_id: 11,
          user_id: 2,
          opportunity_id: 3,
          status: 'accepted',
          name: 'Alex',
          email: 'alex@x.com',
          opportunity_title: 'Walk',
          opportunity_start_date: '2026-08-10 09:00:00',
        },
      ]];
    }
    if (/FROM shift_feedback/i.test(sql) && /application_id = \?/i.test(sql)) {
      return [[{
        id: 1,
        application_id: 11,
        rating: 5,
        comment: null,
        flag_concern: 0,
        handled_at: null,
        created_at: '2026-08-11 09:00:00',
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await feedbackCtrl.submitFeedback(
    { body: { token, rating: 4, flag_concern: false } },
    res
  );
  assert.strictEqual(res.statusCode, 409);
});

test('findAcceptedNeedingFeedbackRequest uses yesterday date filter', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /\?::date - interval '1 day'/i);
    assert.match(sql, /feedback_requested_at IS NULL/i);
    assert.match(sql, /accepted', 'approved'/);
    assert.strictEqual(params.length, 1);
    return [[]];
  });
  const rows = await ShiftFeedback.findAcceptedNeedingFeedbackRequest(
    new Date('2026-08-11T12:00:00Z')
  );
  assert.deepStrictEqual(rows, []);
});
