'use strict';

/**
 * Per-deployment shelter identity. Defaults are Assisi Animal Sanctuary so an
 * unconfigured deployment looks exactly like it always has. Every value is
 * validated here, so callers can drop them straight into HTML, JSON and email.
 */
const DEFAULTS = {
  name: 'Assisi Animal Sanctuary',
  shortName: 'Assisi',
  location: 'Conlig, Newtownards',
  websiteUrl: 'https://www.assisi-ni.org',
  primaryColour: '#1b5e20',
  logoUrl: '',
  charityNumber: '',
  contactEmail: '',
};

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function validColour(value) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : null;
}

function validUrl(value, { allowPath = false } = {}) {
  if (!value) return null;
  if (allowPath && value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.replace(/\/$/, '') : null;
  } catch (_) {
    return null;
  }
}

function validEmail(value) {
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value) ? value : null;
}

function getBranding(env = process.env) {
  const name = clean(env.SHELTER_NAME) || DEFAULTS.name;
  const customName = name !== DEFAULTS.name;
  return {
    name,
    // A custom name with no short name falls back to the full name, never "Assisi".
    shortName: clean(env.SHELTER_SHORT_NAME) || (customName ? name : DEFAULTS.shortName),
    location: clean(env.SHELTER_LOCATION) || (customName ? '' : DEFAULTS.location),
    websiteUrl: validUrl(clean(env.SHELTER_WEBSITE_URL)) || (customName ? '' : DEFAULTS.websiteUrl),
    primaryColour: validColour(clean(env.SHELTER_PRIMARY_COLOUR)) || DEFAULTS.primaryColour,
    logoUrl: validUrl(clean(env.SHELTER_LOGO_URL), { allowPath: true }) || DEFAULTS.logoUrl,
    charityNumber: clean(env.SHELTER_CHARITY_NUMBER),
    contactEmail: validEmail(clean(env.SHELTER_CONTACT_EMAIL)) || DEFAULTS.contactEmail,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Replace %%SHELTER_*%% tokens in an HTML string with escaped branding values. */
function applyBrandingTokens(html, branding = getBranding()) {
  const map = {
    '%%SHELTER_NAME%%': branding.name,
    '%%SHELTER_SHORT_NAME%%': branding.shortName,
    '%%SHELTER_LOCATION%%': branding.location,
    '%%SHELTER_WEBSITE_URL%%': branding.websiteUrl,
    '%%SHELTER_PRIMARY_COLOUR%%': branding.primaryColour,
    '%%SHELTER_CONTACT_EMAIL%%': branding.contactEmail,
  };
  let out = html;
  for (const [token, value] of Object.entries(map)) {
    out = out.split(token).join(escapeHtml(value));
  }
  return out;
}

/** Shelter name escaped for use inside HTML email bodies. */
function shelterNameHtml(env = process.env) {
  return escapeHtml(getBranding(env).name);
}

module.exports = {
  DEFAULTS,
  getBranding,
  escapeHtml,
  applyBrandingTokens,
  shelterNameHtml,
};
