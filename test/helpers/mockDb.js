'use strict';
// Installs a mock in place of config/database BEFORE any model is required.
// Models do `const { pool } = require('../config/database')`, capturing the
// pool object once. We keep that object stable and swap the handler per test.
const path = require('path');
const dbPath = require.resolve('../../config/database');

let currentHandler = async () => [[], []];
const calls = [];

const pool = {
  async execute(sql, params = []) {
    calls.push({ sql: String(sql), params });
    return currentHandler(sql, params);
  },
  async query(sql, params = []) {
    calls.push({ sql: String(sql), params });
    return currentHandler(sql, params);
  },
  async getConnection() {
    return {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      async execute(sql, params = []) {
        return pool.execute(sql, params);
      },
      async query(sql, params = []) {
        return pool.query(sql, params);
      },
      release() {},
    };
  },
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { pool, testConnection: async () => true },
};

function setHandler(fn) { currentHandler = fn; }
function resetCalls() { calls.length = 0; }
function lastCall() { return calls[calls.length - 1]; }
module.exports = { pool, setHandler, resetCalls, calls, lastCall };
