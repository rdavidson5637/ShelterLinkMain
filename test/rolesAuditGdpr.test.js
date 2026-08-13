'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

// Fresh module load after mock DB is installed.
delete require.cache[require.resolve('../middleware/auth')];
delete require.cache[require.resolve('../middleware/auditLog')];
delete require.cache[require.resolve('../models/AuditLog')];
delete require.cache[require.resolve('../models/Gdpr')];
delete require.cache[require.resolve('../controllers/gdprController')];
delete require.cache[require.resolve('../controllers/exportController')];
delete require.cache[require.resolve('../controllers/profileController')];
delete require.cache[require.resolve('../controllers/hoursController')];

const { requireRole, hasRole, isStaffOrAdmin, isAdminUser } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const Gdpr = require('../models/Gdpr');
const AuditLog = require('../models/AuditLog');
const {
  exportVolunteerGdpr,
  eraseVolunteer,
  listAuditLog,
} = require('../controllers/gdprController');
const { exportVolunteers } = require('../controllers/exportController');
const { updateVolunteerApproval } = require('../controllers/profileController');
const { approveHours } = require('../controllers/hoursController');

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
  };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  res.send = (b) => {
    res.body = b;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 1, role: 'admin' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/admin/test',
    ...overrides,
  };
}

test('hasRole / isStaffOrAdmin / isAdminUser helpers', () => {
  assert.strictEqual(isStaffOrAdmin(makeReq({ session: { role: 'staff' } })), true);
  assert.strictEqual(isStaffOrAdmin(makeReq({ session: { role: 'admin' } })), true);
  assert.strictEqual(isStaffOrAdmin(makeReq({ session: { role: 'volunteer' } })), false);
  assert.strictEqual(isAdminUser(makeReq({ session: { role: 'staff' } })), false);
  assert.strictEqual(isAdminUser(makeReq({ session: { role: 'admin' } })), true);
  assert.strictEqual(hasRole(makeReq({ session: { role: 'staff' } }), 'staff', 'admin'), true);
});

