'use strict';

/**
 * Volunteer CSV import (SL-LATER-32), for a shelter moving off spreadsheets.
 *
 *   POST /api/admin/volunteers/import/preview   text/csv  row-by-row check, writes nothing
 *   POST /api/admin/volunteers/import           text/csv  same check, then creates the rows
 *   POST /api/admin/volunteers/invites          JSON      send set-password emails
 *
 * Import is admin only. Imported volunteers get no password (an unusable
 * marker, so nobody can sign in as them) and no email: staff send
 * set-password invites later from the volunteers page, one or several rows
 * at a time, through the existing reset-password link.
 *
 * An address that already has a ShelterLink login at another shelter is not
 * given a second account; that login is linked to this shelter through the
 * memberships table, with the volunteer role, and keeps its own password.
 * The cross-shelter lookup answers only "is there an account, and is it
 * already here" per address. It reads no name, role or other shelter.
 *
 * Every preview, import and invite run is written to audit_log with counts
 * and user ids, not the file contents.
 */

const { pool } = require('../config/database');
const { currentShelterId, runWithoutShelter } = require('../utils/shelterContext');
const { readVolunteerCsv, CsvImportError, MAX_BYTES, MAX_ROWS } = require('../utils/volunteerCsv');
const { recordAudit } = require('../middleware/auditLog');
const { createResetToken, productionResetBaseUrl } = require('../utils/resetToken');
const { isEmailConfigured } = require('../utils/emailConfig');
const { IMPORTED_NO_PASSWORD } = require('../utils/importedAccount');

const INVITE_TTL_DAYS = 7;
const INVITE_MAX = 100;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function send(res, error) {
  if (error && Number.isInteger(error.status) && error.status < 500) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error('[VolunteerImport] error:', error && error.message);
  return res.status(500).json({ error: 'Internal server error' });
}

function shelterIdOrFail() {
  const id = currentShelterId();
  if (!id) throw fail(403, 'Forbidden');
  return id;
}

/**
 * Per address: does a login exist, and is it already at this shelter
 * (primary shelter or a membership). Runs outside shelter context because
 * users rows at other shelters are hidden by RLS.
 */
async function accountsFor(shelterId, emails) {
  if (!emails.length) return new Map();
  const [rows] = await runWithoutShelter(() => pool.execute(
    `SELECT u.user_id, lower(u.email) AS email,
            (u.shelter_id = ? OR m.id IS NOT NULL) AS here
     FROM users u
     LEFT JOIN memberships m ON m.user_id = u.user_id AND m.shelter_id = ?
     WHERE lower(u.email) = ANY(?::text[])`,
    [shelterId, shelterId, emails]
  ));
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.email), { userId: Number(row.user_id), here: row.here === true || row.here === 1 || row.here === 't' });
  }
  return map;
}

async function checkFile(shelterId, text) {
  const { rows } = readVolunteerCsv(text);
  const emails = rows.filter((r) => !r.errors.length).map((r) => r.email);
  const accounts = await accountsFor(shelterId, emails);
  for (const row of rows) {
    const account = accounts.get(row.email);
    if (row.errors.length) row.outcome = 'error';
    else if (account && account.here) row.outcome = 'duplicate';
    else if (account) {
      row.outcome = 'link';
      row.userId = account.userId;
    } else row.outcome = 'new';
  }
  const summary = { total: rows.length, new: 0, link: 0, duplicate: 0, error: 0 };
  for (const row of rows) summary[row.outcome] += 1;
  return { rows, summary };
}

function publicRow(row) {
  return {
    row: row.row,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    date_of_birth: row.date_of_birth,
    outcome: row.outcome,
    errors: row.errors,
  };
}

function csvBody(req) {
  if (typeof req.body !== 'string') {
    throw fail(415, 'Send the file as text/csv.');
  }
  return req.body;
}

async function previewImport(req, res) {
  try {
    const shelterId = shelterIdOrFail();
    const text = csvBody(req);
    const { rows, summary } = await checkFile(shelterId, text);
    await recordAudit(req, {
      action: 'volunteer.import.preview',
      entityType: 'volunteer',
      detail: { ...summary, bytes: Buffer.byteLength(text, 'utf8') },
    });
    res.locals.auditWritten = true;
    return res.status(200).json({
      rows: rows.map(publicRow),
      summary,
      limits: { maxBytes: MAX_BYTES, maxRows: MAX_ROWS },
    });
  } catch (error) {
    if (error instanceof CsvImportError) return res.status(400).json({ error: error.message });
    return send(res, error);
  }
}

