'use strict';

function sessionCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    path: '/',
    secure: Boolean(isProduction),
    sameSite: isProduction ? 'strict' : 'lax',
  };
}

function clearSessionCookie(res) {
  if (!res || typeof res.clearCookie !== 'function') return res;
  return res.clearCookie('connect.sid', sessionCookieOptions());
}

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
  sessionCookieOptions,
  clearSessionCookie,
  regenerateSession,
  destroyUserSessions,
};
