'use strict';

const crypto = require('crypto');

function hashIcalToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function createIcalToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashIcalToken(raw) };
}

module.exports = {
  hashIcalToken,
  createIcalToken,
};
