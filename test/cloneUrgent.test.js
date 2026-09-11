'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const emails = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendUrgentCover: async (to, details) => {
      emails.push({ to, details });
      return { messageId: 'test' };
    },
  },
};

delete require.cache[require.resolve('../models/Opportunity')];
delete require.cache[require.resolve('../models/Qualification')];
delete require.cache[require.resolve('../models/Tag')];
delete require.cache[require.resolve('../models/Animal')];
delete require.cache[require.resolve('../models/AdminMessage')];
delete require.cache[require.resolve('../controllers/opportunityController')];

const Opportunity = require('../models/Opportunity');
const {
  cloneOpportunity,
  flagOpportunityUrgent,
} = require('../controllers/opportunityController');

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
    params: {},
    query: {},
    method: 'POST',
    originalUrl: '/api/opportunities/1/clone',
    ...overrides,
  };
}

function baseOpp(overrides = {}) {
  return {
    opportunity_id: 7,
    id: 7,
    title: 'Dog walk',
    description: 'Walk dogs',
    requirements: null,
    location: 'Kennels',
    // Relative to now so the "upcoming shift" guard stays satisfied over time.
    start_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' '),
    end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' '),
    max_volunteers: 4,
    status: 'open',
    recurrence_rule: 'none',
    recurrence_until: null,
    parent_opportunity_id: null,
    check_in_code: 'OLDCODE',
    cancellation_cutoff_hours: 24,
    activity_notes: null,
    is_urgent: 0,
    urgent_flagged_at: null,
    spots_filled: 1,
    ...overrides,
  };
}

test('clone copies fields, clears dates, regenerates check-in code', async () => {
  mock.resetCalls();
  let insertParams = null;
  mock.setHandler(async (sql, params) => {
    if (/WHERE opportunity_id = \?/i.test(sql) && /SELECT/i.test(sql)) {
      const id = Number(params[0]);
      if (id === 7) return [[baseOpp()]];
      if (id === 88) {
        return [[
          baseOpp({
            opportunity_id: 88,
            id: 88,
            start_date: null,
            end_date: null,
            check_in_code: params.includes('NEW') ? 'NEWCOD' : 'NEWID1',
          }),
        ]];
      }
      return [[baseOpp({ opportunity_id: id, id })]];
    }
    if (/INSERT INTO opportunities/i.test(sql)) {
      insertParams = params;
      return [{ insertId: 88 }];
    }
    if (/DELETE FROM opportunity_qualifications/i.test(sql)) return [{ affectedRows: 0 }];
    if (/INSERT INTO opportunity_qualifications/i.test(sql)) return [{ insertId: 1 }];
    if (/DELETE FROM opportunity_tags/i.test(sql)) return [{ affectedRows: 0 }];
    if (/INSERT INTO opportunity_tags/i.test(sql)) return [{ insertId: 1 }];
    if (/DELETE FROM opportunity_animals/i.test(sql)) return [{ affectedRows: 0 }];
    if (/INSERT INTO opportunity_animals/i.test(sql)) return [{ insertId: 1 }];
    if (/FROM opportunity_qualifications/i.test(sql) || /required_qualifications/i.test(sql)) {
      return [[{ opportunity_id: 7, id: 3, name: 'Dog Handling' }]];
    }
    if (/FROM opportunity_tags/i.test(sql) || /opportunity_tags/i.test(sql)) {
      return [[{ opportunity_id: 7, id: 2, name: 'dogs' }]];
    }
    if (/FROM opportunity_animals/i.test(sql)) {
      return [[{ opportunity_id: 7, id: 5, name: 'Bella' }]];
    }
    if (/FROM qualifications/i.test(sql)) return [[]];
    if (/FROM tags/i.test(sql)) return [[]];
    if (/FROM animals/i.test(sql)) return [[]];
    return [[]];
  });

  // Patch attach helpers via Qualification/Tag/Animal if needed — controller uses withExtras.
  // Simpler path: test cloneFrom model directly first.
  const clone = await Opportunity.cloneFrom(7, 1);
  assert.ok(clone);
  assert.ok(insertParams, 'expected insert');
  assert.strictEqual(insertParams[4], null, 'start_date cleared');
  assert.strictEqual(insertParams[5], null, 'end_date cleared');
  assert.notStrictEqual(insertParams[12], 'OLDCODE', 'check-in code regenerated');
  assert.strictEqual(insertParams[0], 'Dog walk');
});

