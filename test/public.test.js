'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const publicCtrl = require('../controllers/publicController');

function makeRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

test('public endpoint hides admin fields and closed/past shifts', async () => {
  publicCtrl._resetCacheForTests();
  mock.resetCalls();
  mock.setHandler(async () => [[
    {
      opportunity_id: 1,
      id: 1,
      title: 'Open future',
      description: 'Walk dogs',
      location: 'Yard',
      start_date: '2099-01-01 10:00:00',
      end_date: '2099-01-01 12:00:00',
      max_volunteers: 4,
      spots_filled: 1,
      status: 'open',
      check_in_code: 'SECRET',
    },
    {
      opportunity_id: 2,
      id: 2,
      title: 'Past',
      start_date: '2020-01-01',
      status: 'open',
      check_in_code: 'X',
      max_volunteers: 2,
      spots_filled: 0,
    },
  ]]);

  const res = makeRes();
  await publicCtrl.listPublicOpportunities({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.length, 1);
  assert.strictEqual(res.body[0].title, 'Open future');
  assert.strictEqual(res.body[0].spots_remaining, 3);
  assert.strictEqual(res.body[0].check_in_code, undefined);
});

test('ics output has basic VCALENDAR structure and escapes text', () => {
  const ics = publicCtrl.buildVCalendar([
    {
      uid: '1@test',
      start: '20260101T100000Z',
      end: '20260101T120000Z',
      summary: 'Dogs, cats; walk\nline',
      description: 'Hello, world',
      location: 'Main, Yard',
    },
  ]);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /END:VEVENT/);
  assert.match(ics, /END:VCALENDAR/);
  assert.match(ics, /SUMMARY:Dogs\\, cats\\; walk\\nline/);
});

test('my-shifts feed requires token and wrong token 404s', async () => {
  mock.resetCalls();
  mock.setHandler(async () => [[]]);

  const missing = makeRes();
  await publicCtrl.myShiftsIcs({ query: {} }, missing);
  assert.strictEqual(missing.statusCode, 404);

  const wrong = makeRes();
  await publicCtrl.myShiftsIcs({ query: { token: 'nope' } }, wrong);
  assert.strictEqual(wrong.statusCode, 404);
});
