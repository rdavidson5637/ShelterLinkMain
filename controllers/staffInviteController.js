'use strict';

/**
 * Shelter admins invite their own team (PR10):
 *   GET  /api/admin/invites                     open invites for this shelter
 *   POST /api/admin/invites                     invite a staff member or admin
 *   POST /api/admin/invites/:inviteId/revoke    stop an unused invite working
 *
 * Admin only. Every query runs in the admin's own shelter context, set by
 * bindShelter from the user row, and also names that shelter id, so an
 * admin can only ever see or change their own shelter's invites. The
 * invite is accepted at /invite/<token> (PR6), which creates the account on
 * this shelter with the invited role.
 */

const { pool } = require('../config/database');
const { currentShelterId, runWithoutShelter } = require('../utils/shelterContext');
const { createInvite, INVITE_TTL_DAYS } = require('../services/shelterProvision');
const { deliverInvite, inviteDeliveryBlocker } = require('../services/inviteDelivery');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(['staff', 'admin']);

// Deliberately vague. Saying "this address already has an account" would
// let any shelter admin test whether someone uses ShelterLink anywhere,
// at any other shelter.
const CANNOT_INVITE = 'This address cannot be invited. Ask the person for a different email address, or contact ShelterLink support.';

const ADMIN_CONFIRM = 'Confirm that this person should be an admin. Admins can invite other admins, change roles and use privacy tools.';

function fail(status, message, field = null) {
  const error = new Error(message);
  error.status = status;
  error.field = field;
  return error;
}

function send(res, error) {
  if (error && Number.isInteger(error.status) && error.status < 500) {
    return res.status(error.status).json({ error: error.message, field: error.field || null });
  }
  console.error('[StaffInvite] error:', error && error.message);
  return res.status(500).json({ error: 'Internal server error' });
}

function shelterIdOrFail() {
  const id = currentShelterId();
  if (!id) throw fail(403, 'Forbidden');
  return id;
}

async function listStaffInvites(req, res) {
  try {
    const shelterId = shelterIdOrFail();
    const [rows] = await pool.execute(
      `SELECT id, email, role, expires_at, created_at
       FROM admin_invites
       WHERE shelter_id = ? AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC, id DESC
       LIMIT 200`,
      [shelterId]
    );
    return res.json(rows);
  } catch (error) {
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

async function createStaffInvite(req, res) {
  try {
    const shelterId = shelterIdOrFail();
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const role = typeof req.body?.role === 'string' && req.body.role ? req.body.role : 'staff';
    if (!EMAIL_RE.test(email) || email.length > 254) {
      throw fail(400, 'Enter an email address like name@example.org.', 'email');
    }
    if (!ROLES.has(role)) throw fail(400, 'Choose staff or admin.', 'role');
    // Making another admin is the one invite that hands over the keys, so
    // the page asks first and the API requires the answer.
    if (role === 'admin' && req.body?.confirm_admin !== true) throw fail(400, ADMIN_CONFIRM, 'role');

    // The token cannot be read back later, so an invite that cannot be
    // emailed is useless. Refuse before creating anything.
    const blocker = inviteDeliveryBlocker();
    if (blocker) {
      throw fail(409, blocker === 'app_url_missing'
        ? 'Invite emails need an https APP_URL before they can be sent.'
        : 'Email is not set up on this server, so invites cannot be sent yet.');
    }

    // One account per email address across ShelterLink (users email is
    // unique), so an address that already has one cannot accept an invite.
    const [existing] = await runWithoutShelter(() => pool.execute(
      'SELECT user_id FROM users WHERE lower(email) = lower(?) LIMIT 1',
      [email]
    ));
    if (existing.length) {
      throw fail(409, CANNOT_INVITE, 'email');
    }

    const result = await inShelterTransaction(async (conn) => {
      // A fresh invite replaces any unused one for the same address.
      await conn.execute(
        `UPDATE admin_invites SET expires_at = NOW()
         WHERE shelter_id = ? AND lower(email) = lower(?) AND used_at IS NULL AND expires_at > NOW()`,
        [shelterId, email]
      );
      const invite = await createInvite(conn, {
        shelterId,
        email,
        role,
        createdBy: Number(req.session.userId),
      });
      const [shelters] = await conn.execute('SELECT name FROM shelters WHERE id = ? LIMIT 1', [shelterId]);
      return { invite, shelterName: shelters[0] ? shelters[0].name : null };
    });

    const inviteEmail = await deliverInvite({
      email: result.invite.email,
      token: result.invite.token,
      shelterName: result.shelterName,
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
    return send(res, error);
  }
}

async function revokeStaffInvite(req, res) {
  try {
    const shelterId = shelterIdOrFail();
    const [result] = await pool.execute(
      `UPDATE admin_invites SET expires_at = NOW()
       WHERE id = ? AND shelter_id = ? AND used_at IS NULL AND expires_at > NOW()`,
      [Number(req.params.inviteId), shelterId]
    );
    if (!result || !result.affectedRows) throw fail(404, 'Invite not found, or already used or expired.');
    return res.json({ invite: { id: Number(req.params.inviteId), revoked: true } });
  } catch (error) {
    return send(res, error);
  }
}

module.exports = {
  CANNOT_INVITE,
  ADMIN_CONFIRM,
  listStaffInvites,
  createStaffInvite,
  revokeStaffInvite,
};
