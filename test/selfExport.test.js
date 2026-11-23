'use strict';

/**
 * SL-DAY-09: volunteer self-serve data export.
 * Reuses Gdpr.buildVolunteerExport; session userId only (no cross-tenant download).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

delete require.cache[require.resolve('../utils/simpleZip')];
delete require.cache[require.resolve('../models/Gdpr')];
delete require.cache[require.resolve('../controllers/gdprController')];
delete require.cache[require.resolve('../routes/profile')];

const { zipSingleFile, crc32 } = require('../utils/simpleZip');
const Gdpr = require('../models/Gdpr');
const {
  exportMyData,
  exportVolunteerGdpr,
} = require('../controllers/gdprController');

const ROOT = path.join(__dirname, '..');

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
    session: { userId: 4, role: 'volunteer' },
    body: {},
    params: {},
    query: {},
    method: 'GET',
    originalUrl: '/api/volunteer/data-export',
    ...overrides,
  };
}

function mockVolunteerExportQueries(userId = 4) {
  mock.setHandler(async (sql, params) => {
    if (/INSERT INTO audit_log/i.test(sql)) {
      return [{ insertId: 1 }];
    }
    if (/FROM users WHERE user_id/i.test(sql)) {
      assert.strictEqual(Number(params[0]), userId);
      return [
        [
          {
            user_id: userId,
            first_name: 'Vera',
            last_name: 'Volunteer',
            name: 'Vera Volunteer',
            phone: '07000000000',
            email: 'vera@example.com',
            role: 'volunteer',
            created_at: '2026-01-01',
            last_login: null,
            anonymised_at: null,
          },
        ],
      ];
    }
    if (/FROM applications/i.test(sql)) {
      return [[{ application_id: 10, user_id: userId, status: 'approved', opportunity_title: 'Kennels' }]];
    }
    if (/FROM volunteer_hours/i.test(sql)) {
      return [[{ record_id: 1, user_id: userId, hours: 2, approved: 1, opportunity_title: 'Kennels' }]];
    }
    if (/FROM messages WHERE user_id/i.test(sql)) {
      return [[{ id: 1, thread_id: 1, body: 'Hello', created_at: '2026-02-01' }]];
    }
    if (/FROM volunteer_profiles/i.test(sql)) {
      return [[{ user_id: userId, skills: 'dogs' }]];
    }
    return [[]];
  });
}

test('zipSingleFile builds a readable store-only archive', () => {
  const body = Buffer.from('{"ok":true}', 'utf8');
  const zip = zipSingleFile('data.json', body);
  assert.ok(zip.length > body.length);
  assert.strictEqual(zip.readUInt32LE(0), 0x04034b50);
  assert.strictEqual(crc32(body), crc32(Buffer.from('{"ok":true}')));
  // Local header filename + payload contain the JSON.
  assert.ok(zip.includes(Buffer.from('data.json')));
  assert.ok(zip.includes(body));
});

test('exportMyData returns JSON for the session volunteer only', async () => {
  mock.resetCalls();
  mockVolunteerExportQueries(4);

  const res = makeRes();
  await exportMyData(
    makeReq({
      session: { userId: 4, role: 'volunteer' },
      // Attempt to request another volunteer — must be ignored.
      query: { userId: '2', format: 'json' },
      params: { userId: '2' },
      body: { userId: 2 },
    }),
    res
  );

  assert.strictEqual(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /json/i);
  assert.match(res.headers['Content-Disposition'], /my-shelterlink-data-.*\.json/);
  const payload = JSON.parse(res.body);
  assert.strictEqual(payload.user.user_id, 4);
  assert.strictEqual(payload.user.email, 'vera@example.com');
  assert.ok(Array.isArray(payload.applications));
  assert.ok(Array.isArray(payload.hours));
  assert.ok(Array.isArray(payload.messages));
  assert.ok(payload.exported_at);
});

test('exportMyData ZIP wraps the same JSON payload', async () => {
  mock.resetCalls();
  mockVolunteerExportQueries(4);

  const res = makeRes();
  await exportMyData(makeReq({ query: { format: 'zip' } }), res);

  assert.strictEqual(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /zip/i);
  assert.match(res.headers['Content-Disposition'], /\.zip/);
  assert.ok(Buffer.isBuffer(res.body) || typeof res.body === 'string' || res.body instanceof Uint8Array);
  const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50);
  assert.ok(buf.includes(Buffer.from('vera@example.com')));
});

test('exportMyData 401 without session', async () => {
  const res = makeRes();
  await exportMyData(makeReq({ session: {} }), res);
  assert.strictEqual(res.statusCode, 401);
});

test('exportMyData 400 for non-volunteer session role via buildVolunteerExport', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users WHERE user_id/i.test(sql)) {
      return [[{ user_id: 9, email: 'staff@example.com', role: 'staff' }]];
    }
    return [[]];
  });
  const res = makeRes();
  await exportMyData(makeReq({ session: { userId: 9, role: 'staff' } }), res);
  assert.strictEqual(res.statusCode, 400);
});

test('staff still cannot call admin GDPR export for another volunteer', async () => {
  const res = makeRes();
  await exportVolunteerGdpr(
    makeReq({ session: { userId: 9, role: 'staff' }, params: { userId: '2' } }),
    res
  );
  assert.strictEqual(res.statusCode, 403);
});

test('admin GDPR export 404 when volunteer is outside tenant (RLS empty)', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/FROM users WHERE user_id/i.test(sql)) {
      return [[]];
    }
    return [[]];
  });
  const res = makeRes();
  await exportVolunteerGdpr(
    makeReq({ session: { userId: 1, role: 'admin' }, params: { userId: '2' } }),
    res
  );
  assert.strictEqual(res.statusCode, 404);
});

test('volunteer route and UI wire data-export without a second GDPR builder', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'routes/profile.js'), 'utf8');
  assert.match(routes, /\/data-export/);
  assert.match(routes, /exportMyData/);

  const controller = fs.readFileSync(path.join(ROOT, 'controllers/gdprController.js'), 'utf8');
  assert.match(controller, /exportMyData/);
  assert.match(controller, /buildVolunteerExport/);
  assert.match(controller, /gdpr\.export\.self/);

  const gdprModel = fs.readFileSync(path.join(ROOT, 'models/Gdpr.js'), 'utf8');
  const builders = gdprModel.match(/async function build\w*Export/g) || [];
  assert.strictEqual(builders.length, 1, 'must reuse the single GDPR export builder');

  const dashHtml = fs.readFileSync(path.join(ROOT, 'frontend/pages/volunteer/dashboard.html'), 'utf8');
  assert.match(dashHtml, /exportMyDataButton|exportMyDataJsonButton/);
  assert.match(dashHtml, /Download my data|Your data/);

  const profileHtml = fs.readFileSync(path.join(ROOT, 'frontend/pages/volunteer/complete-profile.html'), 'utf8');
  assert.match(profileHtml, /id="my-data"/);
  assert.match(profileHtml, /exportMyDataJsonButton/);

  const dashJs = fs.readFileSync(path.join(ROOT, 'frontend/js/volunteer/dashboard.js'), 'utf8');
  assert.match(dashJs, /\/volunteer\/data-export/);

  const profileJs = fs.readFileSync(path.join(ROOT, 'frontend/js/volunteer/complete-profile.js'), 'utf8');
  assert.match(profileJs, /\/volunteer\/data-export/);

  const tenant = fs.readFileSync(path.join(ROOT, 'test/tenantIsolation.run.js'), 'utf8');
  assert.match(tenant, /\/api\/volunteer\/data-export/);
  assert.match(tenant, /b\.volunteer@example\.test/);
  assert.match(tenant, /self-export leaked shelter A data|self-export/);
});

test('buildVolunteerExport includes profile, bookings (applications), hours, messages', async () => {
  mock.resetCalls();
  mockVolunteerExportQueries(4);
  const payload = await Gdpr.buildVolunteerExport(4);
  assert.ok(payload.profile);
  assert.ok(payload.applications.length >= 1);
  assert.ok(payload.hours.length >= 1);
  assert.ok(payload.messages.length >= 1);
  assert.strictEqual(payload.hours_approved_total, 2);
});
