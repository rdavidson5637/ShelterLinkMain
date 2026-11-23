'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { runWithShelter } = require('../utils/shelterContext');
const ShelterBrand = require('../models/ShelterBrand');
const {
  getBrandSettings,
  updateBrandSettings,
} = require('../controllers/shelterBrandController');
const { getBrand } = require('../controllers/brandController');
const { bodies } = require('../validation/bodies');
const { inferFromRequest } = require('../middleware/auditLog');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const ROOT = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'database/049_shelter_logo_storage.pg.sql'),
  'utf8'
);
const SCHEMA = fs.readFileSync(path.join(ROOT, 'database/schema.pg.sql'), 'utf8');
const ROUTES = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8');
const BRAND_JS = fs.readFileSync(path.join(ROOT, 'frontend/js/brand.js'), 'utf8');
const BRANDING_HTML = fs.readFileSync(
  path.join(ROOT, 'frontend/pages/admin/branding.html'),
  'utf8'
);

function makeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

function makeReq(overrides = {}) {
  return {
    session: { userId: 1, role: 'admin' },
    body: {},
    query: {},
    params: {},
    ...overrides,
  };
}

let shelterRow;

function handler(sql, params) {
  const text = String(sql || '').replace(/\s+/g, ' ');
  if (/FROM shelters/.test(text) && /primary_colour/.test(text) && /WHERE id = \?/.test(text)) {
    if (!shelterRow || shelterRow.id !== Number(params[0])) return [[]];
    const hasLogo = Boolean(
      (shelterRow.logo && shelterRow.logo.length)
      || shelterRow.logo_storage_key
    );
    return [[{
      name: shelterRow.name,
      slug: shelterRow.slug,
      primary_colour: shelterRow.primary_colour,
      logo_mime: shelterRow.logo_mime,
      logo_storage_key: shelterRow.logo_storage_key,
      has_logo: hasLogo,
    }]];
  }
  if (/SELECT logo, logo_mime, logo_storage_key FROM shelters WHERE id = \?/.test(text)) {
    if (!shelterRow || shelterRow.id !== Number(params[0])) return [[]];
    return [[{
      logo: shelterRow.logo,
      logo_mime: shelterRow.logo_mime,
      logo_storage_key: shelterRow.logo_storage_key,
    }]];
  }
  if (/SELECT logo_storage_key FROM shelters WHERE id = \?/.test(text)) {
    if (!shelterRow || shelterRow.id !== Number(params[0])) return [[]];
    return [[{ logo_storage_key: shelterRow.logo_storage_key }]];
  }
  if (/UPDATE shelters SET primary_colour/.test(text)) {
    if (!shelterRow || shelterRow.id !== Number(params[1])) {
      return [Object.assign([], { affectedRows: 0 })];
    }
    shelterRow.primary_colour = params[0];
    return [Object.assign([], { affectedRows: 1 })];
  }
  if (/UPDATE shelters SET logo = \?/.test(text)) {
    if (!shelterRow || shelterRow.id !== Number(params[3])) {
      return [Object.assign([], { affectedRows: 0 })];
    }
    shelterRow.logo = params[0];
    shelterRow.logo_mime = params[1];
    shelterRow.logo_storage_key = params[2];
    return [Object.assign([], { affectedRows: 1 })];
  }
  return [[]];
}

test.beforeEach(() => {
  shelterRow = {
    id: 2,
    name: 'Second Shelter',
    slug: 'second',
    primary_colour: null,
    logo: null,
    logo_mime: null,
    logo_storage_key: null,
  };
  mock.resetCalls();
  mock.setHandler(async (sql, params) => handler(sql, params));
});

test('049 adds logo_storage_key without touching primary_colour', () => {
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS logo_storage_key/);
  assert.match(MIGRATION, /uq_shelters_logo_storage_key/);
  assert.doesNotMatch(MIGRATION, /ADD COLUMN[^;]*primary_colour/i);
  assert.match(SCHEMA, /logo_storage_key TEXT/);
  assert.match(SCHEMA, /uq_shelters_logo_storage_key/);
});

