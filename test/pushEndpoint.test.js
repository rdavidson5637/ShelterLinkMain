'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'BPublicTestKeyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'PrivateTestKeyXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const mock = require('./helpers/mockDb');
const { pushTestLimiter } = require('../middleware/rateLimiter');

delete require.cache[require.resolve('../utils/pushService')];
const pushService = require('../utils/pushService');
pushService.resetConfigCache();

const pushCtrl = require('../controllers/pushController');

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

test('pushTestLimiter is exported with max 3', () => {
  assert.equal(pushTestLimiter.max, 3);
});

test('test endpoint requires auth', async () => {
  const res = makeRes();
  await pushCtrl.sendTest({ session: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('test endpoint returns 409 with no subscriptions and ignores prefs', async () => {
  const sent = [];
  const webPushPath = require.resolve('web-push');
  require.cache[webPushPath] = {
    id: webPushPath,
    filename: webPushPath,
    loaded: true,
    exports: {
      setVapidDetails() {},
      sendNotification: async (sub, body, options) => {
        sent.push({ sub, body, options });
      },
    },
  };
  pushService.resetConfigCache();
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  await pushCtrl.sendTest({ session: { userId: 5 } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /No device/);

  mock.setHandler(async () => [[
    {
      user_id: 5,
      endpoint: 'https://push.example/1',
      p256dh: 'x',
      auth: 'y',
      prefer_urgent: 0,
      prefer_reminders: 0,
      prefer_threads: 0,
      prefer_fosters: 0,
    },
  ]]);
  const ok = makeRes();
  await pushCtrl.sendTest({ session: { userId: 5 } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(sent.length, 1);
  delete require.cache[webPushPath];
  pushService.resetConfigCache();
});

test('sendToUsers passes TTL urgency and topic per category and deletes 410', async () => {
  const sent = [];
  const webPushPath = require.resolve('web-push');
  require.cache[webPushPath] = {
    id: webPushPath,
    filename: webPushPath,
    loaded: true,
    exports: {
      setVapidDetails() {},
      sendNotification: async (sub, body, options) => {
        sent.push({ endpoint: sub.endpoint, options });
        if (sub.endpoint.endsWith('/gone')) {
          const err = new Error('gone');
          err.statusCode = 410;
          throw err;
        }
      },
    },
  };
  pushService.resetConfigCache();
  mock.setHandler(async (sql) => {
    if (/DELETE FROM push_subscriptions/.test(sql)) return [{ affectedRows: 1 }];
    return [[
      {
        user_id: 1,
        endpoint: 'https://push.example/ok',
        p256dh: 'x',
        auth: 'y',
        prefer_urgent: 1,
        prefer_reminders: 1,
        prefer_threads: 1,
        prefer_fosters: 1,
      },
      {
        user_id: 2,
        endpoint: 'https://push.example/gone',
        p256dh: 'x',
        auth: 'y',
        prefer_urgent: 1,
        prefer_reminders: 1,
        prefer_threads: 1,
        prefer_fosters: 1,
      },
    ]];
  });

  await pushService.sendToUsers([1, 2], { title: 'A', tag: 'urgent-9' }, { category: 'urgent' });
  assert.equal(sent[0].options.TTL, 3600);
  assert.equal(sent[0].options.urgency, 'high');
  assert.equal(sent[0].options.topic, 'urgent-9');

  sent.length = 0;
  await pushService.sendToUsers([1], { title: 'R', tag: 'reminder-1' }, { category: 'reminders' });
  assert.equal(sent[0].options.TTL, 6 * 3600);
  assert.equal(sent[0].options.urgency, 'normal');

  sent.length = 0;
  await pushService.sendToUsers([1], { title: 'T', tag: 'thread-1' }, { category: 'threads' });
  assert.equal(sent[0].options.TTL, 24 * 3600);
  assert.equal(sent[0].options.urgency, 'low');

  mock.resetCalls();
  await pushService.sendToUsers([1, 2], { title: 'A', tag: 'urgent-9' }, { category: 'urgent' });
  assert.ok(mock.calls.some((c) => /DELETE FROM push_subscriptions/.test(c.sql)));

  delete require.cache[webPushPath];
  pushService.resetConfigCache();
});
