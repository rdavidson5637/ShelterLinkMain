'use strict';

const { pool } = require('../config/database');
const { stripContactFields } = require('../utils/contactPrivacy');

const CONTEXT_TYPES = new Set([
  'opportunity',
  'foster_placement',
  'transport_run',
  'direct',
  'announcement',
]);

const VOLUNTEER_DELETE_WINDOW_MS = 15 * 60 * 1000;
const TOMBSTONE_BODY = '[Message deleted]';

function displayName(row) {
  const first = String(row.first_name || '').trim();
  const last = String(row.last_name || '').trim();
  const name = `${first} ${last}`.trim();
  return name || 'Volunteer';
}

function toVolunteerSafeParticipant(row) {
  if (!row) return null;
  return {
    user_id: Number(row.user_id),
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    display_name: displayName(row),
    role: row.role || 'volunteer',
    muted: Number(row.muted) || 0,
    last_read_at: row.last_read_at || null,
  };
}

function toStaffParticipant(row) {
  if (!row) return null;
  return {
    user_id: Number(row.user_id),
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    display_name: displayName(row),
    role: row.role || 'volunteer',
    email: row.email || null,
    muted: Number(row.muted) || 0,
    last_read_at: row.last_read_at || null,
  };
}

function toSafeMessage(row, { forVolunteer = false } = {}) {
  if (!row) return null;
  const deleted = Boolean(row.deleted_at);
  const base = {
    id: Number(row.id),
    thread_id: Number(row.thread_id),
    user_id: Number(row.user_id),
    body: deleted ? TOMBSTONE_BODY : row.body,
    created_at: row.created_at,
    deleted_at: row.deleted_at || null,
    deleted_by: row.deleted_by != null ? Number(row.deleted_by) : null,
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    display_name: displayName(row),
    role: row.role || null,
  };
  if (forVolunteer) {
    return stripContactFields(base);
  }
  return base;
}

function toSafeThread(row, { forVolunteer = false } = {}) {
  if (!row) return null;
  const thread = {
    id: Number(row.id),
    subject: row.subject || null,
    context_type: row.context_type,
    context_id: row.context_id != null ? Number(row.context_id) : null,
    created_by: Number(row.created_by),
    created_at: row.created_at,
    closed_at: row.closed_at || null,
    unread_count: row.unread_count != null ? Number(row.unread_count) : 0,
    last_message_at: row.last_message_at || null,
    muted: row.muted != null ? Number(row.muted) : 0,
    last_read_at: row.last_read_at || null,
  };
  return forVolunteer ? stripContactFields(thread) : thread;
}

