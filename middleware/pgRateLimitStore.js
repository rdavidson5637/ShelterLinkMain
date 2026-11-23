'use strict';

/**
 * Postgres-backed express-rate-limit store.
 *
 * Counters are shared across app replicas via rate_limit_hits. Each limiter
 * gets its own store instance with a distinct prefix so login, API, and other
 * budgets stay separate (express-rate-limit unsharedStore check).
 *
 * Fail-open on DB errors: a store outage must not take the site down.
 */

const { pool } = require('../config/database');

function createPgRateLimitStore(prefix) {
  if (!prefix || typeof prefix !== 'string') {
    throw new Error('pgRateLimitStore requires a non-empty prefix');
  }

  let windowMs = 15 * 60 * 1000;

  function fullKey(key) {
    return `${prefix}${key}`;
  }

  return {
    prefix,
    localKeys: false,

    init(options) {
      if (options && Number.isFinite(options.windowMs) && options.windowMs > 0) {
        windowMs = Math.floor(options.windowMs);
      }
    },

    async increment(key) {
      const k = fullKey(key);
      try {
        const [rows] = await pool.execute(
          `
            INSERT INTO rate_limit_hits (key, hits, reset_at)
            VALUES (?, 1, NOW() + (? * INTERVAL '1 millisecond'))
            ON CONFLICT (key) DO UPDATE SET
              hits = CASE
                WHEN rate_limit_hits.reset_at <= NOW() THEN 1
                ELSE rate_limit_hits.hits + 1
              END,
              reset_at = CASE
                WHEN rate_limit_hits.reset_at <= NOW()
                  THEN NOW() + (? * INTERVAL '1 millisecond')
                ELSE rate_limit_hits.reset_at
              END
            RETURNING hits, reset_at
          `,
          [k, windowMs, windowMs]
        );
        const row = rows[0];
        return {
          totalHits: Number(row.hits) || 1,
          resetTime: row.reset_at ? new Date(row.reset_at) : undefined,
        };
      } catch (error) {
        console.error('[rateLimit] increment failed:', error.message);
        return { totalHits: 0, resetTime: undefined };
      }
    },

    async decrement(key) {
      const k = fullKey(key);
      try {
        await pool.execute(
          `
            UPDATE rate_limit_hits
            SET hits = GREATEST(hits - 1, 0)
            WHERE key = ?
              AND reset_at > NOW()
          `,
          [k]
        );
      } catch (error) {
        console.error('[rateLimit] decrement failed:', error.message);
      }
    },

    async resetKey(key) {
      const k = fullKey(key);
      try {
        await pool.execute('DELETE FROM rate_limit_hits WHERE key = ?', [k]);
      } catch (error) {
        console.error('[rateLimit] resetKey failed:', error.message);
      }
    },

    async get(key) {
      const k = fullKey(key);
      try {
        const [rows] = await pool.execute(
          `
            SELECT hits, reset_at
            FROM rate_limit_hits
            WHERE key = ?
              AND reset_at > NOW()
            LIMIT 1
          `,
          [k]
        );
        if (!rows.length) return undefined;
        return {
          totalHits: Number(rows[0].hits) || 0,
          resetTime: rows[0].reset_at ? new Date(rows[0].reset_at) : undefined,
        };
      } catch (error) {
        console.error('[rateLimit] get failed:', error.message);
        return undefined;
      }
    },
  };
}

module.exports = {
  createPgRateLimitStore,
};
