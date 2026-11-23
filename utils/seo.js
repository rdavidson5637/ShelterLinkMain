'use strict';

/**
 * Public discoverability helpers (SL-LATER-24, SL-DAY-23).
 * Titles, meta, Open Graph, JSON-LD, sitemap, and robots for approved
 * (active) shelter pages only.
 *
 * JSON-LD uses real shelter and open-shift rows only: NGO (Organization)
 * for the charity, plus VolunteerAction nodes for each upcoming open shift
 * on the open-shifts page. No invented towns, phones, or addresses.
 */

const DEFAULT_ORIGIN = 'https://shelterlink.online';
const DEFAULT_OG_IMAGE_PATH = '/public/icons/apple-touch-icon.png';
/** Cap opportunity nodes so a busy board cannot balloon the HTML head. */
const MAX_OPPORTUNITY_JSON_LD = 40;

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

/**
 * Wall-clock DB timestamps stay as local ISO-like strings (no invented Z).
 * Matches the public ICS approach: never shift by server timezone.
 */
function toSchemaDateTime(value) {
  const str = String(value == null ? '' : value).trim();
  if (!str) return null;
  const m = str.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss] = m;
  if (hh == null) return `${y}-${mo}-${d}`;
  return `${y}-${mo}-${d}T${hh}:${mi}:${ss || '00'}`;
}

function organizationJsonLd({
  name,
  url,
  logo,
  email,
  charityNumber,
  charityRegisterName,
}) {
  const org = {
    // ShelterLink hosts animal charities: NGO is the precise type; keep
    // Organization in the list so consumers that only know the parent still match.
    '@type': ['Organization', 'NGO'],
    name: String(name || '').trim(),
    url: String(url || '').trim(),
  };
  if (logo) org.logo = String(logo);
  const mail = email != null ? String(email).trim() : '';
  if (mail) org.email = mail;
  const number = charityNumber != null ? String(charityNumber).trim() : '';
  if (number) org.identifier = number;
  const registerName =
    charityRegisterName != null ? String(charityRegisterName).trim() : '';
  if (registerName && registerName !== org.name) org.alternateName = registerName;
  return org;
}

function orgRefFrom(org) {
  const ref = {
    '@type': ['Organization', 'NGO'],
    name: org.name,
    url: org.url,
  };
  if (org.identifier) ref.identifier = org.identifier;
  return ref;
}

function volunteerActionJsonLd({ name, url, organization }) {
  return {
    '@type': 'VolunteerAction',
    name: `Volunteer at ${String(name || '').trim()}`,
    url: String(url || '').trim(),
    agent: organization,
  };
}

/**
 * One volunteering opportunity from a real open-shift row. Only fields that
 * exist on the opportunity (and the shelter NGO) are set.
 */
function volunteerOpportunityJsonLd({ opportunity, url, organization }) {
  const title = String((opportunity && opportunity.title) || '').trim();
  if (!title) return null;
  const node = {
    '@type': 'VolunteerAction',
    name: title,
    url: String(url || '').trim(),
    agent: organization,
  };
  const description =
    opportunity.description != null ? String(opportunity.description).trim() : '';
  if (description) node.description = description;
  const location =
    opportunity.location != null ? String(opportunity.location).trim() : '';
  if (location) {
    node.location = { '@type': 'Place', name: location };
  }
  const start = toSchemaDateTime(opportunity.start_date);
  if (start) node.startTime = start;
  const end = toSchemaDateTime(opportunity.end_date);
  if (end) node.endTime = end;
  const id = opportunity.id || opportunity.opportunity_id;
  if (id != null && Number.isFinite(Number(id))) {
    node.identifier = String(Number(id));
  }
  return node;
}

function shelterJsonLdGraph(meta, opportunities = []) {
  const org = organizationJsonLd({
    name: meta.name,
    url: meta.canonical,
    logo: meta.image,
    email: meta.email,
    charityNumber: meta.charityNumber,
    charityRegisterName: meta.charityRegisterName,
  });
  const origin = publicOriginFromMeta(meta);
  const actionUrl = meta.slug
    ? absoluteUrl(`/s/${meta.slug}/opportunities`, origin)
    : meta.canonical;
  const orgRef = orgRefFrom(org);
  const graph = [
    org,
    volunteerActionJsonLd({
      name: meta.name,
      url: actionUrl,
      organization: orgRef,
    }),
  ];

  const rows = Array.isArray(opportunities) ? opportunities : [];
  for (const opp of rows.slice(0, MAX_OPPORTUNITY_JSON_LD)) {
    const node = volunteerOpportunityJsonLd({
      opportunity: opp,
      url: actionUrl,
      organization: orgRef,
    });
    if (node) graph.push(node);
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
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
 *
 * `opportunities` is an optional list of real open-shift rows (title,
 * description, location, start_date, end_date). Only used for JSON-LD.
 */
function injectSeoIntoHtml(html, meta, opportunities = []) {
  const source = String(html || '');
  const jsonLd = shelterJsonLdGraph(meta, opportunities);
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
    '/pages/accessibility.html',
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
    'Allow: /pages/accessibility.html',
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
  MAX_OPPORTUNITY_JSON_LD,
  escapeHtml,
  escapeXml,
  publicOrigin,
  absoluteUrl,
  pageMeta,
  toSchemaDateTime,
  organizationJsonLd,
  volunteerActionJsonLd,
  volunteerOpportunityJsonLd,
  shelterJsonLdGraph,
  buildSeoHeadTags,
  injectSeoIntoHtml,
  buildSitemapXml,
  sitemapUrlsForShelters,
  buildRobotsTxt,
};