test('cloneOpportunity endpoint copies quals/tags/animals and returns 201', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO opportunities/i.test(sql)) return [{ insertId: 88 }];
    if (/WHERE opportunity_id = \?/i.test(sql) && /SELECT/i.test(sql)) {
      const id = Number(params[0]);
      if (id === 7) return [[baseOpp()]];
      return [[baseOpp({ opportunity_id: 88, id: 88, start_date: null, end_date: null, check_in_code: 'ZZZZZZ' })]];
    }
    if (/opportunity_qualifications/i.test(sql)) {
      if (/INSERT/i.test(sql)) return [{ insertId: 1 }];
      if (/DELETE/i.test(sql)) return [{ affectedRows: 0 }];
      return [[{ opportunity_id: Number(params[0]) || 7, id: 3, name: 'Dog Handling', qualification_id: 3 }]];
    }
    if (/opportunity_tags/i.test(sql)) {
      if (/INSERT/i.test(sql)) return [{ insertId: 1 }];
      if (/DELETE/i.test(sql)) return [{ affectedRows: 0 }];
      return [[{ opportunity_id: 7, id: 2, name: 'dogs' }]];
    }
    if (/opportunity_animals/i.test(sql)) {
      if (/INSERT/i.test(sql)) return [{ insertId: 1 }];
      if (/DELETE/i.test(sql)) return [{ affectedRows: 0 }];
      return [[{ opportunity_id: 7, id: 5, name: 'Bella', species: 'dog' }]];
    }
    if (/FROM animals/i.test(sql)) {
      return [[{ id: 5, name: 'Bella', species: 'dog' }]];
    }
    if (/FROM qualifications/i.test(sql)) {
      return [[{ id: 3, name: 'Dog Handling' }]];
    }
    if (/FROM tags/i.test(sql)) {
      return [[{ id: 2, name: 'dogs' }]];
    }
    return [[]];
  });

  const res = makeRes();
  await cloneOpportunity(makeReq({ params: { id: '7' } }), res);
  assert.strictEqual(res.statusCode, 201);
  assert.ok(res.body);
  assert.notStrictEqual(res.body.check_in_code, 'OLDCODE');
  // No application inserts
  assert.ok(!mock.calls.some((c) => /INSERT INTO applications/i.test(c.sql)));
});

test('canReflagUrgent blocks within 24h', () => {
  const now = new Date('2026-08-26T12:00:00Z');
  assert.strictEqual(
    Opportunity.canReflagUrgent({ urgent_flagged_at: '2026-08-26T10:00:00Z' }, now),
    false
  );
  assert.strictEqual(
    Opportunity.canReflagUrgent({ urgent_flagged_at: '2026-08-25T11:00:00Z' }, now),
    true
  );
});

test('urgent email excludes existing applicants and unqualified volunteers', async () => {
  mock.resetCalls();
  emails.length = 0;
  mock.setHandler(async (sql, params) => {
    if (/WHERE opportunity_id = \?/i.test(sql) && /SELECT/i.test(sql) && !/users/i.test(sql)) {
      return [[baseOpp({ spots_filled: 1 })]];
    }
    if (/FROM users u/i.test(sql) && /volunteer_profiles/i.test(sql)) {
      assert.match(sql, /NOT EXISTS[\s\S]*applications/i);
      assert.match(sql, /opportunity_qualifications/i);
      return [[
        { user_id: 9, email: 'ok@example.com', first_name: 'Ok', last_name: 'Vol' },
      ]];
    }
    if (/UPDATE opportunities/i.test(sql) && /is_urgent/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO admin_messages/i.test(sql)) return [{ insertId: 1 }];
    if (/FROM admin_messages/i.test(sql)) {
      return [[{ id: 1, subject: 'Cover needed', recipient_count: 1 }]];
    }
    if (/opportunity_qualifications|opportunity_tags|opportunity_animals|FROM animals|FROM qualifications|FROM tags/i.test(sql)) {
      return [[]];
    }
    return [[]];
  });

  const res = makeRes();
  await flagOpportunityUrgent(makeReq({ params: { id: '7' }, originalUrl: '/api/opportunities/7/urgent' }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(emails.length, 1);
  assert.strictEqual(emails[0].to, 'ok@example.com');
  assert.strictEqual(res.body.sent, 1);
});

test('urgent re-flag within 24h returns 429', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/WHERE opportunity_id = \?/i.test(sql) && /SELECT/i.test(sql)) {
      return [[
        baseOpp({
          urgent_flagged_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          is_urgent: 1,
        }),
      ]];
    }
    return [[]];
  });

  const res = makeRes();
  await flagOpportunityUrgent(makeReq({ params: { id: '7' } }), res);
  assert.strictEqual(res.statusCode, 429);
});