test('requireRole blocks staff from admin-only middleware', async () => {
  mock.setHandler(async () => [[{ user_id: 9, name: 'Staff', email: 's@x.com', role: 'staff' }]]);
  const mw = requireRole('admin');
  const req = makeReq({ session: { userId: 9, role: 'staff' } });
  const res = makeRes();
  let nextCalled = false;
  await mw(req, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
});

test('requireRole allows staff for staff+admin middleware', async () => {
  mock.setHandler(async () => [[{ user_id: 9, name: 'Staff', email: 's@x.com', role: 'staff' }]]);
  const mw = requireRole('staff', 'admin');
  const req = makeReq({ session: { userId: 9, role: 'staff' } });
  const res = makeRes();
  let nextCalled = false;
  await mw(req, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(res.statusCode, 200);
});

test('staff blocked from export volunteers controller', async () => {
  const res = makeRes();
  await exportVolunteers(
    makeReq({ session: { userId: 9, role: 'staff' } }),
    res
  );
  assert.strictEqual(res.statusCode, 403);
});

test('staff blocked from volunteer profile approval', async () => {
  const res = makeRes();
  await updateVolunteerApproval(
    makeReq({
      session: { userId: 9, role: 'staff' },
      params: { userId: '3' },
      body: { approved: true },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 403);
});

test('staff blocked from GDPR erase and audit list', async () => {
  let res = makeRes();
  await eraseVolunteer(
    makeReq({
      session: { userId: 9, role: 'staff' },
      params: { userId: '3' },
      body: { confirmation: 'DELETE' },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 403);

  res = makeRes();
  await listAuditLog(makeReq({ session: { userId: 9, role: 'staff' } }), res);
  assert.strictEqual(res.statusCode, 403);

  res = makeRes();
  await exportVolunteerGdpr(
    makeReq({ session: { userId: 9, role: 'staff' }, params: { userId: '3' } }),
    res
  );
  assert.strictEqual(res.statusCode, 403);
});

test('auditMutations writes a row on successful staff mutation', async () => {
  mock.resetCalls();
  const inserts = [];
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO audit_log/i.test(sql)) {
      inserts.push({ sql, params });
      return [{ insertId: 42 }];
    }
    return [[]];
  });

  const req = makeReq({
    session: { userId: 7, role: 'staff' },
    method: 'PUT',
    originalUrl: '/api/hours/15/approve',
    params: { id: '15' },
  });
  const res = makeRes();

  await new Promise((resolve) => {
    auditMutations(req, res, () => {
      res.status(200).json({ message: 'ok' });
      // allow async audit write
      setTimeout(resolve, 30);
    });
  });

  assert.ok(inserts.length >= 1, 'expected audit_log insert');
  assert.strictEqual(inserts[0].params[0], 7);
  assert.match(String(inserts[0].params[1]), /hours/);
});

test('erasure anonymises PII but preserves approved hours total', async () => {
  mock.resetCalls();
  let userRow = {
    user_id: 3,
    email: 'vol@example.com',
    role: 'volunteer',
    anonymised_at: null,
  };
  let hoursSum = 12.5;
  const updates = [];

  mock.setHandler(async (sql, params) => {
    if (/SELECT user_id, email, role, anonymised_at/i.test(sql)) {
      return [[{ ...userRow }]];
    }
    if (/SUM\(CASE WHEN approved = 1/i.test(sql)) {
      return [[{ total: hoursSum }]];
    }
    if (/UPDATE users SET/i.test(sql) && /anonymised_at/i.test(sql)) {
      updates.push({ type: 'user', params });
      userRow = {
        ...userRow,
        email: params[0],
        anonymised_at: new Date(),
      };
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE volunteer_profiles SET/i.test(sql)) {
      updates.push({ type: 'profile', params });
      return [{ affectedRows: 1 }];
    }
    if (/DELETE FROM (custom_field_values|user_documents|volunteer_tags|sessions)/i.test(sql)) {
      updates.push({ type: 'delete', sql });
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const outcome = await Gdpr.anonymiseUser(3, { reason: 'gdpr_erasure' });
  assert.ok(outcome);
  assert.strictEqual(outcome.already_anonymised, false);
  assert.strictEqual(outcome.hours_preserved, 12.5);
  assert.match(outcome.email, /deleted\+3@anonymised\.invalid/);
  assert.ok(updates.some((u) => u.type === 'user'));
  // Hours rows must not be deleted — only user/profile/custom/docs/tags.
  assert.ok(!updates.some((u) => /volunteer_hours/i.test(String(u.sql || ''))));
});

test('eraseVolunteer requires typed DELETE confirmation and audits', async () => {
  mock.resetCalls();
  const auditInserts = [];
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO audit_log/i.test(sql)) {
      auditInserts.push({ params });
      return [{ insertId: 1 }];
    }
    if (/SELECT user_id, email, role, anonymised_at/i.test(sql)) {
      return [[{ user_id: 3, email: 'a@b.c', role: 'volunteer', anonymised_at: null }]];
    }
    if (/SUM\(CASE WHEN approved = 1/i.test(sql)) {
      return [[{ total: 4 }]];
    }
    if (/UPDATE users SET/i.test(sql)) return [{ affectedRows: 1 }];
    if (/UPDATE volunteer_profiles SET/i.test(sql)) return [{ affectedRows: 1 }];
    if (/DELETE FROM/i.test(sql)) return [{ affectedRows: 0 }];
    return [[]];
  });

  let res = makeRes();
  await eraseVolunteer(
    makeReq({
      session: { userId: 1, role: 'admin' },
      params: { userId: '3' },
      body: { confirmation: 'nope' },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 400);

  res = makeRes();
  await eraseVolunteer(
    makeReq({
      session: { userId: 1, role: 'admin' },
      params: { userId: '3' },
      body: { confirmation: 'DELETE' },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.hours_preserved, 4);
  assert.ok(auditInserts.some((a) => a.params[1] === 'gdpr.erase'));
});

test('AuditLog.create inserts expected columns', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [{ insertId: 99 }]);
  const id = await AuditLog.create({
    userId: 1,
    action: 'test.action',
    entityType: 'widget',
    entityId: 5,
    detail: { ok: true },
  });
  assert.strictEqual(id, 99);
  const call = mock.lastCall();
  assert.match(call.sql, /INSERT INTO audit_log/i);
  assert.strictEqual(call.params[1], 'test.action');
  assert.strictEqual(call.params[3], '5');
});

test('staff can approve hours (controller allows staff)', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/UPDATE volunteer_hours/i.test(sql) || /approve/i.test(sql)) {
      return [[{
        record_id: 15,
        user_id: 3,
        hours: 2,
        opportunity_title: 'Walk dogs',
        approved: 1,
      }]];
    }
    if (/FROM users/i.test(sql)) {
      return [[{ user_id: 3, email: 'v@x.com', name: 'Vol', role: 'volunteer' }]];
    }
    if (/SELECT .* FROM volunteer_hours/i.test(sql) || /WHERE record_id/i.test(sql)) {
      return [[{
        record_id: 15,
        user_id: 3,
        hours: 2,
        opportunity_title: 'Walk dogs',
        approved: 1,
      }]];
    }
    return [[]];
  });

  // Re-require hours model path used by controller — use approve via model mock responses.
  // The controller calls VolunteerHours.approve which hits pool.execute.
  const VolunteerHours = require('../models/VolunteerHours');
  const originalApprove = VolunteerHours.approve;
  VolunteerHours.approve = async () => ({
    record_id: 15,
    user_id: 3,
    hours: 2,
    opportunity_title: 'Walk dogs',
    approved: 1,
  });

  try {
    const res = makeRes();
    await approveHours(
      makeReq({
        session: { userId: 9, role: 'staff' },
        params: { id: '15' },
      }),
      res
    );
    assert.strictEqual(res.statusCode, 200);
  } finally {
    VolunteerHours.approve = originalApprove;
  }
});
