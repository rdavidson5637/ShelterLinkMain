#!/usr/bin/env node
'use strict';

/**
 * Print the names of production settings that are missing or weak.
 * Does not print secret values and does not connect to the database.
 *
 * Usage: npm run check-prod
 */

require('dotenv').config();
process.env.NODE_ENV = 'production';

const {
  collectProductionProblems,
  collectProductionWarnings,
  collectCharityRegisterWarnings,
} = require('../utils/validateEnv');

const missing = collectProductionProblems();
const warnings = collectProductionWarnings();

if (missing.length) {
  console.error('Refusing a production boot until these are set:');
  missing.forEach((name) => console.error(`  - ${name}`));
} else {
  console.log('Required production settings are present.');
}

if (warnings.length) {
  console.warn('Optional settings still off:');
  warnings.forEach((line) => console.warn(`  - ${line}`));
} else if (!missing.length) {
  console.log('Optional email, push, emergency phone, backup key, and timezone are set.');
}

const registerWarnings = collectCharityRegisterWarnings();
if (registerWarnings.length) {
  console.warn('Charity register lookups (optional, evidence only):');
  registerWarnings.forEach((line) => console.warn(`  - ${line}`));
} else {
  console.log('Charity register API keys are set (CCEW_API_KEY, OSCR_API_KEY).');
}
console.log('CCNI lookups read charity_register_cache: import with scripts/import-charity-register.js.');

console.log('This check does not prove the database password works.');
process.exit(missing.length ? 1 : 0);
