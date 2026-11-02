'use strict';

const fs = require('fs');

let warned = false;

function isLocalHost(host) {
  if (!host) return true;
  const name = String(host).toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

function loadCa(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.includes('-----BEGIN')) return text;
  if (!fs.existsSync(text)) {
    const error = new Error('DB_SSL_CA is not a certificate and not a readable file');
    error.code = 'DB_SSL_CA_UNREADABLE';
    throw error;
  }
  return fs.readFileSync(text, 'utf8');
}

/**
 * Local hosts stay without TLS. A remote host verifies when DB_SSL_CA is a
 * PEM or a path to one. Otherwise TLS stays on and the certificate is not
 * checked, which is today's behaviour.
 */
function databaseSsl(host, env = process.env, logger = console) {
  if (isLocalHost(host)) return false;
  const ca = loadCa(env.DB_SSL_CA);
  if (ca) return { rejectUnauthorized: true, ca };
  if (String(env.NODE_ENV) === 'production' && !warned) {
    warned = true;
    logger.warn(
      'Database TLS is not verifying the server certificate. Set DB_SSL_CA to a CA file or PEM.'
    );
  }
  return { rejectUnauthorized: false };
}

function resetDatabaseSslWarning() {
  warned = false;
}

module.exports = {
  databaseSsl,
  loadCa,
  resetDatabaseSslWarning,
};
