'use strict';

const { cspDirectives } = require('./csp');

function securityHeaders(isProduction) {
  return {
    contentSecurityPolicy: {
      directives: cspDirectives(isProduction),
    },
    // Local HTTP must not teach the browser to remember HSTS for localhost.
    strictTransportSecurity: isProduction
      ? { maxAge: 15552000, includeSubDomains: true }
      : false,
    xFrameOptions: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  };
}

function permissionsPolicy(_req, res, next) {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  next();
}

module.exports = {
  securityHeaders,
  permissionsPolicy,
};
