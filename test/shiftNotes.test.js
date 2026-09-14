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
    sendShiftNoteUpdate: async (...args) => {
      emailCalls.push(args);
      return { messageId: 'test' };
    },
  },
};

delete require.cache[require.resolve('../models/ShiftNote')];
delete require.cache[require.resolve('../models/Opportunity')];
delete require.cache[require.resolve('../models/Application')];
delete require.cache[require.resolve('../controllers/shiftNoteController')];

const ShiftNote = require('../models/ShiftNote');
const {
  listNotes,
  createNote,
  deleteNote,
} = require('../controllers/shiftNoteController');

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

test('create note inserts and returns mapped row', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/INSERT INTO shift_notes/i.test(sql)) return [{ insertId: 9 }];
    if (/FROM shift_notes/i.test(sql) && /WHERE sn\.id/i.test(sql)) {
      return [[
        {
          id: 9,
          opportunity_id: 3,
          author_id: 1,
          body: 'Bring wellies',
          notify: 1,
          created_at: '2026-08-26 10:00:00',
          author_first_name: 'Ada',
          author_last_name: 'Admin',
          author_name: 'Ada Admin',
        },
      ]];
    }
    return [[]];
  });

  const note = await ShiftNote.create({
    opportunityId: 3,
    authorId: 1,
    body: 'Bring wellies',
    notify: 1,
  });
  assert.strictEqual(note.id, 9);
  assert.strictEqual(note.body, 'Bring wellies');
  assert.strictEqual(note.notify, 1);
});

test('createNote emails accepted volunteers only when notify=1', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities/i.test(sql) && /opportunity_id = \?/i.test(sql)) {
      return [[
        {
          opportunity_id: 5,
          id: 5,
          title: 'Dog walk',
          start_date: '2026-09-01 09:00:00',
          status: 'open',
        },
      ]];
    }
    if (/INSERT INTO shift_notes/i.test(sql)) return [{ insertId: 11 }];
    if (/FROM shift_notes/i.test(sql) && /WHERE sn\.id/i.test(sql)) {
      return [[
        {
          id: 11,
          opportunity_id: 5,
          author_id: 1,
          body: 'Meet at gate',
          notify: 1,
          created_at: '2026-08-26 11:00:00',
          author_name: 'Staff',
        },
      ]];
    }
    if (/FROM applications/i.test(sql)) {
      return [[
        { application_id: 1, status: 'accepted', email: 'ok@x.com' },
        { application_id: 2, status: 'pending', email: 'pending@x.com' },
        { application_id: 3, status: 'waitlisted', email: 'wait@x.com' },
        { application_id: 4, status: 'cancelled', email: 'cancel@x.com' },
        { application_id: 5, status: 'approved', email: 'ok2@x.com' },
      ]];
    }
    return [[]];
  });

  const res = makeRes();
  await createNote(
    {
      session: { userId: 1, role: 'staff' },
      params: { id: '5' },
      body: { body: 'Meet at gate', notify: true },
    },
    res
  );
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(emailCalls.length, 2);
  assert.deepStrictEqual(
    emailCalls.map((c) => c[0]).sort(),
    ['ok2@x.com', 'ok@x.com']
  );
});

test('createNote without notify does not email', async () => {
  emailCalls.length = 0;
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 5, id: 5, title: 'Walk', start_date: '2026-09-01', status: 'open' }]];
    }
    if (/INSERT INTO shift_notes/i.test(sql)) return [{ insertId: 12 }];
    if (/FROM shift_notes/i.test(sql)) {
      return [[{ id: 12, opportunity_id: 5, author_id: 1, body: 'Hi', notify: 0, created_at: null, author_name: 'S' }]];
    }
    return [[]];
  });

  const res = makeRes();
  await createNote(
    {
      session: { userId: 1, role: 'admin' },
      params: { id: '5' },
      body: { body: 'Hi', notify: false },
    },
    res
  );
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(emailCalls.length, 0);
});

test('listNotes forbids volunteers who have not applied', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 5, id: 5, title: 'Walk', status: 'open' }]];
    }
    if (/FROM applications/i.test(sql)) return [[]];
    return [[]];
  });

  const res = makeRes();
  await listNotes(
    { session: { userId: 9, role: 'volunteer' }, params: { id: '5' } },
    res
  );
  assert.strictEqual(res.statusCode, 403);
});

test('listNotes hides internal notes from volunteers on the shift', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 5, id: 5, title: 'Walk', status: 'open' }]];
    }
    if (/FROM applications/i.test(sql)) {
      return [[{ application_id: 3, status: 'accepted' }]];
    }
    if (/FROM shift_notes/i.test(sql)) {
      return [[
        {
          id: 1,
          opportunity_id: 5,
          author_id: 1,
          body: 'Internal',
          notify: 0,
          created_at: '2026-08-26',
          author_name: 'Ada',
        },
        {
          id: 2,
          opportunity_id: 5,
          author_id: 1,
          body: 'Bring wellies',
          notify: 1,
          created_at: '2026-08-26',
          author_name: 'Ada',
        },
      ]];
    }
    return [[]];
  });

  const res = makeRes();
  await listNotes(
    { session: { userId: 9, role: 'volunteer' }, params: { id: '5' } },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.length, 1);
  assert.strictEqual(res.body[0].body, 'Bring wellies');
});

test('listNotes returns all notes for staff', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM opportunities/i.test(sql)) {
      return [[{ opportunity_id: 5, id: 5, title: 'Walk', status: 'open' }]];
    }
    if (/FROM shift_notes/i.test(sql)) {
      return [[
        {
          id: 1,
          opportunity_id: 5,
          author_id: 1,
          body: 'Internal',
          notify: 0,
          created_at: '2026-08-26',
          author_name: 'Ada',
        },
      ]];
    }
    return [[]];
  });

  const res = makeRes();
  await listNotes(
    { session: { userId: 1, role: 'admin' }, params: { id: '5' } },
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.length, 1);
  assert.strictEqual(res.body[0].body, 'Internal');
});

test('deleteNote rejects non-admin', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);
  const res = makeRes();
  await deleteNote(
    {
      session: { userId: 2, role: 'staff' },
      params: { id: '5', noteId: '1' },
    },
    res
  );
  assert.strictEqual(res.statusCode, 403);
});

test('deleteNote removes for admin', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM shift_notes/i.test(sql) && /WHERE sn\.id/i.test(sql)) {
      return [[
        {
          id: 1,
          opportunity_id: 5,
          author_id: 1,
          body: 'x',
          notify: 0,
          created_at: null,
          author_name: 'A',
        },
      ]];
    }
    if (/DELETE FROM shift_notes/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });

  const res = makeRes();
  await deleteNote(
    {
      session: { userId: 1, role: 'admin' },
      params: { id: '5', noteId: '1' },
    },
    res
  );
  assert.strictEqual(res.statusCode, 200);
});
