'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('./helpers/mockDb');

// Controllers need auth helpers — exercise requireStaff via a thin route-style check
const { isStaffOrAdmin, requireStaff } = require('../middleware/auth');
const Incident = require('../models/Incident');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('Incident.create inserts staff_only visibility', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO incidents/i.test(sql)) {
      assert.equal(params[4], 'concern');
      assert.ok(sql.includes("'staff_only'") || params.includes('staff_only'));
      return [{ insertId: 12 }];
    }
    if (/FROM incidents i/i.test(sql) && /WHERE i\.id = \?/i.test(sql)) {
      return [
        [
          {
            id: 12,
            animal_id: 2,
            opportunity_id: null,
            reported_by: 1,
            body: 'Limping after walk',
            severity: 'concern',
            visibility: 'staff_only',
            created_at: '2026-08-26',
            resolved_at: null,
            resolved_by: null,
            animal_name: 'Rex',
            reporter_first_name: 'Ciara',
            reporter_last_name: 'Gallagher',
          },
        ],
      ];
    }
    return [[]];
  });

  const row = await Incident.create({
    animalId: 2,
    reportedBy: 1,
    body: 'Limping after walk',
    severity: 'concern',
  });
  assert.equal(row.id, 12);
  assert.equal(row.visibility, 'staff_only');
  assert.equal(row.animal_id, 2);
});

test('Incident.update rejects clearing both animal_id and opportunity_id', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM incidents i/i.test(sql) && /WHERE i\.id = \?/i.test(sql)) {
      return [[{
        id: 12, animal_id: 2, opportunity_id: null, reported_by: 1,
        body: 'Limping after walk', severity: 'concern', visibility: 'staff_only',
        created_at: '2026-08-26', resolved_at: null, resolved_by: null,
      }]];
    }
    return [[]];
  });

  await assert.rejects(
    () => Incident.update(12, { animal_id: null, opportunity_id: null }),
    (err) => err.status === 400 && /animal_id or opportunity_id/.test(err.message)
  );
  // Must not have issued the UPDATE — only the lookup SELECT should have run.
  assert.ok(!mock.calls.some((c) => /UPDATE incidents/i.test(c.sql)));
});

test('volunteers cannot access incidents API (403)', async () => {
  const { listIncidents, createIncident } = require('../controllers/incidentController');

  const req = {
    session: { userId: 4, role: 'volunteer' },
    user: { user_id: 4, role: 'volunteer' },
    query: {},
    body: { animal_id: 1, body: 'secret' },
    params: {},
  };
  const res = mockRes();
  await listIncidents(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Forbidden');

  const res2 = mockRes();
  await createIncident(req, res2);
  assert.equal(res2.statusCode, 403);
});

test('staff can list incidents filtered by animal', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/FROM incidents i/i.test(sql)) {
      assert.ok(sql.includes('i.animal_id = ?'));
      assert.equal(params[0], 2);
      return [
        [
          {
            id: 1,
            animal_id: 2,
            reported_by: 1,
            body: 'Note',
            severity: 'info',
            visibility: 'staff_only',
            created_at: '2026-08-26',
          },
        ],
      ];
    }
    return [[]];
  });

  const { listIncidents } = require('../controllers/incidentController');
  const req = {
    session: { userId: 1, role: 'admin' },
    user: { user_id: 1, role: 'admin' },
    query: { animal_id: '2' },
  };
  const res = mockRes();
  await listIncidents(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].animal_id, 2);
});

test('isStaffOrAdmin is false for volunteer role', () => {
  assert.equal(isStaffOrAdmin({ session: { role: 'volunteer' }, user: { role: 'volunteer' } }), false);
  assert.equal(isStaffOrAdmin({ session: { role: 'staff' }, user: { role: 'staff' } }), true);
});

test('requireStaff middleware rejects volunteers', async () => {
  const req = { session: { userId: 9, role: 'volunteer' }, user: { role: 'volunteer' } };
  const res = mockRes();
  let nextCalled = false;
  // attachUser will try DB — stub via mock so findById may fail; role from session still used
  mock.setHandler(async () => [[]]);
  await requireStaff(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
