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
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
}

module.exports = {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  clearSessionCookie,
};
