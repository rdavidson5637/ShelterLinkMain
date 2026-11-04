'use strict';

/**
 * Charity Commission for Northern Ireland.
 *
 * CCNI has no documented lookup API. It publishes the register as a CSV
 * download. The path is:
 *
 *   1. A platform owner downloads the CSV from the CCNI website.
 *   2. scripts/import-charity-register.js --regulator ccni --file <csv>
 *      loads it into charity_register_cache (migration 037).
 *   3. lookup() reads the cache.
 *
 * A number missing from the cache is reported as 'not_found' only when the
 * cache holds CCNI rows at all. An empty cache reports 'not_configured' so
 * nobody reads "never imported" as "not a charity". In both cases the
 * platform owner can still hand-check the CCNI website before approving.
 *
 * Header names in the CCNI download have changed over time, so the importer
 * matches a few aliases per column (see COLUMNS) and refuses a file where it
 * cannot find the number, name, and status columns.
 */

const { validateCharityNumber } = require('./formats');
const { registerResult, unknownResult, toDateOnly } = require('./result');
const { parseCsv } = require('./csv');

const REGULATOR = 'ccni';
const SOURCE = 'ccni_csv';

const COLUMNS = Object.freeze({
  number: ['reg charity number', 'registered charity number', 'charity number', 'reg number'],
  subNumber: ['sub charity number', 'subsidiary number'],
  name: ['charity name', 'name'],
  status: ['status', 'charity status', 'registration status'],
  removedAt: ['date removed', 'removed date', 'date of removal', 'removal date'],
});

