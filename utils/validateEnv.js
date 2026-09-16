'use strict';

const WEAK_PATTERN = /change_me|replace_me|shelterlink-admin|\bdemo\b|changeme/i;

function isBlank(value) {
  return !value || typeof value !== 'string' || !value.trim();
}

function isWeakSecret(value, { minLength = 16 } = {}) {
  if (isBlank(value)) return true;
  const trimmed = value.trim();
  if (trimmed.length < minLength) return true;
  return WEAK_PATTERN.test(trimmed);
}

function isWeakAppUrl(value) {
  if (isBlank(value)) return true;
  const trimmed = value.trim();
  if (WEAK_PATTERN.test(trimmed)) return true;
  if (/localhost|127\.0\.0\.1/i.test(trimmed)) return true;
  return false;
}

function collectProductionProblems() {
  if (process.env.NODE_ENV !== 'production') return [];
  const missing = [];
  if (isWeakSecret(process.env.SESSION_SECRET, { minLength: 32 })) {
    missing.push('SESSION_SECRET');
  }
  if (isWeakSecret(process.env.ADMIN_REGISTRATION_KEY, { minLength: 16 })) {
    missing.push('ADMIN_REGISTRATION_KEY');
  }
  if (isWeakAppUrl(process.env.APP_URL)) {
    missing.push('APP_URL');
  }
  return missing;
}

function validateEnv({ exitProcess } = {}) {
  const missing = collectProductionProblems();
  const shouldExit = exitProcess ?? process.env.NODE_ENV === 'production';
  if (missing.length) {
    console.error(`\u2717 Refusing to start in production without: ${missing.join(', ')}`);
    console.error('  Set these on the host and redeploy. See DEPLOY.md.');
    if (shouldExit) process.exit(1);
  }
  return { ok: missing.length === 0, missing };
}

module.exports = {
  validateEnv,
  isWeakSecret,
  isWeakAppUrl,
  collectProductionProblems,
};
