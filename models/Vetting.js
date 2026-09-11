'use strict';

const crypto = require('crypto');
const { pool } = require('../config/database');

const CHECK_TYPES = new Set([
  'accessni_basic',
  'accessni_standard',
  'accessni_enhanced',
  'other',
]);

const CHECK_STATUSES = new Set([
  'not_required',
  'requested',
  'pending',
  'clear',
  'flagged',
  'expired',
]);

const REFERENCE_STATUSES = new Set(['requested', 'received', 'declined', 'expired']);

const REFERENCE_TOKEN_TTL_DAYS = 21;
const STAFF_WARN_DAYS = 60;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateReferenceToken() {
  return crypto.randomBytes(32).toString('hex');
}

function toSafeReference(row, { includeComments = false } = {}) {
  if (!row) return null;
  const base = {
    id: Number(row.id),
    user_id: Number(row.user_id),
    referee_name: row.referee_name,
    referee_email: row.referee_email,
    referee_relationship: row.referee_relationship || null,
    requested_at: row.requested_at,
    expires_at: row.expires_at,
    responded_at: row.responded_at || null,
    is_suitable: row.is_suitable == null ? null : Number(row.is_suitable),
    status: row.status,
  };
  if (includeComments) {
    base.comments = row.comments || null;
  }
  return base;
}

function toSafeCheck(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    check_type: row.check_type,
    reference_number: row.reference_number || null,
    issued_on: row.issued_on || null,
    expires_on: row.expires_on || null,
    status: row.status,
    notes: row.notes || null,
    updated_by: row.updated_by != null ? Number(row.updated_by) : null,
    updated_at: row.updated_at,
  };
}

function normalizeCheckType(value) {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  return CHECK_TYPES.has(v) ? v : null;
}

function normalizeCheckStatus(value) {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  return CHECK_STATUSES.has(v) ? v : null;
}

