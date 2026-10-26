'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBody, validateQuery, positiveParam, boundQueryInput } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

function run(middleware, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve({ status: this.statusCode, body: payload });
      },
    };
    middleware(req, res, () => resolve({ status: 0, body: null, next: true }));
  });
}

test('write bodies reject unknown fields with a field error and no stack', async () => {
  const result = await run(validateBody(bodies.login), {
    body: { email: 'a@example.test', password: 'longpassword', role: 'admin' },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Invalid request data.');
  assert.ok(result.body.fields.role);
  assert.equal(result.body.stack, undefined);
});

test('login body keeps the fields the form sends', async () => {
  const req = {
    body: {
      email: 'a@example.test',
      password: 'longpassword',
      rememberMe: true,
      pushEndpoint: 'https://push.example/sub',
    },
  };
  const result = await run(validateBody(bodies.login), req);
  assert.equal(result.next, true);
  assert.equal(req.body.rememberMe, true);
});

test('numeric ids reject zero and text', async () => {
  const zero = await run(
    (req, res, next) => positiveParam('id')(req, res, next, '0'),
    {}
  );
  const word = await run(
    (req, res, next) => positiveParam('id')(req, res, next, 'abc'),
    {}
  );
  assert.equal(zero.status, 400);
  assert.equal(word.status, 400);
  assert.equal(word.body.fields.id, 'Must be a positive integer');
});

test('query keys must be plain names and values stay bounded', async () => {
  const badKey = await run(boundQueryInput, { query: { 'a.b': '1' } });
  assert.equal(badKey.status, 400);
  const long = await run(boundQueryInput, { query: { token: 'x'.repeat(2001) } });
  assert.equal(long.status, 400);
  const ok = await run(boundQueryInput, { query: { date: '2099-06-01' } });
  assert.equal(ok.next, true);
});

test('group booking rejects an unexpected field', async () => {
  const result = await run(validateBody(bodies.groupBooking), {
    body: {
      opportunity_id: 1,
      group_name: 'Year 6',
      contact_name: 'Pat',
      contact_email: 'pat@example.test',
      size: 8,
      role: 'admin',
    },
  });
  assert.equal(result.status, 400);
  assert.ok(result.body.fields.role);
});

test('admin dashboard applications query (status and limit) passes validation', async () => {
  const req = { query: { limit: '5' } };
  const result = await run(validateQuery(queries.applications), req);
  assert.equal(result.next, true);
  const both = await run(validateQuery(queries.applications), { query: { status: 'pending', limit: '5' } });
  assert.equal(both.next, true);
  const unknown = await run(validateQuery(queries.applications), { query: { page: '2' } });
  assert.equal(unknown.status, 400);
});