async function findByContext(contextType, contextId) {
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM message_threads
      WHERE context_type = ?
        AND context_id IS NOT DISTINCT FROM ?
      ORDER BY id ASC
      LIMIT 1
    `,
    [contextType, contextId == null ? null : Number(contextId)]
  );
  return rows[0] || null;
}

async function getById(threadId) {
  const [rows] = await pool.execute(
    `SELECT * FROM message_threads WHERE id = ? LIMIT 1`,
    [Number(threadId)]
  );
  return rows[0] || null;
}

/**
 * Accepted/approved applicants for an opportunity, plus all staff and admin.
 */
async function resolveParticipantsForOpportunity(opportunityId) {
  const oppId = Number(opportunityId);
  const [volunteerRows] = await pool.execute(
    `
      SELECT DISTINCT a.user_id
      FROM applications a
      WHERE a.opportunity_id = ?
        AND a.status IN ('accepted', 'approved')
    `,
    [oppId]
  );
  const [staffRows] = await pool.execute(
    `
      SELECT user_id
      FROM users
      WHERE role IN ('staff', 'admin')
    `
  );
  const ids = new Set();
  for (const row of volunteerRows) ids.add(Number(row.user_id));
  for (const row of staffRows) ids.add(Number(row.user_id));
  return [...ids].filter((id) => Number.isFinite(id) && id > 0);
}

async function resolveStaffAdminIds() {
  const [rows] = await pool.execute(
    `SELECT user_id FROM users WHERE role IN ('staff', 'admin')`
  );
  return rows.map((r) => Number(r.user_id)).filter((id) => id > 0);
}

async function resolveApprovedVolunteerIds() {
  const [rows] = await pool.execute(
    `
      SELECT u.user_id
      FROM users u
      INNER JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      WHERE u.role = 'volunteer'
        AND COALESCE(vp.approved, 0) = 1
    `
  );
  return rows.map((r) => Number(r.user_id)).filter((id) => id > 0);
}

async function addParticipants(threadId, userIds = []) {
  const tid = Number(threadId);
  const unique = [...new Set(userIds.map(Number).filter((id) => id > 0))];
  for (const userId of unique) {
    await pool.execute(
      `
        INSERT INTO thread_participants (thread_id, user_id, muted)
        VALUES (?, ?, 0)
        ON CONFLICT (thread_id, user_id) DO NOTHING
      `,
      [tid, userId]
    );
  }
}

async function ensureParticipant(threadId, userId) {
  await addParticipants(threadId, [userId]);
}

async function removeParticipant(threadId, userId) {
  const [result] = await pool.execute(
    `DELETE FROM thread_participants WHERE thread_id = ? AND user_id = ?`,
    [Number(threadId), Number(userId)]
  );
  return Number(result.affectedRows) > 0;
}

/**
 * Drop a volunteer from an opportunity's shift-chat thread, if one exists.
 * Call this whenever a previously-accepted application is revoked (staff
 * rejects it, or it's cancelled) — otherwise the volunteer keeps reading and
 * posting into that shift's chat indefinitely, since nothing else ever
 * removes a `thread_participants` row.
 */
async function removeParticipantForOpportunity(opportunityId, userId) {
  const thread = await findByContext('opportunity', opportunityId);
  if (!thread) return false;
  return removeParticipant(thread.id, userId);
}

async function createThread({
  subject,
  contextType,
  contextId,
  createdBy,
  participantIds = [],
}) {
  if (!CONTEXT_TYPES.has(contextType)) {
    const err = new Error('Invalid context_type');
    err.status = 400;
    throw err;
  }
  const [result] = await pool.execute(
    `
      INSERT INTO message_threads (subject, context_type, context_id, created_by)
      VALUES (?, ?, ?, ?)
    `,
    [
      subject ? String(subject).slice(0, 255) : null,
      contextType,
      contextId == null ? null : Number(contextId),
      Number(createdBy),
    ]
  );
  const threadId = result.insertId;
  const participants = new Set(participantIds.map(Number).filter((id) => id > 0));
  participants.add(Number(createdBy));
  await addParticipants(threadId, [...participants]);
  return getById(threadId);
}

/**
 * Lazily create (or return) a thread for a context. Seeds participants for
 * opportunity / announcement contexts.
 */
async function createOrGetForContext({
  contextType,
  contextId,
  createdBy,
  subject = null,
}) {
  if (!CONTEXT_TYPES.has(contextType)) {
    const err = new Error('Invalid context_type');
    err.status = 400;
    throw err;
  }

  // Announcements are always new threads (not lazily unique by context).
  if (contextType === 'announcement') {
    const staffIds = await resolveStaffAdminIds();
    const volunteers = await resolveApprovedVolunteerIds();
    return createThread({
      subject: subject || 'Announcement',
      contextType: 'announcement',
      contextId: null,
      createdBy,
      participantIds: [...new Set([...staffIds, ...volunteers])],
    });
  }

  // 'direct' threads use context_id as the other participant's user_id (not
  // an opportunity/run/placement id) — without it there is no one to make
  // the thread "direct" with, and it silently ends up staff-only.
  if (contextType === 'direct' && !(Number(contextId) > 0)) {
    const err = new Error('context_id (the other participant\'s user id) is required for a direct thread');
    err.status = 400;
    throw err;
  }

  const existing = await findByContext(contextType, contextId);
  if (existing) {
    // Refresh participants for opportunity threads (new acceptances).
    if (contextType === 'opportunity' && contextId != null) {
      const ids = await resolveParticipantsForOpportunity(contextId);
      await addParticipants(existing.id, ids);
    }
    await ensureParticipant(existing.id, createdBy);
    if (contextType === 'direct') {
      await ensureParticipant(existing.id, contextId);
    }
    return existing;
  }

  let participantIds = await resolveStaffAdminIds();
  if (contextType === 'opportunity' && contextId != null) {
    participantIds = await resolveParticipantsForOpportunity(contextId);
  } else if (
    (contextType === 'foster_placement' || contextType === 'transport_run') &&
    contextId != null
  ) {
    participantIds = await resolveStaffAdminIds();
  } else if (contextType === 'direct') {
    // Note: reuse is keyed only on (context_type, context_id) — see
    // findByContext — so two different staff members opening a 'direct'
    // thread with the same recipient will land in the same thread today.
    participantIds = [Number(contextId)];
  }

  return createThread({
    subject,
    contextType,
    contextId,
    createdBy,
    participantIds,
  });
}

async function listForUser(userId, { isStaff = false } = {}) {
  const uid = Number(userId);
  let sql;
  let params;
  if (isStaff) {
    sql = `
      SELECT
        t.*,
        COALESCE(tp.muted, 0) AS muted,
        tp.last_read_at,
        (
          SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id
        ) AS last_message_at,
        (
          SELECT COUNT(*)::int
          FROM messages m
          WHERE m.thread_id = t.id
            AND m.deleted_at IS NULL
            AND m.user_id <> ?
            AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)
        ) AS unread_count
      FROM message_threads t
      LEFT JOIN thread_participants tp
        ON tp.thread_id = t.id AND tp.user_id = ?
      ORDER BY COALESCE(
        (SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id),
        t.created_at
      ) DESC
    `;
    params = [uid, uid];
  } else {
    sql = `
      SELECT
        t.*,
        COALESCE(tp.muted, 0) AS muted,
        tp.last_read_at,
        (
          SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id
        ) AS last_message_at,
        (
          SELECT COUNT(*)::int
          FROM messages m
          WHERE m.thread_id = t.id
            AND m.deleted_at IS NULL
            AND m.user_id <> ?
            AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)
        ) AS unread_count
      FROM message_threads t
      INNER JOIN thread_participants tp
        ON tp.thread_id = t.id AND tp.user_id = ?
      ORDER BY COALESCE(
        (SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id),
        t.created_at
      ) DESC
    `;
    params = [uid, uid];
  }
  const [rows] = await pool.execute(sql, params);
  return rows.map((row) => toSafeThread(row, { forVolunteer: !isStaff }));
}

async function isParticipant(threadId, userId) {
  const [rows] = await pool.execute(
    `
      SELECT 1 AS ok
      FROM thread_participants
      WHERE thread_id = ? AND user_id = ?
      LIMIT 1
    `,
    [Number(threadId), Number(userId)]
  );
  return rows.length > 0;
}

async function getParticipants(threadId, { forVolunteer = false } = {}) {
  const [rows] = await pool.execute(
    `
      SELECT
        tp.thread_id,
        tp.user_id,
        tp.last_read_at,
        tp.muted,
        u.first_name,
        u.last_name,
        u.role,
        u.email
      FROM thread_participants tp
      INNER JOIN users u ON u.user_id = tp.user_id
      WHERE tp.thread_id = ?
      ORDER BY u.role DESC, u.last_name ASC, u.first_name ASC
    `,
    [Number(threadId)]
  );
  return rows.map((row) =>
    forVolunteer ? toVolunteerSafeParticipant(row) : toStaffParticipant(row)
  );
}

async function getMessages(threadId, { forVolunteer = false, limit = 200 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const [rows] = await pool.execute(
    `
      SELECT
        m.*,
        u.first_name,
        u.last_name,
        u.role
      FROM messages m
      INNER JOIN users u ON u.user_id = m.user_id
      WHERE m.thread_id = ?
      ORDER BY m.created_at ASC
      LIMIT ${safeLimit}
    `,
    [Number(threadId)]
  );
  return rows.map((row) => toSafeMessage(row, { forVolunteer }));
}

async function markRead(threadId, userId) {
  await ensureParticipant(threadId, userId);
  await pool.execute(
    `
      UPDATE thread_participants
      SET last_read_at = CURRENT_TIMESTAMP
      WHERE thread_id = ? AND user_id = ?
    `,
    [Number(threadId), Number(userId)]
  );
}

async function setMuted(threadId, userId, muted) {
  await ensureParticipant(threadId, userId);
  await pool.execute(
    `
      UPDATE thread_participants
      SET muted = ?
      WHERE thread_id = ? AND user_id = ?
    `,
    [muted ? 1 : 0, Number(threadId), Number(userId)]
  );
  return { muted: muted ? 1 : 0 };
}

async function addMessage(threadId, userId, body) {
  const text = String(body || '').trim();
  if (!text) {
    const err = new Error('Message body is required');
    err.status = 400;
    throw err;
  }
  if (text.length > 2000) {
    const err = new Error('Message body must be at most 2000 characters');
    err.status = 400;
    throw err;
  }
  const [result] = await pool.execute(
    `
      INSERT INTO messages (thread_id, user_id, body)
      VALUES (?, ?, ?)
    `,
    [Number(threadId), Number(userId), text]
  );
  const [rows] = await pool.execute(
    `
      SELECT m.*, u.first_name, u.last_name, u.role
      FROM messages m
      INNER JOIN users u ON u.user_id = m.user_id
      WHERE m.id = ?
      LIMIT 1
    `,
    [result.insertId]
  );
  return toSafeMessage(rows[0]);
}

async function findMessageById(messageId) {
  const [rows] = await pool.execute(
    `SELECT * FROM messages WHERE id = ? LIMIT 1`,
    [Number(messageId)]
  );
  return rows[0] || null;
}

/**
 * Soft-delete rules:
 * - Staff/admin: any message in any thread
 * - Volunteer: own message only, within 15 minutes of created_at
 */
async function softDeleteMessage(messageId, actorId, { isStaff = false } = {}) {
  const message = await findMessageById(messageId);
  if (!message) {
    const err = new Error('Message not found');
    err.status = 404;
    throw err;
  }
  if (message.deleted_at) {
    return toSafeMessage(message);
  }

  if (!isStaff) {
    if (Number(message.user_id) !== Number(actorId)) {
      const err = new Error('You can only delete your own messages');
      err.status = 403;
      throw err;
    }
    const created = new Date(message.created_at).getTime();
    if (!Number.isFinite(created) || Date.now() - created > VOLUNTEER_DELETE_WINDOW_MS) {
      const err = new Error('Messages can only be deleted within 15 minutes');
      err.status = 403;
      throw err;
    }
  }

  await pool.execute(
    `
      UPDATE messages
      SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, body = ?
      WHERE id = ?
    `,
    [Number(actorId), TOMBSTONE_BODY, Number(messageId)]
  );
  return findMessageById(messageId).then((row) => toSafeMessage(row));
}

async function unreadCountForUser(userId, { isStaff = false } = {}) {
  const uid = Number(userId);
  let sql;
  let params;
  if (isStaff) {
    // Staff: unread across all threads, using their participant last_read_at when present.
    sql = `
      SELECT COUNT(*)::int AS cnt
      FROM messages m
      INNER JOIN message_threads t ON t.id = m.thread_id
      LEFT JOIN thread_participants tp
        ON tp.thread_id = m.thread_id AND tp.user_id = ?
      WHERE m.deleted_at IS NULL
        AND m.user_id <> ?
        AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)
    `;
    params = [uid, uid];
  } else {
    sql = `
      SELECT COUNT(*)::int AS cnt
      FROM messages m
      INNER JOIN thread_participants tp
        ON tp.thread_id = m.thread_id AND tp.user_id = ?
      WHERE m.deleted_at IS NULL
        AND m.user_id <> ?
        AND COALESCE(tp.muted, 0) = 0
        AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)
    `;
    params = [uid, uid];
  }
  const [rows] = await pool.execute(sql, params);
  return Number(rows[0]?.cnt) || 0;
}

/**
 * Users with unread messages older than 15 minutes, not muted, not own messages,
 * who have not received a digest this clock-hour.
 */
async function findDigestCandidates(now = new Date()) {
  const [rows] = await pool.execute(
    `
      SELECT
        u.user_id,
        u.email,
        u.first_name,
        COUNT(m.id)::int AS unread_count,
        MAX(m.created_at) AS latest_unread_at
      FROM messages m
      INNER JOIN thread_participants tp ON tp.thread_id = m.thread_id
      INNER JOIN users u ON u.user_id = tp.user_id
      LEFT JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      LEFT JOIN message_digest_log d
        ON d.user_id = u.user_id
        AND d.digest_hour = date_trunc('hour', CAST(? AS TIMESTAMP))
      WHERE m.deleted_at IS NULL
        AND m.user_id <> tp.user_id
        AND COALESCE(tp.muted, 0) = 0
        AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)
        AND m.created_at <= (CAST(? AS TIMESTAMP) - INTERVAL '15 minutes')
        AND u.email IS NOT NULL
        AND u.email <> ''
        AND d.user_id IS NULL
        AND (vp.away_until IS NULL OR vp.away_until < CURRENT_DATE)
      GROUP BY u.user_id, u.email, u.first_name
      ORDER BY u.user_id ASC
    `,
    [now.toISOString(), now.toISOString()]
  );
  return rows;
}

async function markDigestSent(userId, now = new Date()) {
  await pool.execute(
    `
      INSERT INTO message_digest_log (user_id, digest_hour)
      VALUES (?, date_trunc('hour', CAST(? AS TIMESTAMP)))
      ON CONFLICT (user_id, digest_hour) DO NOTHING
    `,
    [Number(userId), now.toISOString()]
  );
}

async function getThreadDetail(threadId, { forVolunteer = false } = {}) {
  const thread = await getById(threadId);
  if (!thread) return null;
  const [participants, messages] = await Promise.all([
    getParticipants(threadId, { forVolunteer }),
    getMessages(threadId, { forVolunteer }),
  ]);
  return {
    ...toSafeThread(thread, { forVolunteer }),
    participants,
    messages,
  };
}

module.exports = {
  CONTEXT_TYPES,
  VOLUNTEER_DELETE_WINDOW_MS,
  TOMBSTONE_BODY,
  displayName,
  toVolunteerSafeParticipant,
  toStaffParticipant,
  toSafeMessage,
  toSafeThread,
  findByContext,
  getById,
  resolveParticipantsForOpportunity,
  resolveStaffAdminIds,
  resolveApprovedVolunteerIds,
  addParticipants,
  ensureParticipant,
  removeParticipant,
  removeParticipantForOpportunity,
  createThread,
  createOrGetForContext,
  listForUser,
  isParticipant,
  getParticipants,
  getMessages,
  getThreadDetail,
  markRead,
  setMuted,
  addMessage,
  findMessageById,
  softDeleteMessage,
  unreadCountForUser,
  findDigestCandidates,
  markDigestSent,
};