async function inShelterTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* already aborted */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function runImport(req, res) {
  try {
    const shelterId = shelterIdOrFail();
    const text = csvBody(req);
    const { rows, summary } = await checkFile(shelterId, text);
    const toCreate = rows.filter((r) => r.outcome === 'new');
    const toLink = rows.filter((r) => r.outcome === 'link');
    if (!toCreate.length && !toLink.length) {
      throw fail(400, 'Nothing to import: every row is already here or has a problem.');
    }

    const result = await inShelterTransaction(async (conn) => {
      const created = [];
      for (const row of toCreate) {
        const [inserted] = await conn.execute(
          `INSERT INTO users (first_name, last_name, name, phone, email, password, role, shelter_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'volunteer', ?, NOW())
           RETURNING user_id`,
          [
            row.first_name,
            row.last_name,
            `${row.first_name} ${row.last_name}`,
            row.phone,
            row.email,
            IMPORTED_NO_PASSWORD,
            shelterId,
          ]
        );
        const userId = Number(inserted.insertId || (inserted[0] && inserted[0].user_id));
        created.push(userId);
        if (row.date_of_birth) {
          await conn.execute(
            'INSERT INTO volunteer_profiles (user_id, date_of_birth, shelter_id) VALUES (?, ?, ?)',
            [userId, row.date_of_birth, shelterId]
          );
        }
      }
      const linked = [];
      for (const row of toLink) {
        await conn.execute(
          `INSERT INTO memberships (user_id, shelter_id, role)
           VALUES (?, ?, 'volunteer')
           ON CONFLICT (user_id, shelter_id) DO NOTHING`,
          [row.userId, shelterId]
        );
        linked.push(row.userId);
      }
      // In the same transaction, so an import is never written without its audit row.
      await conn.execute(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail_json, created_at)
         VALUES (?, 'volunteer.import', 'volunteer', NULL, ?, NOW())`,
        [
          req.session?.userId || null,
          JSON.stringify({
            rows: summary.total,
            created: created.length,
            linked: linked.length,
            skipped_duplicates: summary.duplicate,
            skipped_errors: summary.error,
            created_user_ids: created,
            linked_user_ids: linked,
            bytes: Buffer.byteLength(text, 'utf8'),
          }),
        ]
      );
      return { created, linked };
    });
    res.locals.auditWritten = true;

    return res.status(201).json({
      message: `Imported ${result.created.length} new and linked ${result.linked.length} existing.`,
      created: result.created.length,
      linked: result.linked.length,
      skipped_duplicates: summary.duplicate,
      skipped_errors: summary.error,
    });
  } catch (error) {
    if (error instanceof CsvImportError) return res.status(400).json({ error: error.message });
    if (error && error.code === '23505') {
      return res.status(409).json({ error: 'Someone signed up with one of these addresses since the preview. Check the file again.' });
    }
    return send(res, error);
  }
}

function inviteBlocker() {
  if (!isEmailConfigured()) return 'Email is not set up on this server, so invites cannot be sent yet.';
  if (!productionResetBaseUrl()) return 'Invite emails need an https APP_URL before they can be sent.';
  return null;
}

/**
 * Staff choose imported volunteers (no password yet) and send each a
 * set-password email. Uses the reset-password link and token columns, with
 * a longer expiry than a forgotten-password reset. Anyone already holding a
 * password, at another shelter, or not a volunteer is skipped.
 */
async function sendInvites(req, res) {
  try {
    const shelterId = shelterIdOrFail();
    const ids = [...new Set((req.body.user_ids || []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) throw fail(400, 'Choose at least one volunteer.');
    if (ids.length > INVITE_MAX) throw fail(400, `Send at most ${INVITE_MAX} invites at a time.`);
    const blocker = inviteBlocker();
    if (blocker) throw fail(409, blocker);

    const [rows] = await pool.execute(
      `SELECT user_id, email, first_name
       FROM users
       WHERE user_id = ANY(?::int[]) AND shelter_id = ? AND role = 'volunteer' AND password = ?`,
      [ids, shelterId, IMPORTED_NO_PASSWORD]
    );

    // Required here so tests can swap the email module.
    const { sendVolunteerSetPasswordInvite } = require('../utils/emailService');
    const baseUrl = productionResetBaseUrl();
    const sent = [];
    const failed = [];
    for (const user of rows) {
      const { raw, hash } = createResetToken();
      const expires = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
      const [update] = await pool.execute(
        `UPDATE users SET reset_token = ?, reset_token_expires = ?
         WHERE user_id = ? AND shelter_id = ? AND password = ?`,
        [hash, expires, user.user_id, shelterId, IMPORTED_NO_PASSWORD]
      );
      if (!update || !update.affectedRows) continue;
      try {
        await sendVolunteerSetPasswordInvite(user.email, {
          firstName: user.first_name,
          link: `${baseUrl}/reset-password.html?token=${raw}`,
          expiresInDays: INVITE_TTL_DAYS,
        });
        sent.push(Number(user.user_id));
      } catch (emailError) {
        console.error('[VolunteerImport] invite email failed:', emailError && emailError.message);
        await pool.execute(
          'UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE user_id = ? AND reset_token = ?',
          [user.user_id, hash]
        );
        failed.push(Number(user.user_id));
      }
    }
    const skipped = ids.length - sent.length - failed.length;

    await recordAudit(req, {
      action: 'volunteer.invite.send',
      entityType: 'volunteer',
      detail: { requested: ids.length, sent: sent.length, failed: failed.length, skipped, sent_user_ids: sent, failed_user_ids: failed },
    });
    res.locals.auditWritten = true;

    return res.status(200).json({ sent: sent.length, failed: failed.length, skipped });
  } catch (error) {
    return send(res, error);
  }
}

module.exports = {
  INVITE_TTL_DAYS,
  previewImport,
  runImport,
  sendInvites,
};
