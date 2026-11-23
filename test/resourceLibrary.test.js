'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { runWithShelter } = require('../utils/shelterContext');
const ShelterResource = require('../models/ShelterResource');
const {
  listResources,
  createLink,
  downloadResource,
} = require('../controllers/resourceLibraryController');
const { bodies } = require('../validation/bodies');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/062_shelter_resources.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const PUBLIC_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/public.js'), 'utf8');
const RESOURCE_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/resources.js'), 'utf8');
const NAV = fs.readFileSync(path.join(ROOT, 'frontend/js/components/navConfig.js'), 'utf8');
const VOL_PAGE = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/volunteer/resources.html'),
  'utf8'
);
const ADMIN_PAGE = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/resources.html'),
  'utf8'
);

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    sent: undefined,
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
    res.headers[k] = v;
  };
  res.send = (b) => {
    res.sent = b;
    return res;
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 2, role: 'staff' },
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

test('migration 062 creates shelter_resources with tenant isolation', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS shelter_resources/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /tenant_isolation/);
  assert.match(MIGRATION, /assert_same_shelter/);
  assert.match(MIGRATION, /kind IN \('link', 'file'\)/);
  assert.match(SCHEMA, /CREATE TABLE shelter_resources/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*shelter_resources/);
  assert.match(SETUP_DB, /062_shelter_resources\.pg\.sql/);
});

test('resources API is authenticated and never mounted on public routes', () => {
  assert.match(SERVER, /\/api\/resources/);
  assert.match(RESOURCE_ROUTES, /isAuthenticated/);
  assert.match(RESOURCE_ROUTES, /requireStaff/);
  assert.match(RESOURCE_ROUTES, /\/links/);
  assert.match(RESOURCE_ROUTES, /\/files/);
  assert.match(RESOURCE_ROUTES, /\/:id\/download/);
  assert.doesNotMatch(PUBLIC_ROUTES, /resources/);
  assert.doesNotMatch(SERVER, /\/api\/public\/resources/);
});

test('volunteer and staff nav expose Resources pages', () => {
  assert.match(NAV, /volunteer\/resources\.html/);
  assert.match(NAV, /admin\/resources\.html/);
  assert.match(VOL_PAGE, /Resource list|Handbooks, policies/);
  assert.match(ADMIN_PAGE, /Resource library/);
});

test('shelterResource bodies validate link and update payloads', () => {
  assert.equal(
    bodies.shelterResourceLink.safeParse({
      title: 'Handbook',
      url: 'https://example.org/h',
    }).success,
    true
  );
  assert.equal(
    bodies.shelterResourceUpdate.safeParse({ active: 0 }).success,
    true
  );
  assert.equal(bodies.shelterResourceFileMeta.safeParse({ title: 'Policy' }).success, true);
});

test('normaliseTitle and normaliseUrl reject empty or unsafe values', () => {
  assert.equal(ShelterResource.normaliseTitle('  Handbook  '), 'Handbook');
  assert.throws(() => ShelterResource.normaliseTitle('   '), /title/i);
  assert.equal(
    ShelterResource.normaliseUrl('https://example.org/doc'),
    'https://example.org/doc'
  );
  assert.throws(() => ShelterResource.normaliseUrl('javascript:alert(1)'), /http/i);
  assert.throws(() => ShelterResource.normaliseUrl('not a url'), /valid/i);
});

test('createLink inserts an active link row for the bound shelter', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/COUNT\(\*\)::int AS count/.test(sql) && /shelter_resources/.test(sql)) {
      return [[{ count: 0 }]];
    }
    if (/MAX\(sort_order\)/.test(sql)) {
      return [[{ max_order: -1 }]];
    }
    if (/INSERT INTO shelter_resources/.test(sql)) {
      assert.equal(params[0], 'Volunteer handbook');
      assert.equal(params[1], 'https://example.org/handbook');
      assert.equal(params[2], 0);
      return [{ insertId: 7, affectedRows: 1 }];
    }
    if (/FROM shelter_resources/.test(sql) && /WHERE id =/.test(sql)) {
      return [[
        {
          id: 7,
          title: 'Volunteer handbook',
          kind: 'link',
          url: 'https://example.org/handbook',
          filename: null,
          original_name: null,
          mime_type: null,
          size: null,
          sort_order: 0,
          active: 1,
          created_at: '2026-11-23T00:00:00.000Z',
          updated_at: '2026-11-23T00:00:00.000Z',
        },
      ]];
    }
    return [[]];
  });

  const item = await runWithShelter(1, () =>
    ShelterResource.createLink({
      title: '  Volunteer handbook  ',
      url: 'https://example.org/handbook',
      createdBy: 2,
    })
  );
  assert.equal(item.id, 7);
  assert.equal(item.kind, 'link');
  assert.equal(item.url, 'https://example.org/handbook');
  assert.equal(item.active, true);
});

