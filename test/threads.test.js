'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const MessageThread = require('../models/MessageThread');
const threadCtrl = require('../controllers/threadController');
const { hasContactLeak } = require('../utils/contactPrivacy');

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

test('resolveParticipantsForOpportunity includes accepted apps and staff', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM applications/i.test(sql)) {
      return [[{ user_id: 10 }, { user_id: 11 }]];
    }
    if (/role IN \('staff', 'admin'\)/i.test(sql)) {
      return [[{ user_id: 1 }, { user_id: 2 }]];
    }
    return [[]];
  });
  const ids = await MessageThread.resolveParticipantsForOpportunity(42);
  assert.deepStrictEqual(ids.sort((a, b) => a - b), [1, 2, 10, 11]);
});

test('createOrGetForContext rejects a direct thread with no recipient', async () => {
  await assert.rejects(
    () => MessageThread.createOrGetForContext({ contextType: 'direct', contextId: null, createdBy: 1 }),
    (err) => err.status === 400 && /other participant's user id/.test(err.message)
  );
});

test('createOrGetForContext adds the recipient to a new direct thread, not just staff', async () => {
  mock.resetCalls();
  const insertedParticipants = [];
  mock.setHandler(async (sql, params) => {
    if (/FROM message_threads/i.test(sql) && /context_type = \?/i.test(sql)) {
      return [[]]; // no existing thread
    }
    if (/INSERT INTO message_threads/i.test(sql)) {
      return [{ insertId: 55 }];
    }
    if (/INSERT INTO thread_participants/i.test(sql)) {
      insertedParticipants.push(Number(params[1]));
      return [{ affectedRows: 1 }];
    }
    if (/SELECT user_id FROM users WHERE role IN/i.test(sql)) {
      return [[{ user_id: 1 }]]; // staff creator
    }
    if (/FROM message_threads WHERE id/i.test(sql)) {
      return [[{ id: 55, context_type: 'direct', context_id: 42 }]];
    }
    return [[]];
  });

  await MessageThread.createOrGetForContext({
    contextType: 'direct',
    contextId: 42,
    createdBy: 1,
    subject: 'Direct message',
  });

  // The volunteer this thread is supposed to be "direct" with must actually
  // be a participant, not just the staff creator.
  assert.ok(insertedParticipants.includes(42), 'recipient (context_id) was added');
  assert.ok(insertedParticipants.includes(1), 'creator was added');
});

test('createOrGetForContext ensures the recipient stays a participant when reusing a direct thread', async () => {
  mock.resetCalls();
  const ensured = [];
  mock.setHandler(async (sql, params) => {
    if (/FROM message_threads/i.test(sql) && /context_type = \?/i.test(sql)) {
      return [[{ id: 55, context_type: 'direct', context_id: 42 }]];
    }
    if (/INSERT INTO thread_participants/i.test(sql)) {
      ensured.push(Number(params[1]));
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const existing = await MessageThread.createOrGetForContext({
    contextType: 'direct',
    contextId: 42,
    createdBy: 1,
  });

  assert.equal(existing.id, 55);
  assert.ok(ensured.includes(42), 'recipient was (re-)ensured as a participant');
});

test('toVolunteerSafeParticipant never includes email or phone', () => {
  const safe = MessageThread.toVolunteerSafeParticipant({
    user_id: 9,
    first_name: 'Ada',
    last_name: 'Lovelace',
    role: 'volunteer',
    email: 'ada@example.com',
    phone: '07700900000',
    address: '1 Street',
    muted: 0,
    last_read_at: null,
  });
  assert.strictEqual(safe.display_name, 'Ada Lovelace');
  assert.strictEqual(safe.email, undefined);
  assert.strictEqual(safe.phone, undefined);
  assert.ok(!hasContactLeak(safe));
});

test('getThread strips contact fields for volunteers', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM message_threads WHERE id/i.test(sql)) {
      return [[{
        id: 5,
        subject: 'Shift chat',
        context_type: 'opportunity',
        context_id: 3,
        created_by: 1,
        created_at: new Date().toISOString(),
        closed_at: null,
      }]];
    }
    if (/FROM thread_participants[\s\S]*WHERE thread_id = \? AND user_id/i.test(sql)) {
      return [[{ ok: 1 }]];
    }
    if (/FROM thread_participants tp/i.test(sql) && /INNER JOIN users/i.test(sql)) {
      return [[
        {
          thread_id: 5,
          user_id: 9,
          last_read_at: null,
          muted: 0,
          first_name: 'Ada',
          last_name: 'Lovelace',
          role: 'volunteer',
          email: 'ada@secret.com',
        },
        {
          thread_id: 5,
          user_id: 1,
          last_read_at: null,
          muted: 0,
          first_name: 'Sam',
          last_name: 'Staff',
          role: 'staff',
          email: 'staff@secret.com',
        },
      ]];
    }
    if (/FROM messages m/i.test(sql) && /INNER JOIN users/i.test(sql)) {
      return [[
        {
          id: 100,
          thread_id: 5,
          user_id: 1,
          body: 'Hello team',
          created_at: new Date().toISOString(),
          deleted_at: null,
          deleted_by: null,
          first_name: 'Sam',
          last_name: 'Staff',
          role: 'staff',
        },
      ]];
    }
    if (/UPDATE thread_participants/i.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO thread_participants/i.test(sql)) return [{ insertId: 0 }];
    return [[]];
  });

  const res = makeRes();
  await threadCtrl.getThread(
    {
      session: { userId: 9, role: 'volunteer' },
      params: { id: '5' },
      user: { user_id: 9, role: 'volunteer' },
    },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.participants);
  assert.ok(!hasContactLeak(res.body));
  for (const p of res.body.participants) {
    assert.strictEqual(p.email, undefined);
  }
});

