'use strict';

const crypto = require('crypto');
const fs = require('fs');

const SSL_PARAMS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'];

let warned = false;

function caError(message) {
  const error = new Error(message);
  error.code = 'DB_SSL_CA';
  throw error;
}

function isLocalHost(host) {
  const names = String(host || '')
    .split(',')
    .map((name) => name.trim().toLowerCase().replace(/^\[|\]$/g, ''))
    .filter(Boolean);
  if (names.length === 0) return true;
  return names.every((name) => name === 'localhost' || name === '127.0.0.1' || name === '::1');
}

function normalizePem(text) {
  let pem = String(text || '').trim().replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  const match = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/);
  if (!match) return pem;
  const body = match[1].replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

function validatePem(pem) {
  const normalized = normalizePem(pem);
  try {
    const certificate = new crypto.X509Certificate(normalized);
    if (!certificate.raw || certificate.raw.length === 0) {
      caError('DB_SSL_CA is not a valid certificate');
    }
  } catch (error) {
    if (error && error.code === 'DB_SSL_CA') throw error;
    caError('DB_SSL_CA is not a valid certificate');
  }
  return normalized;
}

function loadCa(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.includes('-----BEGIN')) return validatePem(text);
  if (!fs.existsSync(text)) {
    caError('DB_SSL_CA is not a certificate and not a readable file');
  }
  return validatePem(fs.readFileSync(text, 'utf8'));
}

/**
 * pg copies ssl from the connection string over the ssl option. When a CA is
 * set, drop those parameters so the CA is the one that is used.
 */
function stripSslParams(connectionString) {
  const value = String(connectionString || '');
  const queryAt = value.indexOf('?');
  if (queryAt === -1) return value;
  const kept = value.slice(queryAt + 1).split('&').filter((part) => {
    const key = decodeURIComponent((part.split('=')[0] || '').replace(/\+/g, ' ')).toLowerCase();
    return !SSL_PARAMS.includes(key);
  });
  return kept.length ? `${value.slice(0, queryAt)}?${kept.join('&')}` : value.slice(0, queryAt);
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

function applyDatabaseSsl(connectionString, host, env = process.env, logger = console) {
  const ssl = databaseSsl(host, env, logger);
  if (ssl && ssl.ca) {
    return { connectionString: stripSslParams(connectionString), ssl };
  }
  return { connectionString, ssl };
}

function resetDatabaseSslWarning() {
  warned = false;
}

module.exports = {
  applyDatabaseSsl,
  databaseSsl,
  loadCa,
  resetDatabaseSslWarning,
  stripSslParams,
};
