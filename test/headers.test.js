'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Duplex } = require('stream');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'header-check-only-not-a-real-secret-value';

const { securityHeaders } = require('../utils/securityHeaders');
const { app } = require('../server');

function getHeadersInMemory(path) {
  return new Promise((resolve, reject) => {
    const socket = new Duplex({
      read() {},
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    socket.remoteAddress = '127.0.0.1';
    const req = new http.IncomingMessage(socket);
    req.method = 'GET';
    req.url = path;
    req.headers = { host: '127.0.0.1' };

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);
    const origEnd = res.end.bind(res);
    res.end = function (...args) {
      origEnd(...args);
      const raw = res.getHeaders();
      const headers = {};
      for (const [k, v] of Object.entries(raw)) {
        headers[k.toLowerCase()] = v;
      }
      resolve(headers);
      return res;
    };
    res.on('error', reject);
    app.handle(req, res, reject);
  });
}

function getHeaders(path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
        res.resume();
        const headers = res.headers;
        server.close(() => resolve(headers));
      });
      req.on('error', (error) => {
        server.close(() => {
          if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
            getHeadersInMemory(path).then(resolve, reject);
          } else {
            reject(error);
          }
        });
      });
    });
    server.on('error', (error) => {
      if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
        getHeadersInMemory(path).then(resolve, reject);
      } else {
        reject(error);
      }
    });
  });
}

test('production header options include HSTS and deny framing', () => {
  const options = securityHeaders(true);
  assert.equal(options.strictTransportSecurity.maxAge, 15552000);
  assert.equal(options.strictTransportSecurity.includeSubDomains, true);
  assert.equal(options.xFrameOptions.action, 'deny');
  assert.equal(options.referrerPolicy.policy, 'strict-origin-when-cross-origin');
});

test('non-production header options omit HSTS', () => {
  assert.equal(securityHeaders(false).strictTransportSecurity, false);
});

test('responses for / and /api carry the security headers', async () => {
  for (const path of ['/', '/api']) {
    const headers = await getHeaders(path);
    assert.equal(headers['x-powered-by'], undefined);
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.match(headers['permissions-policy'], /camera=\(\)/);
    assert.match(headers['content-security-policy'], /default-src 'self'/);
    assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(headers['strict-transport-security'], undefined);
    assert.equal(headers['content-security-policy-report-only'], undefined);
  }
});
