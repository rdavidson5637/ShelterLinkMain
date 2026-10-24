'use strict';

/**
 * Non-production demo hints for the login page.
 * Passwords come from the environment. Nothing is returned in production,
 * and nothing is returned when the demo env vars are unset.
 */
function accountFromEnv(role, label, emailName, passwordName) {
  const email = String(process.env[emailName] || '').trim();
  const password = String(process.env[passwordName] || '');
  if (!email || !password) return null;
  return { role, label, email, password };
}

function demoAccounts() {
  if (process.env.NODE_ENV === 'production') return [];
  return [
    accountFromEnv('admin', 'Admin', 'DEMO_ADMIN_EMAIL', 'DEMO_ADMIN_PASSWORD'),
    accountFromEnv('volunteer', 'Volunteer', 'DEMO_VOLUNTEER_EMAIL', 'DEMO_VOLUNTEER_PASSWORD'),
  ].filter(Boolean);
}

function getPublicConfig(req, res) {
  const accounts = demoAccounts();
  return res.status(200).json({
    showDemoHints: accounts.length > 0,
    accounts,
  });
}

function getDemoInfo(req, res) {
  return getPublicConfig(req, res);
}

module.exports = {
  getPublicConfig,
  getDemoInfo,
};
