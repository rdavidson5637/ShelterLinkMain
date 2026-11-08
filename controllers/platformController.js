'use strict';

/**
 * Platform owner actions: the shelter approval queue and suspension.
 *
 * These handlers read and write only shelters, shelter_applications,
 * admin_invites, platform_owners and platform_audit. They never read users,
 * volunteer_profiles or any other tenant volunteer data. Every query runs
 * outside shelter context (runWithoutShelter), and no shelter id is read
 * from the client: shelter ids come from route params naming a shelter row
 * the owner acts on, or from the row just inserted.
 */

const { pool } = require('../config/database');
const { runWithoutShelter } = require('../utils/shelterContext');
const { createShelter, createInvite } = require('../services/shelterProvision');
const { forgetShelter } = require('../middleware/shelter');

const APPLICATION_STATUSES = new Set(['pending', 'approved', 'rejected']);
const REASON_MIN = 3;
const REASON_MAX = 1000;
const LIST_LIMIT = 200;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendError(res, next, error) {
  if (error && Number.isInteger(error.status) && error.status < 500) {
    return res.status(error.status).json({ error: error.message });
  }
  return next(error);
}

/** Run fn(conn) in one transaction outside any shelter context. */
function inPlatformTransaction(fn) {
  return runWithoutShelter(async () => {
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
  });
}

async function recordPlatformAudit(db, {
  actorUserId,
  action,
  applicationId = null,
  targetShelterId = null,
  detail = null,
}) {
  await db.execute(
    `INSERT INTO platform_audit (actor_user_id, action, application_id, target_shelter_id, detail)
     VALUES (?, ?, ?, ?, ?)`,
    [actorUserId, action, applicationId, targetShelterId, detail == null ? null : JSON.stringify(detail)]
  );
}

