'use strict';

/**
 * Buddy / mentor pairing for new volunteers (SL-DAY-08).
 * Staff assign one existing volunteer as a buddy. Both sides can read the
 * pairing on home/profile. Optional email to the buddy on assign only.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireShelterId() {
  const id = currentShelterId();
  if (!id) throw fail(403, 'Shelter context is missing');
  return id;
}

function displayName(row) {
  if (!row) return null;
  const fromParts = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return fromParts || row.name || null;
}

function mapPairing(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    volunteer_user_id: Number(row.volunteer_user_id),
    buddy_user_id: Number(row.buddy_user_id),
    assigned_at: row.assigned_at || null,
    assigned_by: row.assigned_by != null ? Number(row.assigned_by) : null,
    notify_emailed_at: row.notify_emailed_at || null,
    volunteer: {
      user_id: Number(row.volunteer_user_id),
      name: displayName({
        first_name: row.volunteer_first_name,
        last_name: row.volunteer_last_name,
        name: row.volunteer_name,
      }),
      email: row.volunteer_email || null,
      first_name: row.volunteer_first_name || null,
    },
    buddy: {
      user_id: Number(row.buddy_user_id),
      name: displayName({
        first_name: row.buddy_first_name,
        last_name: row.buddy_last_name,
        name: row.buddy_name,
      }),
      email: row.buddy_email || null,
      first_name: row.buddy_first_name || null,
    },
  };
}

const PAIRING_SELECT = `
  SELECT
    b.id,
    b.volunteer_user_id,
    b.buddy_user_id,
    b.assigned_by,
    b.assigned_at,
    b.notify_emailed_at,
    v.first_name AS volunteer_first_name,
    v.last_name AS volunteer_last_name,
    v.name AS volunteer_name,
    v.email AS volunteer_email,
    u.first_name AS buddy_first_name,
    u.last_name AS buddy_last_name,
    u.name AS buddy_name,
    u.email AS buddy_email
  FROM volunteer_buddies b
  JOIN users v ON v.user_id = b.volunteer_user_id
  JOIN users u ON u.user_id = b.buddy_user_id
`;

async function findActiveVolunteer(userId) {
  const [rows] = await pool.execute(
    `SELECT user_id, first_name, last_name, name, email, role, archived_at, anonymised_at
       FROM users
      WHERE user_id = ?
        AND role = 'volunteer'
      LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.archived_at || row.anonymised_at) return null;
  return row;
}

async function forVolunteer(volunteerUserId) {
  requireShelterId();
  const id = Number(volunteerUserId);
  if (!Number.isInteger(id) || id <= 0) throw fail(400, 'Invalid volunteer');

  const volunteer = await findActiveVolunteer(id);
  if (!volunteer) throw fail(404, 'Volunteer not found');

  const [rows] = await pool.execute(
    `${PAIRING_SELECT}
      WHERE b.volunteer_user_id = ?
      LIMIT 1`,
    [id]
  );
  return {
    volunteer: {
      user_id: Number(volunteer.user_id),
      name: displayName(volunteer),
      email: volunteer.email || null,
      first_name: volunteer.first_name || null,
    },
    pairing: mapPairing(rows[0] || null),
  };
}

async function forMe(userId) {
  requireShelterId();
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw fail(400, 'Invalid user');

  const [asVolunteerRows] = await pool.execute(
    `${PAIRING_SELECT}
      WHERE b.volunteer_user_id = ?
      LIMIT 1`,
    [id]
  );
  const [asBuddyRows] = await pool.execute(
    `${PAIRING_SELECT}
      WHERE b.buddy_user_id = ?
      ORDER BY b.assigned_at DESC, b.id DESC`,
    [id]
  );

  return {
    as_volunteer: mapPairing(asVolunteerRows[0] || null),
    as_buddy: asBuddyRows.map(mapPairing),
  };
}

/**
 * Assign or replace the buddy for a volunteer.
 * Returns { pairing, previousBuddyUserId, changed }.
 */
async function assign({ volunteerUserId, buddyUserId, assignedBy = null } = {}) {
  requireShelterId();
  const volunteerId = Number(volunteerUserId);
  const buddyId = Number(buddyUserId);
  if (!Number.isInteger(volunteerId) || volunteerId <= 0) {
    throw fail(400, 'Invalid volunteer');
  }
  if (!Number.isInteger(buddyId) || buddyId <= 0) {
    throw fail(400, 'Choose a buddy from the volunteer list.');
  }
  if (volunteerId === buddyId) {
    throw fail(400, 'A volunteer cannot be their own buddy.');
  }

  const volunteer = await findActiveVolunteer(volunteerId);
  if (!volunteer) throw fail(404, 'Volunteer not found');
  const buddy = await findActiveVolunteer(buddyId);
  if (!buddy) throw fail(400, 'Buddy must be an active volunteer at this shelter.');

  const existing = await forVolunteer(volunteerId);
  if (existing.pairing && Number(existing.pairing.buddy_user_id) === buddyId) {
    return {
      pairing: existing.pairing,
      previousBuddyUserId: buddyId,
      changed: false,
      volunteer,
      buddy,
    };
  }

  const assignedById =
    assignedBy != null && Number.isInteger(Number(assignedBy)) && Number(assignedBy) > 0
      ? Number(assignedBy)
      : null;

  if (existing.pairing) {
    await pool.execute(
      `UPDATE volunteer_buddies
          SET buddy_user_id = ?,
              assigned_by = ?,
              assigned_at = CURRENT_TIMESTAMP,
              notify_emailed_at = NULL
        WHERE volunteer_user_id = ?`,
      [buddyId, assignedById, volunteerId]
    );
  } else {
    await pool.execute(
      `INSERT INTO volunteer_buddies (volunteer_user_id, buddy_user_id, assigned_by)
       VALUES (?, ?, ?)`,
      [volunteerId, buddyId, assignedById]
    );
  }

  const refreshed = await forVolunteer(volunteerId);
  return {
    pairing: refreshed.pairing,
    previousBuddyUserId: existing.pairing ? Number(existing.pairing.buddy_user_id) : null,
    changed: true,
    volunteer,
    buddy,
  };
}

async function clear(volunteerUserId) {
  requireShelterId();
  const id = Number(volunteerUserId);
  if (!Number.isInteger(id) || id <= 0) throw fail(400, 'Invalid volunteer');

  const volunteer = await findActiveVolunteer(id);
  if (!volunteer) throw fail(404, 'Volunteer not found');

  const existing = await forVolunteer(id);
  if (!existing.pairing) {
    return { cleared: false, pairing: null };
  }

  await pool.execute(`DELETE FROM volunteer_buddies WHERE volunteer_user_id = ?`, [id]);
  return { cleared: true, pairing: existing.pairing };
}

async function markNotified(volunteerUserId, when = new Date()) {
  requireShelterId();
  const id = Number(volunteerUserId);
  if (!Number.isInteger(id) || id <= 0) throw fail(400, 'Invalid volunteer');
  const whenSql = when.toISOString().slice(0, 19).replace('T', ' ');
  await pool.execute(
    `UPDATE volunteer_buddies
        SET notify_emailed_at = COALESCE(notify_emailed_at, ?)
      WHERE volunteer_user_id = ?`,
    [whenSql, id]
  );
  return forVolunteer(id);
}

module.exports = {
  forVolunteer,
  forMe,
  assign,
  clear,
  markNotified,
  findActiveVolunteer,
};
