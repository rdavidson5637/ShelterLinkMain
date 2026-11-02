'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test(
  'erasing a throwaway volunteer clears personal fields, ends the session, and writes an audit row',
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
    const User = require('../models/User');
    const VolunteerProfile = require('../models/VolunteerProfile');
    const { eraseVolunteer } = require('../controllers/gdprController');

    const email = `gdpr-erasure-${Date.now()}@example.test`;
    const address = '99 Secret Lane';
    const phone = '07700900111';
    let userId = null;
    let shelterId = null;

    try {
      const shelter = await runWithoutShelter(async () => {
        const [rows] = await pool.execute('SELECT id FROM shelters ORDER BY id LIMIT 1');
        return rows[0];
      });
      assert.ok(shelter, 'local database has a shelter');
      shelterId = shelter.id;

      await runWithShelter(shelterId, async () => {
        const [admins] = await pool.execute(
          `SELECT user_id FROM users WHERE role = 'admin' ORDER BY user_id LIMIT 1`
        );
        assert.ok(admins[0], 'local database has an admin');

        const created = await User.create({
          first_name: 'Erase',
          last_name: 'Me',
          email,
          password: 'Password1',
          role: 'volunteer',
        });
        userId = created.user_id;
        await pool.execute('UPDATE users SET phone = ? WHERE user_id = ?', [phone, userId]);
        await VolunteerProfile.create(userId, { address });
      });

      await runWithoutShelter(async () => {
        await pool.execute(
          `INSERT INTO session (sid, sess, expire)
           VALUES (?, ?::json, NOW() + INTERVAL '1 day')`,
          [`gdpr-test-${userId}`, JSON.stringify({ userId })]
        );
      });

      await runWithShelter(shelterId, async () => {
        const [admins] = await pool.execute(
          `SELECT user_id FROM users WHERE role = 'admin' ORDER BY user_id LIMIT 1`
        );
        assert.ok(admins[0], 'local database has an admin');

        const res = {
          statusCode: 200,
          body: undefined,
          status(code) { this.statusCode = code; return this; },
          json(body) { this.body = body; return this; },
        };
        await eraseVolunteer(
          {
            session: { userId: admins[0].user_id, role: 'admin' },
            params: { userId: String(userId) },
            body: { confirmation: 'DELETE' },
          },
          res
        );
        assert.equal(res.statusCode, 200);

        const [users] = await pool.execute(
          'SELECT email, phone, first_name, last_name FROM users WHERE user_id = ?',
          [userId]
        );
        assert.equal(users[0].email, `deleted+${userId}@anonymised.invalid`);
        assert.equal(users[0].phone, null);
        assert.equal(users[0].first_name, 'Anonymised');
        assert.equal(users[0].last_name, 'User');

        const [profiles] = await pool.execute(
          'SELECT address FROM volunteer_profiles WHERE user_id = ?',
          [userId]
        );
        assert.equal(profiles[0].address, null);

        const [audits] = await pool.execute(
          `SELECT action, detail_json
           FROM audit_log
           WHERE action = 'gdpr.erase' AND entity_id = ?
           ORDER BY id DESC LIMIT 1`,
          [String(userId)]
        );
        assert.equal(audits.length, 1);
        const detail = JSON.stringify(audits[0].detail_json);
        assert.doesNotMatch(detail, /Secret Lane|07700900111|example\.test/);
      });

      const sessions = await runWithoutShelter(async () => {
        const [rows] = await pool.execute(
          `SELECT sid FROM session WHERE sess->>'userId' = ?`,
          [String(userId)]
        );
        return rows;
      });
      assert.equal(sessions.length, 0);
    } finally {
      if (userId && shelterId) {
        await runWithoutShelter(async () => {
          await pool.execute(`DELETE FROM session WHERE sid = ?`, [`gdpr-test-${userId}`]);
        }).catch(() => {});
        await runWithShelter(shelterId, async () => {
          await pool.execute('DELETE FROM volunteer_profiles WHERE user_id = ?', [userId]);
          await pool.execute(
            `DELETE FROM audit_log WHERE entity_id = ? AND action = 'gdpr.erase'`,
            [String(userId)]
          );
          await pool.execute('DELETE FROM users WHERE user_id = ?', [userId]);
          const [leftovers] = await pool.execute(
            `SELECT user_id FROM users WHERE email LIKE 'gdpr-erasure-%@example.test'`
          );
          for (const row of leftovers) {
            await pool.execute('DELETE FROM volunteer_profiles WHERE user_id = ?', [row.user_id]);
            await pool.execute('DELETE FROM users WHERE user_id = ?', [row.user_id]);
          }
        }).catch(() => {});
      }
      await closePool();
    }
  }
);
