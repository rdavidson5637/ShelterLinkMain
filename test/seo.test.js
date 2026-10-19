'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV = 'test';

const {
  PUBLIC_PATHS,
  siteOrigin,
  buildRobotsTxt,
  buildSitemapXml,
  wwwToApex,
} = require('../utils/seo');

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  let out;
  try {
    out = fn();
  } catch (e) {
    restore();
    throw e;
  }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
}


// fetch() ignores a custom Host header, so use http.request for host-based tests.
function request(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('siteOrigin uses APP_URL origin and ignores any path or trailing slash', () => {
  withEnv({ APP_URL: 'https://shelterlink.online/' }, () => {
    assert.equal(siteOrigin(), 'https://shelterlink.online');
  });
  withEnv({ APP_URL: 'https://shelterlink.online/some/path' }, () => {
    assert.equal(siteOrigin(), 'https://shelterlink.online');
  });
  withEnv({ APP_URL: undefined, PORT: '4000' }, () => {
    assert.equal(siteOrigin(), 'http://localhost:4000');
  });
});

test('robots.txt blocks private areas and points at the sitemap on APP_URL', () => {
  const txt = buildRobotsTxt('https://shelterlink.online');
  assert.match(txt, /User-agent: \*/);
  for (const p of ['/api/', '/pages/admin/', '/pages/volunteer/', '/kiosk.html']) {
    assert.ok(txt.includes(`Disallow: ${p}`), `missing Disallow ${p}`);
  }
  assert.ok(txt.includes('Sitemap: https://shelterlink.online/sitemap.xml'));
  assert.doesNotMatch(txt, /Disallow: \/\s*$/m);
});

test('sitemap lists only public URLs on the APP_URL host', () => {
  const xml = buildSitemapXml('https://shelterlink.online');
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(
    locs,
    PUBLIC_PATHS.map((p) => `https://shelterlink.online${p}`)
  );
  assert.ok(!xml.includes('/admin/') && !xml.includes('/api/') && !xml.includes('kiosk'));
});

test('www redirects to the apex with a 301, keeping path and query', async () => {
  const app = express();
  app.use(wwwToApex({ APP_URL: 'https://shelterlink.online' }));
  app.get('/healthz', (req, res) => res.send('ok'));
  app.get('/pages/opportunities.html', (req, res) => res.send('page'));
  const server = await listen(app);
  const port = server.address().port;
  try {
    const redirected = await request(port, '/pages/opportunities.html?x=1', 'www.shelterlink.online');
    assert.equal(redirected.status, 301);
    assert.equal(redirected.location, 'https://shelterlink.online/pages/opportunities.html?x=1');

    const apex = await request(port, '/pages/opportunities.html', 'shelterlink.online');
    assert.equal(apex.status, 200);

    const health = await request(port, '/healthz', 'www.shelterlink.online');
    assert.equal(health.status, 200);
  } finally {
    server.close();
  }
});

test('www redirect never loops or fires for unrelated hosts', async () => {
  const app = express();
  // APP_URL itself is the www host: no redirect
  app.use(wwwToApex({ APP_URL: 'https://www.example.org' }));
  app.get('/', (req, res) => res.send('ok'));
  const server = await listen(app);
  const port = server.address().port;
  try {
    assert.equal((await request(port, '/', 'www.example.org')).status, 200);
    assert.equal((await request(port, '/', 'www.other.com')).status, 200);
  } finally {
    server.close();
  }
});

test('public pages are served with absolute canonical, OG tags and a description', async () => {
  await withEnv({ APP_URL: 'https://shelterlink.online' }, async () => {
    delete require.cache[require.resolve('../routes/seo')];
    const router = require('../routes/seo');
    const app = express();
    app.use(router);
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const robots = await fetch(`${base}/robots.txt`);
      assert.equal(robots.status, 200);
      assert.match(robots.headers.get('content-type'), /text\/plain/);
      const sitemap = await fetch(`${base}/sitemap.xml`);
      assert.equal(sitemap.status, 200);
      assert.match(sitemap.headers.get('content-type'), /xml/);

      for (const p of ['/', '/index.html', '/pages/opportunities.html']) {
        const res = await fetch(`${base}${p}`);
        assert.equal(res.status, 200, p);
        const html = await res.text();
        assert.ok(!html.includes('%%APP_URL%%'), `${p} still has placeholders`);
        const desc = html.match(/<meta name="description" content="([^"]+)"/);
        assert.ok(desc, `${p} has no meta description`);
        assert.ok(desc[1].length >= 70 && desc[1].length <= 160, `${p} description length ${desc[1].length}`);
        assert.match(html, /<link rel="canonical" href="https:\/\/shelterlink\.online\//);
        assert.match(html, /property="og:image" content="https:\/\/shelterlink\.online\/public\/images\/og\.png"/);
      }
      const privacy = await (await fetch(`${base}/pages/privacy.html`)).text();
      assert.match(privacy, /<meta name="description"/);
    } finally {
      server.close();
    }
  });
});
