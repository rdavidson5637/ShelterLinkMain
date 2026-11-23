'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

delete require.cache[require.resolve('../middleware/auth')];
delete require.cache[require.resolve('../middleware/platformOwner')];
delete require.cache[require.resolve('../utils/shelterContext')];
delete require.cache[require.resolve('../models/AuditLog')];
delete require.cache[require.resolve('../controllers/gdprController')];

const AuditLog = require('../models/AuditLog');
const platformOwner = require('../middleware/platformOwner');
const shelterContext = require('../utils/shelterContext');
const {
  listAuditLog,
  exportAuditLogCsv,
} = require('../controllers/gdprController');

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
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
  res.send = (b) => {
    res.body = b;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 1, role: 'admin' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/admin/audit-log',
    ...overrides,
  };
}

test('AuditLog.findAll returns rows, total, limit and offset', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/COUNT\(\*\)/i.test(sql)) return [[{ total: 3 }]];
    return [[
      {
        id: 9,
        user_id: 1,
        shelter_id: 1,
        action: 'hours.approve',
        entity_type: 'hours',
        entity_id: '15',
        detail_json: '{"ok":true}',
        created_at: '2026-11-23T10:00:00.000Z',
        actor_email: 'a@example.test',
        actor_first_name: 'Ada',
        actor_last_name: 'Admin',
        actor_role: 'admin',
        shelter_name: 'Assisi',
        shelter_slug: 'assisi',
      },
    ]];
  });

  const page = await AuditLog.findAll({ limit: 50, offset: 0 });
  assert.equal(page.total, 3);
  assert.equal(page.limit, 50);
  assert.equal(page.offset, 0);
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].action, 'hours.approve');
  assert.deepEqual(page.rows[0].detail_json, { ok: true });
  assert.match(mock.calls[0].sql, /COUNT\(\*\)/i);
  assert.match(mock.calls[1].sql, /LEFT JOIN shelters/i);
});

test('listAuditLog returns paginated tenant-scoped payload for shelter admin', async () => {
  const originalOwner = platformOwner.isPlatformOwnerUser;
  const originalFindAll = AuditLog.findAll;
  platformOwner.isPlatformOwnerUser = async () => false;
  AuditLog.findAll = async () => ({
    rows: [{ id: 1, action: 'hours.approve', shelter_id: 1 }],
    total: 1,
    limit: 50,
    offset: 0,
  });

  try {
    const res = makeRes();
    await listAuditLog(makeReq({ query: { limit: '50' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.scope, 'shelter');
    assert.equal(res.body.total, 1);
    assert.equal(res.body.rows[0].action, 'hours.approve');
  } finally {
    platformOwner.isPlatformOwnerUser = originalOwner;
    AuditLog.findAll = originalFindAll;
  }
});

test('listAuditLog uses bypass so platform owners see every shelter', async () => {
  const originalOwner = platformOwner.isPlatformOwnerUser;
  const originalBypass = shelterContext.runWithoutShelter;
  const originalFindAll = AuditLog.findAll;
  let bypassed = false;
  platformOwner.isPlatformOwnerUser = async () => true;
  shelterContext.runWithoutShelter = (fn) => {
    bypassed = true;
    return fn();
  };
  AuditLog.findAll = async () => ({
    rows: [
      { id: 1, action: 'a', shelter_id: 1, shelter_name: 'One' },
      { id: 2, action: 'b', shelter_id: 2, shelter_name: 'Two' },
    ],
    total: 2,
    limit: 50,
    offset: 0,
  });

  try {
    const res = makeRes();
    await listAuditLog(makeReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(bypassed, true);
    assert.equal(res.body.scope, 'all');
    assert.equal(res.body.rows.length, 2);
  } finally {
    platformOwner.isPlatformOwnerUser = originalOwner;
    shelterContext.runWithoutShelter = originalBypass;
    AuditLog.findAll = originalFindAll;
  }
});

test('exportAuditLogCsv writes filtered CSV with formula-safe fields', async () => {
  const originalOwner = platformOwner.isPlatformOwnerUser;
  const originalFindAll = AuditLog.findAll;
  platformOwner.isPlatformOwnerUser = async () => false;
  AuditLog.findAll = async (filters) => {
    assert.equal(filters.forExport, true);
    assert.equal(filters.action, 'hours.approve');
    return {
      rows: [{
        created_at: '2026-11-23T10:00:00.000Z',
        actor_first_name: 'Ada',
        actor_last_name: 'Admin',
        actor_email: 'a@example.test',
        user_id: 1,
        action: 'hours.approve',
        entity_type: 'hours',
        entity_id: '15',
        detail_json: { method: 'PUT' },
        shelter_id: 1,
        shelter_name: 'Assisi',
      }],
      total: 1,
      limit: 10000,
      offset: 0,
    };
  };

  try {
    const res = makeRes();
    await exportAuditLogCsv(
      makeReq({ query: { action: 'hours.approve' } }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/csv');
    assert.match(res.headers['Content-Disposition'], /audit-log\.csv/);
    assert.match(String(res.body), /"when","actor","action","entity_type","entity_id","detail"/);
    assert.match(String(res.body), /hours\.approve/);
    assert.doesNotMatch(String(res.body), /"shelter_id"/);
  } finally {
    platformOwner.isPlatformOwnerUser = originalOwner;
    AuditLog.findAll = originalFindAll;
  }
});

test('exportAuditLogCsv includes shelter columns for platform owners', async () => {
  const originalOwner = platformOwner.isPlatformOwnerUser;
  const originalBypass = shelterContext.runWithoutShelter;
  const originalFindAll = AuditLog.findAll;
  platformOwner.isPlatformOwnerUser = async () => true;
  shelterContext.runWithoutShelter = (fn) => fn();
  AuditLog.findAll = async () => ({
    rows: [{
      created_at: '2026-11-23T10:00:00.000Z',
      actor_email: 'p@example.test',
      user_id: 9,
      action: 'invite.create',
      entity_type: 'invite',
      entity_id: '3',
      detail_json: '=1+1',
      shelter_id: 2,
      shelter_name: 'Second',
    }],
    total: 1,
    limit: 10000,
    offset: 0,
  });

  try {
    const res = makeRes();
    await exportAuditLogCsv(makeReq(), res);
    assert.equal(res.statusCode, 200);
    assert.match(String(res.body), /"shelter_id","shelter_name"/);
    assert.match(String(res.body), /Second/);
    assert.match(String(res.body), /'=1\+1/);
  } finally {
    platformOwner.isPlatformOwnerUser = originalOwner;
    shelterContext.runWithoutShelter = originalBypass;
    AuditLog.findAll = originalFindAll;
  }
});

test('staff cannot list or export the audit log', async () => {
  let res = makeRes();
  await listAuditLog(makeReq({ session: { userId: 9, role: 'staff' } }), res);
  assert.equal(res.statusCode, 403);

  res = makeRes();
  await exportAuditLogCsv(makeReq({ session: { userId: 9, role: 'staff' } }), res);
  assert.equal(res.statusCode, 403);
});
