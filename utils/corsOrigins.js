'use strict';

const PRODUCTION_ORIGIN = 'https://shelterlink.online';

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function extraOriginsFromEnv() {
  return (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
}

function productionAllowlist() {
  const allowed = new Set([PRODUCTION_ORIGIN]);
  const appUrl = normalizeOrigin(process.env.APP_URL);
  if (appUrl) allowed.add(appUrl);
  extraOriginsFromEnv().forEach((origin) => allowed.add(origin));
  return allowed;
}

function isLocalDevOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (process.env.NODE_ENV === 'production') {
    return productionAllowlist().has(normalized);
  }
  if (isLocalDevOrigin(normalized)) return true;
  return extraOriginsFromEnv().includes(normalized);
}

function corsOriginDelegate(origin, callback) {
  if (isAllowedCorsOrigin(origin)) return callback(null, true);
  return callback(null, false);
}

module.exports = {
  PRODUCTION_ORIGIN,
  isAllowedCorsOrigin,
  corsOriginDelegate,
  productionAllowlist,
};
