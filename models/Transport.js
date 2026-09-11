'use strict';

const { pool } = require('../config/database');

const RUN_STATUSES = new Set([
  'open',
  'part_covered',
  'covered',
  'completed',
  'cancelled',
]);

const COORDINATION_HINT =
  'Coordinate handovers via the shelter — do not contact other drivers directly. Use the transport run message thread if available.';

/**
 * Derive run status from leg claim/completion state.
 * Cancelled is sticky (caller must not overwrite).
 */
function deriveRunStatus(legs = []) {
  const list = Array.isArray(legs) ? legs : [];
  if (!list.length) return 'open';
  const claimed = list.filter((l) => l.claimed_by != null).length;
  const completed = list.filter((l) => l.completed_at != null).length;
  if (completed === list.length) return 'completed';
  if (claimed === list.length) return 'covered';
  if (claimed > 0) return 'part_covered';
  return 'open';
}

function mapRun(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    animal_id: row.animal_id == null ? null : Number(row.animal_id),
    created_by: Number(row.created_by),
  };
}

function mapLeg(row, { includeContact = false } = {}) {
  if (!row) return null;
  const base = {
    id: Number(row.id),
    run_id: Number(row.run_id),
    leg_order: Number(row.leg_order),
    from_location: row.from_location,
    to_location: row.to_location,
    depart_at: row.depart_at || null,
    arrive_by: row.arrive_by || null,
    distance_miles:
      row.distance_miles == null || row.distance_miles === ''
        ? null
        : Number(row.distance_miles),
    claimed_by: row.claimed_by == null ? null : Number(row.claimed_by),
    claimed_at: row.claimed_at || null,
    completed_at: row.completed_at || null,
    notes: row.notes || null,
    expense_claimed: Number(row.expense_claimed) ? 1 : 0,
    claimer_first_name: row.claimer_first_name || null,
    claimer_last_name: row.claimer_last_name || null,
    claimer_name:
      row.claimer_name ||
      [row.claimer_first_name, row.claimer_last_name].filter(Boolean).join(' ').trim() ||
      null,
  };
  if (includeContact) {
    base.claimer_email = row.claimer_email || null;
    base.claimer_phone = row.claimer_phone || null;
  }
  return base;
}

/** Adjacent-leg summary for volunteers — no contact fields. */
function toAdjacentLegSummary(leg) {
  if (!leg) return null;
  return {
    exists: true,
    leg_order: Number(leg.leg_order),
    from_location: leg.from_location,
    to_location: leg.to_location,
    is_claimed: leg.claimed_by != null,
    is_completed: leg.completed_at != null,
  };
}

function toVolunteerSafeLeg(leg) {
  if (!leg) return null;
  return {
    id: Number(leg.id),
    run_id: Number(leg.run_id),
    leg_order: Number(leg.leg_order),
    from_location: leg.from_location,
    to_location: leg.to_location,
    depart_at: leg.depart_at || null,
    arrive_by: leg.arrive_by || null,
    distance_miles:
      leg.distance_miles == null || leg.distance_miles === ''
        ? null
        : Number(leg.distance_miles),
    claimed_by: leg.claimed_by == null ? null : Number(leg.claimed_by),
    claimed_at: leg.claimed_at || null,
    completed_at: leg.completed_at || null,
    notes: leg.notes || null,
    expense_claimed: Number(leg.expense_claimed) ? 1 : 0,
    run_title: leg.run_title || null,
    run_date: leg.run_date || null,
    run_status: leg.run_status || null,
    animal_id: leg.animal_id == null ? null : Number(leg.animal_id),
    animal_name: leg.animal_name || null,
  };
}

async function findRunById(id) {
  const [rows] = await pool.execute(
    `
      SELECT tr.*, a.name AS animal_name, a.species AS animal_species,
             u.first_name AS creator_first_name, u.last_name AS creator_last_name
      FROM transport_runs tr
      LEFT JOIN animals a ON a.id = tr.animal_id
      LEFT JOIN users u ON u.user_id = tr.created_by
      WHERE tr.id = ?
      LIMIT 1
    `,
    [id]
  );
  return mapRun(rows[0]);
}

