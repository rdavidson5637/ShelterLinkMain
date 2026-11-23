'use strict';

/**
 * Fetches vendored Pico and FullCalendar if they are missing or fail the
 * pinned SRI checksum. Runtime still serves them from /public so CSP stays
 * script-src 'self'. Used when a git remote cannot carry the large vendor blobs.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { ROOT, VENDOR_FILES } = require('./vendor-manifest');

function sriSha384(buffer) {
  return `sha384-${crypto.createHash('sha384').update(buffer).digest('base64')}`;
}

function fileMatchesIntegrity(dest, integrity) {
  if (!fs.existsSync(dest)) return false;
  const actual = sriSha384(fs.readFileSync(dest));
  return actual === integrity;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp`;
    const out = fs.createWriteStream(tmp);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          out.close(() => {
            fs.unlink(tmp, () => {
              download(res.headers.location, dest).then(resolve, reject);
            });
          });
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          out.close(() => {
            fs.unlink(tmp, () => {
              reject(new Error(`${url} -> ${res.statusCode}`));
            });
          });
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
      .on('error', (err) => {
        out.close(() => {
          fs.unlink(tmp, () => reject(err));
        });
      });
  });
}

async function ensureFile(file) {
  const rel = path.relative(ROOT, file.dest);
  if (fileMatchesIntegrity(file.dest, file.integrity)) {
    console.log('vendor ok', rel);
    return;
  }
  if (fs.existsSync(file.dest)) {
    console.log('vendor checksum mismatch, refetch', rel);
    fs.unlinkSync(file.dest);
  } else {
    console.log('vendor fetch', rel);
  }
  await download(file.url, file.dest);
  if (!fileMatchesIntegrity(file.dest, file.integrity)) {
    const actual = sriSha384(fs.readFileSync(file.dest));
    try {
      fs.unlinkSync(file.dest);
    } catch {
      /* ignore */
    }
    throw new Error(
      `integrity mismatch for ${rel}: expected ${file.integrity}, got ${actual}`
    );
  }
  console.log('vendor verified', rel);
}

async function main() {
  for (const file of VENDOR_FILES) {
    await ensureFile(file);
  }
}

module.exports = { sriSha384, fileMatchesIntegrity, ensureFile, VENDOR_FILES };

if (require.main === module) {
  main().catch((error) => {
    console.error('[ensure-vendor]', error.message);
    process.exit(1);
  });
}
