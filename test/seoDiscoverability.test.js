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
  organizationJsonLd,
  volunteerOpportunityJsonLd,
  toSchemaDateTime,
  publicOrigin,
} = require('../utils/seo');

function graphTypes(graph) {
  return (graph['@graph'] || []).flatMap((n) => {
    const t = n['@type'];
    return Array.isArray(t) ? t : [t];
  });
}

const HOME = path.join(__dirname, '..', 'frontend', 'index.html');
const OPPORTUNITIES = path.join(__dirname, '..', 'frontend', 'pages', 'opportunities.html');
const NOT_FOUND = path.join(__dirname, '..', 'frontend', 'pages', 'error', '404.html');

const SHELTERS = {
  assisi: {
    id: 1,
    status: 'active',
    name: 'Assisi Animal Sanctuary',
    charity_number: 'NIC123456',
    charity_register_name: 'Assisi Animal Sanctuary',
    privacy_contact_email: 'privacy@assisi.example',
  },
  second: {
    id: 2,
    status: 'active',
    name: 'Second Shelter',
    charity_number: null,
    charity_register_name: null,
    privacy_contact_email: null,
  },
  paused: {
    id: 3,
    status: 'suspended',
    name: 'Paused Shelter',
    charity_number: null,
    charity_register_name: null,
    privacy_contact_email: null,
  },
};

