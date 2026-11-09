'use strict';

/**
 * Platform owner actions: the shelter approval queue and suspension.
 *
 * These handlers read and write only shelters, shelter_applications,
 * admin_invites, platform_owners and platform_audit. They never read
 * volunteer_profiles or any other tenant volunteer data. The one exception
 * is services/accountLookup.js, which tells the queue yes or no for whether
 * an applicant's email already has an account, and reads nothing else. Every query runs
 * outside shelter context (runWithoutShelter), and no shelter id is read
 * from the client: shelter ids come from route params naming a shelter row
 * the owner acts on, or from the row just inserted.
 */

const { pool } = require('../config/database');
const { runWithoutShelter } = require('../utils/shelterContext');
const {
  createShelter,
  createInvite,
  reissueApplicationInvite,
  INVITE_TTL_DAYS,
} = require('../services/shelterProvision');
const { deliverInvite, inviteDeliveryBlocker } = require('../services/inviteDelivery');
const { emailsWithAccounts } = require('../services/accountLookup');

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
    const flags = await runWithoutShelter(() => applicationFlags(rows));
    return res.json(rows.map((row) => ({
      ...row,
      register_snapshot: parseSnapshot(row.register_snapshot),
      ...flags(row),
    })));
  } catch (error) {
    return next(error);
  }
}

function emailKey(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Per-row flags for the queue, in two queries for the whole list:
 *   contact_has_account (pending)  the applicant's email already has an
 *                                  account, so accepting the invite will be
 *                                  refused; warn before approving.
 *   invite_accepted (approved)     the admin invite has been used; there is
 *                                  nothing to resend.
 */
async function applicationFlags(rows) {
  const pending = rows.filter((row) => row.status === 'pending');
  const approved = rows.filter((row) => row.status === 'approved');
  const withAccounts = pending.length
    ? await emailsWithAccounts(pool, pending.map((row) => row.contact_email))
    : new Set();
  const accepted = new Set();
  if (approved.length) {
    const [used] = await pool.execute(
      `SELECT DISTINCT s.slug, lower(i.email) AS email
       FROM admin_invites i
       JOIN shelters s ON s.id = i.shelter_id
       WHERE i.used_at IS NOT NULL AND s.slug = ANY(?::text[])`,
      [[...new Set(approved.map((row) => row.desired_slug))]]
    );
    for (const row of used) accepted.add(`${row.slug}|${emailKey(row.email)}`);
  }
  return (row) => {
    if (row.status === 'pending') {
      return { contact_has_account: withAccounts.has(emailKey(row.contact_email)) };
    }
    if (row.status === 'approved') {
      return { invite_accepted: accepted.has(`${row.desired_slug}|${emailKey(row.contact_email)}`) };
    }
    return {};
  };
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
 * the invite at /invite#<token>. The raw invite token is not returned to the
 * browser: it goes only into the invite email, sent after the commit. A
 * failed email does not undo the approval; the response says so and the
 * owner can resend.
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

    const inviteEmail = await deliverInvite({
      email: result.invite.email,
      token: result.invite.token,
      shelterName: result.shelter.name,
      role: result.invite.role,
      expiresInDays: INVITE_TTL_DAYS,
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
      inviteEmail,
    });
  } catch (error) {
    return sendError(res, next, error);
  }
}

/**
 * Resend the admin invite for an approved application: expire the unused
 * invite, issue a new one, audit invite.created, then email it. Refused
 * before anything changes when email cannot be sent, so a working link is
 * never expired for nothing. Refused once the invite has been accepted.
 */
async function resendInvite(req, res, next) {
  const applicationId = Number(req.params.id);
  const ownerId = req.platformOwnerId;
  try {
    const blocker = inviteDeliveryBlocker();
    if (blocker) {
      throw fail(409, blocker === 'app_url_missing'
        ? 'Invite emails need an https APP_URL before they can be sent'
        : 'Email is not configured, so the invite cannot be sent');
    }
    const result = await inPlatformTransaction(async (conn) => {
      const reissued = await reissueApplicationInvite(conn, applicationId);
      await recordPlatformAudit(conn, {
        actorUserId: ownerId,
        action: 'invite.created',
        applicationId,
        targetShelterId: reissued.shelter.id,
        detail: {
          inviteId: reissued.invite.inviteId,
          role: reissued.invite.role,
          expiresAt: reissued.invite.expiresAt,
          source: 'resend',
        },
      });
      return reissued;
    });

    const inviteEmail = await deliverInvite({
      email: result.invite.email,
      token: result.invite.token,
      shelterName: result.shelter.name,
      role: result.invite.role,
      expiresInDays: INVITE_TTL_DAYS,
    });

    return res.status(201).json({
      invite: {
        id: result.invite.inviteId,
        email: result.invite.email,
        role: result.invite.role,
        expiresAt: result.invite.expiresAt,
      },
      inviteEmail,
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
 * Set shelters.status to suspended. Nothing is deleted. Blocking sign-in
 * and public pages for a suspended shelter is PR7 (bindShelter); this
 * records the status and the audit row.
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
    return res.json({ shelter: { id: shelterId, slug: shelter.slug, status: 'suspended' } });
  } catch (error) {
    return sendError(res, next, error);
  }
}

module.exports = {
  listApplications,
  approveApplication,
  resendInvite,
  rejectApplication,
  listShelters,
  suspendShelter,
  recordPlatformAudit,
  inPlatformTransaction,
};
