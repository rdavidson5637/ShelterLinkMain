'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { siteOrigin, buildRobotsTxt, buildSitemapXml } = require('../utils/seo');
const { getBranding, applyBrandingTokens, escapeHtml } = require('../utils/branding');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const router = express.Router();

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(buildRobotsTxt());
});

router.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(buildSitemapXml());
});

// Web app manifest with this deployment's description and theme colour.
// Same URL as the static file, so the install flow is unchanged.
const manifestSource = path.join(FRONTEND, 'public', 'manifest.webmanifest');
router.get('/public/manifest.webmanifest', (req, res, next) => {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestSource, 'utf8'));
  } catch (_) {
    return next();
  }
  const b = getBranding();
  manifest.description = `Volunteer shifts and hours for ${b.name}`;
  manifest.theme_color = b.primaryColour;
  res.set('Cache-Control', 'no-cache');
  return res.type('application/manifest+json').send(JSON.stringify(manifest, null, 2));
});

// HTML pages are templates. Tokens (%%APP_URL%%, %%SHELTER_NAME%% ...) are
// filled from APP_URL and the SHELTER_* env vars, and two <meta> tags carry the
// name to client scripts (the CSP blocks inline scripts). Rendered once per
// file per configuration and cached.
const pageCache = new Map();

function renderPage(absFile) {
  const origin = siteOrigin();
  const branding = getBranding();
  const key = `${origin}|${JSON.stringify(branding)}|${absFile}`;
  if (!pageCache.has(key)) {
    let html = fs.readFileSync(absFile, 'utf8');
    html = html.split('%%APP_URL%%').join(origin);
    html = applyBrandingTokens(html, branding);
    const metas =
      `    <meta name="shelter-name" content="${escapeHtml(branding.name)}" />\n` +
      `    <meta name="shelter-short-name" content="${escapeHtml(branding.shortName)}" />\n`;
    html = html.includes('</head>') ? html.replace('</head>', `${metas}  </head>`) : html;
    pageCache.set(key, html);
  }
  return pageCache.get(key);
}

router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let reqPath = req.path === '/' ? '/index.html' : req.path;
  if (!reqPath.endsWith('.html')) return next();
  try {
    reqPath = decodeURIComponent(reqPath);
  } catch (_) {
    return next();
  }
  const abs = path.normalize(path.join(FRONTEND, reqPath));
  if (!abs.startsWith(FRONTEND + path.sep) || !fs.existsSync(abs)) return next();
  res.set('Cache-Control', 'no-cache');
  return res.type('html').send(renderPage(abs));
});

module.exports = router;
