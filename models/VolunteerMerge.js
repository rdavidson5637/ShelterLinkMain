'use strict';

/**
 * Staff merge of duplicate volunteer records in the same shelter (SL-DAY-03).
 *
 * Preview two volunteers, then move bookings (applications), shift notes,
 * qualifications and this-shelter memberships onto the kept record and archive
 * the duplicate. Every query runs under the caller's shelter context so RLS
 * fail-closes across shelters: a foreign volunteer is invisible and returns 404.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');
const { hashPassword } = require('../utils/password');
const { destroyUserSessions } = require('../utils/sessionCookie');

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function requireShelter() {
  const id = currentShelterId();
  if (!id) throw fail(403, 'Shelter context is missing');
  return Number(id);
}

function normaliseUserId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw fail(400, `${label} must be a positive integer`);
  }
  return id;
}

function publicVolunteer(row) {
  if (!row) return null;
  return {
    user_id: Number(row.user_id),
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    name: row.name || null,
    email: row.email || null,
    phone: row.phone || null,
    role: row.role,
    shelter_id: row.shelter_id != null ? Number(row.shelter_id) : null,
    approved: row.approved == null ? null : Number(row.approved),
    archived_at: row.archived_at || null,
    anonymised_at: row.anonymised_at || null,
  };
}

async function loadVolunteer(db, userId, shelterId) {
  const [rows] = await db.execute(
    `SELECT u.user_id, u.first_name, u.last_name, u.name, u.email, u.phone,
            u.role, u.shelter_id, u.archived_at, u.anonymised_at, u.merged_into_user_id,
            COALESCE(vp.approved, 0) AS approved
     FROM users u
     LEFT JOIN volunteer_profiles vp ON vp.user_id = u.user_id
     WHERE u.user_id = ?
     LIMIT 1
     FOR UPDATE OF u`,
    [userId]
  );
  const row = rows[0];
  if (!row) throw fail(404, 'Volunteer not found');
  if (Number(row.shelter_id) !== Number(shelterId)) {
    // Defence in depth: RLS should already hide foreign rows.
    throw fail(404, 'Volunteer not found');
  }
  if (row.role !== 'volunteer') {
    throw fail(400, 'Only volunteer accounts can be merged');
  }
  return row;
}

async function countRows(db, sql, params) {
  const [rows] = await db.execute(sql, params);
  return Number(rows[0]?.n || 0);
}

async function gatherCounts(db, keepId, dupId, shelterId) {
  const [
    bookingsKeep,
    bookingsDup,
    bookingConflicts,
    notesKeep,
    notesDup,
    qualsKeep,
    qualsDup,
    qualConflicts,
    membershipsDup,
  ] = await Promise.all([
    countRows(db, 'SELECT COUNT(*)::int AS n FROM applications WHERE user_id = ?', [keepId]),
    countRows(db, 'SELECT COUNT(*)::int AS n FROM applications WHERE user_id = ?', [dupId]),
    countRows(
      db,
      `SELECT COUNT(*)::int AS n
       FROM applications d
       INNER JOIN applications k ON k.opportunity_id = d.opportunity_id AND k.user_id = ?
       WHERE d.user_id = ?`,
      [keepId, dupId]
    ),
    countRows(db, 'SELECT COUNT(*)::int AS n FROM shift_notes WHERE author_id = ?', [keepId]),
    countRows(db, 'SELECT COUNT(*)::int AS n FROM shift_notes WHERE author_id = ?', [dupId]),
    countRows(db, 'SELECT COUNT(*)::int AS n FROM volunteer_qualifications WHERE user_id = ?', [keepId]),
    countRows(db, 'SELECT COUNT(*)::int AS n FROM volunteer_qualifications WHERE user_id = ?', [dupId]),
    countRows(
      db,
      `SELECT COUNT(*)::int AS n
       FROM volunteer_qualifications d
       INNER JOIN volunteer_qualifications k
         ON k.qualification_id = d.qualification_id AND k.user_id = ?
       WHERE d.user_id = ?`,
      [keepId, dupId]
    ),
    countRows(
      db,
      'SELECT COUNT(*)::int AS n FROM memberships WHERE user_id = ? AND shelter_id = ?',
      [dupId, shelterId]
    ),
  ]);

  return {
    bookings: {
      keep: bookingsKeep,
      duplicate: bookingsDup,
      move: bookingsDup - bookingConflicts,
      conflicts: bookingConflicts,
    },
    notes: {
      keep: notesKeep,
      duplicate: notesDup,
      move: notesDup,
    },
    qualifications: {
      keep: qualsKeep,
      duplicate: qualsDup,
      move: qualsDup - qualConflicts,
      conflicts: qualConflicts,
    },
    memberships: {
      duplicate_at_shelter: membershipsDup,
      // Keep already has (or will retain) the shelter membership; dup row is dropped.
      drop: membershipsDup,
    },
  };
}

/**
 * Read-only preview of what a merge would move. Locks both rows so staff see a
 * consistent snapshot, then rolls back.
 */
