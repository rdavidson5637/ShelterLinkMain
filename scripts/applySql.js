'use strict';

/**
 * Run a SQL file. Parts separated by a line `-- @break` run as separate
 * queries so CREATE ROLE is not wrapped in the same transaction as the rest.
 * A duplicate CREATE ROLE (42710) is ignored. Other errors are not.
 */
async function applySql(pgPool, sql) {
  const parts = String(sql).split(/\n-- @break\n/);
  for (const part of parts) {
    const statement = part.trim();
    if (!statement) continue;
    try {
      await pgPool.query(statement);
    } catch (err) {
      if (err.code === '42710' && /CREATE ROLE/i.test(statement)) continue;
      throw err;
    }
  }
}

module.exports = { applySql };