async function listLegsForRun(runId, { includeContact = false } = {}) {
  const [rows] = await pool.execute(
    `
      SELECT tl.*,
             u.first_name AS claimer_first_name,
             u.last_name AS claimer_last_name,
             u.email AS claimer_email,
             u.phone AS claimer_phone,
             TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS claimer_name
      FROM transport_legs tl
      LEFT JOIN users u ON u.user_id = tl.claimed_by
      WHERE tl.run_id = ?
      ORDER BY tl.leg_order ASC, tl.id ASC
    `,
    [runId]
  );
  return rows.map((row) => mapLeg(row, { includeContact }));
}

async function findLegById(id, { includeContact = false } = {}) {
  const [rows] = await pool.execute(
    `
      SELECT tl.*,
             tr.title AS run_title,
             tr.run_date,
             tr.status AS run_status,
             tr.animal_id,
             a.name AS animal_name,
             u.first_name AS claimer_first_name,
             u.last_name AS claimer_last_name,
             u.email AS claimer_email,
             u.phone AS claimer_phone,
             TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS claimer_name
      FROM transport_legs tl
      INNER JOIN transport_runs tr ON tr.id = tl.run_id
      LEFT JOIN animals a ON a.id = tr.animal_id
      LEFT JOIN users u ON u.user_id = tl.claimed_by
      WHERE tl.id = ?
      LIMIT 1
    `,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...mapLeg(row, { includeContact }),
    run_title: row.run_title,
    run_date: row.run_date,
    run_status: row.run_status,
    animal_id: row.animal_id == null ? null : Number(row.animal_id),
    animal_name: row.animal_name || null,
  };
}

async function refreshRunStatus(runId, connection = null) {
  const exec = connection || pool;
  const [legRows] = await exec.execute(
    `SELECT claimed_by, completed_at FROM transport_legs WHERE run_id = ? ORDER BY leg_order`,
    [runId]
  );
  const [runRows] = await exec.execute(
    `SELECT status FROM transport_runs WHERE id = ? LIMIT 1`,
    [runId]
  );
  const current = runRows[0]?.status;
  if (current === 'cancelled') return 'cancelled';
  const next = deriveRunStatus(legRows);
  if (next !== current) {
    await exec.execute(`UPDATE transport_runs SET status = ? WHERE id = ?`, [next, runId]);
  }
  return next;
}

