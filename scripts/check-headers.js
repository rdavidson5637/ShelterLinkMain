#!/usr/bin/env node
/**
 * Print security headers for / and /api.
 *   node scripts/check-headers.js
 * Does not use the production database. It only listens on a random local port.
 */

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'header-check-only-not-a-real-secret-value';
}

const http = require('http');
const { app } = require('../server');

const NAMES = [
  'content-security-policy',
  'content-security-policy-report-only',
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'x-frame-options',
  'x-powered-by',
  'access-control-allow-origin',
];

function get(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      res.resume();
      resolve(res.headers);
    });
    req.on('error', reject);
  });
}

function print(path, headers) {
  console.log(`\n${path}`);
  for (const name of NAMES) {
    const value = headers[name];
    console.log(`  ${name}: ${value === undefined ? '(absent)' : value}`);
  }
}

const server = app.listen(0, '127.0.0.1', async () => {
  try {
    print('/', await get(server, '/'));
    print('/api', await get(server, '/api'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
