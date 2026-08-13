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
    sendEmail: async (...args) => { emailCalls.push(args); },
  },
};

const AdminMessage = require('../models/AdminMessage');
const msgCtrl = require('../controllers/messageController');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test('resolveRecipients builds skill filter alone', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /vp\.skills LIKE \?/i);
    assert.deepStrictEqual(params, ['%dogs%']);
    return [[{ user_id: 1, email: 'a@x.com' }]];
  });
  const rows = await AdminMessage.resolveRecipients({ skill: 'dogs' });
  assert.strictEqual(rows.length, 1);
});

test('resolveRecipients combines profile status and min hours', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /COALESCE\(vp\.approved, 0\) = 1/i);
    assert.match(sql, /HAVING/i);
    assert.deepStrictEqual(params, [10]);
    return [[]];
  });
  await AdminMessage.resolveRecipients({ profileStatus: 'approved', minApprovedHours: 10 });
});

test('resolveRecipients opportunity filter alone', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /EXISTS/i);
    assert.deepStrictEqual(params, [42]);
    return [[{ user_id: 2, email: 'b@x.com' }]];
  });
  await AdminMessage.resolveRecipients({ opportunityId: 42 });
});

test('sendBulkMessage refuses empty recipient set', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  await msgCtrl.sendBulkMessage(
    {
      session: { userId: 1, role: 'admin' },
      body: { subject: 'Hi', body: 'Hello', filter: { skill: 'cats' } },
    },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(emailCalls.length, 0);
});

test('sendBulkMessage writes log row and sends individually', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users u/i.test(sql)) {
      return [[
        { user_id: 2, email: 'a@x.com', first_name: 'A', last_name: 'One' },
        { user_id: 3, email: 'b@x.com', first_name: 'B', last_name: 'Two' },
      ]];
    }
    if (/INSERT INTO admin_messages/i.test(sql)) return [{ insertId: 9 }];
    if (/FROM admin_messages WHERE id/i.test(sql)) {
      return [[{ id: 9, subject: 'Hello', recipient_count: 2 }]];
    }
    return [[]];
  });

  const res = makeRes();
  await msgCtrl.sendBulkMessage(
    {
      session: { userId: 1, role: 'admin' },
      body: { subject: 'Hello', body: 'Body text', filter: {} },
    },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.sent, 2);
  assert.strictEqual(emailCalls.length, 2);
  assert.strictEqual(emailCalls[0][0], 'a@x.com');
  assert.strictEqual(emailCalls[1][0], 'b@x.com');
  assert.ok(mock.calls.some((c) => /INSERT INTO admin_messages/i.test(c.sql)));
});