async function createRun({
  animalId = null,
  title,
  runDate,
  notes = null,
  createdBy,
  legs = [],
} = {}) {
  if (!title || !String(title).trim()) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }
  if (!runDate) {
    const err = new Error('run_date is required');
    err.status = 400;
    throw err;
  }
  if (!createdBy) {
    const err = new Error('created_by is required');
    err.status = 400;
    throw err;
  }
  const legList = Array.isArray(legs) ? legs : [];
  if (!legList.length) {
    const err = new Error('At least one leg is required');
    err.status = 400;
    throw err;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `
        INSERT INTO transport_runs (animal_id, title, run_date, notes, status, created_by)
        VALUES (?, ?, ?, ?, 'open', ?)
      `,
      [
        animalId == null || animalId === '' ? null : Number(animalId),
        String(title).trim(),
        String(runDate).slice(0, 10),
        notes || null,
        Number(createdBy),
      ]
    );
    const runId = result.insertId;

    for (let i = 0; i < legList.length; i += 1) {
      const leg = legList[i] || {};
      const from = String(leg.from_location || leg.from || '').trim();
      const to = String(leg.to_location || leg.to || '').trim();
      if (!from || !to) {
        const err = new Error(`Leg ${i + 1}: from_location and to_location are required`);
        err.status = 400;
        throw err;
      }
      const order =
        leg.leg_order != null && Number.isFinite(Number(leg.leg_order))
          ? Number(leg.leg_order)
          : i + 1;
      await connection.execute(
        `
          INSERT INTO transport_legs
            (run_id, leg_order, from_location, to_location, depart_at, arrive_by, distance_miles, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          runId,
          order,
          from,
          to,
          leg.depart_at || null,
          leg.arrive_by || null,
          leg.distance_miles == null || leg.distance_miles === ''
            ? null
            : Number(leg.distance_miles),
          leg.notes || null,
        ]
      );
    }

    await connection.commit();
    return getRunDetail(runId, { includeContact: true });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function listRuns({ status = null } = {}) {
  const params = [];
  let where = '';
  if (status && RUN_STATUSES.has(status)) {
    where = 'WHERE tr.status = ?';
    params.push(status);
  }
  const [rows] = await pool.execute(
    `
      SELECT tr.*, a.name AS animal_name,
             (SELECT COUNT(*)::int FROM transport_legs tl WHERE tl.run_id = tr.id) AS leg_count,
             (SELECT COUNT(*)::int FROM transport_legs tl
                WHERE tl.run_id = tr.id AND tl.claimed_by IS NOT NULL) AS claimed_count
      FROM transport_runs tr
      LEFT JOIN animals a ON a.id = tr.animal_id
      ${where}
      ORDER BY tr.run_date DESC, tr.id DESC
    `,
    params
  );
  return rows.map(mapRun);
}

async function getRunDetail(runId, { includeContact = false } = {}) {
  const run = await findRunById(runId);
  if (!run) return null;
  const legs = await listLegsForRun(runId, { includeContact });
  return { ...run, legs };
}

/**
 * 'open'/'part_covered'/'covered'/'completed' are derived from leg
 * claim/completion state by refreshRunStatus, which runs after every claim
 * and every leg completion — they are never settable directly. A caller that
 * requested one of them here used to get a silent 200 that immediately
 * reverted the status right back to whatever the legs implied. 'cancelled'
 * is the only status this endpoint can durably set, so that's the only one
 * it accepts; requesting anything else is a 400, not a no-op success.
 */
async function updateRunStatus(runId, status) {
  if (status !== 'cancelled') {
    const err = new Error(
      "Only 'cancelled' can be set directly here; open/part_covered/covered/completed are derived from leg state"
    );
    err.status = 400;
    throw err;
  }
  const [result] = await pool.execute(
    `UPDATE transport_runs SET status = ? WHERE id = ?`,
    [status, runId]
  );
  if (!result.affectedRows) return null;
  return findRunById(runId);
}

/**
 * Open (unclaimed) legs on non-cancelled / non-completed runs for volunteers.
 */
async function listOpenLegsForVolunteers() {
  const [rows] = await pool.execute(
    `
      SELECT tl.*,
             tr.title AS run_title,
             tr.run_date,
             tr.status AS run_status,
             tr.animal_id,
             a.name AS animal_name
      FROM transport_legs tl
      INNER JOIN transport_runs tr ON tr.id = tl.run_id
      LEFT JOIN animals a ON a.id = tr.animal_id
      WHERE tl.claimed_by IS NULL
        AND tr.status IN ('open', 'part_covered')
      ORDER BY tr.run_date ASC, tl.leg_order ASC, tl.id ASC
    `
  );
  return rows.map(toVolunteerSafeLeg);
}

async function listMyLegs(userId) {
  const [rows] = await pool.execute(
    `
      SELECT tl.*,
             tr.title AS run_title,
             tr.run_date,
             tr.status AS run_status,
             tr.animal_id,
             a.name AS animal_name
      FROM transport_legs tl
      INNER JOIN transport_runs tr ON tr.id = tl.run_id
      LEFT JOIN animals a ON a.id = tr.animal_id
      WHERE tl.claimed_by = ?
      ORDER BY tr.run_date DESC, tl.leg_order ASC
    `,
    [userId]
  );
  return rows.map(toVolunteerSafeLeg);
}

/**
 * Atomic claim: FOR UPDATE so two drivers cannot take the same leg.
 */
async function claimLeg(legId, userId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `
        SELECT tl.*, tr.status AS run_status, tr.animal_id
        FROM transport_legs tl
        INNER JOIN transport_runs tr ON tr.id = tl.run_id
        WHERE tl.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [legId]
    );
    const leg = rows[0];
    if (!leg) {
      const err = new Error('Leg not found');
      err.status = 404;
      throw err;
    }
    if (['cancelled', 'completed'].includes(leg.run_status)) {
      const err = new Error('This transport run is not open for claims');
      err.status = 400;
      throw err;
    }
    if (leg.claimed_by != null) {
      const err = new Error('This leg has already been claimed');
      err.status = 409;
      throw err;
    }

    await connection.execute(
      `
        UPDATE transport_legs
        SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND claimed_by IS NULL
      `,
      [userId, legId]
    );

    await refreshRunStatus(leg.run_id, connection);
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    connection.release();
  }

  return buildClaimResponse(legId, userId);
}