function parseSnapshot(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readReason(body, { required }) {
  const raw = body && body.reason;
  if (raw == null || raw === '') {
    if (required) throw fail(400, 'A reason is required');
    return null;
  }
  if (typeof raw !== 'string') throw fail(400, 'Reason must be text');
  const reason = raw.trim();
  if (required && reason.length < REASON_MIN) {
    throw fail(400, `Reason must be at least ${REASON_MIN} characters`);
  }
  if (reason.length > REASON_MAX) throw fail(400, `Reason must be at most ${REASON_MAX} characters`);
  return reason || null;
}

const APPLICATION_COLUMNS = `id, shelter_name, desired_slug, regulator, charity_number,
  register_snapshot, contact_name, contact_email, status, decided_by, decided_at,
  reason, created_at`;

async function listApplications(req, res, next) {
  try {
    const requested = typeof req.query.status === 'string' ? req.query.status : 'pending';
    if (requested !== 'all' && !APPLICATION_STATUSES.has(requested)) {
      return res.status(400).json({ error: 'status must be pending, approved, rejected, or all' });
    }
    const [rows] = await runWithoutShelter(() => (requested === 'all'
      ? pool.execute(
        `SELECT ${APPLICATION_COLUMNS} FROM shelter_applications
         ORDER BY created_at DESC, id DESC LIMIT ${LIST_LIMIT}`
      )
      : pool.execute(
        `SELECT ${APPLICATION_COLUMNS} FROM shelter_applications
         WHERE status = ? ORDER BY created_at ASC, id ASC LIMIT ${LIST_LIMIT}`,
        [requested]
      )));
    return res.json(rows.map((row) => ({ ...row, register_snapshot: parseSnapshot(row.register_snapshot) })));
  } catch (error) {
    return next(error);
  }
}

async function lockPendingApplication(conn, id) {
  const [rows] = await conn.execute(
    `SELECT ${APPLICATION_COLUMNS} FROM shelter_applications WHERE id = ? FOR UPDATE`,
    [id]
  );
  const application = rows[0];
  if (!application) throw fail(404, 'Application not found');
  if (application.status !== 'pending') throw fail(409, `Application is already ${application.status}`);
  return application;
}

/**
 * Approve: create the shelter, issue its first admin invite, mark the
 * application approved, and audit both, all in one transaction. No user
 * or password is created; the applicant sets a password when they accept
 * the invite (PR6). The raw invite token is not returned to the browser.
 */
async function approveApplication(req, res, next) {
  const applicationId = Number(req.params.id);
  const ownerId = req.platformOwnerId;
  try {
    const result = await inPlatformTransaction(async (conn) => {
      const application = await lockPendingApplication(conn, applicationId);
      const snapshot = parseSnapshot(application.register_snapshot) || {};
      const shelter = await createShelter(conn, {
        name: application.shelter_name,
        slug: application.desired_slug,
        charityRegulator: application.regulator,
        charityNumber: application.charity_number,
        charityRegisterName: typeof snapshot.name === 'string' ? snapshot.name.slice(0, 255) : null,
        charityCheckedAt: typeof snapshot.checkedAt === 'string' ? snapshot.checkedAt : null,
      });
      const invite = await createInvite(conn, {
        shelterId: shelter.shelterId,
        email: application.contact_email,
        role: 'admin',
      });
      const [updated] = await conn.execute(
        `UPDATE shelter_applications
         SET status = 'approved', decided_by = ?, decided_at = NOW()
         WHERE id = ? AND status = 'pending'`,
        [ownerId, applicationId]
      );
      if (!updated || updated.affectedRows !== 1) throw fail(409, 'Application changed, try again');

      await recordPlatformAudit(conn, {
        actorUserId: ownerId,
        action: 'application.approved',
        applicationId,
        targetShelterId: shelter.shelterId,
        detail: { slug: shelter.slug },
      });
      await recordPlatformAudit(conn, {
        actorUserId: ownerId,
        action: 'invite.created',
        applicationId,
        targetShelterId: shelter.shelterId,
        detail: { inviteId: invite.inviteId, role: invite.role, expiresAt: invite.expiresAt },
      });
      return { shelter, invite };
    });

    return res.status(201).json({
      application: { id: applicationId, status: 'approved' },
      shelter: {
        id: result.shelter.shelterId,
        name: result.shelter.name,
        slug: result.shelter.slug,
        status: 'active',
      },
      invite: {
        id: result.invite.inviteId,
        email: result.invite.email,
        role: result.invite.role,
        expiresAt: result.invite.expiresAt,
      },
    });
  } catch (error) {
    return sendError(res, next, error);
  }
}

async function rejectApplication(req, res, next) {
  const applicationId = Number(req.params.id);
  const ownerId = req.platformOwnerId;
  try {
    const reason = readReason(req.body, { required: true });
    await inPlatformTransaction(async (conn) => {
      await lockPendingApplication(conn, applicationId);
      const [updated] = await conn.execute(
        `UPDATE shelter_applications
         SET status = 'rejected', reason = ?, decided_by = ?, decided_at = NOW()
         WHERE id = ? AND status = 'pending'`,
        [reason, ownerId, applicationId]
      );
      if (!updated || updated.affectedRows !== 1) throw fail(409, 'Application changed, try again');
      await recordPlatformAudit(conn, {
        actorUserId: ownerId,
        action: 'application.rejected',
        applicationId,
        detail: { reason },
      });
    });
    return res.json({ application: { id: applicationId, status: 'rejected', reason } });
  } catch (error) {
    return sendError(res, next, error);
  }
}

async function listShelters(req, res, next) {
  try {
    const [rows] = await runWithoutShelter(() => pool.execute(
      `SELECT id, name, slug, status, charity_regulator, charity_number,
              charity_register_name, charity_checked_at, created_at
       FROM shelters ORDER BY id`
    ));
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
}

/**
 * Set shelters.status to suspended. Nothing is deleted. From then on the
 * shelter's people cannot sign in and are signed out on their next request
 * (bindShelter), its public pages, feeds and forms answer 404, and jobs
 * stop emailing them. Retention still runs.
 */
async function suspendShelter(req, res, next) {
  const shelterId = Number(req.params.id);
  const ownerId = req.platformOwnerId;
  try {
    const reason = readReason(req.body, { required: false });
    if (Number(req.session && req.session.shelterId) === shelterId) {
      throw fail(409, 'You cannot suspend the shelter your own account belongs to');
    }
    const shelter = await inPlatformTransaction(async (conn) => {
      const [rows] = await conn.execute(
        'SELECT id, slug, status FROM shelters WHERE id = ? FOR UPDATE',
        [shelterId]
      );
      const row = rows[0];
      if (!row) throw fail(404, 'Shelter not found');
      if (row.status === 'suspended') throw fail(409, 'Shelter is already suspended');
      await conn.execute(
        `UPDATE shelters SET status = 'suspended' WHERE id = ? AND status = 'active'`,
        [shelterId]
      );
      await recordPlatformAudit(conn, {
        actorUserId: ownerId,
        action: 'shelter.suspended',
        targetShelterId: shelterId,
        detail: { slug: row.slug, reason },
      });
      return row;
    });
    // Takes effect on this instance at once; other instances within the
    // shelter cache's 30 seconds.
    forgetShelter({ id: shelterId, slug: shelter.slug });
    return res.json({ shelter: { id: shelterId, slug: shelter.slug, status: 'suspended' } });
  } catch (error) {
    return sendError(res, next, error);
  }
}

/**
 * Set a suspended shelter back to active. Its people can sign in again,
 * its public pages and feeds come back, and jobs pick it up on their next
 * run. Audited as shelter.reactivated with the optional reason.
 */
async function reactivateShelter(req, res, next) {
  const shelterId = Number(req.params.id);
  const ownerId = req.platformOwnerId;
  try {
    const reason = readReason(req.body, { required: false });
    const shelter = await inPlatformTransaction(async (conn) => {
      const [rows] = await conn.execute(
        'SELECT id, slug, status FROM shelters WHERE id = ? FOR UPDATE',
        [shelterId]
      );
      const row = rows[0];
      if (!row) throw fail(404, 'Shelter not found');
      if (row.status === 'active') throw fail(409, 'Shelter is already active');
      await conn.execute(
        `UPDATE shelters SET status = 'active' WHERE id = ? AND status = 'suspended'`,
        [shelterId]
      );
      await recordPlatformAudit(conn, {
        actorUserId: ownerId,
        action: 'shelter.reactivated',
        targetShelterId: shelterId,
        detail: { slug: row.slug, reason },
      });
      return row;
    });
    forgetShelter({ id: shelterId, slug: shelter.slug });
    return res.json({ shelter: { id: shelterId, slug: shelter.slug, status: 'active' } });
  } catch (error) {
    return sendError(res, next, error);
  }
}

module.exports = {
  listApplications,
  approveApplication,
  rejectApplication,
  listShelters,
  suspendShelter,
  reactivateShelter,
  recordPlatformAudit,
  inPlatformTransaction,
};
