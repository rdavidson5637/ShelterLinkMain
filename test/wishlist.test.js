'use strict';

// SL-DAY-18: staff supplies wishlist (name, quantity, priority, note) on the
// public shelter page with an updated_on date. No payments or donation flow.
// Email only elsewhere; no SMS.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

for (const mod of [
  '../models/ShelterWishlistItem',
  '../controllers/wishlistController',
  '../middleware/auth',
]) {
  const resolved = require.resolve(mod);
  delete require.cache[resolved];
}

const ShelterWishlistItem = require('../models/ShelterWishlistItem');
const {
  listWishlist,
  createWishlistItem,
  archiveWishlistItem,
  listPublicWishlist,
} = require('../controllers/wishlistController');
const { TENANT_TABLES, runWithShelter } = require('../utils/shelterContext');

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/073_shelter_wishlist.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const SETUP_DB = fs.readFileSync(path.join(ROOT, 'scripts/setup-db.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ROUTES = fs.readFileSync(path.join(ROOT, 'routes/wishlist.js'), 'utf8');
const PUBLIC_ROUTES = fs.readFileSync(path.join(ROOT, 'routes/public.js'), 'utf8');
const AUDIT = fs.readFileSync(path.join(ROOT, 'middleware/auditLog.js'), 'utf8');
const BODIES = fs.readFileSync(path.join(ROOT, 'validation/bodies.js'), 'utf8');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'utils/notify/index.js'), 'utf8');
const SMS = fs.readFileSync(path.join(ROOT, 'utils/notify/smsProvider.js'), 'utf8');
const ADMIN_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/wishlist.html'),
  'utf8'
);
const ADMIN_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/admin/wishlist.js'), 'utf8');
const HOME_HTML = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
const PUBLIC_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/public/wishlist.js'), 'utf8');
const NAV = fs.readFileSync(path.join(ROOT, 'frontend/js/components/navConfig.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'frontend/public/css/custom.css'), 'utf8');

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

function makeReq(overrides = {}) {
  return {
    session: { userId: 5, role: 'staff' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/wishlist',
    headers: {},
    get: () => undefined,
    ...overrides,
  };
}

test('migration 073 creates shelter_wishlist_items with tenant isolation', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS shelter_wishlist_items/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /tenant_isolation/);
  assert.match(MIGRATION, /assert_same_shelter/);
  assert.match(MIGRATION, /priority IN \('high', 'medium', 'low'\)/);
  assert.match(MIGRATION, /quantity >= 1/);
  assert.match(MIGRATION, /archived_at/);
  assert.match(SCHEMA, /CREATE TABLE shelter_wishlist_items/);
  assert.match(SCHEMA, /DROP TABLE IF EXISTS[\s\S]*shelter_wishlist_items/);
  assert.match(SETUP_DB, /073_shelter_wishlist\.pg\.sql/);
  assert.ok(TENANT_TABLES.includes('shelter_wishlist_items'));
});

test('routes, audit, validation; no payments, email-only stack, no SMS', () => {
  assert.match(SERVER, /\/api\/wishlist/);
  assert.match(ROUTES, /requireStaff/);
  assert.match(ROUTES, /\/:id\/archive/);
  assert.match(PUBLIC_ROUTES, /\/wishlist/);
  assert.match(PUBLIC_ROUTES, /listPublicWishlist/);
  assert.match(BODIES, /shelterWishlistCreate/);
  assert.match(BODIES, /shelterWishlistUpdate/);
  assert.match(BODIES, /shelterWishlist/);
  assert.match(AUDIT, /wishlist\.create/);
  assert.match(AUDIT, /wishlist\.archive/);
  assert.match(AUDIT, /wishlist\.update/);
  assert.doesNotMatch(ROUTES, /stripe|paypal|checkout|twilio/i);
  assert.doesNotMatch(ADMIN_JS, /stripe|paypal|checkout|twilio/i);
  assert.doesNotMatch(PUBLIC_JS, /stripe|paypal|checkout|twilio/i);
  assert.doesNotMatch(NOTIFY, /wishlist|Wishlist/);
  assert.match(SMS, /disabled|switched off|never/i);
});

test('UI: staff page and public home ruled list; no emoji or gradient blobs', () => {
  assert.match(ADMIN_HTML, /Supplies wishlist/);
  assert.match(ADMIN_HTML, /wishlistForm/);
  assert.match(ADMIN_HTML, /Priority/);
  assert.match(ADMIN_JS, /\/wishlist\/\$\{id\}\/archive/);
  assert.match(ADMIN_JS, /Remove from list/);
  assert.match(NAV, /wishlist\.html/);
  assert.match(HOME_HTML, /publicWishlistSection/);
  assert.match(HOME_HTML, /Supplies needed/);
  assert.match(HOME_HTML, /public\/wishlist\.js/);
  assert.match(PUBLIC_JS, /\/api\/public\/wishlist/);
  assert.match(PUBLIC_JS, /Updated on/);
  assert.match(CSS, /SL-DAY-18/);
  assert.match(CSS, /\.wishlist-home-list\b/);
  assert.match(CSS, /\.wishlist-ruled-list\b/);
  const dayCss = CSS.slice(CSS.indexOf('/* SL-DAY-18:'));
  assert.doesNotMatch(dayCss, /🎉|😀|gradient|rounded-2xl|card-grid/i);
  assert.doesNotMatch(ADMIN_HTML, /🎉|😀/);
  assert.doesNotMatch(HOME_HTML, /🎉|😀/);
  assert.match(ADMIN_HTML, /no payment or donation checkout/i);
  assert.match(HOME_HTML, /no online payment/i);
});

test('create and list active wishlist items; archive hides from public', async () => {
  const store = { rows: [], nextId: 1 };

  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO shelter_wishlist_items/i.test(sql)) {
      const id = store.nextId++;
      const row = {
        id,
        name: params[0],
        quantity: params[1],
        priority: params[2],
        note: params[3],
        archived_at: null,
        created_by: params[4],
        created_at: '2026-11-23T10:00:00.000Z',
        updated_at: '2026-11-23T10:00:00.000Z',
      };
      store.rows.push(row);
      return [{ insertId: id }];
    }
    if (/FROM shelter_wishlist_items/i.test(sql) && /WHERE id = \?/i.test(sql)) {
      const id = Number(params[0]);
      return [store.rows.filter((r) => r.id === id)];
    }
    if (/FROM shelter_wishlist_items/i.test(sql) && /archived_at IS NULL/i.test(sql)) {
      return [store.rows.filter((r) => !r.archived_at)];
    }
    if (/FROM shelter_wishlist_items/i.test(sql)) {
      return [store.rows.slice()];
    }
    if (/SET archived_at = CURRENT_TIMESTAMP/i.test(sql)) {
      const id = Number(params[0]);
      const row = store.rows.find((r) => r.id === id);
      if (row) {
        row.archived_at = '2026-11-23T12:00:00.000Z';
        row.updated_at = row.archived_at;
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    throw new Error(`Unexpected SQL in create/list test: ${sql.slice(0, 120)}`);
  });

  await runWithShelter(1, async () => {
    const createRes = makeRes();
    await createWishlistItem(
      makeReq({
        method: 'POST',
        body: {
          name: 'Dog towels',
          quantity: 12,
          priority: 'high',
          note: 'Any colour',
        },
      }),
      createRes
    );
    assert.equal(createRes.statusCode, 201);
    assert.equal(createRes.body.item.name, 'Dog towels');
    assert.equal(createRes.body.item.quantity, 12);
    assert.equal(createRes.body.item.priority, 'high');

    const listRes = makeRes();
    await listWishlist(makeReq(), listRes);
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.body.total, 1);
    assert.equal(listRes.body.updated_on, '2026-11-23');

    const archiveRes = makeRes();
    await archiveWishlistItem(
      makeReq({ method: 'POST', params: { id: String(createRes.body.item.id) } }),
      archiveRes
    );
    assert.equal(archiveRes.statusCode, 200);
    assert.ok(archiveRes.body.item.archived_at);

    const publicPayload = await ShelterWishlistItem.listPublic();
    assert.equal(publicPayload.total, 0);
    assert.equal(publicPayload.items.length, 0);
  });

  mock.resetCalls();
});

