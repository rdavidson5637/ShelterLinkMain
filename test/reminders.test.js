'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
// Jobs skip when email is unconfigured; the email service itself is stubbed below.
process.env.EMAIL_HOST = 'smtp.test.invalid';
process.env.EMAIL_FROM = 'ShelterLink <test@example.com>';

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
const claims = [];
require.cache[jobLogPath] = {
  id: jobLogPath,
  filename: jobLogPath,
  loaded: true,
  exports: {
    recordJobRun: async (name, status, detail) => {
      jobRuns.push({ name, status, detail });
      return jobRuns.length;
    },
    claimJobRun: async (name, runKey) => {
      const key = `${name}:${runKey}`;
      if (claims.includes(key)) return false;
      claims.push(key);
      return true;
    },
  },
};

const Application = require('../models/Application');
const { runShiftReminders } = require('../jobs/shiftReminders');
const appCtrl = require('../controllers/applicationController');
const pushService = require('../utils/pushService');
const pushCalls = [];
const origSend = pushService.sendToUsers;
pushService.sendToUsers = async (...args) => {
  pushCalls.push(args);
  return origSend.apply(pushService, args);
};

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
    assert.match(sql, /interval '24 hours'/i);
    assert.match(sql, /accepted', 'approved'/);
    assert.match(sql, /prefer_reminders/i);
    assert.strictEqual(params.length, 2);
    return [[{ application_id: 1, email: 'a@x.com', opportunity_title: 'Walk', opportunity_start_date: '2026-08-11 18:00:00', opportunity_location: 'Yard', reminder_sent_at: null, prefer_reminders: 1 }]];
  });

  const rows = await Application.findAcceptedNeedingReminder(new Date('2026-08-11T12:00:00Z'));
  assert.strictEqual(rows.length, 1);
});

test('reminder_sent_at and job_runs claim prevent duplicate sends', async () => {
  mock.resetCalls();
  emailCalls.length = 0;
  jobRuns.length = 0;
  claims.length = 0;

  let reminderMarked = false;
  mock.setHandler(async (sql) => {
    if (/reminder_sent_at IS NULL/i.test(sql) && /SELECT/i.test(sql)) {
      if (reminderMarked) return [[]];
      return [[{ application_id: 3, user_id: 2, email: 'v@x.com', opportunity_title: 'Feed cats', opportunity_start_date: '2026-08-11 20:00:00', opportunity_location: 'Cattery', reminder_sent_at: null, prefer_reminders: 1 }]];
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
  assert.ok(claims.some((c) => c.startsWith('shiftReminderSend:app:3:')));

  const second = await runShiftReminders(new Date('2026-08-11T12:30:00Z'));
  assert.match(second, /sent=0/);
  assert.strictEqual(emailCalls.filter((c) => c[0] === 'reminder').length, 1);
  assert.ok(jobRuns.length >= 2);
});

test('shift reminders send push with reminders category and keep going if push throws', async () => {
  mock.resetCalls();
  emailCalls.length = 0;
  pushCalls.length = 0;
  claims.length = 0;
  mock.setHandler(async (sql) => {
    if (/reminder_sent_at IS NULL/i.test(sql) && /SELECT/i.test(sql)) {
      return [[{ application_id: 8, user_id: 4, email: 'v@x.com', opportunity_title: 'Walk', opportunity_start_date: '2026-06-11 10:00:00', opportunity_location: 'Yard', prefer_reminders: 1 }]];
    }
    if (/SET reminder_sent_at/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  const detail = await runShiftReminders(new Date('2026-06-11T08:00:00Z'));
  assert.match(detail, /pushSent=/);
  assert.equal(pushCalls[0][2].category, 'reminders');
  assert.deepEqual(pushCalls[0][0], [4]);

  pushService.sendToUsers = async () => {
    throw new Error('push down');
  };
  emailCalls.length = 0;
  // New application id so the hourly claim key does not collide.
  mock.setHandler(async (sql) => {
    if (/reminder_sent_at IS NULL/i.test(sql) && /SELECT/i.test(sql)) {
      return [[{ application_id: 9, user_id: 4, email: 'v@x.com', opportunity_title: 'Walk', opportunity_start_date: '2026-06-11 10:00:00', opportunity_location: 'Yard', prefer_reminders: 1 }]];
    }
    if (/SET reminder_sent_at/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  const afterThrow = await runShiftReminders(new Date('2026-06-11T08:00:00Z'));
  assert.match(afterThrow, /sent=1/);
  assert.equal(emailCalls.length, 1);
  pushService.sendToUsers = origSend;
});

test('shift reminders skip quiet hours without marking sent', async () => {
  mock.resetCalls();
  emailCalls.length = 0;
  claims.length = 0;
  mock.setHandler(async (sql) => {
    if (/reminder_sent_at IS NULL/i.test(sql) && /SELECT/i.test(sql)) {
      return [[{
        application_id: 12,
        user_id: 4,
        email: 'v@x.com',
        opportunity_title: 'Walk',
        opportunity_start_date: '2026-06-11 10:00:00',
        opportunity_location: 'Yard',
        prefer_reminders: 1,
        quiet_hours_start: '22:00',
        quiet_hours_end: '08:00',
      }]];
    }
    if (/SET reminder_sent_at/i.test(sql)) {
      assert.fail('must not mark reminder sent during quiet hours');
    }
    return [[]];
  });
  // 23:00 UTC is 23:00 or 00:00 London depending on DST; use a fixed local via SHELTER_TIMEZONE.
  const previous = process.env.SHELTER_TIMEZONE;
  process.env.SHELTER_TIMEZONE = 'UTC';
  try {
    const detail = await runShiftReminders(new Date('2026-06-10T23:30:00Z'));
    assert.match(detail, /skippedQuiet=1/);
    assert.match(detail, /sent=0/);
    assert.equal(emailCalls.length, 0);
    assert.equal(claims.length, 0);
  } finally {
    if (previous === undefined) delete process.env.SHELTER_TIMEZONE;
    else process.env.SHELTER_TIMEZONE = previous;
  }
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
