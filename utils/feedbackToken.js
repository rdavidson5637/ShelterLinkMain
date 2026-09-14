'use strict';

const crypto = require('crypto');

function getSecret() {
  const secret = process.env.FEEDBACK_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('FEEDBACK_TOKEN_SECRET or SESSION_SECRET is required');
  }
  return secret;
}

/**
 * Create a signed feedback token that maps to an application (no login needed).
 * Format: base64url(payload).base64url(hmac)
 */
function createFeedbackToken(applicationId) {
  const id = Number(applicationId);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error('Invalid application id for feedback token');
  }
  const payload = Buffer.from(JSON.stringify({ a: id }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/**
 * Verify a feedback token. Returns { applicationId } or null.
 */
function verifyFeedbackToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const id = Number(data?.a);
    if (!Number.isInteger(id) || id < 1) return null;
    return { applicationId: id };
  } catch {
    return null;
  }
}

module.exports = {
  createFeedbackToken,
  verifyFeedbackToken,
};
