'use strict';

// SL-LATER-18: GET /healthz reports app+DB health without secrets.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'healthz-test-only-not-a-real-secret';

const mock = require('./helpers/mockDb');
const { app } = require('../server');

const SECRETISH =
  /\b(password|secret|database_url|connection[_ -]?string|api[_-]?key|bearer)\b|postgres(ql)?:\/\/|["']?access[_-]?token["']?\s*:/i;

function listen() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

async function get(server, path) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

test('/healthz returns 200 { db: true } when SELECT 1 succeeds', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/SELECT 1/i.test(sql)) return [[{ ok: 1 }]];
    return [[]];
  });

  const server = await listen();
  try {
    const res = await get(server, '/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { db: true });
    assert.equal(Object.keys(res.json).length, 1);
    assert.doesNotMatch(res.text, SECRETISH);
    assert.ok(mock.calls.some((c) => /SELECT 1/i.test(c.sql)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('/healthz returns 503 { db: false } when the DB ping fails', async () => {
  mock.resetCalls();
  mock.setHandler(async () => {
    throw new Error('simulated connection failure');
  });

  const server = await listen();
  try {
    const res = await get(server, '/healthz');
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { db: false });
    assert.doesNotMatch(res.text, SECRETISH);
    assert.doesNotMatch(res.text, /simulated connection failure/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('/healthz returns 503 { db: false } when SELECT 1 returns no rows', async () => {
  mock.resetCalls();
  mock.setHandler(async (sql) => {
    if (/SELECT 1/i.test(sql)) return [[]];
    return [[]];
  });

  const server = await listen();
  try {
    const res = await get(server, '/healthz');
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { db: false });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('/api/health stays secret-free on success and failure', async () => {
  mock.setHandler(async (sql) => {
    if (/SELECT 1/i.test(sql)) return [[{ ok: 1 }]];
    return [[]];
  });

  const server = await listen();
  try {
    const okRes = await get(server, '/api/health');
    assert.equal(okRes.status, 200);
    assert.deepEqual(okRes.json, { status: 'ok' });
    assert.doesNotMatch(okRes.text, SECRETISH);

    mock.setHandler(async () => {
      throw new Error('db boom DATABASE_URL=postgres://user:pass@host/db');
    });
    const bad = await get(server, '/api/health');
    assert.equal(bad.status, 503);
    assert.deepEqual(bad.json, { status: 'unavailable' });
    assert.doesNotMatch(bad.text, SECRETISH);
    assert.doesNotMatch(bad.text, /postgres:\/\//i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
