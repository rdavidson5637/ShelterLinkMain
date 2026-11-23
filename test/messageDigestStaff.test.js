'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
delete process.env.EMAIL_HOST;
delete process.env.EMAIL_FROM;
delete process.env.EMAIL_USER;
delete process.env.EMAIL_PASS;
delete process.env.APP_URL;

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
const digestCalls = [];
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendThreadDigest: async (...args) => {
      digestCalls.push(args);
    },
  },
};

const jobLogPath = require.resolve('../utils/jobLog');
require.cache[jobLogPath] = {
  id: jobLogPath,
  filename: jobLogPath,
  loaded: true,
  exports: {
    recordJobRun: async () => 1,
  },
};

const MessageThread = require('../models/MessageThread');
const { runMessageDigest } = require('../jobs/messageDigest');
const { threadUrl } = require('../utils/pushPayloads');

function withEnv(vars, fn) {
  const prev = {};
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('threadUrl sends staff digests to the admin threads page', () => {
  assert.equal(threadUrl(null, 'staff'), '/pages/admin/threads.html');
  assert.equal(threadUrl(12, 'admin'), '/pages/admin/threads.html?thread=12');
  assert.equal(threadUrl(12, 'volunteer'), '/pages/volunteer/messages.html?thread=12');
});

test('findDigestCandidates uses volunteer participant query and staff all-threads query', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /UNION ALL/i);
    assert.match(sql, /u\.role = 'volunteer'/i);
    assert.match(sql, /u\.role IN \('staff', 'admin'\)/i);
    assert.equal(params.length, 4);
    return [[
      {
        user_id: 2,
        email: 'staff@example.com',
        first_name: 'Sam',
        role: 'staff',
        unread_count: 3,
        latest_unread_at: '2026-11-23T02:00:00.000Z',
      },
    ]];
  });

  const rows = await MessageThread.findDigestCandidates(new Date('2026-11-23T03:00:00.000Z'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'staff');
  assert.equal(rows[0].unread_count, 3);
});

test('runMessageDigest passes staff role through to sendThreadDigest', async () => {
  digestCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/digest_candidates|UNION ALL|FROM messages m/i.test(sql)) {
      return [[
        {
          user_id: 5,
          email: 'admin@example.com',
          first_name: 'Ada',
          role: 'admin',
          unread_count: 4,
        },
        {
          user_id: 9,
          email: 'vol@example.com',
          first_name: 'Val',
          role: 'volunteer',
          unread_count: 1,
        },
      ]];
    }
    return [[]];
  });

  await withEnv(
    { EMAIL_HOST: 'smtp.example.com', EMAIL_FROM: 'ShelterLink <no-reply@example.com>' },
    async () => {
      const result = await runMessageDigest({ now: new Date(Date.UTC(2026, 9, 19, 12, 0, 0)) });
      assert.equal(result.sent, 2);
    }
  );

  assert.equal(digestCalls.length, 2);
  assert.equal(digestCalls[0][0], 'admin@example.com');
  assert.equal(digestCalls[0][1].role, 'admin');
  assert.equal(digestCalls[0][1].unreadCount, 4);
  assert.equal(digestCalls[1][0], 'vol@example.com');
  assert.equal(digestCalls[1][1].role, 'volunteer');
});