function normaliseHeader(h) {
  return String(h).trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumns(header) {
  const names = header.map(normaliseHeader);
  const out = {};
  for (const [key, aliases] of Object.entries(COLUMNS)) {
    const idx = names.findIndex((n) => aliases.includes(n));
    out[key] = idx === -1 ? null : idx;
  }
  return out;
}

function mapStatus(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (s.startsWith('registered')) return 'registered';
  if (s.startsWith('removed')) return 'removed';
  return 'unknown';
}

/** "100001", "NIC100001", "nic 100001" -> "NIC100001" or null if not valid. */
function normaliseNumber(raw) {
  const compact = String(raw == null ? '' : raw).replace(/\s+/g, '').toUpperCase();
  const withPrefix = /^\d{6}$/.test(compact) ? `NIC${compact}` : compact;
  const checked = validateCharityNumber(REGULATOR, withPrefix);
  return checked.ok ? checked.value : null;
}

/**
 * Turn CCNI CSV text into cache rows. Pure: no database.
 * Returns { rows, skipped, total }. Throws if the header is unusable.
 * Rows for subsidiaries (sub number other than 0) are skipped: CCNI numbers
 * in formats.js have no suffix, so an applicant cannot give one.
 */
function parseCcniCsv(text) {
  const table = parseCsv(text);
  if (!table.length) throw new Error('CSV is empty');
  const cols = findColumns(table[0]);
  const missing = ['number', 'name', 'status'].filter((k) => cols[k] == null);
  if (missing.length) {
    throw new Error(
      `CSV header is missing ${missing.join(', ')} column(s). Found: ${table[0].map((h) => h.trim()).join(' | ')}`
    );
  }

  const byNumber = new Map();
  let skipped = 0;
  for (const cells of table.slice(1)) {
    const sub = cols.subNumber == null ? '' : String(cells[cols.subNumber] || '').trim();
    if (sub && sub !== '0') {
      skipped += 1;
      continue;
    }
    const number = normaliseNumber(cells[cols.number]);
    const name = String(cells[cols.name] || '').trim().slice(0, 255);
    if (!number || !name) {
      skipped += 1;
      continue;
    }
    const status = mapStatus(cells[cols.status]);
    byNumber.set(number, {
      charity_number: number,
      name,
      status,
      removed_at: status === 'removed' && cols.removedAt != null ? toDateOnly(cells[cols.removedAt]) : null,
    });
  }
  return { rows: [...byNumber.values()], skipped, total: table.length - 1 };
}

// The app's pg type parsers return TIMESTAMP as the raw string (no zone), so
// pass strings through rather than guess a zone. Dates come from test doubles.
function toCachedAt(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function defaultDb() {
  // Lazy so tests and the format-only paths never open a pool.
  // eslint-disable-next-line global-require
  const { pool } = require('../../config/database');
  // eslint-disable-next-line global-require
  const { runWithoutShelter } = require('../../utils/shelterContext');
  // The cache is global and revoked from shelterlink_tenant, so never run
  // this under a shelter's tenant role.
  return { query: (sql, params) => runWithoutShelter(() => pool.execute(sql, params)) };
}

/**
 * Look up one NI charity in the cache.
 *
 * @param {string} rawNumber
 * @param {object} [opts]
 * @param {{query: Function}} [opts.db]  returns [rows]; defaults to the app pool
 * @param {Date|number} [opts.now]
 */
async function lookup(rawNumber, opts = {}) {
  const now = opts.now;
  const checked = validateCharityNumber(REGULATOR, rawNumber);
  if (!checked.ok) return unknownResult('invalid_format', SOURCE, now, { message: checked.error });

  const db = opts.db || defaultDb();
  let rows;
  try {
    [rows] = await db.query(
      `SELECT name, status, to_char(removed_at, 'YYYY-MM-DD') AS removed_at, imported_at
         FROM charity_register_cache
        WHERE regulator = ? AND charity_number = ?`,
      [REGULATOR, checked.value]
    );
  } catch {
    return unknownResult('unavailable', SOURCE, now, { error: 'ccni_cache_error' });
  }

  const row = rows && rows[0];
  if (row) {
    const cachedAt = toCachedAt(row.imported_at);
    if (row.status === 'unknown') {
      return unknownResult('unavailable', SOURCE, now, {
        error: 'ccni_unknown_status',
        name: row.name,
        cachedAt,
      });
    }
    return registerResult({
      found: true,
      name: row.name,
      status: row.status,
      removedAt: row.removed_at,
      source: SOURCE,
      now,
      cachedAt,
    });
  }

  let any;
  try {
    [any] = await db.query('SELECT MAX(imported_at) AS imported_at FROM charity_register_cache WHERE regulator = ?', [
      REGULATOR,
    ]);
  } catch {
    return unknownResult('unavailable', SOURCE, now, { error: 'ccni_cache_error' });
  }
  const lastImport = any && any[0] && any[0].imported_at;
  if (!lastImport) {
    return unknownResult('not_configured', SOURCE, now, {
      error: 'ccni_cache_empty',
      message: 'The CCNI register has not been imported. Check the charity by hand on the CCNI website.',
    });
  }
  return registerResult({
    found: false,
    status: 'not_found',
    source: SOURCE,
    now,
    cachedAt: toCachedAt(lastImport),
  });
}

const BATCH = 500;

/**
 * Upsert parsed rows into charity_register_cache in one transaction.
 * conn: a pool connection (beginTransaction/commit/rollback/execute) used
 * outside any shelter context. Rows not in the file are left alone; their
 * imported_at shows how stale they are.
 */
async function writeCache(conn, rows, { source = SOURCE, regulator = REGULATOR } = {}) {
  await conn.beginTransaction();
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').join(', ');
      const params = chunk.flatMap((r) => [regulator, r.charity_number, r.name, r.status, r.removed_at, source]);
      await conn.execute(
        `INSERT INTO charity_register_cache
           (regulator, charity_number, name, status, removed_at, source, imported_at)
         VALUES ${values}
         ON CONFLICT (regulator, charity_number) DO UPDATE SET
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           removed_at = EXCLUDED.removed_at,
           source = EXCLUDED.source,
           imported_at = EXCLUDED.imported_at
         RETURNING charity_number`,
        params
      );
    }
    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* already aborted */
    }
    throw err;
  }
  return rows.length;
}

module.exports = {
  lookup,
  parseCcniCsv,
  writeCache,
  normaliseNumber,
  mapStatus,
  findColumns,
  COLUMNS,
  SOURCE,
  REGULATOR,
};