async function previewMerge(keepUserId, duplicateUserId) {
  const shelterId = requireShelter();
  const keepId = normaliseUserId(keepUserId, 'keep_user_id');
  const dupId = normaliseUserId(duplicateUserId, 'duplicate_user_id');
  if (keepId === dupId) {
    throw fail(400, 'Keep and duplicate must be different volunteers');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const keep = await loadVolunteer(conn, keepId, shelterId);
    const duplicate = await loadVolunteer(conn, dupId, shelterId);

    if (keep.archived_at || keep.anonymised_at) {
      throw fail(400, 'Kept volunteer is archived or anonymised');
    }
    if (duplicate.archived_at || duplicate.anonymised_at) {
      throw fail(400, 'Duplicate volunteer is already archived or anonymised');
    }

    const counts = await gatherCounts(conn, keepId, dupId, shelterId);
    await conn.rollback();

    return {
      shelter_id: shelterId,
      keep: publicVolunteer(keep),
      duplicate: publicVolunteer(duplicate),
      counts,
    };
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Execute the merge: reassign child rows, archive the duplicate, lock sign-in.
 */
async function executeMerge(keepUserId, duplicateUserId) {
  const shelterId = requireShelter();
  const keepId = normaliseUserId(keepUserId, 'keep_user_id');
  const dupId = normaliseUserId(duplicateUserId, 'duplicate_user_id');
  if (keepId === dupId) {
    throw fail(400, 'Keep and duplicate must be different volunteers');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const keep = await loadVolunteer(conn, keepId, shelterId);
    const duplicate = await loadVolunteer(conn, dupId, shelterId);

    if (keep.archived_at || keep.anonymised_at) {
      throw fail(400, 'Kept volunteer is archived or anonymised');
    }
    if (duplicate.archived_at || duplicate.anonymised_at) {
      throw fail(400, 'Duplicate volunteer is already archived or anonymised');
    }

    const before = await gatherCounts(conn, keepId, dupId, shelterId);

    // Drop duplicate bookings that would collide with the kept account.
    if (before.bookings.conflicts > 0) {
      await conn.execute(
        `DELETE FROM applications d
         WHERE d.user_id = ?
           AND EXISTS (
             SELECT 1 FROM applications k
             WHERE k.user_id = ? AND k.opportunity_id = d.opportunity_id
           )`,
        [dupId, keepId]
      );
    }

    const [bookingMove] = await conn.execute(
      `UPDATE applications SET user_id = ? WHERE user_id = ?`,
      [keepId, dupId]
    );

    const [notesMove] = await conn.execute(
      `UPDATE shift_notes SET author_id = ? WHERE author_id = ?`,
      [keepId, dupId]
    );

    // After-shift notes follow the volunteer; application_id unique may collide
    // when both had a note on the same booking (bookings already deduped above).
    await conn.execute(
      `DELETE FROM volunteer_shift_notes d
       WHERE d.user_id = ?
         AND EXISTS (
           SELECT 1 FROM volunteer_shift_notes k
           WHERE k.user_id = ? AND k.application_id = d.application_id
         )`,
      [dupId, keepId]
    );
    await conn.execute(
      `UPDATE volunteer_shift_notes SET user_id = ? WHERE user_id = ?`,
      [keepId, dupId]
    );

    if (before.qualifications.conflicts > 0) {
      await conn.execute(
        `DELETE FROM volunteer_qualifications d
         WHERE d.user_id = ?
           AND EXISTS (
             SELECT 1 FROM volunteer_qualifications k
             WHERE k.user_id = ? AND k.qualification_id = d.qualification_id
           )`,
        [dupId, keepId]
      );
    }

    const [qualMove] = await conn.execute(
      `UPDATE volunteer_qualifications SET user_id = ? WHERE user_id = ?`,
      [keepId, dupId]
    );

    // Memberships: only this shelter. Never touch another sanctuary's rows.
    const [membershipDrop] = await conn.execute(
      `DELETE FROM memberships WHERE user_id = ? AND shelter_id = ?`,
      [dupId, shelterId]
    );

    const lockedHash = await hashPassword(`archived-merge-${dupId}-${Date.now()}`);
    const archivedEmail = `merged+${dupId}@archived.invalid`;

    await conn.execute(
      `UPDATE users SET
         archived_at = NOW(),
         merged_into_user_id = ?,
         email = ?,
         password = ?,
         reset_token = NULL,
         reset_token_expires = NULL,
         ical_token = NULL
       WHERE user_id = ?`,
      [keepId, archivedEmail, lockedHash, dupId]
    );

    await destroyUserSessions(conn, dupId);

    const moved = {
      bookings: Number(bookingMove?.rowCount ?? bookingMove?.affectedRows ?? before.bookings.move),
      notes: Number(notesMove?.rowCount ?? notesMove?.affectedRows ?? before.notes.move),
      qualifications: Number(qualMove?.rowCount ?? qualMove?.affectedRows ?? before.qualifications.move),
      memberships_dropped: Number(
        membershipDrop?.rowCount ?? membershipDrop?.affectedRows ?? before.memberships.drop
      ),
      booking_conflicts_dropped: before.bookings.conflicts,
      qualification_conflicts_dropped: before.qualifications.conflicts,
    };

    await conn.commit();

    return {
      shelter_id: shelterId,
      keep: publicVolunteer(keep),
      duplicate: {
        ...publicVolunteer(duplicate),
        email: archivedEmail,
        archived_at: new Date().toISOString(),
      },
      moved,
    };
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  previewMerge,
  executeMerge,
};
