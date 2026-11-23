'use strict';

/**
 * Per-shelter minimum age and guardian consent records (SL-NOW-02).
 * See database/041_under_18_guardian_consent.pg.sql and utils/ageRules.js.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');
const { todayIso, calendarDay } = require('../utils/shelterTime');
const { assessAge, normaliseMinAge, allowsMinors, ADULT_AGE } = require('../utils/ageRules');

const CONSENT_COLUMNS = `
  id, user_id, guardian_name, guardian_relationship, guardian_phone,
  guardian_email, consented_at, recorded_by, withdrawn_at, withdrawn_by
`;

// Always name the shelter row. Row level security is a second guard.
async function getShelterSettings() {
  const shelterId = currentShelterId();
  if (!shelterId) return { min_volunteer_age: null, updated_at: null };
  const [rows] = await pool.execute(
    `SELECT min_volunteer_age, updated_at
       FROM shelter_settings
      WHERE shelter_id = ?
      LIMIT 1`,
    [shelterId]
  );
  const row = rows[0] || null;
  return {
    min_volunteer_age: normaliseMinAge(row ? row.min_volunteer_age : null),
    updated_at: row ? row.updated_at : null,
  };
}

async function setMinVolunteerAge(minAge, updatedBy) {
  const shelterId = currentShelterId();
  if (!shelterId) {
    const err = new Error('Shelter context is missing');
    err.status = 403;
    throw err;
  }
  await pool.execute(
    `INSERT INTO shelter_settings (shelter_id, min_volunteer_age, updated_by, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (shelter_id) DO UPDATE
       SET min_volunteer_age = EXCLUDED.min_volunteer_age,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
    [shelterId, minAge, updatedBy || null]
  );
  return getShelterSettings();
}

async function findActiveForUser(userId) {
  if (!userId) throw new Error('userId is required');
  const [rows] = await pool.execute(
    `SELECT ${CONSENT_COLUMNS}
       FROM guardian_consents
      WHERE user_id = ? AND withdrawn_at IS NULL
      ORDER BY consented_at DESC
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function listForUser(userId) {
  if (!userId) throw new Error('userId is required');
  const [rows] = await pool.execute(
    `SELECT ${CONSENT_COLUMNS}
       FROM guardian_consents
      WHERE user_id = ?
      ORDER BY consented_at DESC, id DESC`,
    [userId]
  );
  return rows;
}

/**
 * Record a new consent. Any earlier active consent is withdrawn first, so
 * there is never more than one active row for a volunteer.
 */
async function record(userId, details, recordedBy) {
  if (!userId) throw new Error('userId is required');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE guardian_consents
          SET withdrawn_at = CURRENT_TIMESTAMP, withdrawn_by = ?
        WHERE user_id = ? AND withdrawn_at IS NULL`,
      [recordedBy || null, userId]
    );
    await conn.execute(
      `INSERT INTO guardian_consents
         (user_id, guardian_name, guardian_relationship, guardian_phone, guardian_email, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        details.guardian_name,
        details.guardian_relationship,
        details.guardian_phone || null,
        details.guardian_email || null,
        recordedBy || null,
      ]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return findActiveForUser(userId);
}

async function withdraw(userId, withdrawnBy) {
  if (!userId) throw new Error('userId is required');
  const [result] = await pool.execute(
    `UPDATE guardian_consents
        SET withdrawn_at = CURRENT_TIMESTAMP, withdrawn_by = ?
      WHERE user_id = ? AND withdrawn_at IS NULL`,
    [withdrawnBy || null, userId]
  );
  return result.affectedRows > 0;
}

/**
 * Age check for a booking. profile is the volunteer_profiles row (it carries
 * date_of_birth); opportunity may be null, in which case today is used.
 */
async function assessForBooking(userId, profile, opportunity) {
  const settings = await getShelterSettings();
  const onDay = (opportunity && calendarDay(opportunity.start_date)) || todayIso();
  const dateOfBirth = profile ? profile.date_of_birth : null;

  // Only look up consent when it could matter.
  const preliminary = assessAge({
    dateOfBirth,
    minAge: settings.min_volunteer_age,
    hasConsent: true,
    onDay,
  });
  if (!preliminary.ok || !preliminary.needsConsent) return preliminary;

  const consent = await findActiveForUser(userId);
  return assessAge({
    dateOfBirth,
    minAge: settings.min_volunteer_age,
    hasConsent: Boolean(consent),
    onDay,
  });
}

module.exports = {
  ADULT_AGE,
  allowsMinors,
  getShelterSettings,
  setMinVolunteerAge,
  findActiveForUser,
  listForUser,
  record,
  withdraw,
  assessForBooking,
};
