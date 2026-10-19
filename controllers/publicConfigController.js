'use strict';

/**
 * Non-production demo hints for the login page.
 * Seed credentials match database/seed.pg.sql / README.md.
 */
const DEMO_ACCOUNTS = [
  {
    role: 'admin',
    label: 'Admin',
    email: 'admin@shelterlink.org',
    password: 'Admin123!',
  },
  {
    role: 'volunteer',
    label: 'Volunteer',
    email: 'alex.jenkins@example.com',
    password: 'Password1',
  },
];

const { getBranding } = require('../utils/branding');
const { isDemoMode } = require('../utils/demoMode');

function getPublicConfig(req, res) {
  const demoMode = isDemoMode();
  const showDemoHints = process.env.NODE_ENV !== 'production' || demoMode;
  return res.status(200).json({
    showDemoHints,
    demoMode,
    accounts: showDemoHints ? DEMO_ACCOUNTS : [],
    branding: getBranding(),
  });
}

function getDemoInfo(req, res) {
  return getPublicConfig(req, res);
}

module.exports = {
  getPublicConfig,
  getDemoInfo,
  DEMO_ACCOUNTS,
};
