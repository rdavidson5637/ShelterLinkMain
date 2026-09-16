'use strict';

const SESSION_COOKIE_NAME = 'connect.sid';

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
  sessionCookieOptions,
  clearSessionCookie,
  regenerateSession,
  destroyUserSessions,
};