async function buildClaimResponse(legId, userId) {
  const leg = await findLegById(legId, { includeContact: false });
  if (!leg) return null;
  const siblings = await listLegsForRun(leg.run_id, { includeContact: false });
  const idx = siblings.findIndex((l) => l.id === Number(legId));
  const previous = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  return {
    leg: toVolunteerSafeLeg(leg),
    previous_leg: previous ? toAdjacentLegSummary(previous) : { exists: false },
    next_leg: next ? toAdjacentLegSummary(next) : { exists: false },
    coordination: COORDINATION_HINT,
    message_context: {
      context_type: 'transport_run',
      context_id: leg.run_id,
    },
    claimed_by: Number(userId),
  };
}

async function completeLeg(legId, userId, { distanceMiles = null, notes = null } = {}) {
  const connection = await pool.getConnection();
  let animalId = null;
  let runId = null;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `
        SELECT tl.*, tr.animal_id, tr.status AS run_status
        FROM transport_legs tl
        INNER JOIN transport_runs tr ON tr.id = tl.run_id
        WHERE tl.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [legId]
    );
    const leg = rows[0];
    if (!leg) {
      const err = new Error('Leg not found');
      err.status = 404;
      throw err;
    }
    // Same guard claimLeg applies — a cancelled run shouldn't gain a
    // "completed" leg (and the bogus animal-activity note that comes with it)
    // just because a driver who claimed it earlier wasn't told it was cancelled.
    if (['cancelled', 'completed'].includes(leg.run_status)) {
      const err = new Error('This transport run is no longer open for completion');
      err.status = 400;
      throw err;
    }
    if (Number(leg.claimed_by) !== Number(userId)) {
      const err = new Error('Only the claiming driver can complete this leg');
      err.status = 403;
      throw err;
    }
    if (leg.completed_at) {
      const err = new Error('Leg already completed');
      err.status = 400;
      throw err;
    }

    let miles = leg.distance_miles;
    if (distanceMiles != null && distanceMiles !== '') {
      const parsed = Number(distanceMiles);
      if (!Number.isFinite(parsed) || parsed < 0) {
        const err = new Error('distance_miles must be a non-negative number');
        err.status = 400;
        throw err;
      }
      miles = parsed;
    }
    await connection.execute(
      `
        UPDATE transport_legs
        SET completed_at = CURRENT_TIMESTAMP,
            distance_miles = COALESCE(?, distance_miles),
            notes = COALESCE(?, notes)
        WHERE id = ?
      `,
      [miles, notes || null, legId]
    );

    animalId = leg.animal_id == null ? null : Number(leg.animal_id);
    runId = Number(leg.run_id);
    await refreshRunStatus(runId, connection);
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    connection.release();
  }

  let activity = null;
  if (animalId) {
    // The leg is already committed as complete at this point — a failure
    // logging the animal-activity note (pool exhaustion, animal deleted
    // concurrently, etc.) must not turn an already-successful completion
    // into a 500 that tells the driver it failed.
    try {
      const Animal = require('./Animal');
      const noteParts = [`Transport leg #${legId} completed`];
      if (notes) noteParts.push(notes);
      activity = await Animal.logActivity({
        animalId,
        userId,
        activityType: 'transport',
        notes: noteParts.join(': '),
      });
    } catch (activityError) {
      console.error('[Transport] completeLeg activity log error:', activityError.message);
    }
  }

  const leg = await findLegById(legId, { includeContact: false });
  return { leg: toVolunteerSafeLeg(leg), activity };
}