test('listResources for volunteers returns active items only', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    assert.match(sql, /WHERE active = 1/);
    assert.doesNotMatch(sql, /shelter_id\s*=/);
    return [[
      {
        id: 1,
        title: 'Policy',
        kind: 'file',
        url: null,
        filename: 'abc.pdf',
        original_name: 'policy.pdf',
        mime_type: 'application/pdf',
        size: 1200,
        sort_order: 0,
        active: 1,
        created_at: '2026-11-23T00:00:00.000Z',
        updated_at: '2026-11-23T00:00:00.000Z',
      },
    ]];
  });

  const req = makeReq({ session: { userId: 9, role: 'volunteer' }, query: {} });
  const res = makeRes();
  await runWithShelter(1, () => listResources(req, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.items[0].kind, 'file');
  assert.equal(res.body.items[0].url, null);
});

test('staff list with all=1 includes inactive without leaking storage_key', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    assert.doesNotMatch(sql, /WHERE active = 1/);
    assert.doesNotMatch(sql, /storage_key/);
    assert.doesNotMatch(sql, /\bcontent\b/);
    return [[
      {
        id: 2,
        title: 'Old link',
        kind: 'link',
        url: 'https://example.org/old',
        filename: null,
        original_name: null,
        mime_type: null,
        size: null,
        sort_order: 1,
        active: 0,
        created_at: '2026-11-23T00:00:00.000Z',
        updated_at: '2026-11-23T00:00:00.000Z',
      },
    ]];
  });

  const req = makeReq({ query: { all: '1' } });
  const res = makeRes();
  await runWithShelter(1, () => listResources(req, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items[0].active, false);
  assert.equal(res.body.items[0].url, 'https://example.org/old');
});

test('tenant isolation: list and create require shelter context', async () => {
  await assert.rejects(
    () => ShelterResource.listResources(),
    (err) => err.status === 403
  );
  await assert.rejects(
    () => ShelterResource.createLink({ title: 'x', url: 'https://example.org' }),
    (err) => err.status === 403
  );
});

test('tenant isolation: shelter A cannot read shelter B resource by id', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);

  const missing = await runWithShelter(2, () => ShelterResource.findById(99));
  assert.equal(missing, null);

  const req = makeReq({
    session: { userId: 9, role: 'volunteer' },
    params: { id: '99' },
  });
  const res = makeRes();
  await runWithShelter(2, () => downloadResource(req, res));
  assert.equal(res.statusCode, 404);
});

test('createLink controller returns 201 for staff', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql, params) => {
    if (/COUNT\(\*\)::int AS count/.test(sql)) return [[{ count: 0 }]];
    if (/MAX\(sort_order\)/.test(sql)) return [[{ max_order: 0 }]];
    if (/INSERT INTO shelter_resources/.test(sql)) {
      return [{ insertId: 3, affectedRows: 1 }];
    }
    if (/FROM shelter_resources/.test(sql) && /WHERE id =/.test(sql)) {
      assert.equal(Number(params[0]), 3);
      return [[
        {
          id: 3,
          title: 'Site map',
          kind: 'link',
          url: 'https://example.org/map',
          filename: null,
          original_name: null,
          mime_type: null,
          size: null,
          sort_order: 1,
          active: 1,
          created_at: '2026-11-23T00:00:00.000Z',
          updated_at: '2026-11-23T00:00:00.000Z',
        },
      ]];
    }
    return [[]];
  });

  const req = makeReq({
    body: { title: 'Site map', url: 'https://example.org/map' },
  });
  const res = makeRes();
  await runWithShelter(1, () => createLink(req, res));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.item.kind, 'link');
  assert.equal(res.body.item.title, 'Site map');
});

test('volunteer cannot download an inactive file', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM shelter_resources/.test(sql) && /WHERE id =/.test(sql) && !/content/.test(sql)) {
      return [[
        {
          id: 5,
          title: 'Draft policy',
          kind: 'file',
          url: null,
          filename: 'x.pdf',
          original_name: 'draft.pdf',
          mime_type: 'application/pdf',
          size: 10,
          sort_order: 0,
          active: 0,
          created_at: '2026-11-23T00:00:00.000Z',
          updated_at: '2026-11-23T00:00:00.000Z',
        },
      ]];
    }
    return [[]];
  });

  const req = makeReq({
    session: { userId: 9, role: 'volunteer' },
    params: { id: '5' },
  });
  const res = makeRes();
  await runWithShelter(1, () => downloadResource(req, res));
  assert.equal(res.statusCode, 404);
});
