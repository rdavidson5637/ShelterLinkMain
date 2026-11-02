'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test(
  'destroyUserSessions deletes a session while a shelter context is active',
  { skip: !(process.env.ENV_FILE && process.env.LOCAL_DB_REQUIRED === '1') },
  async () => {
    require('../config/loadEnv').loadEnv();
    const { assertLocalDatabase } = require('../utils/liveDbGuard');
    assertLocalDatabase({
      databaseUrl: process.env.DATABASE_URL,
      dbHost: process.env.DB_HOST,
      pgHost: process.env.PGHOST,
    });

    const { pool, closePool } = require('../config/database');
    const { runWithShelter, runWithoutShelter } = require('../utils/shelterContext');
    const { destroyUserSessions } = require('../utils/sessionCookie');

    const shelter = await runWithoutShelter(async () => {
      const [rows] = await pool.execute('SELECT id FROM shelters ORDER BY id LIMIT 1');
      return rows[0];
    });
    assert.ok(shelter, 'local database has a shelter');

    const userId = 900000000 + (process.pid % 100000);
    const sid = `session-end-${process.pid}`;

    try {
      await runWithoutShelter(async () => {
        await pool.execute('DELETE FROM session WHERE sid = ?', [sid]);
        await pool.execute(
          `INSERT INTO session (sid, sess, expire)
           VALUES (?, ?::json, NOW() + INTERVAL '1 day')`,
          [sid, JSON.stringify({ userId })]
        );
      });

      await runWithShelter(shelter.id, () => destroyUserSessions(pool, userId));

      const left = await runWithoutShelter(async () => {
        const [rows] = await pool.execute(
          `SELECT sid FROM session WHERE sess->>'userId' = ?`,
          [String(userId)]
        );
        return rows;
      });
      assert.equal(left.length, 0);
    } finally {
      await runWithoutShelter(() => pool.execute('DELETE FROM session WHERE sid = ?', [sid])).catch(() => {});
      await closePool();
    }
  }
);
