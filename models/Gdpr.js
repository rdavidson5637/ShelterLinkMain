'use strict';

const { hashPassword } = require('../utils/password');
const { pool } = require('../config/database');
const { destroyUserSessions } = require('../utils/sessionCookie');
const { cutoffFrom } = require('../config/retention');
const { currentShelterId } = require('../utils/shelterContext');
const UserDocument = require('./UserDocument');

const RETENTION_MONTHS_MIN = 1;
const RETENTION_MONTHS_MAX = 120;

function normaliseRetentionMonths(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < RETENTION_MONTHS_MIN || n > RETENTION_MONTHS_MAX) return null;
  return n;
}

/**
 * Per-shelter inactive-volunteer period (months). Null means off.
 */
async function getRetentionMonths() {
  const shelterId = currentShelterId();
  if (!shelterId) return null;
  const [rows] = await pool.execute(
    `SELECT retention_inactive_months
       FROM shelter_settings
      WHERE shelter_id = ?
      LIMIT 1`,
    [shelterId]
  );
  return normaliseRetentionMonths(rows[0]?.retention_inactive_months);
}

async function getRetentionSettings() {
  const shelterId = currentShelterId();
  if (!shelterId) {
    return { retention_inactive_months: null, updated_at: null, shelter_id: null };
  }
  const [rows] = await pool.execute(
    `SELECT retention_inactive_months, updated_at
       FROM shelter_settings
      WHERE shelter_id = ?
      LIMIT 1`,
    [shelterId]
  );
  const row = rows[0] || null;
  return {
    shelter_id: shelterId,
    retention_inactive_months: normaliseRetentionMonths(row?.retention_inactive_months),
    updated_at: row ? row.updated_at : null,
  };
}

