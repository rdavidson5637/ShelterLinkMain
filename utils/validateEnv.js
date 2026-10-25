'use strict';

const { isEmailConfigured } = require('./emailConfig');

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
  if (!/^https:\/\//i.test(trimmed)) return true;
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
  if (isBlank(process.env.DATABASE_URL)) {
    missing.push('DATABASE_URL');
  }
  return missing;
}

/**
 * Optional integrations that are off in production. Non-fatal: the app runs
 * without them, but features degrade silently, so we say so once at boot.
 */
function collectProductionWarnings() {
  if (process.env.NODE_ENV !== 'production') return [];
  const warnings = [];
  if (!isEmailConfigured()) {
    warnings.push(
      'Email is not configured (EMAIL_HOST, EMAIL_FROM/EMAIL_USER, EMAIL_PASS): password resets and all email digests are off'
    );
  }
  const vapidPublic = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY;
  if (isBlank(vapidPublic) || isBlank(vapidPrivate)) {
    warnings.push('Web push is not configured (WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY): urgent cover push alerts are off');
  }
  if (isBlank(process.env.SHELTER_EMERGENCY_PHONE)) {
    warnings.push('SHELTER_EMERGENCY_PHONE is not set: foster emergency phone will not be shown');
  }
  if (isWeakSecret(process.env.BACKUP_ENCRYPTION_KEY, { minLength: 16 })) {
    warnings.push('BACKUP_ENCRYPTION_KEY is missing or shorter than 16 characters: npm run backup will refuse to run');
  }
  if (isBlank(process.env.SHELTER_TIMEZONE)) {
    warnings.push('SHELTER_TIMEZONE is not set: scheduled jobs use Europe/London');
  }
  return warnings;
}

function logStartupWarnings() {
  const warnings = collectProductionWarnings();
  if (warnings.length) {
    console.warn('! Optional integrations missing:');
    warnings.forEach((w) => console.warn(`  - ${w}`));
  }
  return warnings;
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
  collectProductionWarnings,
  logStartupWarnings,
};
