'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const emailCalls = [];
let emailFailFor = null;
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendShiftReminder: async (to, details) => {
      emailCalls.push({ kind: 'reminder', to, details });
    },
    sendUrgentCover: async (to, details) => {
      if (to === emailFailFor) throw new Error('smtp down');
      emailCalls.push({ kind: 'urgent', to, details });
    },
  },
};

const pushService = require('../utils/pushService');
const smsModule = require('../utils/notify/smsProvider');
const notify = require('../utils/notify');

const pushCalls = [];
let pushImpl = async (userIds) => ({ sent: userIds.length, skipped: 0, failed: 0, configured: true });
pushService.sendToUsers = async (...args) => {
  pushCalls.push(args);
  return pushImpl(...args);
};

const smsSends = [];
const realSend = smsModule.disabledSmsProvider.send;

function setEmail(on) {
  if (on) {
    process.env.EMAIL_HOST = 'smtp.test.invalid';
    process.env.EMAIL_FROM = 'ShelterLink <test@example.com>';
  } else {
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_USER;
  }
}

function reset() {
  emailCalls.length = 0;
  pushCalls.length = 0;
  smsSends.length = 0;
  emailFailFor = null;
  pushImpl = async (userIds) => ({ sent: userIds.length, skipped: 0, failed: 0, configured: true });
}

const app = {
  application_id: 11,
  user_id: 5,
  email: 'v@example.com',
  opportunity_title: 'Dog walk',
  opportunity_start_date: '2026-12-01 10:00:00',
  opportunity_location: 'Yard',
};

test('channels are email, push and sms', () => {
  assert.deepEqual([...notify.CHANNELS], ['email', 'push', 'sms']);
});

test('SMS provider is the disabled one and reports skipped', async () => {
  const provider = smsModule.getSmsProvider();
  assert.equal(provider.name, 'disabled');
  assert.equal(provider.isEnabled(), false);
  assert.ok(smsModule.isSmsProvider(provider));
  assert.ok(Object.isFrozen(provider));
  const result = await provider.send({ to: '+440000000000', body: 'x', kind: 'reminder' });
  assert.deepEqual(result, { sent: false, skipped: true, reason: 'sms_disabled' });
  assert.equal(realSend, provider.send);
});

