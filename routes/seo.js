'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { siteOrigin, buildRobotsTxt, buildSitemapXml } = require('../utils/seo');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const router = express.Router();

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(buildRobotsTxt());
});

router.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(buildSitemapXml());
});

// Public pages carry absolute URLs (canonical, og:url, og:image). The HTML has
// %%APP_URL%% placeholders that are filled from APP_URL here, so each
// deployment emits its own host. Rendered once per file and cached.
const pageCache = new Map();

function renderPage(relativeFile) {
  const origin = siteOrigin();
  const key = `${origin}|${relativeFile}`;
  if (!pageCache.has(key)) {
    const html = fs.readFileSync(path.join(FRONTEND, relativeFile), 'utf8');
    pageCache.set(key, html.split('%%APP_URL%%').join(origin));
  }
  return pageCache.get(key);
}

function servePage(relativeFile) {
  return (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(renderPage(relativeFile));
  };
}

router.get(['/', '/index.html'], servePage('index.html'));
router.get('/pages/opportunities.html', servePage('pages/opportunities.html'));
router.get('/pages/privacy.html', servePage('pages/privacy.html'));

module.exports = router;
