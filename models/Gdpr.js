'use strict';

const bcrypt = require('bcrypt');
const { pool } = require('../config/database');

const DEFAULT_RETENTION_YEARS = 3;

function retentionYears() {
  const raw = Number(process.env.DATA_RETENTION_YEARS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_RETENTION_YEARS;
}

/**
 * Build a full JSON export of a volunteer's personal data (GDPR access).
 */
async function buildVolunteerExport(userId) {
  const id = Number(userId);
  const [users] = await pool.execute(
    `SELECT user_id, first_name, last_name, name, phone, email, role, created_at, last_login, anonymised_at
     FROM users WHERE user_id = ? LIMIT 1`,
    [id]
  );
  const user = users[0];
  if (!user) return null;
  if (user.role !== 'volunteer') {
    const err = new Error('GDPR export is only available for volunteer accounts');
    err.statusCode = 400;
    throw err;
  }

  const [profiles] = await pool.execute(
    'SELECT * FROM volunteer_profiles WHERE user_id = ? LIMIT 1',
    [id]
  );
  const [applications] = await pool.execute(
    `SELECT a.*, o.title AS opportunity_title
     FROM applications a
     LEFT JOIN opportunities o ON o.opportunity_id = a.opportunity_id
     WHERE a.user_id = ?
     ORDER BY a.applied_at DESC`,
    [id]
  );
  const [hours] = await pool.execute(
    `SELECT vh.*, o.title AS opportunity_title
     FROM volunteer_hours vh
     LEFT JOIN opportunities o ON o.opportunity_id = vh.opportunity_id
     WHERE vh.user_id = ?
     ORDER BY vh.date DESC`,
    [id]
  );
  const [qualifications] = await pool.execute(
    `SELECT vq.*, q.name AS qualification_name
     FROM volunteer_qualifications vq
     LEFT JOIN qualifications q ON q.id = vq.qualification_id
     WHERE vq.user_id = ?`,
    [id]
  );
  const [waivers] = await pool.execute(
    `SELECT wa.*, w.title AS waiver_title, w.version AS waiver_version
     FROM waiver_acceptances wa
     LEFT JOIN waivers w ON w.id = wa.waiver_id
     WHERE wa.user_id = ?`,
    [id]
  );
  const [customValues] = await pool.execute(
    `SELECT cfv.*, cf.label AS field_label, cf.field_type
     FROM custom_field_values cfv
     LEFT JOIN custom_fields cf ON cf.id = cfv.field_id
     WHERE cfv.user_id = ?`,
    [id]
  );
  const [documents] = await pool.execute(
    `SELECT id, original_name, mime_type, size, label, uploaded_at, expires_at
     FROM user_documents WHERE user_id = ?`,
    [id]
  );
  const [tags] = await pool.execute(
    `SELECT t.id, t.name, t.slug
     FROM volunteer_tags vt
     INNER JOIN tags t ON t.id = vt.tag_id
     WHERE vt.user_id = ?`,
    [id]
  );

  const hoursTotal = hours
    .filter((h) => Number(h.approved) === 1)
    .reduce((sum, h) => sum + Number(h.hours || 0), 0);

  return {
    exported_at: new Date().toISOString(),
    user,
    profile: profiles[0] || null,
    applications,
    hours,
    hours_approved_total: hoursTotal,
    qualifications,
    waiver_acceptances: waivers,
    custom_field_values: customValues,
    documents,
    tags,
  };
}

/**
 * Anonymise a volunteer account: replace PII, keep hour rows for aggregates.
 * Returns the updated user row summary, or null if not found.
 */
async function anonymiseUser(userId, { reason = 'gdpr_erasure' } = {}) {
  const id = Number(userId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT user_id, email, role, anonymised_at FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [id]
    );
    const user = rows[0];
    if (!user) {
      await conn.rollback();
      return null;
    }
    if (user.role !== 'volunteer') {
      const err = new Error('Only volunteer accounts can be anonymised');
      err.statusCode = 400;
      throw err;
    }
    if (user.anonymised_at) {
      await conn.rollback();
      return { user_id: id, already_anonymised: true, email: user.email };
    }

    // Preserve approved hours totals by leaving volunteer_hours untouched.
    const [hoursRows] = await conn.execute(
      `SELECT COALESCE(SUM(CASE WHEN approved = 1 THEN hours ELSE 0 END), 0) AS total
       FROM volunteer_hours WHERE user_id = ?`,
      [id]
    );
    const hoursPreserved = Number(hoursRows[0]?.total || 0);

    const anonEmail = `deleted+${id}@anonymised.invalid`;
    // Unusable password hash — account cannot log in.
    const lockedHash = await bcrypt.hash(`locked-${id}-${Date.now()}`, 10);

    await conn.execute(
      `UPDATE users SET
         first_name = 'Anonymised',
         last_name = 'User',
         name = 'Anonymised User',
         phone = NULL,
         email = ?,
         password = ?,
         reset_token = NULL,
         reset_token_expires = NULL,
         ical_token = NULL,
         anonymised_at = NOW()
       WHERE user_id = ?`,
      [anonEmail, lockedHash, id]
    );

    await conn.execute(
      `UPDATE volunteer_profiles SET
         date_of_birth = NULL,
         address = NULL,
         emergency_contact = NULL,
         skills = NULL,
         availability = NULL
       WHERE user_id = ?`,
      [id]
    );

    // Remove free-text custom field answers and document binaries metadata path.
    await conn.execute('DELETE FROM custom_field_values WHERE user_id = ?', [id]);
    await conn.execute('DELETE FROM user_documents WHERE user_id = ?', [id]);
    await conn.execute('DELETE FROM volunteer_tags WHERE user_id = ?', [id]);

    // Drop sessions if the sessions table stores user data (best-effort).
    try {
      await conn.execute(
        `DELETE FROM sessions WHERE data LIKE ? OR data LIKE ?`,
        [`%"userId":${id}%`, `%"userId": ${id}%`]
      );
    } catch (_) {
      // sessions table may not support LIKE well; ignore
    }

    await conn.commit();
    return {
      user_id: id,
      already_anonymised: false,
      email: anonEmail,
      hours_preserved: hoursPreserved,
      reason,
    };
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Find volunteers inactive for retentionYears() and anonymise them.
 * Inactivity = COALESCE(last_login, created_at) older than the threshold.
 */
async function runDataRetention(now = new Date()) {
  const years = retentionYears();
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - years);

  const [candidates] = await pool.execute(
    `SELECT user_id
     FROM users
     WHERE role = 'volunteer'
       AND anonymised_at IS NULL
       AND COALESCE(last_login, created_at) < ?
     ORDER BY user_id ASC`,
    [cutoff]
  );

  const results = [];
  for (const row of candidates) {
    try {
      const outcome = await anonymiseUser(row.user_id, { reason: 'data_retention' });
      results.push({ user_id: row.user_id, ok: true, outcome });
    } catch (err) {
      results.push({ user_id: row.user_id, ok: false, error: err.message });
    }
  }

  return {
    retention_years: years,
    cutoff: cutoff.toISOString(),
    scanned: candidates.length,
    anonymised: results.filter((r) => r.ok && r.outcome && !r.outcome.already_anonymised).length,
    results,
  };
}

module.exports = {
  DEFAULT_RETENTION_YEARS,
  retentionYears,
  buildVolunteerExport,
  anonymiseUser,
  runDataRetention,
};