test('SMS cannot be switched on from the environment', () => {
  const saved = { SMS_PROVIDER: process.env.SMS_PROVIDER, SMS_ENABLED: process.env.SMS_ENABLED };
  process.env.SMS_PROVIDER = 'twilio';
  process.env.SMS_ENABLED = 'true';
  try {
    assert.equal(smsModule.getSmsProvider().isEnabled(), false);
    assert.equal(notify.channelStatus().sms, false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('isSmsProvider rejects objects missing the interface', () => {
  assert.equal(smsModule.isSmsProvider(null), false);
  assert.equal(smsModule.isSmsProvider({ name: 'x', send() {} }), false);
  assert.equal(smsModule.isSmsProvider({ isEnabled() {}, send() {} }), false);
  assert.equal(smsModule.isSmsProvider({ name: 'x', isEnabled() {}, send() {} }), true);
});

test('no SMS vendor dependency is installed', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  for (const banned of ['twilio', 'vonage', '@vonage/server-sdk', 'messagebird', 'plivo', 'aws-sdk', '@aws-sdk/client-sns']) {
    assert.ok(!deps.includes(banned), `${banned} must not be a dependency`);
  }
});

test('reminder goes by email and push, SMS skipped', async () => {
  reset();
  setEmail(true);
  const result = await notify.notifyShiftReminder(app, { title: 'Dog walk', date: '1 Dec', time: '10:00', location: 'Yard' });
  assert.equal(result.email.sent, 1);
  assert.equal(result.push.sent, 1);
  assert.equal(result.sms.sent, 0);
  assert.equal(result.sms.skipped, 1);
  assert.equal(result.sms.provider, 'disabled');
  assert.equal(result.delivered, true);
  assert.equal(emailCalls[0].to, 'v@example.com');
  assert.deepEqual(pushCalls[0][0], [5]);
  assert.equal(pushCalls[0][2].category, 'reminders');
  assert.equal(pushCalls[0][1].type, 'reminder');
});

test('reminder with email off sends push only and is delivered only if push went out', async () => {
  reset();
  setEmail(false);
  let result = await notify.notifyShiftReminder(app, {});
  assert.equal(emailCalls.length, 0);
  assert.equal(result.email.skipped, 1);
  assert.equal(result.delivered, true);

  pushImpl = async () => ({ sent: 0, skipped: 1, failed: 0, configured: true });
  result = await notify.notifyShiftReminder(app, {});
  assert.equal(result.delivered, false);
});

test('reminder with email on but no address fails without sending push', async () => {
  reset();
  setEmail(true);
  const result = await notify.notifyShiftReminder({ ...app, email: null }, {});
  assert.equal(result.email.reason, 'missing_email');
  assert.equal(result.delivered, false);
  assert.equal(pushCalls.length, 0);
});

test('push throwing does not stop the reminder email', async () => {
  reset();
  setEmail(true);
  pushImpl = async () => {
    throw new Error('push down');
  };
  const result = await notify.notifyShiftReminder(app, {});
  assert.equal(result.email.sent, 1);
  assert.equal(result.push.sent, 0);
  assert.equal(result.push.error, true);
  assert.equal(result.delivered, true);
});

test('urgent cover emails each recipient, counts failures and pushes once', async () => {
  reset();
  setEmail(true);
  emailFailFor = 'b@example.com';
  const recipients = [
    { user_id: 1, email: 'a@example.com', first_name: 'Ann' },
    { user_id: 2, email: 'b@example.com', first_name: 'Ben' },
  ];
  const result = await notify.notifyUrgentCover({
    recipients,
    opportunity: { id: 9, title: 'Kennels', location: 'Block B' },
    subject: 'Cover needed: Kennels 2026-12-01',
    whenLabel: '2026-12-01',
  });
  assert.deepEqual(
    { sent: result.email.sent, failed: result.email.failed },
    { sent: 1, failed: 1 }
  );
  assert.equal(emailCalls[0].details.firstName, 'Ann');
  assert.equal(pushCalls.length, 1);
  assert.deepEqual(pushCalls[0][0], [1, 2]);
  assert.equal(pushCalls[0][2].category, 'urgent');
  assert.equal(pushCalls[0][1].tag, 'urgent-9');
  assert.equal(result.push.sent, 2);
  assert.equal(result.sms.skipped, 2);
  assert.equal(result.sms.sent, 0);
});

test('urgent cover with no recipients does not call push', async () => {
  reset();
  const result = await notify.notifyUrgentCover({ recipients: [], opportunity: { id: 1 }, subject: 'x' });
  assert.equal(pushCalls.length, 0);
  assert.equal(result.email.sent, 0);
  assert.equal(result.push.configured, false);
});

test('channelStatus reflects email and push configuration', () => {
  setEmail(true);
  const status = notify.channelStatus();
  assert.equal(status.email, true);
  assert.equal(typeof status.push, 'boolean');
  assert.equal(status.sms, false);
  setEmail(false);
  assert.equal(notify.channelStatus().email, false);
});

test('reminder respects prefer_reminders off and quiet hours', async () => {
  reset();
  setEmail(true);
  let result = await notify.notifyShiftReminder({ ...app, prefer_reminders: 0 }, {});
  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, 'prefer_reminders_off');
  assert.equal(emailCalls.length, 0);

  const previous = process.env.SHELTER_TIMEZONE;
  process.env.SHELTER_TIMEZONE = 'UTC';
  try {
    result = await notify.notifyShiftReminder(
      { ...app, prefer_reminders: 1, quiet_hours_start: '22:00', quiet_hours_end: '08:00' },
      {},
      { now: new Date('2026-06-10T23:00:00Z') }
    );
    assert.equal(result.skipReason, 'quiet_hours');
    assert.equal(emailCalls.length, 0);
  } finally {
    if (previous === undefined) delete process.env.SHELTER_TIMEZONE;
    else process.env.SHELTER_TIMEZONE = previous;
  }
});

test('urgent cover skips quiet-hours recipients', async () => {
  reset();
  setEmail(true);
  const previous = process.env.SHELTER_TIMEZONE;
  process.env.SHELTER_TIMEZONE = 'UTC';
  try {
    const result = await notify.notifyUrgentCover({
      recipients: [
        { user_id: 1, email: 'a@example.com', first_name: 'Ann', quiet_hours_start: '22:00', quiet_hours_end: '08:00' },
        { user_id: 2, email: 'b@example.com', first_name: 'Ben' },
      ],
      opportunity: { id: 3, title: 'Walk', location: 'Yard' },
      subject: 'Cover needed',
      whenLabel: '2026-06-11',
      now: new Date('2026-06-10T23:00:00Z'),
    });
    assert.equal(result.skippedQuiet, 1);
    assert.equal(result.email.sent, 1);
    assert.deepEqual(pushCalls[0][0], [2]);
  } finally {
    if (previous === undefined) delete process.env.SHELTER_TIMEZONE;
    else process.env.SHELTER_TIMEZONE = previous;
  }
});
