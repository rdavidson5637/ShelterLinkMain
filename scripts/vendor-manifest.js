'use strict';

/**
 * Pinned vendor assets fetched from the CDN by ensure-vendor.js.
 * Integrity values are SRI sha384 digests of the exact bytes served at
 * the listed URL (verified against jsDelivr on 2026-11-23).
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');

const VENDOR_FILES = [
  {
    dest: path.join(ROOT, 'frontend/public/css/vendor/pico-2.1.1.min.css'),
    publicPath: '/public/css/vendor/pico-2.1.1.min.css',
    url: 'https://cdn.jsdelivr.net/npm/@picocss/pico@2.1.1/css/pico.min.css',
    integrity: 'sha384-L1dWfspMTHU/ApYnFiMz2QID/PlP1xCW9visvBdbEkOLkSSWsP6ZJWhPw6apiXxU',
  },
  {
    dest: path.join(ROOT, 'frontend/public/js/vendor/fullcalendar-6.1.19.min.js'),
    publicPath: '/public/js/vendor/fullcalendar-6.1.19.min.js',
    url: 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.19/index.global.min.js',
    integrity: 'sha384-LjuMvep2w70bTtVscyL+xkqhYr7Y0kTM4t5cwWMy0xOTfl5duHb7MnP6K3J3/4Mk',
  },
];

module.exports = { ROOT, VENDOR_FILES };
