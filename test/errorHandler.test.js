'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { errorHandler } = require('../middleware/errorHandler');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test('production errors hide SQL and include a request id', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const res = makeRes();
  try {
    errorHandler(
      Object.assign(new Error('SELECT password FROM users WHERE email = ada@example.com'), { status: 500 }),
      { id: 'req-1' },
      res,
      () => {}
    );
  } finally {
    process.env.NODE_ENV = previous;
  }
  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(res.body.error, 'Internal server error.');
  assert.strictEqual(res.body.requestId, 'req-1');
  assert.doesNotMatch(JSON.stringify(res.body), /SELECT|ada@example.com/);
});

test('robots.txt allows the public pages and blocks the API', () => {
  const text = fs.readFileSync(path.join(__dirname, '../frontend/robots.txt'), 'utf8');
  assert.match(text, /Allow: \/pages\/opportunities.html/);
  assert.match(text, /Allow: \/pages\/group-booking.html/);
  assert.match(text, /Disallow: \/api\//);
  assert.match(text, /Disallow: \/pages\/admin\//);
  assert.match(text, /Disallow: \/reset-password.html/);
  assert.doesNotMatch(text, /Disallow: \/register.html/);
});
