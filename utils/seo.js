'use strict';

/**
 * Public SEO helpers: canonical origin, robots.txt, sitemap.xml and the
 * www -> apex redirect. Everything derives from APP_URL so a second rescue
 * deployment gets its own host without code changes.
 */

// Public, indexable pages. Everything else (admin, volunteer, kiosk, API) is private.
const PUBLIC_PATHS = ['/', '/pages/opportunities.html', '/pages/privacy.html'];

const DISALLOWED_PREFIXES = [
  '/api/',
  '/pages/admin/',
  '/pages/volunteer/',
  '/kiosk.html',
  '/forgot-password.html',
  '/reset-password.html',
  '/pages/feedback.html',
];

function siteOrigin(env = process.env) {
  const raw = (env.APP_URL || '').trim();
  const fallback = `http://localhost:${env.PORT || 3000}`;
  if (!raw) return fallback;
  try {
    return new URL(raw).origin;
  } catch (_) {
    return fallback;
  }
}

function buildRobotsTxt(origin = siteOrigin()) {
  const lines = ['User-agent: *', 'Allow: /'];
  DISALLOWED_PREFIXES.forEach((p) => lines.push(`Disallow: ${p}`));
  lines.push('', `Sitemap: ${origin}/sitemap.xml`, '');
  return lines.join('\n');
}

function buildSitemapXml(origin = siteOrigin()) {
  const urls = PUBLIC_PATHS.map((p) => `  <url><loc>${origin}${p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Express middleware: send www.<apex> to the APP_URL host with a 301.
 * Only fires when APP_URL is the bare apex of the requested www host, so it
 * can never loop and never touches unrelated hosts (localhost, Railway URLs).
 */
function wwwToApex(env = process.env) {
  return function wwwToApexMiddleware(req, res, next) {
    const host = (req.hostname || '').toLowerCase();
    if (!host.startsWith('www.') || req.path === '/healthz') return next();
    let target;
    try {
      target = new URL((env.APP_URL || '').trim());
    } catch (_) {
      return next();
    }
    if (target.hostname.toLowerCase() !== host.slice(4)) return next();
    return res.redirect(301, `${target.origin}${req.originalUrl}`);
  };
}

module.exports = {
  PUBLIC_PATHS,
  DISALLOWED_PREFIXES,
  siteOrigin,
  buildRobotsTxt,
  buildSitemapXml,
  wwwToApex,
};
