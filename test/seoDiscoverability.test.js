'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

process.env.NODE_ENV = 'test';

const mock = require('./helpers/mockDb');
const {
  activeShelterPage,
  _resetSlugCacheForTests,
  _clearHtmlTemplateCacheForTests,
} = require('../middleware/shelter');
const { getSitemap, getRobots } = require('../controllers/seoController');
const {
  pageMeta,
  injectSeoIntoHtml,
  buildSitemapXml,
  sitemapUrlsForShelters,
  buildRobotsTxt,
  shelterJsonLdGraph,
  publicOrigin,
} = require('../utils/seo');

const HOME = path.join(__dirname, '..', 'frontend', 'index.html');
const OPPORTUNITIES = path.join(__dirname, '..', 'frontend', 'pages', 'opportunities.html');
const NOT_FOUND = path.join(__dirname, '..', 'frontend', 'pages', 'error', '404.html');

const SHELTERS = {
  assisi: { id: 1, status: 'active', name: 'Assisi Animal Sanctuary' },
  second: { id: 2, status: 'active', name: 'Second Shelter' },
  paused: { id: 3, status: 'suspended', name: 'Paused Shelter' },
};

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function mockShelterQueries(sql, params) {
  if (/FROM shelters WHERE slug = \?/.test(sql)) {
    const row = SHELTERS[params[0]];
    return [row ? [{ id: row.id, status: row.status, name: row.name }] : []];
  }
  if (/FROM shelters\s+WHERE status = 'active'/.test(sql)) {
    return [[
      { slug: 'assisi', name: 'Assisi Animal Sanctuary' },
      { slug: 'second', name: 'Second Shelter' },
    ]];
  }
  return [[]];
}

test('pageMeta builds shelter titles and absolute canonical URLs', () => {
  const meta = pageMeta({
    pageKey: 'opportunities',
    shelterName: 'Assisi Animal Sanctuary',
    slug: 'assisi',
    origin: 'https://shelterlink.online',
  });
  assert.equal(meta.title, 'Open shifts at Assisi Animal Sanctuary - ShelterLink');
  assert.match(meta.description, /Assisi Animal Sanctuary/);
  assert.equal(meta.canonical, 'https://shelterlink.online/s/assisi/opportunities');
});

test('injectSeoIntoHtml adds Open Graph and Organization/VolunteerAction JSON-LD', () => {
  const base = fs.readFileSync(HOME, 'utf8');
  const meta = pageMeta({
    pageKey: 'home',
    shelterName: 'Second Shelter',
    slug: 'second',
    origin: 'https://shelterlink.online',
  });
  const html = injectSeoIntoHtml(base, meta);
  assert.match(html, /<title>Volunteer at Second Shelter - ShelterLink<\/title>/);
  assert.match(html, /property="og:title" content="Volunteer at Second Shelter - ShelterLink"/);
  assert.match(html, /property="og:url" content="https:\/\/shelterlink\.online\/s\/second"/);
  assert.match(html, /application\/ld\+json/);
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ldMatch);
  const graph = JSON.parse(ldMatch[1]);
  assert.equal(graph['@context'], 'https://schema.org');
  const types = graph['@graph'].map((n) => n['@type']);
  assert.ok(types.includes('Organization'));
  assert.ok(types.includes('VolunteerAction'));
  assert.equal(graph['@graph'][0].name, 'Second Shelter');
});

test('injectSeoIntoHtml escapes shelter names in tags and JSON-LD', () => {
  const meta = pageMeta({
    pageKey: 'home',
    shelterName: 'A <script>evil</script> & "Co"',
    slug: 'evil',
    origin: 'https://shelterlink.online',
  });
  const html = injectSeoIntoHtml('<html><head></head><body></body></html>', meta);
  assert.doesNotMatch(html, /<script>evil<\/script>/);
  assert.match(html, /&lt;script&gt;evil&lt;\/script&gt;/);
  const graph = shelterJsonLdGraph(meta);
  assert.equal(graph['@graph'][0].name, 'A <script>evil</script> & "Co"');
});

