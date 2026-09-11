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
    sendApplicationConfirmation: async () => {},
    sendApplicationApproval: async () => {},
    sendApplicationCancellation: async () => {},
    sendApplicationRejection: async () => {},
    sendWaitlistPromotion: async () => {},
    sendHoursApproval: async () => {},
    sendVolunteerApprovalNotification: async () => {},
    sendShiftReminder: async () => {},
  },
};

const Waiver = require('../models/Waiver');
const UserDocument = require('../models/UserDocument');
const appCtrl = require('../controllers/applicationController');
const docCtrl = require('../controllers/documentController');

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    sent: null,
    headers: {},
  };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.send = (b) => {
    res.sent = b;
    return res;
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 2, role: 'volunteer' },
    body: { opportunityId: 1 },
    params: {},
    query: {},
    ...overrides,
  };
}

test('unaccepted waiver blocks application server-side', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM\s+volunteer_profiles/i.test(sql)) {
      return [[{ user_id: 2, approved: 1, user_email: 'v@x.com' }]];
    }
    if (/FROM\s+waivers\s+w/i.test(sql) && /NOT EXISTS/i.test(sql)) {
      return [[{
        id: 5,
        title: 'Liability Waiver',
        body: 'Be careful',
        version: 1,
        active: 1,
        requires_reacceptance: 1,
        created_at: new Date(),
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await appCtrl.applyForOpportunity(makeReq(), res);
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.body.error, /must accept.*waiver/i);
  assert.match(res.body.error, /Liability Waiver/);
  assert.ok(Array.isArray(res.body.pending_waivers));
  assert.strictEqual(res.body.pending_waivers[0].id, 5);
});

test('version bump with requires_reacceptance forces re-accept', async () => {
  mock.resetCalls();
  let waiverRow = {
    id: 1,
    title: 'Liability',
    body: 'v1 text',
    version: 1,
    active: 1,
    requires_reacceptance: 1,
    created_at: new Date(),
  };

  mock.setHandler(async (sql, params) => {
    if (/FROM waivers WHERE id/i.test(sql)) {
      return [[{ ...waiverRow }]];
    }
    if (/UPDATE waivers/i.test(sql)) {
      waiverRow = {
        ...waiverRow,
        title: params[0],
        body: params[1],
        version: params[2],
        active: params[3],
        requires_reacceptance: params[4],
      };
      return [{ affectedRows: 1 }];
    }
    if (/FROM\s+waivers\s+w/i.test(sql) && /NOT EXISTS/i.test(sql)) {
      // Simulate: user accepted v1, but current is v2 with reacceptance required
      const userId = params[0];
      assert.strictEqual(userId, 2);
      if (waiverRow.version > 1 && waiverRow.requires_reacceptance) {
        return [[{ ...waiverRow }]];
      }
      return [[]];
    }
    return [[]];
  });

  const updated = await Waiver.update(1, { body: 'v2 revised text' });
  assert.strictEqual(updated.version, 2);
  assert.strictEqual(updated.body, 'v2 revised text');

  const pending = await Waiver.findPendingForUser(2);
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].version, 2);
});

test('upload rejects wrong mime type', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);

  const res = makeRes();
  const req = makeReq({
    file: {
      filename: 'abc.txt',
      originalname: 'notes.txt',
      mimetype: 'text/plain',
      size: 100,
    },
    body: {},
  });

  await docCtrl.uploadDocument(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /PDF, JPG, and PNG/i);
});

test('upload rejects oversize via multer error handler', () => {
  const res = makeRes();
  const handled = docCtrl.handleMulterError({ code: 'LIMIT_FILE_SIZE' }, res);
  assert.strictEqual(handled, true);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /5MB/i);
});

test('isAllowedMime only allows pdf/jpg/png', () => {
  assert.strictEqual(UserDocument.isAllowedMime('application/pdf'), true);
  assert.strictEqual(UserDocument.isAllowedMime('image/jpeg'), true);
  assert.strictEqual(UserDocument.isAllowedMime('image/png'), true);
  assert.strictEqual(UserDocument.isAllowedMime('text/plain'), false);
  assert.strictEqual(UserDocument.isAllowedMime('application/zip'), false);
});

test('download route enforces ownership and streams bytes from the database', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4 pretend pdf bytes');

  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/SELECT\s+content/i.test(sql) && /FROM user_documents/i.test(sql)) {
      return [[{
        content: pdfBytes,
        mime_type: 'application/pdf',
        original_name: 'id.pdf',
        filename: 'abc123.pdf',
      }]];
    }
    if (/FROM user_documents WHERE id/i.test(sql)) {
      return [[{
        id: 9,
        user_id: 2,
        filename: 'abc123.pdf',
        original_name: 'id.pdf',
        mime_type: 'application/pdf',
        size: pdfBytes.length,
        uploaded_at: new Date(),
        expires_at: null,
        label: null,
      }]];
    }
    return [[]];
  });

  // Other volunteer cannot download
  const forbiddenRes = makeRes();
  await docCtrl.downloadDocument(
    makeReq({ session: { userId: 99, role: 'volunteer' }, params: { id: 9 } }),
    forbiddenRes
  );
  assert.strictEqual(forbiddenRes.statusCode, 403);
  assert.strictEqual(forbiddenRes.sent, null);

  // Owner can download
  const ownerRes = makeRes();
  await docCtrl.downloadDocument(
    makeReq({ session: { userId: 2, role: 'volunteer' }, params: { id: 9 } }),
    ownerRes
  );
  assert.strictEqual(ownerRes.statusCode, 200);
  assert.ok(Buffer.isBuffer(ownerRes.sent));
  assert.strictEqual(ownerRes.sent.toString(), pdfBytes.toString());
  assert.strictEqual(ownerRes.headers['content-type'], 'application/pdf');
  assert.match(ownerRes.headers['content-disposition'], /filename="id\.pdf"/);

  // Admin can download
  const adminRes = makeRes();
  await docCtrl.downloadDocument(
    makeReq({ session: { userId: 1, role: 'admin' }, params: { id: 9 } }),
    adminRes
  );
  assert.ok(Buffer.isBuffer(adminRes.sent));
});

test('upload stores file content in the database', async () => {
  mock.resetCalls();
  let insertParams = null;
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO user_documents/i.test(sql)) {
      insertParams = params;
      return [{ insertId: 42 }];
    }
    if (/FROM user_documents WHERE id/i.test(sql)) {
      return [[{ id: 42, user_id: 2, filename: 'x', original_name: 'ref.pdf',
        mime_type: 'application/pdf', size: 4, uploaded_at: new Date(),
        expires_at: null, label: null }]];
    }
    return [[]];
  });

  const res = makeRes();
  await docCtrl.uploadDocument(
    makeReq({
      session: { userId: 2, role: 'volunteer' },
      file: {
        buffer: Buffer.from('%PDF'),
        originalname: 'ref.pdf',
        mimetype: 'application/pdf',
        size: 4,
      },
      body: {},
    }),
    res
  );

  assert.strictEqual(res.statusCode, 201);
  assert.ok(insertParams, 'INSERT INTO user_documents ran');
  const contentParam = insertParams.find((p) => Buffer.isBuffer(p));
  assert.ok(contentParam, 'file bytes were passed as a bind parameter');
  assert.strictEqual(contentParam.toString(), '%PDF');
});
