'use strict';

/**
 * Public sitemap.xml and robots.txt (SL-LATER-24).
 * Sitemap lists platform public pages plus active shelter home and
 * opportunity boards only. Suspended shelters are omitted.
 */

const { pool } = require('../config/database');
const { runWithoutShelter } = require('../utils/shelterContext');
const {
  publicOrigin,
  buildSitemapXml,
  sitemapUrlsForShelters,
  buildRobotsTxt,
} = require('../utils/seo');

async function listActiveShelters() {
  const [rows] = await runWithoutShelter(() => pool.execute(
    `SELECT slug, name
       FROM shelters
      WHERE status = 'active'
        AND slug IS NOT NULL
      ORDER BY slug`
  ));
  return rows || [];
}

async function getSitemap(req, res) {
  try {
    const origin = publicOrigin();
    const shelters = await listActiveShelters();
    const urls = sitemapUrlsForShelters(shelters, origin);
    const xml = buildSitemapXml(urls);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(xml);
  } catch (error) {
    console.error('[SEO] getSitemap error:', error.message);
    return res.status(500).type('text/plain').send('Internal server error');
  }
}

function getRobots(req, res) {
  const body = buildRobotsTxt(publicOrigin());
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(body);
}

module.exports = {
  listActiveShelters,
  getSitemap,
  getRobots,
};
