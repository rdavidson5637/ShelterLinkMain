'use strict';

const { Pool, types } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

// Match mysql2 dateStrings:true — DATE and TIMESTAMP come back as strings.
const DATE_OID = 1082;
const TIMESTAMP_OID = 1114;
const TIMESTAMPTZ_OID = 1184;
const INT8_OID = 20;
types.setTypeParser(DATE_OID, (val) => val);
types.setTypeParser(TIMESTAMP_OID, (val) => val);
types.setTypeParser(TIMESTAMPTZ_OID, (val) => val);
// COUNT(*) is int8; mysql2 returned JS numbers.
types.setTypeParser(INT8_OID, (val) => {
  const n = Number(val);
  return Number.isSafeInteger(n) ? n : val;
});

/**
 * Translate mysql-style `?` placeholders to `$1..$n`.
 * Literal `?` inside quoted strings (and comments) is left unchanged.
 */
function translatePlaceholders(sql, params = []) {
  const source = String(sql);
  const values = params == null ? [] : Array.isArray(params) ? params : [params];
  let out = '';
  let n = 0;
  let i = 0;
  let state = 'code';

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (c === "'") {
        state = 'single';
        out += c;
        i += 1;
        continue;
      }
      if (c === '"') {
        state = 'double';
        out += c;
        i += 1;
        continue;
      }
      if (c === '-' && next === '-') {
        state = 'linecomment';
        out += c + next;
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        state = 'blockcomment';
        out += c + next;
        i += 2;
        continue;
      }
      if (c === '?') {
        n += 1;
        out += `$${n}`;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }

    if (state === 'single') {
      if (c === "'" && next === "'") {
        out += "''";
        i += 2;
        continue;
      }
      if (c === "'") {
        state = 'code';
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }

    if (state === 'double') {
      if (c === '"' && next === '"') {
        out += '""';
        i += 2;
        continue;
      }
      if (c === '"') {
        state = 'code';
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }

    if (state === 'linecomment') {
      if (c === '\n') state = 'code';
      out += c;
      i += 1;
      continue;
    }

    if (state === 'blockcomment') {
      if (c === '*' && next === '/') {
        out += '*/';
        i += 2;
        state = 'code';
        continue;
      }
      out += c;
      i += 1;
    }
  }

  return { sql: out, params: values };
}

function stripLeadingSqlNoise(sql) {
  return String(sql)
    .replace(/^\s+/, '')
    .replace(/^(?:--[^\n]*\n|\s+|\/\*[\s\S]*?\*\/)*/g, '')
    .trim();
}

function statementKind(sql) {
  const head = stripLeadingSqlNoise(sql).split(/\s+/, 1)[0] || '';
  const word = head.toLowerCase();
  if (word === 'insert') return 'insert';
  if (word === 'update') return 'update';
  if (word === 'delete') return 'delete';
  return 'other';
}

function hasReturning(sql) {
  return /\breturning\b/i.test(String(sql));
}

function ensureReturning(sql) {
  if (statementKind(sql) !== 'insert' || hasReturning(sql)) return String(sql);
  return String(sql).replace(/;?\s*$/, '') + ' RETURNING *';
}

/**
 * Map INSERT ... RETURNING row to mysql2 insertId: first column named `id`
 * or ending in `_id`.
 */
function mapInsertId(row) {
  if (!row || typeof row !== 'object') return undefined;
  for (const key of Object.keys(row)) {
    if (key === 'id' || key.endsWith('_id')) return row[key];
  }
  return undefined;
}

function shapeExecuteResult(sql, pgResult) {
  const kind = statementKind(sql);
  const rowCount = pgResult && typeof pgResult.rowCount === 'number' ? pgResult.rowCount : 0;
  const rows = (pgResult && pgResult.rows) || [];

  if (kind === 'insert') {
    const payload = rows.slice();
    payload.insertId = mapInsertId(rows[0]);
    payload.affectedRows = rowCount;
    return [payload];
  }
  if (kind === 'update' || kind === 'delete') {
    return [{ affectedRows: rowCount }];
  }
  return [rows];
}

function isLocalHost(host) {
  if (!host) return true;
  const h = String(host).toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function connectionConfig() {
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 10);
  const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS || 30000);

  if (process.env.DATABASE_URL) {
    let host = '';
    try {
      host = new URL(process.env.DATABASE_URL).hostname;
    } catch {
      host = '';
    }
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: isLocalHost(host) ? false : { rejectUnauthorized: false },
      max: connectionLimit,
      idleTimeoutMillis,
    };
  }

  const host = process.env.DB_HOST || 'localhost';
  return {
    host,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'shelterlink',
    ssl: isLocalHost(host) ? false : { rejectUnauthorized: false },
    max: connectionLimit,
    idleTimeoutMillis,
  };
}

const pgPool = new Pool(connectionConfig());

async function runOn(querier, sql, params) {
  const translated = translatePlaceholders(sql, params);
  const text = ensureReturning(translated.sql);
  const result = await querier.query(text, translated.params);
  return shapeExecuteResult(sql, result);
}

function wrapClient(client) {
  return {
    async beginTransaction() {
      await client.query('BEGIN');
    },
    async commit() {
      await client.query('COMMIT');
    },
    async rollback() {
      await client.query('ROLLBACK');
    },
    async execute(sql, params = []) {
      return runOn(client, sql, params);
    },
    async query(sql, params = []) {
      return runOn(client, sql, params);
    },
    release() {
      client.release();
    },
  };
}

const pool = {
  async execute(sql, params = []) {
    return runOn(pgPool, sql, params);
  },
  async query(sql, params = []) {
    return runOn(pgPool, sql, params);
  },
  async getConnection() {
    const client = await pgPool.connect();
    return wrapClient(client);
  },
  async end() {
    await pgPool.end();
  },
};

async function testConnection() {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    if (!rows || !rows.length) throw new Error('Health check query returned no rows');
    return true;
  } catch (error) {
    const cfg = connectionConfig();
    console.error('[DB] Connection test failed:', {
      message: error.message,
      code: error.code,
      host: cfg.host || (cfg.connectionString ? '(DATABASE_URL)' : undefined),
      port: cfg.port,
      database: cfg.database,
    });
    throw error;
  }
}

async function closePool() {
  await pgPool.end();
}

module.exports = {
  pool,
  pgPool,
  testConnection,
  closePool,
  translatePlaceholders,
  mapInsertId,
  ensureReturning,
  shapeExecuteResult,
};
