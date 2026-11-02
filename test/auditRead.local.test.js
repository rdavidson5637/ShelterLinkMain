'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test(
  'a document download audit row can be written on the local database and then removed',
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
    const { recordAudit } = require('../middleware/auditLog');
    const { runWithShelter, runWithoutShelter } = require('../utils/shelterContext');

    try {
      const shelters = await runWithoutShelter(async () => {
        const [rows] = await pool.execute('SELECT id FROM shelters ORDER BY id LIMIT 1');
        return rows;
      });
      assert.ok(shelters.length, 'local database has a shelter');

      await runWithShelter(shelters[0].id, async () => {
        const id = await recordAudit(
          { session: {} },
          {
            action: 'document.download',
            entityType: 'document',
            entityId: 0,
            detail: { document_id: 0, user_id: 0, check: 'b6-local' },
          }
        );
        const [rows] = await pool.execute(
          'SELECT action, detail_json FROM audit_log WHERE id = ?',
          [id]
        );
        assert.equal(rows[0].action, 'document.download');
        assert.match(JSON.stringify(rows[0].detail_json), /b6-local/);
        assert.doesNotMatch(JSON.stringify(rows[0].detail_json), /%PDF|BEGIN/);
        await pool.execute('DELETE FROM audit_log WHERE id = ?', [id]);
      });
    } finally {
      await closePool();
    }
  }
);
