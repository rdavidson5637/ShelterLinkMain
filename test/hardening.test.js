'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
delete require.cache[require.resolve('../models/Opportunity')];
delete require.cache[require.resolve('../controllers/opportunityController')];

const { sanitizeInput } = require('../middleware/sanitize');
const {
  sessionCookieOptions,
  clearSessionCookie,
  regenerateSession,
  destroyUserSessions,
} = require('../utils/sessionCookie');
const { stripAdminFields, getAllOpportunities } = require('../controllers/opportunityController');

function runSanitize(body) {
  const req = { body, query: {}, params: {} };
  const res = {
    statusCode: 200,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  let nextCalled = false;
  sanitizeInput(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
}

test('sanitizeInput leaves passwords and tokens intact', () => {
  const { req, nextCalled } = runSanitize({
    email: 'ada@example.com',
    password: 'P@ss<word>1',
    token: 'ab<>cd',
    title: '<script>alert(1)</script>',
  });
  assert.equal(nextCalled, true);
  assert.equal(req.body.password, 'P@ss<word>1');
  assert.equal(req.body.token, 'ab<>cd');
  assert.equal(req.body.title.includes('<script>'), false);
});

test('session cookies are httpOnly and match production flags', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const opts = sessionCookieOptions();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.secure, true);
  assert.equal(opts.sameSite, 'strict');
  assert.equal(opts.path, '/');
  const res = { cookie: null, clearCookie(name, options) { this.cookie = { name, options }; } };
  clearSessionCookie(res);
  assert.equal(res.cookie.name, 'connect.sid');
  assert.equal(res.cookie.options.secure, true);
  process.env.NODE_ENV = prev;
});

test('regenerateSession assigns values after regenerate', async () => {
  let regenerated = false;
  const req = {
    session: {
      old: true,
      regenerate(cb) {
        regenerated = true;
        this.old = undefined;
        cb(null);
      },
    },
  };
  await regenerateSession(req, { userId: 7, role: 'admin' });
  assert.equal(regenerated, true);
  assert.equal(req.session.userId, 7);
  assert.equal(req.session.role, 'admin');
});

test('destroyUserSessions deletes connect-pg-simple rows for that user', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [{ affectedRows: 2 }]);
  await destroyUserSessions(mock.pool, 42);
  const call = mock.calls.find((c) => /DELETE FROM session/i.test(c.sql));
  assert.ok(call);
  assert.deepEqual(call.params, ['42']);
});

test('stripAdminFields hides check-in codes and internal shift notes', () => {
  const stripped = stripAdminFields(
    {
      title: 'Walk',
      check_in_code: 'SECRET',
      activity_notes: 'staff only',
      shift_notes: [
        { body: 'Internal', notify: 0 },
        { body: 'Bring wellies', notify: 1 },
      ],
    },
    false
  );
  assert.equal(stripped.check_in_code, undefined);
  assert.equal(stripped.activity_notes, undefined);
  assert.deepEqual(
    stripped.shift_notes.map((n) => n.body),
    ['Bring wellies']
  );
});

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

test('escapeHtml encodes markup', async () => {
  const { escapeHtml } = await import('../frontend/js/utils/escapeHtml.js');
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('volunteers cannot list closed shifts via ?status=', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities/i.test(sql) && /status = \?/i.test(sql)) {
      return [[{
        opportunity_id: 1,
        id: 1,
        title: 'Open kennel',
        status: 'open',
        start_date: '2099-01-01',
        location: 'Yard',
      }]];
    }
    if (/FROM opportunities/i.test(sql)) {
      return [[{
        opportunity_id: 2,
        id: 2,
        title: 'Closed deep-clean',
        status: 'closed',
        start_date: '2099-01-02',
        location: 'Yard',
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await getAllOpportunities(
    { session: { userId: 9, role: 'volunteer' }, query: { status: 'closed' } },
    res
  );
  assert.equal(res.statusCode, 200);
  const statusCall = mock.calls.find((c) => /FROM opportunities/i.test(c.sql) && c.params.includes('open'));
  assert.ok(statusCall, 'volunteer list must force status=open');
  assert.ok(!mock.calls.some((c) => c.params && c.params.includes('closed')));
});
