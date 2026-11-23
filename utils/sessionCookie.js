'use strict';

const SESSION_COOKIE_NAME = 'connect.sid';

/** Default idle lifetime for every session (rolling). */
const DEFAULT_SESSION_MS = 60 * 60 * 1000;
/** Opt-in "keep me signed in" lifetime. Volunteers on their own device only. */
const VOLUNTEER_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

/** Accept the checkbox as JSON true, "true", "on" or "1". Anything else is off. */
function parseRememberMe(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    return ['true', 'on', '1'].includes(value.trim().toLowerCase());
  }
  return false;
}

/**
 * Cookie lifetime for a signed-in session. Only a volunteer who opted in
 * gets 30 days. Staff, admin and kiosk sessions always stay at 1 hour.
 */
function sessionMaxAgeFor({ role, kioskMode = false, rememberMe = false } = {}) {
  if (!kioskMode && role === 'volunteer' && rememberMe) return VOLUNTEER_REMEMBER_MS;
  return DEFAULT_SESSION_MS;
}

function applySessionLifetime(req, options = {}) {
  if (!req || !req.session) return;
  if (!req.session.cookie) req.session.cookie = {};
  req.session.cookie.maxAge = sessionMaxAgeFor(options);
}

/**
 * Clamp any session that is not an ordinary volunteer session back to the
 * 1-hour default. This catches long-lived staff/admin sessions issued before
 * this change and any session whose role or kiosk flag changed after login.
 */
function enforceSessionLifetime(req, res, next) {
  const sess = req && req.session;
  const cookie = sess && sess.cookie;
  if (cookie && sess.userId && (sess.kioskMode || sess.role !== 'volunteer')) {
    const current = cookie.originalMaxAge != null ? cookie.originalMaxAge : cookie.maxAge;
    if (current == null || current > DEFAULT_SESSION_MS) {
      cookie.maxAge = DEFAULT_SESSION_MS;
    }
  }
  if (typeof next === 'function') next();
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? 'strict' : 'lax',
    path: '/',
  };
}

function clearSessionCookie(res) {
  if (!res || typeof res.clearCookie !== 'function') return res;
  return res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
}

/**
 * Regenerate the session id (session-fixation hardening) while preserving
 * the values a caller needs carried over — e.g. userId/role right after
 * login. Falls back to mutating in place if regenerate() isn't available
 * (e.g. a test double), so callers never have to special-case that.
 */
function regenerateSession(req, values = {}) {
  return new Promise((resolve, reject) => {
    if (!req) return resolve();
    if (!req.session) {
      req.session = { ...values };
      return resolve();
    }
    if (typeof req.session.regenerate !== 'function') {
      Object.assign(req.session, values);
      return resolve();
    }
    req.session.regenerate((err) => {
      if (err) return reject(err);
      Object.assign(req.session, values);
      resolve();
    });
  });
}

/** Invalidate every session for a user (e.g. after a password reset). */
async function destroyUserSessions(pool, userId) {
  const id = Number(userId);
  if (!pool || !Number.isFinite(id) || id <= 0) return;
  try {
    await pool.execute(
      `DELETE FROM session WHERE sess->>'userId' = ?`,
      [String(id)]
    );
  } catch (error) {
    console.error('[Session] destroyUserSessions error:', error.message);
  }
}

module.exports = {
  SESSION_COOKIE_NAME,
  DEFAULT_SESSION_MS,
  VOLUNTEER_REMEMBER_MS,
  parseRememberMe,
  sessionMaxAgeFor,
  applySessionLifetime,
  enforceSessionLifetime,
  sessionCookieOptions,
  clearSessionCookie,
  regenerateSession,
  destroyUserSessions,
};
