'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mock = require('./helpers/mockDb');
const hoursCtrl = require('../controllers/hoursController');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function makeReq() {
  return { session: { userId: 2 }, body: { opportunityId: 1, date: today(), hours: 2 } };
}
function withApplications(apps) {
  mock.setHandler(async (sql) => {
    if (/FROM applications a/i.test(sql)) return [apps.map((a) => ({ ...a, id: 1, application_id: 1 }))];
    if (/INSERT INTO volunteer_hours/i.test(sql)) return [{ insertId: 3 }];
    if (/FROM\s+volunteer_hours/i.test(sql)) return [[{ record_id: 3, hours: 2 }]];
    return [[]];
  });
}

test('REGRESSION: approved application allows logging hours', async () => {
  withApplications([{ opportunity_id: 1, status: 'approved' }]);
  const res = makeRes();
  await hoursCtrl.logHours(makeReq(), res);
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body));
});

test('accepted application allows logging hours', async () => {
  withApplications([{ opportunity_id: 1, status: 'accepted' }]);
  const res = makeRes();
  await hoursCtrl.logHours(makeReq(), res);
  assert.strictEqual(res.statusCode, 201);
});

test('only a pending application is not enough (403)', async () => {
  withApplications([{ opportunity_id: 1, status: 'pending' }]);
  const res = makeRes();
  await hoursCtrl.logHours(makeReq(), res);
  assert.strictEqual(res.statusCode, 403);
});

test('no application for that opportunity is rejected (403)', async () => {
  withApplications([{ opportunity_id: 99, status: 'accepted' }]);
  const res = makeRes();
  await hoursCtrl.logHours(makeReq(), res);
  assert.strictEqual(res.statusCode, 403);
});

test('future date is rejected (400)', async () => {
  withApplications([{ opportunity_id: 1, status: 'accepted' }]);
  const req = makeReq();
  const d = new Date(); d.setFullYear(d.getFullYear() + 1);
  req.body.date = d.toISOString().slice(0, 10);
  const res = makeRes();
  await hoursCtrl.logHours(req, res);
  assert.strictEqual(res.statusCode, 400);
});
