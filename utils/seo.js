'use strict';

/**
 * Public discoverability helpers (SL-LATER-24).
 * Titles, meta, Open Graph, JSON-LD, sitemap, and robots for approved
 * (active) shelter pages only.
 */

const DEFAULT_ORIGIN = 'https://shelterlink.online';
const DEFAULT_OG_IMAGE_PATH = '/public/icons/apple-touch-icon.png';

const PAGE_COPY = {
  home: {
    title: (name) => `Volunteer at ${name} - ShelterLink`,
    description: (name) =>
      `Browse open volunteer shifts at ${name}, apply to help, and log your hours with ShelterLink.`,
  },
  opportunities: {
    title: (name) => `Open shifts at ${name} - ShelterLink`,
    description: (name) =>
      `Upcoming volunteer shifts at ${name}. Create a ShelterLink account to apply.`,
  },
  'group-booking': {
    title: (name) => `Group booking at ${name} - ShelterLink`,
    description: (name) =>
      `Companies and schools can request a group slot at ${name}. It is reserved only after an administrator confirms.`,
  },
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function publicOrigin(env = process.env) {
  const raw = env && env.APP_URL != null ? String(env.APP_URL).trim() : '';
  if (!raw) return DEFAULT_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_ORIGIN;
    return `${url.protocol}//${url.host}`;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function absoluteUrl(pathname, origin = publicOrigin()) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${origin.replace(/\/$/, '')}${path}`;
}

function pageMeta({ pageKey, shelterName, slug, origin = publicOrigin() }) {
  const copy = PAGE_COPY[pageKey] || PAGE_COPY.home;
  const name = String(shelterName || 'your local shelter').trim() || 'your local shelter';
  const safeSlug = String(slug || '').trim().toLowerCase();
  let path = safeSlug ? `/s/${safeSlug}` : '/';
  if (pageKey === 'opportunities') {
    path = safeSlug ? `/s/${safeSlug}/opportunities` : '/pages/opportunities.html';
  } else if (pageKey === 'group-booking') {
    path = safeSlug ? `/s/${safeSlug}/group-booking` : '/pages/group-booking.html';
  }
  const title = copy.title(name);
  const description = copy.description(name);
  const canonical = absoluteUrl(path, origin);
  const image = absoluteUrl(DEFAULT_OG_IMAGE_PATH, origin);
  return { title, description, canonical, image, path, name, slug: safeSlug || null };
}

function organizationJsonLd({ name, url, logo }) {
  const org = {
    '@type': 'Organization',
    name: String(name || '').trim(),
    url: String(url || '').trim(),
  };
  if (logo) org.logo = String(logo);
  return org;
}

function volunteerActionJsonLd({ name, url, organization }) {
  return {
    '@type': 'VolunteerAction',
    name: `Volunteer at ${String(name || '').trim()}`,
    url: String(url || '').trim(),
    agent: organization,
  };
}

function shelterJsonLdGraph(meta) {
  const org = organizationJsonLd({
    name: meta.name,
    url: meta.canonical,
    logo: meta.image,
  });
  const actionUrl = meta.slug
    ? absoluteUrl(`/s/${meta.slug}/opportunities`, publicOriginFromMeta(meta))
    : meta.canonical;
  const action = volunteerActionJsonLd({
    name: meta.name,
    url: actionUrl,
    organization: { '@type': 'Organization', name: meta.name, url: org.url },
  });
  return {
    '@context': 'https://schema.org',
    '@graph': [org, action],
  };
}

function publicOriginFromMeta(meta) {
  try {
    return new URL(meta.canonical).origin;
  } catch {
    return publicOrigin();
  }
}

/** JSON-LD lives in a script tag: keep it valid JSON, block </script> breakout. */
function safeJsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildSeoHeadTags(meta, jsonLd) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const canonical = escapeHtml(meta.canonical);
  const image = escapeHtml(meta.image);
  const json = safeJsonLd(jsonLd);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="ShelterLink" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<script type="application/ld+json">${json}</script>`,
  ].join('\n    ');
}

/**
 * Replace title/description and insert canonical, Open Graph, and JSON-LD
 * before </head>. Existing managed tags are removed first so re-injection
 * does not duplicate them.
 */
function injectSeoIntoHtml(html, meta) {
  const source = String(html || '');
  const jsonLd = shelterJsonLdGraph(meta);
  const block = buildSeoHeadTags(meta, jsonLd);

  let out = source
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '')
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, '')
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, '')
    .replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '');

  if (/<\/head>/i.test(out)) {
    return out.replace(/<\/head>/i, `    ${block}\n  </head>`);
  }
  return `${block}\n${out}`;
}

function buildSitemapXml(urls, { lastmod } = {}) {
  const date = lastmod || new Date().toISOString().slice(0, 10);
  const locs = (urls || [])
    .filter((u) => typeof u === 'string' && u.trim())
    .map((u) => u.trim());
  const unique = [...new Set(locs)];
  const body = unique
    .map(
      (loc) =>
        `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${escapeXml(date)}</lastmod>\n  </url>`
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${body}\n` +
    `</urlset>\n`
  );
}

/**
 * Static platform pages plus /s/{slug} and /s/{slug}/opportunities for each
 * active (approved) shelter. Suspended shelters are never listed.
 */
function sitemapUrlsForShelters(shelters, origin = publicOrigin()) {
  const base = [
    '/',
    '/pages/opportunities.html',
    '/pages/group-booking.html',
    '/pages/privacy.html',
    '/apply',
  ].map((p) => absoluteUrl(p, origin));

  const shelterUrls = [];
  for (const row of shelters || []) {
    const slug = String(row && row.slug ? row.slug : '').trim().toLowerCase();
    if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) continue;
    shelterUrls.push(absoluteUrl(`/s/${slug}`, origin));
    shelterUrls.push(absoluteUrl(`/s/${slug}/opportunities`, origin));
  }
  return [...base, ...shelterUrls];
}

function buildRobotsTxt(origin = publicOrigin()) {
  const sitemap = absoluteUrl('/sitemap.xml', origin);
  return [
    'User-agent: *',
    'Allow: /',
    'Allow: /pages/opportunities.html',
    'Allow: /pages/group-booking.html',
    'Allow: /pages/privacy.html',
    'Disallow: /api/',
    'Disallow: /pages/admin/',
    'Disallow: /pages/volunteer/',
    'Disallow: /kiosk',
    'Disallow: /login.html',
    'Disallow: /forgot-password.html',
    'Disallow: /reset-password.html',
    'Disallow: /pages/feedback.html',
    'Disallow: /pages/public/',
    '',
    `Sitemap: ${sitemap}`,
    '',
  ].join('\n');
}

module.exports = {
  PAGE_COPY,
  DEFAULT_ORIGIN,
  DEFAULT_OG_IMAGE_PATH,
  escapeHtml,
  escapeXml,
  publicOrigin,
  absoluteUrl,
  pageMeta,
  organizationJsonLd,
  volunteerActionJsonLd,
  shelterJsonLdGraph,
  buildSeoHeadTags,
  injectSeoIntoHtml,
  buildSitemapXml,
  sitemapUrlsForShelters,
  buildRobotsTxt,
};
