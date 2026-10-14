'use strict';

const LOAD_TIME = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

function sanitiseSwVersion(value) {
  const cleaned = String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 40);
  return cleaned || LOAD_TIME;
}

function buildServiceWorker(source, version) {
  const token = sanitiseSwVersion(version);
  return String(source).replace(/__SW_VERSION__/g, token);
}

function getSwVersion() {
  const fromEnv =
    process.env.RENDER_GIT_COMMIT ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    process.env.GIT_COMMIT;
  if (fromEnv && String(fromEnv).trim()) {
    return sanitiseSwVersion(String(fromEnv).trim().slice(0, 12));
  }
  return sanitiseSwVersion(LOAD_TIME);
}

module.exports = {
  buildServiceWorker,
  getSwVersion,
  sanitiseSwVersion,
};
