'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const { shelterIdFromSlug, _resetSlugCacheForTests } = require('../middleware/shelter');

const PAGE = path.join(__dirname, '..', 'frontend', 'pages', 'opportunities.html');
const NOT_FOUND = path.join(__dirname, '..', 'frontend', 'pages', 'error', '404.html');
const SLUGS = { assisi: 1, second: 2 };

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let server;
let base;

test.before(async () => {
  mock.setHandler(async (sql, params) => {
    if (/FROM shelters WHERE slug = \?/.test(sql)) {
      const id = SLUGS[params[0]];
      return [id ? [{ id }] : []];
    }
    return [[]];
  });

  const app = express();
  // Same fail-closed gate as /s/:slug and /join/:slug on main.
  app.get('/s/:slug/opportunities', async (req, res, next) => {
    try {
      const id = await shelterIdFromSlug(req.params.slug);
      if (!id) return next();
      return res.sendFile(PAGE);
    } catch (error) {
      return next(error);
    }
  });
  app.use((req, res) => res.status(404).sendFile(NOT_FOUND));

  server = await listen(app);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test.beforeEach(() => {
  _resetSlugCacheForTests();
});

test('/s/:slug/opportunities serves the page for a known slug', async () => {
  const res = await fetch(`${base}/s/second/opportunities`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Browse upcoming opportunities/);
});

test('/s/:slug/opportunities is the 404 page for an unknown slug', async () => {
  const res = await fetch(`${base}/s/nowhere/opportunities`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /Page not found|404/i);
});
