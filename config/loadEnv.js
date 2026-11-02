'use strict';

const dotenv = require('dotenv');

/**
 * Load one env file.
 * ENV_FILE, when set, is the only file read. .env is not loaded as well.
 */
function loadEnv() {
  return dotenv.config({ path: process.env.ENV_FILE || '.env' });
}

module.exports = { loadEnv };
