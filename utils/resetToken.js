'use strict';

const crypto = require('crypto');

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function createResetToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashResetToken(raw) };
}

function productionResetBaseUrl() {
  const appUrl = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    if (!appUrl || /localhost|127\.0\.0\.1/i.test(appUrl)) return null;
    return appUrl;
  }
  return appUrl || `http://localhost:${process.env.PORT || 3000}`;
}

module.exports = {
  hashResetToken,
  createResetToken,
  productionResetBaseUrl,
};
