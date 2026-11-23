'use strict';

/**
 * SL-NEXT-06 — optional two-factor sign-in (TOTP) for staff and admin.
 *
 * Staff and admin can see AccessNI vetting data, so they may add an
 * authenticator app as a second step. Volunteers are not offered it here.
 *
 * Sign-in with 2FA on:
 *   POST /api/auth/login        → password OK → { twoFactorRequired: true }.
 *                                 The session holds pendingTwoFactor only, no
 *                                 userId, so every authenticated route still
 *                                 answers 401.
 *   POST /api/auth/2fa/verify   → 6-digit code or one recovery code → signed in.
 *
 * Turning it on and off (signed-in staff/admin):
 *   GET  /api/auth/2fa          → status
 *   POST /api/auth/2fa/setup    → password → new secret held in the session
 *   POST /api/auth/2fa/enable   → first code → saved, recovery codes shown once
 *   POST /api/auth/2fa/disable  → password + code → cleared
 *
 * If migration 042 has not been applied the totp_* columns do not exist.
 * Sign-in then carries on without 2FA, and the settings endpoints answer 503,
 * so deploying this code before the migration cannot lock anyone out.
 */

const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const totp = require('../utils/totp');
const { runWithoutShelter, isBypass } = require('../utils/shelterContext');
const { recordAudit } = require('../middleware/auditLog');

const TWO_FACTOR_ROLES = new Set(['staff', 'admin']);
const PENDING_TTL_MS = 5 * 60 * 1000;
const SETUP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const UNAVAILABLE = 'Two-factor sign-in is not available yet.';

function eligibleRole(role) {
  return TWO_FACTOR_ROLES.has(role);
}

function missingColumn(error) {
  return Boolean(error && error.code === '42703');
}

/** True when this user must pass a second step. Never throws for a missing column. */
async function isEnabledFor(user) {
  if (!user || !eligibleRole(user.role)) return false;
  try {
    const [rows] = await pool.execute(
      `SELECT totp_enabled_at, totp_secret
       FROM users
       WHERE user_id = ? AND shelter_id IS NOT DISTINCT FROM ?`,
      [user.user_id, user.shelter_id == null ? null : user.shelter_id]
    );
    const row = rows && rows[0];
    return Boolean(row && row.totp_enabled_at && row.totp_secret);
  } catch (error) {
    if (missingColumn(error)) return false;
    throw error;
  }
}

function pendingFromSession(req) {
  const pending = req.session && req.session.pendingTwoFactor;
  if (!pending || !pending.userId) return null;
  if (!Number.isFinite(pending.startedAt) || Date.now() - pending.startedAt > PENDING_TTL_MS) return null;
  return pending;
}

function clearPending(req) {
  if (req.session) delete req.session.pendingTwoFactor;
}

async function loadSecretRow(userId, shelterId) {
  const [rows] = await pool.execute(
    `SELECT user_id, first_name, last_name, name, email, role, shelter_id, created_at,
            privacy_notice_version, totp_secret, totp_enabled_at, totp_last_counter,
            totp_recovery_codes
     FROM users
     WHERE user_id = ? AND shelter_id IS NOT DISTINCT FROM ?`,
    [userId, shelterId == null ? null : shelterId]
  );
  return (rows && rows[0]) || null;
}

/**
 * Check a 6-digit code (with replay guard) or a recovery code against a row,
 * and record it as used. Returns 'totp', 'recovery' or null.
 */
async function acceptSecondFactor(row, code) {
  if (!row || !row.totp_enabled_at || !row.totp_secret) return null;
  const given = String(code == null ? '' : code).trim();
  const shelterId = row.shelter_id == null ? null : row.shelter_id;

  if (/^\d{3}\s?\d{3}$/.test(given)) {
    const secret = totp.decryptSecret(row.totp_secret);
    const counter = totp.verifyCode(secret, given, { lastCounter: row.totp_last_counter });
    if (counter == null) return null;
    const [result] = await pool.execute(
      `UPDATE users SET totp_last_counter = ?
       WHERE user_id = ? AND shelter_id IS NOT DISTINCT FROM ?
         AND (totp_last_counter IS NULL OR totp_last_counter < ?)`,
      [counter, row.user_id, shelterId, counter]
    );
    return result && result.affectedRows === 1 ? 'totp' : null;
  }

  const remaining = totp.consumeRecoveryCode(row.totp_recovery_codes, given);
  if (!remaining) return null;
  const [result] = await pool.execute(
    `UPDATE users SET totp_recovery_codes = ?
     WHERE user_id = ? AND shelter_id IS NOT DISTINCT FROM ? AND totp_recovery_codes = ?`,
    [JSON.stringify(remaining), row.user_id, shelterId, row.totp_recovery_codes]
  );
  return result && result.affectedRows === 1 ? 'recovery' : null;
}

