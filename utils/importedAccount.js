'use strict';

/**
 * Imported volunteers (SL-LATER-32) have no password until they follow a
 * set-password invite. users.password is NOT NULL, so it holds this marker,
 * which is not a bcrypt hash: no password can match it.
 */
const IMPORTED_NO_PASSWORD = '!imported:no-password';

/** Invite state of an imported users row (alias u), or NULL once a password is set. */
const INVITE_STATUS_SQL = `CASE
  WHEN u.password <> '${IMPORTED_NO_PASSWORD}' THEN NULL
  WHEN u.reset_token_expires IS NULL THEN 'not_invited'
  WHEN u.reset_token_expires > NOW() THEN 'invited'
  ELSE 'invite_expired'
END`;

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ''));
}

module.exports = { IMPORTED_NO_PASSWORD, INVITE_STATUS_SQL, isBcryptHash };
