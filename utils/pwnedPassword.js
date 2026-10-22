'use strict';

const crypto = require('crypto');
const https = require('https');

const BREACH_MESSAGE = 'That password has appeared in a data breach. Choose a different one.';

function sha1Hex(password) {
  return crypto.createHash('sha1').update(String(password), 'utf8').digest('hex').toUpperCase();
}

function rangeContains(body, suffix) {
  const want = String(suffix || '').toUpperCase();
  return String(body || '').split(/\r?\n/).some((line) => {
    const hash = line.split(':')[0];
    return hash && hash.trim().toUpperCase() === want;
  });
}

function fetchRange(prefix) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'api.pwnedpasswords.com',
      path: `/range/${prefix}`,
      headers: {
        'Add-Padding': 'true',
        'User-Agent': 'ShelterLink-password-check',
      },
      timeout: 2500,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`pwned status ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('pwned timeout')));
    req.on('error', reject);
  });
}

async function breachError(password) {
  const hash = sha1Hex(password);
  const body = await fetchRange(hash.slice(0, 5));
  if (rangeContains(body, hash.slice(5))) return BREACH_MESSAGE;
  return null;
}

module.exports = {
  BREACH_MESSAGE,
  sha1Hex,
  rangeContains,
  breachError,
};