async function setRetentionMonths(months, updatedBy) {
  const shelterId = currentShelterId();
  if (!shelterId) {
    const err = new Error('Shelter context is missing');
    err.status = 403;
    throw err;
  }
  let value = null;
  if (months != null && months !== '') {
    value = normaliseRetentionMonths(months);
    if (value == null) {
      const err = new Error(
        `retention_inactive_months must be null (off) or an integer from ${RETENTION_MONTHS_MIN} to ${RETENTION_MONTHS_MAX}`
      );
      err.statusCode = 400;
      throw err;
    }
  }
  await pool.execute(
    `INSERT INTO shelter_settings (shelter_id, retention_inactive_months, updated_by, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (shelter_id) DO UPDATE
       SET retention_inactive_months = EXCLUDED.retention_inactive_months,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
    [shelterId, value, updatedBy || null]
  );
  return getRetentionSettings();
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
    `SELECT t.id, t.name
     FROM volunteer_tags vt
     INNER JOIN tags t ON t.id = vt.tag_id
     WHERE vt.user_id = ?`,
    [id]
  );
  const [messages] = await pool.execute(
    `SELECT id, thread_id, body, created_at FROM messages WHERE user_id = ? ORDER BY id`,
    [id]
  );
  const [shiftNotes] = await pool.execute(
    `SELECT id, opportunity_id, body, created_at FROM shift_notes WHERE author_id = ? ORDER BY id`,
    [id]
  );
  const [volunteerShiftNotes] = await pool.execute(
    `SELECT id, application_id, opportunity_id, body, created_at
       FROM volunteer_shift_notes WHERE user_id = ? ORDER BY id`,
    [id]
  );
  const [fosterOffers] = await pool.execute(
    `SELECT id, request_id, note, status, created_at FROM foster_offers WHERE user_id = ? ORDER BY id`,
    [id]
  );
  const [references] = await pool.execute(
    `SELECT id, referee_name, referee_email, referee_relationship, comments, status
     FROM volunteer_references WHERE user_id = ?`,
    [id]
  );
  const [checks] = await pool.execute(
    `SELECT id, reference_number, notes, status FROM background_checks WHERE user_id = ?`,
    [id]
  );

  const [guardianConsents] = await pool.execute(
    `SELECT id, guardian_name, guardian_relationship, guardian_phone, guardian_email,
            consented_at, withdrawn_at
     FROM guardian_consents WHERE user_id = ? ORDER BY id`,
    [id]
  );
  const [trainingAttempts] = await pool.execute(
    `SELECT a.id, a.module_id, a.score_percent, a.passed, a.attempted_at,
            m.name AS module_name
     FROM training_attempts a
     LEFT JOIN training_modules m ON m.id = a.module_id
     WHERE a.user_id = ?
     ORDER BY a.id`,
    [id]
  );
  const [mileageClaims] = await pool.execute(
    `SELECT id, travel_date, miles, purpose, transport_leg_id, opportunity_id,
            status, reviewed_at, created_at
     FROM mileage_claims WHERE user_id = ? ORDER BY id`,
    [id]
  );
  const [memberships] = await pool.execute(
    `SELECT m.id, m.shelter_id, m.role, m.created_at, m.updated_at,
            s.name AS shelter_name, s.slug AS shelter_slug
     FROM memberships m
     LEFT JOIN shelters s ON s.id = m.shelter_id
     WHERE m.user_id = ?
     ORDER BY m.id`,
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
    messages,
    shift_notes: shiftNotes,
    volunteer_shift_notes: volunteerShiftNotes,
    foster_offers: fosterOffers,
    references,
    background_checks: checks,
    guardian_consents: guardianConsents,
    training_attempts: trainingAttempts,
    mileage_claims: mileageClaims,
    memberships,
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
    const lockedHash = await hashPassword(`locked-${id}-${Date.now()}`);

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
         emergency_contact_name = NULL,
         emergency_contact_relationship = NULL,
         emergency_contact_phone = NULL,
         skills = NULL,
         availability = NULL,
         home_type = NULL,
         has_garden = NULL,
         garden_secure = NULL,
         has_other_dogs = NULL,
         has_other_cats = NULL,
         has_children_under_16 = NULL,
         can_medicate = NULL,
         max_foster_size = NULL,
         foster_notes = NULL,
         marketing_consent = 0,
         marketing_consent_at = NULL
       WHERE user_id = ?`,
      [id]
    );

    // Remove free-text custom field answers and document binaries metadata path.
    // Drop object-storage blobs before the rows so keys are not orphaned.
    await UserDocument.deleteStoredObjectsForUser(id);
    await conn.execute('DELETE FROM custom_field_values WHERE user_id = ?', [id]);
    await conn.execute('DELETE FROM user_documents WHERE user_id = ?', [id]);
    await conn.execute('DELETE FROM volunteer_tags WHERE user_id = ?', [id]);
    await conn.execute('DELETE FROM push_subscriptions WHERE user_id = ?', [id]);
    await conn.execute('DELETE FROM volunteer_references WHERE user_id = ?', [id]);
    // Guardian details are a third party's personal data.
    await conn.execute('DELETE FROM guardian_consents WHERE user_id = ?', [id]);
    await conn.execute('DELETE FROM training_attempts WHERE user_id = ?', [id]);
    await conn.execute('DELETE FROM mileage_claims WHERE user_id = ?', [id]);
    await conn.execute('DELETE FROM induction_checklist_progress WHERE user_id = ?', [id]);
    await conn.execute(
      `DELETE FROM volunteer_buddies
        WHERE volunteer_user_id = ? OR buddy_user_id = ?`,
      [id, id]
    );
    await conn.execute(
      `UPDATE messages SET body = '[removed]' WHERE user_id = ?`,
      [id]
    );
    await conn.execute(
      `UPDATE background_checks
         SET reference_number = NULL, notes = NULL
       WHERE user_id = ?`,
      [id]
    );
    await conn.execute(
      `UPDATE shift_notes SET body = '[removed]' WHERE author_id = ?`,
      [id]
    );
    await conn.execute(
      `UPDATE volunteer_shift_notes SET body = '[removed]' WHERE user_id = ?`,
      [id]
    );
    await conn.execute(
      `UPDATE foster_offers SET note = NULL WHERE user_id = ?`,
      [id]
    );
    await conn.execute(
      `UPDATE group_bookings
         SET contact_name = 'Removed',
             contact_email = 'removed@anonymised.invalid',
             notes = NULL
       WHERE lower(contact_email) = lower(?)`,
      [user.email]
    );
    await conn.execute(
      `UPDATE audit_log
         SET detail_json = NULL
       WHERE user_id = ?
          OR (entity_type = 'volunteer' AND entity_id = ?)`,
      [id, String(id)]
    );

    await conn.commit();
    await destroyUserSessions(pool, id);
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
 * Volunteers inactive longer than this shelter's retention_inactive_months.
 * Inactivity = COALESCE(last_login, created_at) older than the threshold.
 * Null months means the feature is off for this shelter.
 */
async function listRetentionCandidates(now = new Date()) {
  const shelterId = currentShelterId();
  const months = await getRetentionMonths();
  if (months == null || !shelterId) {
    return {
      shelter_id: shelterId || null,
      retention_inactive_months: null,
      skipped: true,
      cutoff: null,
      scanned: 0,
      candidates: [],
    };
  }
  const cutoff = cutoffFrom(now, months, 'months');
  const [rows] = await pool.execute(
    `SELECT user_id, first_name, last_name, name, email, last_login, created_at
       FROM users
      WHERE role = 'volunteer'
        AND shelter_id = ?
        AND anonymised_at IS NULL
        AND COALESCE(last_login, created_at) < ?
      ORDER BY user_id ASC`,
    [shelterId, cutoff]
  );
  return {
    shelter_id: shelterId,
    retention_inactive_months: months,
    skipped: false,
    cutoff: cutoff.toISOString(),
    scanned: rows.length,
    candidates: rows.map((row) => ({
      user_id: row.user_id,
      first_name: row.first_name,
      last_name: row.last_name,
      name: row.name,
      email: row.email,
      last_login: row.last_login,
      created_at: row.created_at,
      inactive_since: row.last_login || row.created_at,
    })),
  };
}

/**
 * Anonymise volunteers from listRetentionCandidates via anonymiseUser.
 * Keeps approved hour rows (same GDPR erasure path).
 */
async function runDataRetention(now = new Date()) {
  const preview = await listRetentionCandidates(now);
  if (preview.skipped) {
    return {
      shelter_id: preview.shelter_id,
      retention_inactive_months: null,
      skipped: true,
      cutoff: null,
      scanned: 0,
      anonymised: 0,
      results: [],
      candidates: [],
    };
  }

  const results = [];
  for (const row of preview.candidates) {
    try {
      const outcome = await anonymiseUser(row.user_id, { reason: 'data_retention' });
      results.push({ user_id: row.user_id, ok: true, outcome });
    } catch (err) {
      results.push({ user_id: row.user_id, ok: false, error: err.message });
    }
  }

  return {
    shelter_id: preview.shelter_id,
    retention_inactive_months: preview.retention_inactive_months,
    skipped: false,
    cutoff: preview.cutoff,
    scanned: preview.scanned,
    anonymised: results.filter((r) => r.ok && r.outcome && !r.outcome.already_anonymised).length,
    results,
    candidates: preview.candidates,
  };
}

module.exports = {
  RETENTION_MONTHS_MIN,
  RETENTION_MONTHS_MAX,
  normaliseRetentionMonths,
  getRetentionMonths,
  getRetentionSettings,
  setRetentionMonths,
  listRetentionCandidates,
  buildVolunteerExport,
  anonymiseUser,
  runDataRetention,
};
