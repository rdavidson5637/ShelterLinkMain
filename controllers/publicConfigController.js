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

function getPublicConfig(req, res) {
  const showDemoHints = process.env.NODE_ENV !== 'production';
  return res.status(200).json({
    showDemoHints,
    accounts: showDemoHints ? DEMO_ACCOUNTS : [],
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