test('listPublicWishlist resolves shelter and returns public fields only', async () => {
  const item = {
    id: 3,
    name: 'Cat litter',
    quantity: 4,
    priority: 'medium',
    note: null,
    archived_at: null,
    created_by: 2,
    created_at: '2026-11-20T09:00:00.000Z',
    updated_at: '2026-11-22T15:30:00.000Z',
  };

  mock.setHandler(async (sql) => {
    if (/FROM shelter_wishlist_items/i.test(sql) && /archived_at IS NULL/i.test(sql)) {
      return [[item]];
    }
    throw new Error(`Unexpected SQL in public list test: ${sql.slice(0, 120)}`);
  });

  await runWithShelter(1, async () => {
    const res = makeRes();
    await listPublicWishlist(makeReq({ query: {} }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.updated_on, '2026-11-22');
    assert.deepEqual(res.body.items[0], {
      id: 3,
      name: 'Cat litter',
      quantity: 4,
      priority: 'medium',
      note: null,
    });
    assert.equal(res.body.items[0].archived_at, undefined);
    assert.equal(res.body.items[0].created_by, undefined);
  });

  mock.resetCalls();
});

test('validation rejects empty name and bad priority', async () => {
  mock.setHandler(async () => {
    throw new Error('should not query');
  });
  await runWithShelter(1, async () => {
    const badName = makeRes();
    await createWishlistItem(
      makeReq({ method: 'POST', body: { name: '  ', quantity: 1, priority: 'high' } }),
      badName
    );
    assert.equal(badName.statusCode, 400);

    const badPriority = makeRes();
    await createWishlistItem(
      makeReq({
        method: 'POST',
        body: { name: 'Blankets', quantity: 2, priority: 'urgent' },
      }),
      badPriority
    );
    assert.equal(badPriority.statusCode, 400);
  });
  mock.resetCalls();
});