test('sitemap omits suspended shelters and includes active shelter pages', () => {
  const urls = sitemapUrlsForShelters(
    [
      { slug: 'assisi', name: 'Assisi' },
      { slug: 'second', name: 'Second' },
    ],
    'https://shelterlink.online'
  );
  assert.ok(urls.includes('https://shelterlink.online/'));
  assert.ok(urls.includes('https://shelterlink.online/pages/opportunities.html'));
  assert.ok(urls.includes('https://shelterlink.online/s/assisi'));
  assert.ok(urls.includes('https://shelterlink.online/s/assisi/opportunities'));
  assert.ok(urls.includes('https://shelterlink.online/s/second/opportunities'));
  assert.ok(!urls.some((u) => u.includes('/s/paused')));
  const xml = buildSitemapXml(urls, { lastmod: '2026-11-23' });
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>https:\/\/shelterlink\.online\/s\/assisi<\/loc>/);
});

test('robots.txt allows public pages, blocks the API, and points at the sitemap', () => {
  const text = buildRobotsTxt('https://shelterlink.online');
  assert.match(text, /Allow: \/pages\/opportunities\.html/);
  assert.match(text, /Disallow: \/api\//);
  assert.match(text, /Disallow: \/pages\/admin\//);
  assert.match(text, /Sitemap: https:\/\/shelterlink\.online\/sitemap\.xml/);
  assert.doesNotMatch(text, /Disallow: \/register\.html/);
});

test('static robots.txt fallback still blocks private surfaces', () => {
  const text = fs.readFileSync(path.join(__dirname, '../frontend/robots.txt'), 'utf8');
  assert.match(text, /Allow: \/pages\/opportunities\.html/);
  assert.match(text, /Disallow: \/api\//);
  assert.match(text, /Sitemap: https:\/\/shelterlink\.online\/sitemap\.xml/);
});

let pageServer;
let pageBase;
let seoServer;
let seoBase;
let prevAppUrl;

test.before(async () => {
  prevAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://shelterlink.online';
  mock.setHandler(async (sql, params) => mockShelterQueries(sql, params));

  const pages = express();
  pages.get('/s/:slug', activeShelterPage(HOME, 'home'));
  pages.get('/s/:slug/opportunities', activeShelterPage(OPPORTUNITIES, 'opportunities'));
  pages.use((req, res) => res.status(404).sendFile(NOT_FOUND));
  pageServer = await listen(pages);
  pageBase = `http://127.0.0.1:${pageServer.address().port}`;

  const seo = express();
  seo.get('/sitemap.xml', getSitemap);
  seo.get('/robots.txt', getRobots);
  seoServer = await listen(seo);
  seoBase = `http://127.0.0.1:${seoServer.address().port}`;
});

test.after(async () => {
  if (prevAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = prevAppUrl;
  await Promise.all([
    new Promise((resolve) => pageServer.close(resolve)),
    new Promise((resolve) => seoServer.close(resolve)),
  ]);
});

test.beforeEach(() => {
  _resetSlugCacheForTests();
  _clearHtmlTemplateCacheForTests();
});

test('/s/:slug HTML includes shelter SEO tags for an active shelter', async () => {
  const res = await fetch(`${pageBase}/s/second`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Volunteer at Second Shelter - ShelterLink/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /"@type":"Organization"/);
  assert.match(html, /"@type":"VolunteerAction"/);
  assert.match(html, /\/s\/second/);
});

test('/s/:slug/opportunities SEO uses the opportunities title', async () => {
  const res = await fetch(`${pageBase}/s/assisi/opportunities`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Open shifts at Assisi Animal Sanctuary - ShelterLink/);
  assert.match(html, /\/s\/assisi\/opportunities/);
});

test('/s/:slug does not serve SEO HTML for a suspended shelter', async () => {
  const res = await fetch(`${pageBase}/s/paused`);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.doesNotMatch(html, /VolunteerAction/);
  assert.doesNotMatch(html, /Paused Shelter/);
});

test('/sitemap.xml lists only active shelters', async () => {
  const res = await fetch(`${seoBase}/sitemap.xml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /xml/);
  const xml = await res.text();
  assert.match(xml, /\/s\/assisi<\/loc>/);
  assert.match(xml, /\/s\/second\/opportunities<\/loc>/);
  assert.doesNotMatch(xml, /\/s\/paused/);
});

test('/robots.txt is served with a Sitemap line', async () => {
  const res = await fetch(`${seoBase}/robots.txt`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Sitemap: https:\/\/shelterlink\.online\/sitemap\.xml/);
  assert.match(text, /Disallow: \/api\//);
});

test('publicOrigin falls back when APP_URL is missing', () => {
  const prev = process.env.APP_URL;
  delete process.env.APP_URL;
  try {
    assert.equal(publicOrigin({}), 'https://shelterlink.online');
  } finally {
    if (prev === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev;
  }
});
