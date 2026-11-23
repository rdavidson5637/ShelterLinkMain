'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');

const emailPath = require.resolve('../utils/emailService');
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: new Proxy({}, { get: () => async () => {} }),
};

const Opportunity = require('../models/Opportunity');
const qr = require('../controllers/qrCheckinController');
const checkinRouter = require('../routes/checkin');
const { restrictKioskSession } = require('../middleware/auth');

function makeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.set = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  return res;
}

function localSql(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function startingSoon() {
  // Thirty minutes ahead, clamped to today so the check-in window is open.
  const d = new Date(Date.now() + 30 * 60 * 1000);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 0, 0);
  return localSql(d > endOfToday ? endOfToday : d);
}

const OPP = { opportunity_id: 7, title: 'Morning dog walks', location: 'Yard', check_in_code: 'ABC234' };

function volunteerReq(extra = {}) {
  return {
    session: { userId: 2, role: 'volunteer' },
    params: { id: 7 },
    body: {},
    protocol: 'https',
    get: () => 'example.test',
    ...extra,
  };
}

function handler({ booked = true, checkedIn = null, start = startingSoon(), code = OPP.check_in_code } = {}) {
  const updates = [];
  const fn = async (sql, params) => {
    if (/SELECT application_id\s+FROM applications\s+WHERE user_id = \?/i.test(sql)) {
      assert.deepEqual(params, [2, 7], 'lookup is scoped to the signed-in volunteer and shift');
      return [booked ? [{ application_id: 41 }] : []];
    }
    if (/UPDATE applications\s+SET checked_in_at/i.test(sql)) {
      updates.push(params);
      return [{ affectedRows: 1 }];
    }
    if (/WHERE a\.application_id = \?/i.test(sql)) {
      return [[{
        application_id: params[0],
        user_id: 2,
        opportunity_id: 7,
        status: 'accepted',
        check_in_code: code,
        opportunity_start_date: start,
        checked_in_at: updates.length ? localSql(new Date()) : checkedIn,
        checked_out_at: null,
      }]];
    }
    if (/FROM opportunities/i.test(sql)) {
      return [[{ ...OPP, start_date: start, end_date: null, check_in_code: code }]];
    }
    return [[]];
  };
  return { fn, updates };
}

test('check-in codes come from crypto, not Math.random', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Math.random must not be used for check-in codes'); };
  try {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const code = Opportunity.generateCheckInCode();
      assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      seen.add(code);
    }
    assert.ok(seen.size > 190, 'codes should not repeat in a small sample');
  } finally {
    Math.random = original;
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'models', 'Opportunity.js'), 'utf8');
  assert.equal(/Math\.random/.test(src), false);
});

test('poster URL keeps the code in the fragment, not the query string', () => {
  const url = new URL(qr.buildCheckInUrl('https://shelterlink.example', 7, 'ABC234'));
  assert.equal(url.pathname, '/pages/volunteer/checkin.html');
  assert.equal(url.searchParams.get('shift'), '7');
  assert.equal(url.search.includes('ABC234'), false);
  assert.equal(url.hash, '#code=ABC234');
});

