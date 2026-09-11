'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const OpportunityTemplate = require('../models/OpportunityTemplate');
const templateCtrl = require('../controllers/templateController');

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

test('OpportunityTemplate.mapRow parses payload_json', () => {
  const row = OpportunityTemplate.mapRow({
    id: 1,
    name: 'Morning dog walking',
    payload_json: '{"title":"Morning dog walking","max_volunteers":4}',
    created_by: 1,
    created_at: '2026-08-01',
  });
  assert.equal(row.name, 'Morning dog walking');
  assert.equal(row.payload.title, 'Morning dog walking');
  assert.equal(row.payload.max_volunteers, 4);
});

test('listTemplates requires staff', async () => {
  const res = makeRes();
  await templateCtrl.listTemplates({ session: { userId: 2, role: 'volunteer' } }, res);
  assert.equal(res.statusCode, 403);
});

test('createTemplate inserts payload', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/INSERT INTO opportunity_templates/i.test(sql)) {
      return [{ insertId: 3 }];
    }
    if (/FROM opportunity_templates WHERE id/i.test(sql)) {
      return [[{
        id: 3,
        name: 'Cattery care',
        payload_json: '{"title":"Cattery care"}',
        created_by: 1,
        created_at: '2026-08-26',
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await templateCtrl.createTemplate(
    {
      session: { userId: 1, role: 'admin' },
      body: { name: 'Cattery care', payload: { title: 'Cattery care' } },
    },
    res
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.name, 'Cattery care');
  assert.ok(mock.calls.some((c) => /INSERT INTO opportunity_templates/i.test(c.sql)));
});

test('saveFromOpportunityBody stores form fields as template', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/INSERT INTO opportunity_templates/i.test(sql)) {
      return [{ insertId: 7 }];
    }
    if (/FROM opportunity_templates WHERE id/i.test(sql)) {
      return [[{
        id: 7,
        name: 'Kennel deep-clean',
        payload_json: JSON.stringify({
          title: 'Kennel deep-clean',
          location: 'Kennel block',
          max_volunteers: 6,
        }),
        created_by: 1,
        created_at: '2026-08-26',
      }]];
    }
    return [[]];
  });

  const res = makeRes();
  await templateCtrl.saveFromOpportunityBody(
    {
      session: { userId: 1, role: 'staff' },
      body: {
        name: 'Kennel deep-clean',
        title: 'Kennel deep-clean',
        location: 'Kennel block',
        max_volunteers: 6,
      },
    },
    res
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.payload.location, 'Kennel block');
});
