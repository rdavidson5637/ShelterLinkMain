'use strict';

const fs = require('fs');
const path = require('path');
const { isDemoMode, assertOnlyFictionalData } = require('./demoMode');

function loadSql(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'database', file), 'utf8');
}

/** Drop and rebuild the schema, then load the fictional sample data. */
async function rebuildDemoDatabase(pgPool, { env = process.env } = {}) {
  if (!isDemoMode(env)) throw new Error('DEMO_MODE is not true; refusing to rebuild.');
  await assertOnlyFictionalData(pgPool);
  await pgPool.query(loadSql('schema.pg.sql'));
  await pgPool.query(loadSql('seed.pg.sql'));
}

module.exports = { rebuildDemoDatabase };