test('poster origin prefers APP_URL over the request Host header', () => {
  const prev = process.env.APP_URL;
  process.env.APP_URL = 'https://app.shelterlink.example/some/path';
  try {
    assert.equal(qr.appOrigin({ protocol: 'http', get: () => 'evil.test' }), 'https://app.shelterlink.example');
    process.env.APP_URL = '';
    assert.equal(qr.appOrigin({ protocol: 'https', get: () => 'host.test' }), 'https://host.test');
  } finally {
    if (prev === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev;
  }
});

test('status shows not_booked when the volunteer has no confirmed place', async () => {
  mock.resetCalls();
  mock.setHandler(handler({ booked: false }).fn);
  const res = makeRes();
  await qr.getShiftCheckInStatus(volunteerReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, 'not_booked');
  assert.equal(res.body.within_window, true);
  assert.equal('check_in_code' in res.body, false, 'status must not reveal the code');
});

test('status shows ready for a booked volunteer', async () => {
  mock.resetCalls();
  mock.setHandler(handler().fn);
  const res = makeRes();
  await qr.getShiftCheckInStatus(volunteerReq(), res);
  assert.equal(res.body.state, 'ready');
  assert.equal(res.body.title, 'Morning dog walks');
});

test('QR check-in checks in the volunteer\'s own application with the poster code', async () => {
  mock.resetCalls();
  const h = handler();
  mock.setHandler(h.fn);
  const res = makeRes();
  await qr.qrCheckIn(volunteerReq({ body: { code: 'abc234' } }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0][1], 41, 'updates the application found for this volunteer');
});

test('QR check-in rejects a wrong code', async () => {
  mock.resetCalls();
  const h = handler();
  mock.setHandler(h.fn);
  const res = makeRes();
  await qr.qrCheckIn(volunteerReq({ body: { code: 'ZZZZZZ' } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Incorrect check-in code/);
  assert.equal(h.updates.length, 0);
});

test('QR check-in refuses a volunteer who is not booked', async () => {
  mock.resetCalls();
  const h = handler({ booked: false });
  mock.setHandler(h.fn);
  const res = makeRes();
  await qr.qrCheckIn(volunteerReq({ body: { code: 'ABC234' } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(h.updates.length, 0);
});

test('QR check-in keeps the existing time window', async () => {
  mock.resetCalls();
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const h = handler({ start: localSql(future) });
  mock.setHandler(h.fn);
  const res = makeRes();
  await qr.qrCheckIn(volunteerReq({ body: { code: 'ABC234' } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /1 hour before/);
});

test('QR check-out refuses before check-in', async () => {
  mock.resetCalls();
  mock.setHandler(handler().fn);
  const res = makeRes();
  await qr.qrCheckOut(volunteerReq({ body: { code: 'ABC234' } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Check in before checking out/);
});

test('unauthenticated QR calls get 401', async () => {
  for (const fn of [qr.getShiftCheckInStatus, qr.qrCheckIn, qr.qrCheckOut]) {
    const res = makeRes();
    await fn(volunteerReq({ session: {} }), res);
    assert.equal(res.statusCode, 401);
  }
});

test('poster returns details and an SVG QR code for staff', async () => {
  mock.resetCalls();
  mock.setHandler(handler().fn);
  const prev = process.env.APP_URL;
  process.env.APP_URL = 'https://app.shelterlink.example';
  try {
    const res = makeRes();
    await qr.getCheckInPoster(volunteerReq({ session: { userId: 1, role: 'staff' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.check_in_code, 'ABC234');
    assert.equal(res.body.check_in_url, 'https://app.shelterlink.example/pages/volunteer/checkin.html?shift=7#code=ABC234');
    assert.equal(res.headers['cache-control'], 'no-store');

    const svgRes = makeRes();
    await qr.getCheckInPosterQr(volunteerReq({ session: { userId: 1, role: 'staff' } }), svgRes);
    assert.equal(svgRes.statusCode, 200);
    assert.match(svgRes.headers['content-type'], /image\/svg\+xml/);
    assert.match(String(svgRes.body), /^<svg[^>]+viewBox=/);
  } finally {
    if (prev === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev;
  }
});

test('poster is 409 when the shift has no check-in code', async () => {
  mock.resetCalls();
  mock.setHandler(handler({ code: null }).fn);
  const res = makeRes();
  await qr.getCheckInPoster(volunteerReq(), res);
  assert.equal(res.statusCode, 409);
});

test('poster routes require staff; volunteer routes require sign-in', () => {
  const routes = checkinRouter.stack.filter((l) => l.route).map((l) => ({
    path: l.route.path,
    names: l.route.stack.map((s) => s.handle.name),
  }));
  for (const r of routes) {
    assert.ok(r.names.includes('isAuthenticated'), `${r.path} needs isAuthenticated`);
    if (r.path.startsWith('/poster')) {
      assert.ok(r.names.includes('requireRoleMiddleware'), `${r.path} needs requireStaff`);
    }
  }
  assert.equal(routes.length, 5);
});

test('kiosk sessions cannot reach poster check-in endpoints', () => {
  const res = makeRes();
  let nextCalled = false;
  restrictKioskSession({ session: { kioskMode: true, userId: 1 }, path: '/checkin/shifts/7' }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('check-in page strips the code from the address bar and login returns to it', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'volunteer', 'checkin.js'), 'utf8');
  assert.match(page, /history\.replaceState/);
  const login = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'login.js'), 'utf8');
  assert.match(login, /pendingCheckinPath\(\)/);
  const helper = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'utils', 'pendingCheckin.js'), 'utf8');
  assert.match(helper, /const PAGE = '\/pages\/volunteer\/checkin\.html'/);
  assert.match(helper, /`\$\{PAGE\}\?shift=\$\{shift\}`/);
});
