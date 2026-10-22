'use strict';

const bcrypt = require('bcrypt');
const { breachError } = require('./pwnedPassword');

const SALT_ROUNDS = 12;
const WEAK_PASSWORD_MESSAGE = 'Password must be at least 8 characters with one uppercase letter and one number';

function isStrongPassword(password = '') {
  const pwd = String(password);
  return pwd.length >= 8 && /[A-Z]/.test(pwd) && /[0-9]/.test(pwd);
}

function hashPassword(password) {
  return bcrypt.hash(String(password), SALT_ROUNDS);
}

async function passwordPolicyError(password) {
  if (!isStrongPassword(password)) return WEAK_PASSWORD_MESSAGE;
  if (process.env.NODE_ENV === 'test' || process.env.PWNED_PASSWORD_CHECK === 'off') return null;
  try {
    return await breachError(password);
  } catch (error) {
    console.error('[password] breach check unavailable:', error.message);
    return null;
  }
}

module.exports = {
  SALT_ROUNDS,
  WEAK_PASSWORD_MESSAGE,
  isStrongPassword,
  hashPassword,
  passwordPolicyError,
};
