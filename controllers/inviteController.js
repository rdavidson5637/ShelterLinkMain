'use strict';

/**
 * Invite accept flow (PR6). Public, signed-out routes:
 *   POST /api/auth/invite/check    is this link still good, and for whom
 *   POST /api/auth/accept-invite   set a name and password, create the account
 *
 * The token is in the POST body in both. The page reads it from the link's
 * #fragment, which browsers never send to a server, so it is not in any URL
 * that reaches access logs, proxies or Referer headers.
 *
 * Both run outside shelter context: the shelter is unknown until the invite
 * row is read, and it always comes from that row. The request never names a
 * shelter, an email, or a role.
 */

const { pool } = require('../config/database');
const { runWithoutShelter } = require('../utils/shelterContext');
const { hashPassword, passwordPolicyError } = require('../utils/password');
const { PRIVACY_NOTICE_VERSION } = require('../config/privacyNotice');
const {
  findOpenInvite,
  acceptInviteAccount,
  looksLikeInviteToken,
} = require('../services/shelterProvision');

function privacyNoticeAccepted(value) {
  return value === true || value === 'on' || value === 'true';
}

function invalid(res) {
  return res.status(200).json({ valid: false });
}

async function checkInvite(req, res) {
  try {
    const token = String((req.body && req.body.token) || '');
    if (!looksLikeInviteToken(token)) return invalid(res);
    const invite = await runWithoutShelter(() => findOpenInvite(pool, token));
    if (!invite || invite.shelter_status !== 'active') return invalid(res);
    return res.status(200).json({
      valid: true,
      email: invite.email,
      role: invite.role,
      shelterName: invite.shelter_name,
      expiresAt: invite.expires_at,
    });
  } catch (error) {
    console.error('[Invite] check error:', error.message);
    return invalid(res);
  }
}

/** Run fn(conn) in one transaction, outside any shelter context. */
function inTransaction(fn) {
  return runWithoutShelter(async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (error) {
      try { await conn.rollback(); } catch { /* already aborted */ }
      throw error;
    } finally {
      conn.release();
    }
  });
}

async function acceptInvite(req, res) {
  try {
    const {
      token,
      first_name: firstName,
      last_name: lastName,
      phone,
      password,
      privacy_notice: privacyNotice,
    } = req.body || {};

    if (!looksLikeInviteToken(token)) {
      return res.status(400).json({ error: 'This invite link is not valid. It may have been used already or have expired.' });
    }
    if (!firstName || !lastName || !password) {
      return res.status(400).json({ error: 'first_name, last_name, and password are required' });
    }
    if (!privacyNoticeAccepted(privacyNotice)) {
      return res.status(400).json({ error: 'Please confirm you have read the privacy notice.' });
    }
    const policyError = await passwordPolicyError(password);
    if (policyError) return res.status(400).json({ error: policyError });

    // Hash before the transaction so the invite row is not locked for the
    // length of a bcrypt run.
    const passwordHash = await hashPassword(password);
    const account = await inTransaction((conn) => acceptInviteAccount(conn, {
      token,
      firstName,
      lastName,
      phone,
      passwordHash,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    }));

    return res.status(201).json({
      message: 'Your account is ready. Sign in to continue.',
      email: account.email,
      role: account.role,
      shelter: { name: account.shelter.name, slug: account.shelter.slug },
    });
  } catch (error) {
    if (error && Number.isInteger(error.status) && error.status < 500) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[Invite] accept error:', error && error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  checkInvite,
  acceptInvite,
};
