'use strict';

/**
 * Signed-in devices (SL-LATER-33).
 *
 * A signed-in user can list their own connect-pg-simple sessions, sign out
 * any one of the others, or all of them at once. Every query is pinned to
 * sess->>'userId' = the caller, so another user's sessions are never read or
 * deleted. Session ids never leave the server: each row is addressed by an
 * HMAC handle that only means something to this server and this user.
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const { hashPassword, passwordPolicyError } = require('../utils/password');

const HANDLE_RE = /^[A-Za-z0-9_-]{22}$/;
const MAX_ROWS = 50;
let fallbackKey = null;

function handleKey() {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (!fallbackKey) fallbackKey = crypto.randomBytes(32).toString('hex');
  return fallbackKey;
}

/** Opaque, stable handle for a session id. Never reversible to the sid. */
function sessionHandle(sid) {
  return crypto
    .createHmac('sha256', handleKey())
    .update(`device-session:${sid}`)
    .digest('base64url')
    .slice(0, 22);
}

function isValidHandle(value) {
  return typeof value === 'string' && HANDLE_RE.test(value);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function parseSess(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

function toIso(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function currentUserId(req) {
  const id = Number(req && req.session && req.session.userId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function loadOwnSessions(userId) {
  const [rows] = await pool.execute(
    `SELECT sid, sess, expire
       FROM session
      WHERE sess->>'userId' = ?
        AND expire > NOW()
      ORDER BY expire DESC
      LIMIT ${MAX_ROWS}`,
    [String(userId)]
  );
  return Array.isArray(rows) ? rows : [];
}

/** Shape one stored session for the owner. Only summary fields go out. */
function describeSession(row, currentSid) {
  const sess = parseSess(row.sess);
  const expireMs = new Date(row.expire).getTime();
  const cookie = sess.cookie || {};
  const lifetime = Number(cookie.originalMaxAge);
  let lastActiveMs = Number.isFinite(lifetime) && Number.isFinite(expireMs) ? expireMs - lifetime : NaN;
  if (Number.isFinite(lastActiveMs)) lastActiveMs = Math.min(lastActiveMs, Date.now());
  return {
    id: sessionHandle(row.sid),
    device: typeof sess.device === 'string' && sess.device ? sess.device.slice(0, 80) : 'Unknown device',
    signedInAt: toIso(Number(sess.loginAt)),
    lastActiveAt: toIso(lastActiveMs),
    expiresAt: toIso(expireMs),
    kiosk: Boolean(sess.kioskMode),
    current: row.sid === currentSid,
  };
}

async function listSessions(req, res) {
  try {
    const userId = currentUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const rows = await loadOwnSessions(userId);
    const sessions = rows.map((row) => describeSession(row, req.sessionID));
    if (!sessions.some((s) => s.current) && req.sessionID && req.session) {
      // The current session may not be persisted yet on its first request.
      sessions.push(
        describeSession(
          {
            sid: req.sessionID,
            sess: { ...req.session, cookie: { originalMaxAge: 0 } },
            expire: new Date(Date.now()),
          },
          req.sessionID
        )
      );
    }
    sessions.sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return String(b.lastActiveAt || '').localeCompare(String(a.lastActiveAt || ''));
    });
    return res.status(200).json({ sessions });
  } catch (error) {
    console.error('[Sessions] list error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function revokeSession(req, res) {
  try {
    const userId = currentUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const handle = req.params && req.params.id;
    if (!isValidHandle(handle)) return res.status(404).json({ error: 'Session not found' });
    if (req.sessionID && safeEqual(sessionHandle(req.sessionID), handle)) {
      return res.status(400).json({ error: 'Use sign out to end this device.' });
    }
    const rows = await loadOwnSessions(userId);
    const match = rows.find((row) => safeEqual(sessionHandle(row.sid), handle));
    if (!match) return res.status(404).json({ error: 'Session not found' });
    await pool.execute(
      `DELETE FROM session WHERE sid = ? AND sess->>'userId' = ?`,
      [match.sid, String(userId)]
    );
    return res.status(200).json({ message: 'Signed out of that device' });
  } catch (error) {
    console.error('[Sessions] revoke error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** Delete every session for a user except the one with keepSid. */
async function destroyOtherUserSessions(userId, keepSid) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const [result] = await pool.execute(
    `DELETE FROM session WHERE sess->>'userId' = ? AND sid <> ?`,
    [String(id), String(keepSid || '')]
  );
  return (result && (result.affectedRows ?? result.rowCount)) || 0;
}

async function revokeOtherSessions(req, res) {
  try {
    const userId = currentUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const ended = await destroyOtherUserSessions(userId, req.sessionID);
    return res.status(200).json({ message: 'Signed out of all other devices', ended });
  } catch (error) {
    console.error('[Sessions] revoke others error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Change password while signed in. Needs the current password. On success
 * every other session for this user ends; this device stays signed in.
 */
async function changePassword(req, res) {
  try {
    const userId = currentUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (req.session.kioskMode) return res.status(403).json({ error: 'Not available in kiosk mode' });
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Enter your current password and a new password.' });
    }
    const [rows] = await pool.execute(
      'SELECT user_id, password FROM users WHERE user_id = ? LIMIT 1',
      [userId]
    );
    const user = rows && rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ok = await bcrypt.compare(String(currentPassword), String(user.password || ''));
    if (!ok) return res.status(400).json({ error: 'Your current password is not right.' });
    if (String(currentPassword) === String(newPassword)) {
      return res.status(400).json({ error: 'Choose a password you have not used here.' });
    }
    const policyError = await passwordPolicyError(newPassword);
    if (policyError) return res.status(400).json({ error: policyError });

    const passwordHash = await hashPassword(newPassword);
    await pool.execute(
      `UPDATE users
          SET password = ?, reset_token = NULL, reset_token_expires = NULL
        WHERE user_id = ?`,
      [passwordHash, userId]
    );
    const ended = await destroyOtherUserSessions(userId, req.sessionID);
    return res.status(200).json({ message: 'Password changed. Other devices are signed out.', ended });
  } catch (error) {
    console.error('[Sessions] changePassword error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  sessionHandle,
  describeSession,
  destroyOtherUserSessions,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  changePassword,
};