test('admin brand routes are registered', () => {
  assert.match(ROUTES, /router\.get\('\/settings\/brand'/);
  assert.match(ROUTES, /router\.put\('\/settings\/brand'/);
  assert.match(ROUTES, /router\.post\(\s*'\/settings\/brand\/logo'/);
});

test('brandSettings body rejects shelter_id and bad hex', () => {
  assert.equal(bodies.brandSettings.safeParse({ primary_colour: '#0f766e' }).success, true);
  assert.equal(bodies.brandSettings.safeParse({ primary_colour: null }).success, true);
  assert.equal(bodies.brandSettings.safeParse({ primary_colour: '#fff' }).success, false);
  assert.equal(
    bodies.brandSettings.safeParse({ primary_colour: '#0f766e', shelter_id: 1 }).success,
    false
  );
});

test('setPrimaryColour stores a passing colour for the bound shelter only', async () => {
  await runWithShelter(2, () => ShelterBrand.setPrimaryColour('#0f766e'));
  assert.equal(shelterRow.primary_colour, '#0f766e');
  const update = mock.calls.find((c) => /UPDATE shelters\s+SET primary_colour/.test(c.sql));
  assert.deepEqual(update.params, ['#0f766e', 2]);
});

test('setPrimaryColour rejects low-contrast colours', async () => {
  await assert.rejects(
    () => runWithShelter(2, () => ShelterBrand.setPrimaryColour('#f5f5f5')),
    (err) => err.status === 400 && /contrast/i.test(err.message)
  );
  assert.equal(shelterRow.primary_colour, null);
});

test('updateBrandSettings clears colour back to default palette', async () => {
  shelterRow.primary_colour = '#0f766e';
  const res = makeRes();
  await runWithShelter(2, () => updateBrandSettings(
    makeReq({ body: { primary_colour: null } }),
    res
  ));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.primary_colour, null);
  assert.equal(res.body.colourTokens, null);
  assert.match(res.body.message, /default/i);
});

test('getBrand exposes colourTokens for public and volunteer CSS vars', async () => {
  shelterRow.primary_colour = '#0f766e';
  const res = makeRes();
  await runWithShelter(2, () => getBrand({}, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.primaryColour, '#0f766e');
  assert.equal(res.body.colourTokens.green, '#0f766e');
  assert.equal(res.body.name, 'Second Shelter');
});

test('getBrandSettings is scoped to the bound shelter', async () => {
  shelterRow.primary_colour = '#115e59';
  const res = makeRes();
  await runWithShelter(2, () => getBrandSettings({}, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.slug, 'second');
  assert.equal(res.body.primary_colour, '#115e59');
});

test('setLogo writes through the shelters logo columns for the bound id', async () => {
  await runWithShelter(2, () => ShelterBrand.setLogo({
    content: PNG,
    mimeType: 'image/png',
  }));
  assert.equal(shelterRow.logo_mime, 'image/png');
  assert.ok(Buffer.isBuffer(shelterRow.logo));
  const update = mock.calls.find((c) => /UPDATE shelters\s+SET logo = \?/.test(c.sql));
  assert.equal(update.params[3], 2);
});

test('brand.js applies colour tokens onto CSS custom properties', () => {
  assert.match(BRAND_JS, /colourTokens/);
  assert.match(BRAND_JS, /green: '--green'/);
  assert.match(BRAND_JS, /greenHover: '--green-hover'/);
  assert.match(BRAND_JS, /setProperty\(cssVar, value\)/);
  assert.match(BRAND_JS, /removeProperty\(cssVar\)/);
});

test('admin branding page ships under the redesign stylesheet', () => {
  assert.match(BRANDING_HTML, /href="\/public\/css\/custom\.css"/);
  assert.match(BRANDING_HTML, /class="[^"]*staff-app/);
  assert.match(BRANDING_HTML, /id="primary_colour"/);
  assert.match(BRANDING_HTML, /id="logo"/);
  assert.doesNotMatch(BRANDING_HTML, /design-pro|admin-skin/);
});

test('audit log names brand settings mutations', () => {
  assert.equal(
    inferFromRequest({ method: 'PUT', originalUrl: '/api/admin/settings/brand' }).action,
    'shelter.brand.update'
  );
  assert.equal(
    inferFromRequest({ method: 'POST', originalUrl: '/api/admin/settings/brand/logo' }).action,
    'shelter.brand.logo'
  );
});
