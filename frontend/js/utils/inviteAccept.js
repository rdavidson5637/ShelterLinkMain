/**
 * Pure helpers for the invite accept page (/invite#<token>). No DOM and no
 * imports, so the tests can load them directly.
 */

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const MIN_PASSWORD_LENGTH = 10;
// Matches validation/bodies.js acceptInvite.password.
export const MAX_PASSWORD_LENGTH = 200;

/** The token from location.hash, or null if it is missing or malformed. */
export function tokenFromHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  let token;
  try {
    token = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return TOKEN_RE.test(token) ? token : null;
}

export function roleLabel(role) {
  return role === 'staff' ? 'a staff account' : 'the admin account';
}

/**
 * Check the form before it is sent. Returns [{ field, message }] in page
 * order (empty when it is fine). The server checks all of this again.
 */
export function validateAcceptForm(values = {}) {
  const firstName = String(values.firstName || '').trim();
  const lastName = String(values.lastName || '').trim();
  const password = String(values.password || '');
  const confirm = String(values.confirm || '');

  const errors = [];
  if (!firstName) errors.push({ field: 'first_name', message: 'Enter your first name.' });
  if (!lastName) errors.push({ field: 'last_name', message: 'Enter your last name.' });
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `Use no more than ${MAX_PASSWORD_LENGTH} characters.` });
  }
  if (password !== confirm) errors.push({ field: 'confirm_password', message: 'Passwords do not match.' });
  if (!values.privacy) {
    errors.push({ field: 'privacy_notice', message: 'Please confirm you have read the privacy notice.' });
  }
  return errors;
}
