'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const mock = require('./helpers/mockDb');

// Fresh module each preference test via resetConfigCache.
const pushService = require('../utils/pushService');
pushService.resetConfigCache();

test('pushService.isConfigured is false without VAPID keys', () => {
  pushService.resetConfigCache();
  assert.equal(pushService.isConfigured(), false);
  assert.equal(pushService.getPublicKey(), null);
});

test('sendToUsers no-ops gracefully when keys missing', async () => {
  pushService.resetConfigCache();
  mock.resetCalls();
  const result = await pushService.sendToUsers([1, 2], { title: 'Hi' }, { category: 'urgent' });
  assert.equal(result.configured, false);
  assert.equal(result.sent, 0);
  assert.equal(mock.calls.length, 0);
});

test('prefersCategory respects defaults and preference flags', () => {
  assert.equal(pushService.prefersCategory({}, 'urgent'), true);
  assert.equal(pushService.prefersCategory({}, 'reminders'), true);
  assert.equal(pushService.prefersCategory({}, 'threads'), false);
  assert.equal(pushService.prefersCategory({}, 'fosters'), false);
  assert.equal(pushService.prefersCategory({ prefer_urgent: 0 }, 'urgent'), false);
  assert.equal(pushService.prefersCategory({ prefer_threads: 1 }, 'threads'), true);
});

test('sendToUsers skips subscribers who opted out of category', async () => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'BPublicTestKeyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'PrivateTestKeyXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  pushService.resetConfigCache();

  // Stub web-push before send loads it.
  const webPushPath = require.resolve('web-push');
  const sent = [];
  require.cache[webPushPath] = {
    id: webPushPath,
    filename: webPushPath,
    loaded: true,
    exports: {
      setVapidDetails() {},
      sendNotification: async (sub, body) => {
        sent.push({ endpoint: sub.endpoint, body });
      },
    },
  };

  mock.resetCalls();
  mock.setHandler(async () => [[
    {
      user_id: 1,
      endpoint: 'https://push.example/1',
      p256dh: 'x',
      auth: 'y',
      prefer_urgent: 0,
      prefer_reminders: 1,
      prefer_threads: 0,
      prefer_fosters: 0,
    },
    {
      user_id: 2,
      endpoint: 'https://push.example/2',
      p256dh: 'x',
      auth: 'y',
      prefer_urgent: 1,
      prefer_reminders: 1,
      prefer_threads: 0,
      prefer_fosters: 0,
    },
  ]]);

  const result = await pushService.sendToUsers([1, 2], { title: 'Cover' }, { category: 'urgent' });
  assert.equal(result.configured, true);
  assert.equal(result.skipped, 1);
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].endpoint, 'https://push.example/2');

  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  pushService.resetConfigCache();
  delete require.cache[webPushPath];
});
