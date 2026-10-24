'use strict';

const bcrypt = require('bcrypt');
const { breachError } = require('./pwnedPassword');

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 10;
const WEAK_PASSWORD_MESSAGE = 'Password must be at least 10 characters';
const COMMON_PASSWORD_MESSAGE = 'Password is too common';
// Cost-12 hash of a string that is not a user password. Compared when login
// does not find exactly one account, so the response time stays similar.
const DUMMY_PASSWORD_HASH = '$2b$12$d0O2aa61CE.Q7rBPK1fO5OtVktZN4zdJEu2aTytmH//uCxq5WwCLS';
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  '1234567890',
  'qwertyuiop',
  'letmein123',
  'shelterlink',
  'admin12345',
  'changeme123',
  'welcome123',
  'iloveyou123',
]);

function isStrongPassword(password = '') {
  const pwd = String(password);
  if (pwd.length < MIN_PASSWORD_LENGTH) return false;
  return !COMMON_PASSWORDS.has(pwd.toLowerCase());
}

function hashPassword(password) {
  return bcrypt.hash(String(password), SALT_ROUNDS);
}

async function passwordPolicyError(password) {
  const pwd = String(password || '');
  if (pwd.length < MIN_PASSWORD_LENGTH) return WEAK_PASSWORD_MESSAGE;
  if (COMMON_PASSWORDS.has(pwd.toLowerCase())) return COMMON_PASSWORD_MESSAGE;
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
  MIN_PASSWORD_LENGTH,
  WEAK_PASSWORD_MESSAGE,
  COMMON_PASSWORD_MESSAGE,
  DUMMY_PASSWORD_HASH,
  isStrongPassword,
  hashPassword,
  passwordPolicyError,
};