test('softDeleteMessage allows volunteer own message within 15 minutes', async () => {
  mock.resetCalls();
  const created = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  mock.setHandler(async (sql) => {
    if (/FROM messages WHERE id/i.test(sql)) {
      return [[{
        id: 7,
        thread_id: 1,
        user_id: 9,
        body: 'oops',
        created_at: created,
        deleted_at: null,
        deleted_by: null,
      }]];
    }
    if (/UPDATE messages/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  const updated = await MessageThread.softDeleteMessage(7, 9, { isStaff: false });
  assert.ok(updated);
  assert.ok(mock.calls.some((c) => /UPDATE messages/i.test(c.sql)));
});

test('softDeleteMessage rejects volunteer deleting another user message', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM messages WHERE id/i.test(sql)) {
      return [[{
        id: 7,
        thread_id: 1,
        user_id: 2,
        body: 'nope',
        created_at: new Date().toISOString(),
        deleted_at: null,
        deleted_by: null,
      }]];
    }
    return [[]];
  });
  await assert.rejects(
    () => MessageThread.softDeleteMessage(7, 9, { isStaff: false }),
    /only delete your own/i
  );
});

test('softDeleteMessage rejects volunteer after 15 minutes', async () => {
  mock.resetCalls();
  const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  mock.setHandler(async (sql) => {
    if (/FROM messages WHERE id/i.test(sql)) {
      return [[{
        id: 7,
        thread_id: 1,
        user_id: 9,
        body: 'late',
        created_at: old,
        deleted_at: null,
        deleted_by: null,
      }]];
    }
    return [[]];
  });
  await assert.rejects(
    () => MessageThread.softDeleteMessage(7, 9, { isStaff: false }),
    /15 minutes/i
  );
});

test('softDeleteMessage allows staff to delete any message', async () => {
  mock.resetCalls();
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  mock.setHandler(async (sql) => {
    if (/FROM messages WHERE id/i.test(sql)) {
      return [[{
        id: 7,
        thread_id: 1,
        user_id: 9,
        body: 'remove me',
        created_at: old,
        deleted_at: null,
        deleted_by: null,
      }]];
    }
    if (/UPDATE messages/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  await MessageThread.softDeleteMessage(7, 1, { isStaff: true });
  assert.ok(mock.calls.some((c) => /UPDATE messages[\s\S]*deleted_at/i.test(c.sql)));
});

test('unreadCountForUser counts messages after last_read_at excluding own', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    assert.match(sql, /COUNT\(\*\)/i);
    assert.deepStrictEqual(params, [9, 9]);
    return [[{ cnt: 3 }]];
  });
  const count = await MessageThread.unreadCountForUser(9, { isStaff: false });
  assert.strictEqual(count, 3);
});

test('addMessage rejects bodies over 2000 characters', async () => {
  await assert.rejects(
    () => MessageThread.addMessage(1, 2, 'x'.repeat(2001)),
    /2000/
  );
});