/**
 * Called by authController.login after the password matched.
 * Replaces the session with a pending state and answers 200 { twoFactorRequired }.
 */
async function beginChallenge(req, res, user, { rememberMe, pushEndpoint, regenerateSession }) {
  await regenerateSession(req, {
    pendingTwoFactor: {
      userId: user.user_id,
      shelterId: user.shelter_id == null ? null : user.shelter_id,
      rememberMe: Boolean(rememberMe),
      pushEndpoint: pushEndpoint ? String(pushEndpoint) : null,
      startedAt: Date.now(),
      attempts: 0,
    },
  });
  if (req.session) {
    delete req.session.userId;
    delete req.session.role;
    delete req.session.shelterId;
  }
  return res.status(200).json({ twoFactorRequired: true });
}

function makeVerify({ completeSignIn }) {
  async function verify(req, res) {
    if (!isBypass()) return runWithoutShelter(() => verify(req, res));
    try {
      const pending = pendingFromSession(req);
      if (!pending) {
        clearPending(req);
        return res.status(401).json({ error: 'Your sign-in timed out. Enter your email and password again.', restart: true });
      }
      if ((pending.attempts || 0) >= MAX_ATTEMPTS) {
        clearPending(req);
        return res.status(401).json({ error: 'Too many wrong codes. Enter your email and password again.', restart: true });
      }

      let row;
      try {
        row = await loadSecretRow(pending.userId, pending.shelterId);
      } catch (error) {
        if (missingColumn(error)) {
          clearPending(req);
          return res.status(401).json({ error: 'Enter your email and password again.', restart: true });
        }
        throw error;
      }
      if (!row || !eligibleRole(row.role) || !row.totp_enabled_at) {
        clearPending(req);
        return res.status(401).json({ error: 'Enter your email and password again.', restart: true });
      }

      const method = await acceptSecondFactor(row, req.body && req.body.code);
      if (!method) {
        pending.attempts = (pending.attempts || 0) + 1;
        console.warn('[Auth] failed two-factor code', req.ip || '');
        return res.status(401).json({ error: 'That code did not work. Check your authenticator app and try again.' });
      }

      clearPending(req);
      const extra = {};
      if (method === 'recovery') {
        extra.recoveryCodesLeft = Math.max(0, countCodes(row.totp_recovery_codes) - 1);
      }
      return completeSignIn(req, res, row, {
        rememberMe: pending.rememberMe,
        pushEndpoint: pending.pushEndpoint,
        extra,
      });
    } catch (error) {
      console.error('[Auth] twoFactor verify error:', error.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
  return verify;
}

function countCodes(json) {
  try {
    const list = JSON.parse(json || '[]');
    return Array.isArray(list) ? list.length : 0;
  } catch (_) {
    return 0;
  }
}

// ─── Settings (signed-in staff/admin) ────────────────────────────────────────

function requireEligible(req, res) {
  const role = (req.user && req.user.role) || (req.session && req.session.role);
  if (!eligibleRole(role)) {
    res.status(403).json({ error: 'Two-factor sign-in is for staff and admin accounts.' });
    return false;
  }
  return true;
}

async function loadOwnRow(req) {
  const [rows] = await pool.execute(
    `SELECT user_id, email, role, shelter_id, password, totp_secret, totp_enabled_at,
            totp_last_counter, totp_recovery_codes
     FROM users
     WHERE user_id = ?
     LIMIT 1`,
    [req.session.userId]
  );
  return (rows && rows[0]) || null;
}

function handleSettingsError(res, error, label) {
  if (missingColumn(error)) return res.status(503).json({ error: UNAVAILABLE });
  console.error(`[Auth] twoFactor ${label} error:`, error.message);
  return res.status(500).json({ error: 'Internal server error' });
}

async function status(req, res) {
  try {
    if (!requireEligible(req, res)) return undefined;
    const row = await loadOwnRow(req);
    if (!row) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({
      enabled: Boolean(row.totp_enabled_at),
      enabledAt: row.totp_enabled_at || null,
      recoveryCodesLeft: row.totp_enabled_at ? countCodes(row.totp_recovery_codes) : 0,
    });
  } catch (error) {
    return handleSettingsError(res, error, 'status');
  }
}

async function passwordMatches(row, password) {
  if (!row || !password) return false;
  return bcrypt.compare(String(password), String(row.password));
}

async function setup(req, res) {
  try {
    if (!requireEligible(req, res)) return undefined;
    const row = await loadOwnRow(req);
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (row.totp_enabled_at) {
      return res.status(409).json({ error: 'Two-factor sign-in is already on. Turn it off first to move to a new device.' });
    }
    if (!(await passwordMatches(row, req.body && req.body.password))) {
      return res.status(401).json({ error: 'Your password is not correct.' });
    }
    const secret = totp.generateSecret();
    req.session.totpSetup = { secret, startedAt: Date.now() };
    return res.status(200).json({
      secret,
      otpauthUri: totp.otpauthUri(secret, row.email),
    });
  } catch (error) {
    return handleSettingsError(res, error, 'setup');
  }
}

async function enable(req, res) {
  try {
    if (!requireEligible(req, res)) return undefined;
    const pendingSetup = req.session.totpSetup;
    if (
      !pendingSetup ||
      !pendingSetup.secret ||
      !Number.isFinite(pendingSetup.startedAt) ||
      Date.now() - pendingSetup.startedAt > SETUP_TTL_MS
    ) {
      delete req.session.totpSetup;
      return res.status(400).json({ error: 'Setup timed out. Start again.' });
    }
    const counter = totp.verifyCode(pendingSetup.secret, req.body && req.body.code);
    if (counter == null) {
      return res.status(400).json({ error: 'That code did not work. Check the time on your phone and try the newest code.' });
    }
    const { codes, hashes } = totp.generateRecoveryCodes();
    const [result] = await pool.execute(
      `UPDATE users
         SET totp_secret = ?, totp_enabled_at = NOW(), totp_last_counter = ?, totp_recovery_codes = ?
       WHERE user_id = ? AND totp_enabled_at IS NULL`,
      [totp.encryptSecret(pendingSetup.secret), counter, JSON.stringify(hashes), req.session.userId]
    );
    delete req.session.totpSetup;
    if (!result || result.affectedRows !== 1) {
      return res.status(409).json({ error: 'Two-factor sign-in is already on.' });
    }
    await recordAudit(req, { action: 'auth.2fa_enabled', entityType: 'user', entityId: String(req.session.userId) }).catch(
      () => {}
    );
    return res.status(200).json({ enabled: true, recoveryCodes: codes });
  } catch (error) {
    return handleSettingsError(res, error, 'enable');
  }
}

async function disable(req, res) {
  try {
    if (!requireEligible(req, res)) return undefined;
    const row = await loadOwnRow(req);
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (!row.totp_enabled_at) return res.status(200).json({ enabled: false });
    if (!(await passwordMatches(row, req.body && req.body.password))) {
      return res.status(401).json({ error: 'Your password is not correct.' });
    }
    const method = await acceptSecondFactor(row, req.body && req.body.code);
    if (!method) {
      return res.status(401).json({ error: 'That code did not work.' });
    }
    await pool.execute(
      `UPDATE users
         SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL, totp_recovery_codes = NULL
       WHERE user_id = ?`,
      [req.session.userId]
    );
    await recordAudit(req, { action: 'auth.2fa_disabled', entityType: 'user', entityId: String(req.session.userId) }).catch(
      () => {}
    );
    return res.status(200).json({ enabled: false });
  } catch (error) {
    return handleSettingsError(res, error, 'disable');
  }
}

module.exports = {
  TWO_FACTOR_ROLES,
  PENDING_TTL_MS,
  MAX_ATTEMPTS,
  eligibleRole,
  isEnabledFor,
  beginChallenge,
  acceptSecondFactor,
  makeVerify,
  status,
  setup,
  enable,
  disable,
};
