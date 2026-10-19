/**
 * Shelter identity for client scripts. The server fills these meta tags into
 * every HTML page from SHELTER_NAME / SHELTER_SHORT_NAME (utils/branding.js).
 */
function metaContent(name, doc) {
  const el = doc && typeof doc.querySelector === 'function'
    ? doc.querySelector(`meta[name="${name}"]`)
    : null;
  return el && el.content ? el.content : '';
}

export function shelterName(doc = typeof document !== 'undefined' ? document : null) {
  return metaContent('shelter-name', doc) || 'ShelterLink';
}

export function shelterShortName(doc = typeof document !== 'undefined' ? document : null) {
  return metaContent('shelter-short-name', doc) || shelterName(doc);
}
