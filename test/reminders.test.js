'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const emailCalls = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendEmail: async () => {},
    sendApplicationConfirmation: async () => {},
    sendApplicationApproval: async () => {},
    sendApplicationCancellation: async () => {},
    sendApplicationRejection: async () => {},
    sendWaitlistPromotion: async () => {},
    sendHoursApproval: async () => {},
    sendVolunteerApprovalNotification: async () => {},
    sendShiftReminder: async (...args) => { emailCalls.push(['reminder', ...args]); },
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

const Application = require('../models/Application');
const { runShiftReminders } = require('../jobs/shiftReminders');
const appCtrl = require('../controllers/applicationController');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test('reminder query selects only unsent accepted apps in next 24h', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /reminder_sent_at IS NULL/i);
    assert.match(sql, /INTERVAL 24 HOUR/i);
    assert.match(sql, /accepted', 'approved'/);
    assert.strictEqual(params.length, 2);
    return [[{
      application_id: 1,
      email: 'a@x.com',
      opportunity_title: 'Walk',
      opportunity_start_date: '2026-08-11 18:00:00',
      opportunity_location: 'Yard',
      reminder_sent_at: null,
    }]];
  });

  const rows = await Application.findAcceptedNeedingReminder(new Date('2026-08-11T12:00:00Z'));
  assert.strictEqual(rows.length, 1);
});

test('reminder_sent_at prevents duplicate sends', async () => {
  mock.resetCalls();
  emailCalls.length = 0;
  jobRuns.length = 0;

  let reminderMarked = false;
  mock.setHandler(async (sql) => {
    if (/reminder_sent_at IS NULL/i.test(sql) && /SELECT/i.test(sql)) {
      if (reminderMarked) return [[]];
      return [[{
        application_id: 3,
        email: 'v@x.com',
        opportunity_title: 'Feed cats',
        opportunity_start_date: '2026-08-11 20:00:00',
        opportunity_location: 'Cattery',
        reminder_sent_at: null,
      }]];
    }
    if (/SET reminder_sent_at/i.test(sql)) {
      reminderMarked = true;
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const first = await runShiftReminders(new Date('2026-08-11T12:00:00Z'));
  assert.match(first, /sent=1/);
  assert.strictEqual(emailCalls.filter((c) => c[0] === 'reminder').length, 1);

  const second = await runShiftReminders(new Date('2026-08-11T12:30:00Z'));
  assert.match(second, /sent=0/);
  assert.strictEqual(emailCalls.filter((c) => c[0] === 'reminder').length, 1);
  assert.ok(jobRuns.length >= 2);
});

test('no-show endpoint rejects non-admins', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  await appCtrl.markApplicationNoShow(
    { session: { userId: 2, role: 'volunteer' }, params: { id: 1 } },
    res
  );
  assert.strictEqual(res.statusCode, 403);
});

test('no-show endpoint rejects future opportunities', async () => {
  mock.resetCalls();
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  mock.setHandler(async () => [[
    {
      application_id: 1,
      status: 'accepted',
      opportunity_start_date: future,
      opportunity_title: 'Future shift',
    },
  ]]);

  const res = makeRes();
  await appCtrl.markApplicationNoShow(
    { session: { userId: 1, role: 'admin' }, params: { id: 1 } },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /past opportunities/i);
});
