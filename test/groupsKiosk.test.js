'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async () => {},
    sendGroupBookingReceived: async () => {},
    sendGroupBookingConfirmed: async () => {},
    sendGroupBookingDeclined: async () => {},
  },
};

const { communityServiceProgress } = require('../utils/communityService');
const groupCtrl = require('../controllers/groupBookingController');
const { restrictKioskSession, isKioskSession } = require('../middleware/auth');
const { displayName } = require('../controllers/kioskController');

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

test('community service progress math', () => {
  assert.deepStrictEqual(
    communityServiceProgress({ requiredHours: 40, approvedHours: 10 }),
    { target: 40, approved: 10, remaining: 30, percent: 25, completed: false }
  );
  assert.deepStrictEqual(
    communityServiceProgress({ requiredHours: 20, approvedHours: 20 }),
    { target: 20, approved: 20, remaining: 0, percent: 100, completed: true }
  );
  assert.deepStrictEqual(
    communityServiceProgress({ requiredHours: 10, approvedHours: 15 }),
    { target: 10, approved: 15, remaining: 0, percent: 100, completed: true }
  );
  assert.deepStrictEqual(
    communityServiceProgress({ requiredHours: null, approvedHours: 5 }),
    { target: 0, approved: 5, remaining: 0, percent: 0, completed: false }
  );
});

test('kiosk display name uses first name and last initial', () => {
  assert.strictEqual(displayName('Alex', 'Smith'), 'Alex S.');
  assert.strictEqual(displayName('Jordan', ''), 'Jordan');
});

test('group size respects capacity on confirm', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM group_bookings gb/i.test(sql) && /WHERE gb\.id/i.test(sql)) {
      return [[{
        id: 9,
        opportunity_id: 3,
        group_name: 'Acme Corp',
        contact_name: 'Pat',
        contact_email: 'pat@example.com',
        size: 5,
        status: 'pending',
        opportunity_title: 'Dog walk',
        opportunity_start_date: '2026-08-12 10:00:00',
        max_volunteers: 8,
      }]];
    }
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id/i.test(sql)) {
      return [[{
        opportunity_id: 3,
        id: 3,
        title: 'Dog walk',
        max_volunteers: 8,
        status: 'open',
      }]];
    }
    // getCurrentCapacity: applications (6) + confirmed groups (0) = 6; 6+5 > 8
    if (/current_count/i.test(sql) || (/SELECT \(/i.test(sql) && /group_bookings/i.test(sql))) {
      return [[{ current_count: 6 }]];
    }
    return [[]];
  });

  const res = makeRes();
  await groupCtrl.confirmGroupBooking(
    { session: { userId: 1, role: 'admin' }, params: { id: '9' } },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /exceed opportunity capacity/i);
  assert.strictEqual(res.body.capacity, 6);
  assert.strictEqual(res.body.group_size, 5);
});

test('confirming group succeeds when capacity allows', async () => {
  mock.resetCalls();
  let updated = false;
  mock.setHandler(async (sql, params) => {
    if (/FROM group_bookings gb/i.test(sql) && /WHERE gb\.id/i.test(sql)) {
      return [[{
        id: 9,
        opportunity_id: 3,
        group_name: 'Acme Corp',
        contact_name: 'Pat',
        contact_email: 'pat@example.com',
        size: 2,
        status: updated ? 'confirmed' : 'pending',
        opportunity_title: 'Dog walk',
        opportunity_start_date: '2026-08-12 10:00:00',
        max_volunteers: 8,
      }]];
    }
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id/i.test(sql)) {
      return [[{
        opportunity_id: 3,
        id: 3,
        title: 'Dog walk',
        max_volunteers: 8,
        status: 'open',
      }]];
    }
    if (/current_count/i.test(sql) || (/SELECT \(/i.test(sql) && /group_bookings/i.test(sql) && !/FROM group_bookings gb/i.test(sql))) {
      return [[{ current_count: 5 }]];
    }
    if (/UPDATE group_bookings SET status/i.test(sql)) {
      updated = true;
      assert.strictEqual(params[0], 'confirmed');
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const res = makeRes();
  await groupCtrl.confirmGroupBooking(
    { session: { userId: 1, role: 'admin' }, params: { id: '9' } },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.status, 'confirmed');
});

test('kiosk session cannot access admin APIs', async () => {
  const req = {
    session: { userId: 1, role: 'admin', kioskMode: true },
    path: '/admin/stats',
  };
  assert.strictEqual(isKioskSession(req), true);

  const res = makeRes();
  let nextCalled = false;
  await new Promise((resolve) => {
    restrictKioskSession(req, res, () => {
      nextCalled = true;
      resolve();
    });
    // If blocked, resolve after sync return
    setImmediate(resolve);
  });

  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.body.error, /Kiosk session cannot access/i);
});

test('public group booking is rejected when the shift is full', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities/i.test(sql) && /WHERE opportunity_id/i.test(sql)) {
      return [[{
        opportunity_id: 3,
        id: 3,
        title: 'Dog walk',
        max_volunteers: 4,
        status: 'open',
      }]];
    }
    if (/current_count/i.test(sql) || (/SELECT \(/i.test(sql) && /group_bookings/i.test(sql))) {
      return [[{ current_count: 4 }]];
    }
    return [[]];
  });

  const res = makeRes();
  await groupCtrl.createGroupBooking(
    {
      body: {
        opportunity_id: 3,
        group_name: 'Acme',
        contact_name: 'Pat',
        contact_email: 'pat@example.com',
        size: 2,
      },
    },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /Not enough spots/i);
});

test('public group booking rejects oversized groups', async () => {
  const res = makeRes();
  await groupCtrl.createGroupBooking(
    {
      body: {
        opportunity_id: 3,
        group_name: 'Acme',
        contact_name: 'Pat',
        contact_email: 'pat@example.com',
        size: 99,
      },
    },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /cannot exceed/i);
});

test('kiosk session can access kiosk endpoints', async () => {
  const req = {
    session: { userId: 1, role: 'admin', kioskMode: true },
    path: '/kiosk/shifts/today',
  };
  const res = makeRes();
  let nextCalled = false;
  await new Promise((resolve) => {
    restrictKioskSession(req, res, () => {
      nextCalled = true;
      resolve();
    });
  });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(res.statusCode, 200);
});
