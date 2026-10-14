'use strict';

/**
 * Fetches vendored Pico and FullCalendar if they are missing on disk.
 * Runtime still serves them from /public so CSP stays script-src 'self'.
 * Used when a git remote cannot carry the large vendor blobs.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const FILES = [
  {
    dest: path.join(ROOT, 'frontend/public/css/vendor/pico-2.1.1.min.css'),
    url: 'https://cdn.jsdelivr.net/npm/@picocss/pico@2.1.1/css/pico.min.css',
  },
  {
    dest: path.join(ROOT, 'frontend/public/js/vendor/fullcalendar-6.1.19.min.js'),
    url: 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.19/index.global.min.js',
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp`;
    const out = fs.createWriteStream(tmp);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`${url} -> ${res.statusCode}`));
          return;
        }
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            fs.renameSync(tmp, dest);
            resolve();
          });
        });
      })
      .on('error', reject);
  });
}

async function main() {
  for (const file of FILES) {
    if (fs.existsSync(file.dest) && fs.statSync(file.dest).size > 1000) {
      console.log('vendor ok', path.relative(ROOT, file.dest));
      continue;
    }
    console.log('vendor fetch', path.relative(ROOT, file.dest));
    await download(file.url, file.dest);
  }
}

main().catch((error) => {
  console.error('[ensure-vendor]', error.message);
  process.exit(1);
});