const OPEN_SHIFTS = [
  {
    opportunity_id: 101,
    id: 101,
    title: 'Morning dog walk',
    description: 'Walk the kennel dogs on the top field.',
    location: 'Main Kennels, Assisi Animal Sanctuary',
    start_date: '2099-06-01 09:00:00',
    end_date: '2099-06-01 11:00:00',
    status: 'open',
    is_urgent: 0,
  },
  {
    opportunity_id: 102,
    id: 102,
    title: 'Cat socialising',
    description: null,
    location: 'Cattery',
    start_date: '2099-06-02 14:00:00',
    end_date: '2099-06-02 16:00:00',
    status: 'open',
    is_urgent: 0,
  },
];

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
  if (/charity_number, charity_register_name, privacy_contact_email/.test(sql)) {
    const id = Number(params[0]);
    const row = Object.values(SHELTERS).find((s) => s.id === id);
    if (!row) return [[]];
    return [[
      {
        charity_number: row.charity_number,
        charity_register_name: row.charity_register_name,
        privacy_contact_email: row.privacy_contact_email,
      },
    ]];
  }
  if (/FROM shelters\s+WHERE status = 'active'/.test(sql)) {
    return [[
      { slug: 'assisi', name: 'Assisi Animal Sanctuary' },
      { slug: 'second', name: 'Second Shelter' },
    ]];
  }
  // Opportunity.findAll for SEO open-shifts JSON-LD
  if (/FROM opportunities/i.test(sql) && /status = \?/.test(sql)) {
    const shelterHint = params && params[0];
    // Assisi (id 1) has open shifts; others empty. The query is tenant-scoped
    // via runWithShelter; mock returns Assisi rows whenever asked.
    if (shelterHint === 'open' || params.includes('open')) {
      return [OPEN_SHIFTS];
    }
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

test('injectSeoIntoHtml adds Open Graph and Organization/NGO VolunteerAction JSON-LD', () => {
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
  const types = graphTypes(graph);
  assert.ok(types.includes('Organization'));
  assert.ok(types.includes('NGO'));
  assert.ok(types.includes('VolunteerAction'));
  assert.equal(graph['@graph'][0].name, 'Second Shelter');
});

test('organizationJsonLd is NGO with only real charity fields', () => {
  const withCharity = organizationJsonLd({
    name: 'Assisi Animal Sanctuary',
    url: 'https://shelterlink.online/s/assisi',
    email: 'privacy@assisi.example',
    charityNumber: 'NIC123456',
    charityRegisterName: 'Assisi Animal Sanctuary',
  });
  assert.deepEqual(withCharity['@type'], ['Organization', 'NGO']);
  assert.equal(withCharity.identifier, 'NIC123456');
  assert.equal(withCharity.email, 'privacy@assisi.example');
  assert.equal(withCharity.alternateName, undefined);

  const bare = organizationJsonLd({
    name: 'Second Shelter',
    url: 'https://shelterlink.online/s/second',
  });
  assert.equal(bare.identifier, undefined);
  assert.equal(bare.email, undefined);
  assert.equal(bare.telephone, undefined);
  assert.equal(bare.address, undefined);
});

test('volunteerOpportunityJsonLd shape uses real shift fields only', () => {
  const org = { '@type': ['Organization', 'NGO'], name: 'Assisi', url: 'https://example/s/assisi' };
  const node = volunteerOpportunityJsonLd({
    opportunity: OPEN_SHIFTS[0],
    url: 'https://example/s/assisi/opportunities',
    organization: org,
  });
  assert.equal(node['@type'], 'VolunteerAction');
  assert.equal(node.name, 'Morning dog walk');
  assert.equal(node.description, 'Walk the kennel dogs on the top field.');
  assert.equal(node.location['@type'], 'Place');
  assert.equal(node.location.name, 'Main Kennels, Assisi Animal Sanctuary');
  assert.equal(node.startTime, '2099-06-01T09:00:00');
  assert.equal(node.endTime, '2099-06-01T11:00:00');
  assert.equal(node.identifier, '101');
  assert.equal(node.agent.name, 'Assisi');
  assert.equal(toSchemaDateTime('2099-06-01'), '2099-06-01');
  assert.equal(volunteerOpportunityJsonLd({ opportunity: { title: '' }, url: '/', organization: org }), null);
});

test('shelterJsonLdGraph embeds open-shift VolunteerAction nodes from DB rows', () => {
  const meta = {
    ...pageMeta({
      pageKey: 'opportunities',
      shelterName: 'Assisi Animal Sanctuary',
      slug: 'assisi',
      origin: 'https://shelterlink.online',
    }),
    charityNumber: 'NIC123456',
    email: 'privacy@assisi.example',
  };
  const graph = shelterJsonLdGraph(meta, OPEN_SHIFTS);
  assert.equal(graph['@context'], 'https://schema.org');
  assert.ok(graphTypes(graph).includes('NGO'));
  const shiftNodes = graph['@graph'].filter(
    (n) => n['@type'] === 'VolunteerAction' && n.identifier
  );
  assert.equal(shiftNodes.length, 2);
  assert.equal(shiftNodes[0].name, 'Morning dog walk');
  assert.equal(shiftNodes[1].name, 'Cat socialising');
  assert.equal(shiftNodes[1].description, undefined);
  assert.equal(graph['@graph'][0].identifier, 'NIC123456');
  assert.equal(graph['@graph'][0].email, 'privacy@assisi.example');
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
  assert.ok(urls.includes('https://shelterlink.online/pages/accessibility.html'));
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
  assert.match(text, /Allow: \/pages\/accessibility\.html/);
  assert.match(text, /Disallow: \/api\//);
  assert.match(text, /Disallow: \/pages\/admin\//);
  assert.match(text, /Sitemap: https:\/\/shelterlink\.online\/sitemap\.xml/);
  assert.doesNotMatch(text, /Disallow: \/register\.html/);
});

test('static robots.txt fallback still blocks private surfaces', () => {
  const text = fs.readFileSync(path.join(__dirname, '../frontend/robots.txt'), 'utf8');
  assert.match(text, /Allow: \/pages\/opportunities\.html/);
  assert.match(text, /Allow: \/pages\/accessibility\.html/);
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
  assert.match(html, /"Organization"/);
  assert.match(html, /"NGO"/);
  assert.match(html, /"@type":"VolunteerAction"/);
  assert.match(html, /\/s\/second/);
});

test('/s/:slug/opportunities SEO includes NGO and open-shift VolunteerAction nodes', async () => {
  const res = await fetch(`${pageBase}/s/assisi/opportunities`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Open shifts at Assisi Animal Sanctuary - ShelterLink/);
  assert.match(html, /\/s\/assisi\/opportunities/);
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ldMatch);
  const graph = JSON.parse(ldMatch[1]);
  assert.equal(graph['@context'], 'https://schema.org');
  assert.ok(graphTypes(graph).includes('NGO'));
  assert.equal(graph['@graph'][0].identifier, 'NIC123456');
  assert.equal(graph['@graph'][0].email, 'privacy@assisi.example');
  const shiftNames = graph['@graph']
    .filter((n) => n['@type'] === 'VolunteerAction' && n.identifier)
    .map((n) => n.name);
  assert.deepEqual(shiftNames, ['Morning dog walk', 'Cat socialising']);
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