async function createReferenceRequest({
  userId,
  refereeName,
  refereeEmail,
  refereeRelationship = null,
  expiresAt = null,
} = {}) {
  if (!userId) throw new Error('userId is required');
  if (!refereeName || !String(refereeName).trim()) throw new Error('refereeName is required');
  if (!refereeEmail || !String(refereeEmail).trim()) throw new Error('refereeEmail is required');

  const token = generateReferenceToken();
  const tokenHash = hashToken(token);
  const expires =
    expiresAt ||
    new Date(Date.now() + REFERENCE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const sql = `
    INSERT INTO volunteer_references
      (user_id, referee_name, referee_email, referee_relationship, token_hash, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'requested')
  `;
  const [result] = await pool.execute(sql, [
    userId,
    String(refereeName).trim(),
    String(refereeEmail).trim().toLowerCase(),
    refereeRelationship ? String(refereeRelationship).trim() : null,
    tokenHash,
    expires,
  ]);

  const row = await findReferenceById(result.insertId);
  return { reference: toSafeReference(row, { includeComments: true }), token };
}

async function findReferenceById(id) {
  const [rows] = await pool.execute(
    `SELECT * FROM volunteer_references WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function findReferenceByToken(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [rows] = await pool.execute(
    `SELECT * FROM volunteer_references WHERE token_hash = ? LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function listReferencesForUser(userId, { includeComments = false } = {}) {
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM volunteer_references
      WHERE user_id = ?
      ORDER BY requested_at DESC, id DESC
    `,
    [userId]
  );
  return rows.map((row) => toSafeReference(row, { includeComments }));
}

/**
 * `isSuitable` is tri-state: `true`/`false` when the referee gave an answer,
 * `null`/`undefined` when they didn't. Treating "no answer" the same as an
 * explicit "not suitable" would silently flag volunteers nobody actually
 * flagged — see `reference_flagged` in the onboarding pipeline.
 */
async function submitReferenceResponse(token, { isSuitable = null, comments = null, declined = false } = {}) {
  const row = await findReferenceByToken(token);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status !== 'requested') {
    return { ok: false, error: 'already_responded', reference: toSafeReference(row) };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await pool.execute(
      `UPDATE volunteer_references SET status = 'expired' WHERE id = ? AND status = 'requested'`,
      [row.id]
    );
    return { ok: false, error: 'expired' };
  }

  const status = declined ? 'declined' : 'received';
  const suitable = declined || isSuitable == null ? null : isSuitable ? 1 : 0;
  const [result] = await pool.execute(
    `
      UPDATE volunteer_references
      SET status = ?,
          responded_at = CURRENT_TIMESTAMP,
          is_suitable = ?,
          comments = ?
      WHERE id = ? AND status = 'requested'
    `,
    [status, suitable, comments != null ? String(comments).slice(0, 5000) : null, row.id]
  );
  if (!result.affectedRows) {
    return { ok: false, error: 'already_responded' };
  }
  const updated = await findReferenceById(row.id);
  return { ok: true, reference: toSafeReference(updated) };
}

async function expireStaleReferences(now = new Date()) {
  const [result] = await pool.execute(
    `
      UPDATE volunteer_references
      SET status = 'expired'
      WHERE status = 'requested'
        AND expires_at < ?
    `,
    [now]
  );
  return Number(result.affectedRows) || 0;
}

async function upsertBackgroundCheck({
  userId,
  checkType,
  referenceNumber = null,
  issuedOn = null,
  expiresOn = null,
  status = 'pending',
  notes = null,
  updatedBy = null,
  id = null,
} = {}) {
  if (!userId) throw new Error('userId is required');
  const type = normalizeCheckType(checkType);
  if (!type) throw new Error('Invalid check_type');
  const safeStatus = normalizeCheckStatus(status) || 'pending';

  if (id) {
    const [result] = await pool.execute(
      `
        UPDATE background_checks
        SET check_type = ?,
            reference_number = ?,
            issued_on = ?,
            expires_on = ?,
            status = ?,
            notes = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [
        type,
        referenceNumber || null,
        issuedOn || null,
        expiresOn || null,
        safeStatus,
        notes || null,
        updatedBy,
        id,
        userId,
      ]
    );
    if (!result.affectedRows) return null;
    return findBackgroundCheckById(id);
  }

  const [result] = await pool.execute(
    `
      INSERT INTO background_checks
        (user_id, check_type, reference_number, issued_on, expires_on, status, notes, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      type,
      referenceNumber || null,
      issuedOn || null,
      expiresOn || null,
      safeStatus,
      notes || null,
      updatedBy,
    ]
  );
  return findBackgroundCheckById(result.insertId);
}

async function findBackgroundCheckById(id) {
  const [rows] = await pool.execute(
    `SELECT * FROM background_checks WHERE id = ? LIMIT 1`,
    [id]
  );
  return toSafeCheck(rows[0] || null);
}

async function listBackgroundChecksForUser(userId) {
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM background_checks
      WHERE user_id = ?
      ORDER BY updated_at DESC, id DESC
    `,
    [userId]
  );
  return rows.map(toSafeCheck);
}

/**
 * True when volunteer has a clear, non-expired check of the required type.
 */
async function hasClearCheck(userId, checkType, now = new Date()) {
  const type = normalizeCheckType(checkType);
  if (!type) return true;
  const today = String(now.toISOString()).slice(0, 10);
  const [rows] = await pool.execute(
    `
      SELECT id
      FROM background_checks
      WHERE user_id = ?
        AND check_type = ?
        AND status = 'clear'
        AND (expires_on IS NULL OR expires_on >= ?)
      LIMIT 1
    `,
    [userId, type, today]
  );
  return rows.length > 0;
}

async function markExpiredChecks(now = new Date()) {
  const today = String(now.toISOString()).slice(0, 10);
  const [result] = await pool.execute(
    `
      UPDATE background_checks
      SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('clear', 'pending', 'requested')
        AND expires_on IS NOT NULL
        AND expires_on < ?
    `,
    [today]
  );
  return Number(result.affectedRows) || 0;
}

async function findChecksNeedingStaffWarning(now = new Date(), days = STAFF_WARN_DAYS) {
  const today = String(now.toISOString()).slice(0, 10);
  const warnDate = new Date(now);
  warnDate.setUTCDate(warnDate.getUTCDate() + Number(days) || STAFF_WARN_DAYS);
  const warnDay = String(warnDate.toISOString()).slice(0, 10);

  const [rows] = await pool.execute(
    `
      SELECT
        bc.*,
        u.email,
        u.first_name,
        u.last_name
      FROM background_checks bc
      INNER JOIN users u ON u.user_id = bc.user_id
      WHERE bc.status = 'clear'
        AND bc.expires_on IS NOT NULL
        AND bc.expires_on >= ?
        AND bc.expires_on <= ?
      ORDER BY bc.expires_on ASC, bc.id ASC
    `,
    [today, warnDay]
  );
  return rows.map((row) => ({
    ...toSafeCheck(row),
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
  }));
}

/**
 * Volunteer-facing onboarding checklist (no referee comments).
 */
async function getOnboardingChecklist(userId) {
  const VolunteerProfile = require('./VolunteerProfile');
  const Waiver = require('./Waiver');

  const profile = await VolunteerProfile.findByUserId(userId);
  const references = await listReferencesForUser(userId, { includeComments: false });
  const checks = await listBackgroundChecksForUser(userId);
  const pendingWaivers = await Waiver.findPendingForUser(userId);

  const receivedRefs = references.filter((r) => r.status === 'received');
  const clearChecks = checks.filter(
    (c) =>
      c.status === 'clear' &&
      (!c.expires_on || String(c.expires_on).slice(0, 10) >= new Date().toISOString().slice(0, 10))
  );

  return {
    profile_complete: Boolean(profile),
    profile_approved: Boolean(profile && Number(profile.approved) === 1),
    references_requested: references.length,
    references_received: receivedRefs.length,
    references: references,
    background_checks: checks,
    has_clear_background_check: clearChecks.length > 0,
    pending_waivers: pendingWaivers.map((w) => ({
      id: w.id,
      title: w.title,
      version: w.version,
    })),
    waivers_complete: pendingWaivers.length === 0,
  };
}

const PIPELINE_STAGES = [
  'needs_profile',
  'awaiting_approval',
  'needs_waiver',
  'needs_references',
  'reference_flagged',
  'needs_accessni',
  'ready',
];

/**
 * Classify a volunteer into the first incomplete onboarding stage.
 *
 * A reference with status='received' only means the referee responded —
 * it does NOT mean they vouched for the volunteer. `referencesFlagged` must
 * be checked separately so a referee's explicit "not suitable" blocks
 * `ready` instead of being silently absorbed into "references complete".
 */
function classifyOnboardingStage({
  hasProfile,
  approved,
  waiversComplete,
  referencesReceived,
  referencesFlagged = 0,
  hasClearCheck,
}) {
  if (!hasProfile) return 'needs_profile';
  if (!approved) return 'awaiting_approval';
  if (!waiversComplete) return 'needs_waiver';
  if (!(Number(referencesReceived) > 0)) return 'needs_references';
  if (Number(referencesFlagged) > 0) return 'reference_flagged';
  if (!hasClearCheck) return 'needs_accessni';
  return 'ready';
}

/**
 * Staff pipeline: volunteers grouped by onboarding stage.
 */
async function getOnboardingPipeline() {
  const Waiver = require('./Waiver');
  const today = new Date().toISOString().slice(0, 10);

  const [rows] = await pool.execute(
    `
      SELECT
        u.user_id,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.created_at,
        vp.profile_id,
        COALESCE(vp.approved, 0) AS approved,
        (
          SELECT COUNT(*)::int
          FROM volunteer_references vr
          WHERE vr.user_id = u.user_id AND vr.status = 'received'
        ) AS references_received,
        (
          SELECT COUNT(*)::int
          FROM volunteer_references vr
          WHERE vr.user_id = u.user_id AND vr.status = 'received' AND vr.is_suitable = 0
        ) AS references_flagged,
        (
          SELECT COUNT(*)::int
          FROM background_checks bc
          WHERE bc.user_id = u.user_id
            AND bc.status = 'clear'
            AND (bc.expires_on IS NULL OR bc.expires_on >= ?)
        ) AS clear_checks
      FROM users u
      LEFT JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      WHERE u.role = 'volunteer'
        AND u.anonymised_at IS NULL
      ORDER BY u.created_at ASC, u.user_id ASC
    `,
    [today]
  );

  const pipeline = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, []]));

  for (const row of rows) {
    const userId = Number(row.user_id);
    const pendingWaivers = await Waiver.findPendingForUser(userId);
    const referencesFlagged = Number(row.references_flagged) || 0;
    const stage = classifyOnboardingStage({
      hasProfile: row.profile_id != null,
      approved: Number(row.approved) === 1,
      waiversComplete: pendingWaivers.length === 0,
      referencesReceived: Number(row.references_received) || 0,
      referencesFlagged,
      hasClearCheck: Number(row.clear_checks) > 0,
    });

    pipeline[stage].push({
      user_id: userId,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone || null,
      created_at: row.created_at,
      approved: Number(row.approved) === 1,
      references_received: Number(row.references_received) || 0,
      references_flagged: referencesFlagged,
      has_clear_background_check: Number(row.clear_checks) > 0,
      pending_waiver_count: pendingWaivers.length,
      stage,
    });
  }

  return {
    stages: PIPELINE_STAGES,
    counts: Object.fromEntries(
      PIPELINE_STAGES.map((s) => [s, pipeline[s].length])
    ),
    pipeline,
  };
}

module.exports = {
  CHECK_TYPES,
  CHECK_STATUSES,
  REFERENCE_STATUSES,
  REFERENCE_TOKEN_TTL_DAYS,
  STAFF_WARN_DAYS,
  PIPELINE_STAGES,
  hashToken,
  generateReferenceToken,
  toSafeReference,
  toSafeCheck,
  normalizeCheckType,
  normalizeCheckStatus,
  createReferenceRequest,
  findReferenceById,
  findReferenceByToken,
  listReferencesForUser,
  submitReferenceResponse,
  expireStaleReferences,
  upsertBackgroundCheck,
  findBackgroundCheckById,
  listBackgroundChecksForUser,
  hasClearCheck,
  markExpiredChecks,
  findChecksNeedingStaffWarning,
  getOnboardingChecklist,
  classifyOnboardingStage,
  getOnboardingPipeline,
};