async function setExpenseClaimed(legId, claimed = true) {
  const [result] = await pool.execute(
    `UPDATE transport_legs SET expense_claimed = ? WHERE id = ?`,
    [claimed ? 1 : 0, legId]
  );
  if (!result.affectedRows) return null;
  return findLegById(legId, { includeContact: true });
}

function canReflagUrgent(run) {
  if (!run || !run.urgent_flagged_at) return true;
  const flagged = new Date(run.urgent_flagged_at).getTime();
  if (Number.isNaN(flagged)) return true;
  return Date.now() - flagged >= 24 * 60 * 60 * 1000;
}

async function markUrgentFlagged(runId) {
  await pool.execute(
    `UPDATE transport_runs SET urgent_flagged_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [runId]
  );
  return findRunById(runId);
}

/**
 * Approved volunteers who have not already claimed a leg on this run.
 */
async function resolveChaseRecipients(runId, { limit = 200 } = {}) {
  const [rows] = await pool.execute(
    `
      SELECT u.user_id, u.email, u.first_name, u.last_name
      FROM users u
      INNER JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      WHERE u.role = 'volunteer'
        AND COALESCE(vp.approved, 0) = 1
        AND u.email IS NOT NULL AND u.email <> ''
        AND (vp.away_until IS NULL OR vp.away_until < CURRENT_DATE)
        AND NOT EXISTS (
          SELECT 1 FROM transport_legs tl
          WHERE tl.run_id = ? AND tl.claimed_by = u.user_id
        )
      ORDER BY u.user_id ASC
      LIMIT ?
    `,
    [runId, Math.min(Math.max(Number(limit) || 200, 1), 200)]
  );
  return rows;
}

async function mileageTotalsByDriver(runId = null) {
  const params = [];
  let where = 'WHERE tl.claimed_by IS NOT NULL AND tl.distance_miles IS NOT NULL';
  if (runId != null) {
    where += ' AND tl.run_id = ?';
    params.push(Number(runId));
  }
  const [rows] = await pool.execute(
    `
      SELECT
        tl.claimed_by AS user_id,
        u.first_name,
        u.last_name,
        u.email,
        SUM(tl.distance_miles)::float AS total_miles,
        COUNT(*)::int AS leg_count,
        SUM(CASE WHEN tl.expense_claimed = 1 THEN 1 ELSE 0 END)::int AS expense_claimed_count
      FROM transport_legs tl
      INNER JOIN users u ON u.user_id = tl.claimed_by
      ${where}
      GROUP BY tl.claimed_by, u.first_name, u.last_name, u.email
      ORDER BY total_miles DESC
    `,
    params
  );
  return rows.map((r) => ({
    user_id: Number(r.user_id),
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    total_miles: Number(r.total_miles) || 0,
    leg_count: Number(r.leg_count) || 0,
    expense_claimed_count: Number(r.expense_claimed_count) || 0,
  }));
}

module.exports = {
  RUN_STATUSES,
  COORDINATION_HINT,
  deriveRunStatus,
  mapRun,
  mapLeg,
  toAdjacentLegSummary,
  toVolunteerSafeLeg,
  findRunById,
  listLegsForRun,
  findLegById,
  refreshRunStatus,
  createRun,
  listRuns,
  getRunDetail,
  updateRunStatus,
  listOpenLegsForVolunteers,
  listMyLegs,
  claimLeg,
  buildClaimResponse,
  completeLeg,
  setExpenseClaimed,
  canReflagUrgent,
  markUrgentFlagged,
  resolveChaseRecipients,
  mileageTotalsByDriver,
};
