'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('../controllers/launchController');

function makeRes() {
  const res = { statusCode: 200, location: null, headers: {} };
  res.set = (k, v) => {
    res.headers[k] = v;
    return res;
  };
  res.redirect = (code, url) => {
    res.statusCode = code;
    res.location = url;
    return res;
  };
  return res;
}

test('launch kiosk session goes to /kiosk', () => {
  const res = makeRes();
  launch({ session: { kioskMode: true, userId: 1 } }, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.location, '/kiosk');
});

test('launch with no session goes to login', () => {
  const res = makeRes();
  launch({ session: null }, res);
  assert.equal(res.location, '/login.html');
});

test('launch volunteer goes to volunteer dashboard', () => {
  const res = makeRes();
  launch({ session: { userId: 9, role: 'volunteer' } }, res);
  assert.equal(res.location, '/pages/volunteer/dashboard.html');
});

test('launch staff and admin go to admin dashboard', () => {
  const staff = makeRes();
  launch({ session: { userId: 2, role: 'staff' } }, staff);
  assert.equal(staff.location, '/pages/admin/dashboard.html');
  const admin = makeRes();
  launch({ session: { userId: 1, role: 'admin' } }, admin);
  assert.equal(admin.location, '/pages/admin/dashboard.html');
});
