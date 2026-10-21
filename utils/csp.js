'use strict';

function cspDirectives(isProduction) {
  const directives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", 'data:'],
    workerSrc: ["'self'"],
    manifestSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };
  if (isProduction) {
    directives.upgradeInsecureRequests = [];
  } else {
    // Helmet enables this by default; the spec only wants it in production
    // so local HTTP (and this check script) is not forced onto HTTPS.
    directives.upgradeInsecureRequests = null;
  }
  return directives;
}

module.exports = { cspDirectives };
