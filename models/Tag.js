'use strict';

const { pool } = require('../config/database');

const TAG_OVERLAP_WEIGHT = 10;
const AVAILABILITY_MATCH_WEIGHT = 5;
const INLINE_DIGEST_CAP = 200;

/**
 * Profile availability vs opportunity start day/time.
 * Weekdays = Mon–Fri, Weekends = Sat–Sun, Evenings = hour >= 17, Flexible = always.
 */
function matchesAvailability(availability, startDate) {
  if (!startDate) return false;
  const label = String(availability || '').trim().toLowerCase();
  if (!label) return false;
  if (label === 'flexible') return true;

  const d = startDate instanceof Date ? startDate : new Date(startDate);
  if (Number.isNaN(d.getTime())) return false;

  const day = d.getDay(); // 0=Sun … 6=Sat
  const hour = d.getHours();

  if (label === 'weekdays') return day >= 1 && day <= 5;
  if (label === 'weekends') return day === 0 || day === 6;
  if (label === 'evenings') return hour >= 17;
  return false;
}

function computeMatchScore(tagOverlap, availabilityMatch) {
  const overlap = Number(tagOverlap) || 0;
  const avail = availabilityMatch ? 1 : 0;
  return overlap * TAG_OVERLAP_WEIGHT + avail * AVAILABILITY_MATCH_WEIGHT;
}

/**
 * Sort recommendations: higher score first, then earlier start_date.
 */
function compareRecommendationScore(a, b) {
  const scoreDiff = (Number(b.score) || 0) - (Number(a.score) || 0);
  if (scoreDiff !== 0) return scoreDiff;
  const aStart = new Date(a.start_date || 0).getTime();
  const bStart = new Date(b.start_date || 0).getTime();
  return aStart - bStart;
}

function toDateOnly(value = new Date()) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function normalizeTagIds(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((id) => (typeof id === 'object' && id != null ? Number(id.id ?? id.tag_id) : Number(id)))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
}

async function findAll() {
  const [rows] = await pool.execute(
    `SELECT id, name FROM tags ORDER BY name ASC`
  );
  return rows;
}

async function findByUserId(userId) {
  const [rows] = await pool.execute(
    `SELECT t.id, t.name
     FROM volunteer_tags vt
     INNER JOIN tags t ON t.id = vt.tag_id
     WHERE vt.user_id = ?
     ORDER BY t.name ASC`,
    [userId]
  );
  return rows;
}

async function setVolunteerTags(userId, tagIds = []) {
  await pool.execute(`DELETE FROM volunteer_tags WHERE user_id = ?`, [userId]);
  const ids = normalizeTagIds(tagIds) || [];
  for (const tagId of ids) {
    await pool.execute(
      `INSERT INTO volunteer_tags (user_id, tag_id) VALUES (?, ?)`,
      [userId, tagId]
    );
  }
  return findByUserId(userId);
}

async function findForOpportunity(opportunityId) {
  const [rows] = await pool.execute(
    `SELECT t.id, t.name
     FROM opportunity_tags ot
     INNER JOIN tags t ON t.id = ot.tag_id
     WHERE ot.opportunity_id = ?
     ORDER BY t.name ASC`,
    [opportunityId]
  );
  return rows;
}

async function setOpportunityTags(opportunityId, tagIds = []) {
  await pool.execute(
    `DELETE FROM opportunity_tags WHERE opportunity_id = ?`,
    [opportunityId]
  );
  const ids = normalizeTagIds(tagIds) || [];
  for (const tagId of ids) {
    await pool.execute(
      `INSERT INTO opportunity_tags (opportunity_id, tag_id) VALUES (?, ?)`,
      [opportunityId, tagId]
    );
  }
  return findForOpportunity(opportunityId);
}

async function attachTags(opportunities = []) {
  if (!opportunities.length) return opportunities;

  const ids = opportunities
    .map((o) => o.opportunity_id || o.id)
    .filter(Boolean);
  if (!ids.length) return opportunities;

  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT ot.opportunity_id, t.id, t.name
     FROM opportunity_tags ot
     INNER JOIN tags t ON t.id = ot.tag_id
     WHERE ot.opportunity_id IN (${placeholders})
     ORDER BY t.name ASC`,
    ids
  );

  const byOpp = new Map();
  for (const row of rows) {
    const list = byOpp.get(row.opportunity_id) || [];
    list.push({ id: row.id, name: row.name });
    byOpp.set(row.opportunity_id, list);
  }

  return opportunities.map((opp) => {
    const oid = opp.opportunity_id || opp.id;
    return {
      ...opp,
      tags: byOpp.get(oid) || [],
    };
  });
}

/**
 * Plain SQL scoring: tag overlap × 10 + availability match × 5.
 * Returns best `limit` open future opportunities.
 */
async function findRecommendedForUser(userId, limit = 5) {
  const sql = `
    SELECT
      o.opportunity_id,
      o.title,
      o.description,
      o.requirements,
      o.location,
      o.start_date,
      o.end_date,
      o.max_volunteers,
      o.status,
      (
        (
          SELECT COUNT(*)
          FROM applications a
          WHERE a.opportunity_id = o.opportunity_id
            AND a.status IN ('accepted', 'approved')
        )
        +
        (
          SELECT COALESCE(SUM(gb.size), 0)
          FROM group_bookings gb
          WHERE gb.opportunity_id = o.opportunity_id
            AND gb.status = 'confirmed'
        )
      ) AS spots_filled,
      COALESCE(overlap.tag_overlap, 0) AS tag_overlap,
      CASE
        WHEN LOWER(TRIM(vp.availability)) = 'flexible' THEN 1
        WHEN LOWER(TRIM(vp.availability)) = 'weekdays'
          AND DAYOFWEEK(o.start_date) BETWEEN 2 AND 6 THEN 1
        WHEN LOWER(TRIM(vp.availability)) = 'weekends'
          AND DAYOFWEEK(o.start_date) IN (1, 7) THEN 1
        WHEN LOWER(TRIM(vp.availability)) = 'evenings'
          AND HOUR(o.start_date) >= 17 THEN 1
        ELSE 0
      END AS availability_match,
      (
        COALESCE(overlap.tag_overlap, 0) * ${TAG_OVERLAP_WEIGHT}
        + (
          CASE
            WHEN LOWER(TRIM(vp.availability)) = 'flexible' THEN 1
            WHEN LOWER(TRIM(vp.availability)) = 'weekdays'
              AND DAYOFWEEK(o.start_date) BETWEEN 2 AND 6 THEN 1
            WHEN LOWER(TRIM(vp.availability)) = 'weekends'
              AND DAYOFWEEK(o.start_date) IN (1, 7) THEN 1
            WHEN LOWER(TRIM(vp.availability)) = 'evenings'
              AND HOUR(o.start_date) >= 17 THEN 1
            ELSE 0
          END
        ) * ${AVAILABILITY_MATCH_WEIGHT}
      ) AS score
    FROM opportunities o
    INNER JOIN volunteer_profiles vp ON vp.user_id = ?
    LEFT JOIN (
      SELECT ot.opportunity_id, COUNT(*) AS tag_overlap
      FROM opportunity_tags ot
      INNER JOIN volunteer_tags vt
        ON vt.tag_id = ot.tag_id AND vt.user_id = ?
      GROUP BY ot.opportunity_id
    ) overlap ON overlap.opportunity_id = o.opportunity_id
    WHERE o.status = 'open'
      AND o.start_date > NOW()
      AND (
        COALESCE(overlap.tag_overlap, 0) > 0
        OR LOWER(TRIM(vp.availability)) = 'flexible'
        OR (
          LOWER(TRIM(vp.availability)) = 'weekdays'
          AND DAYOFWEEK(o.start_date) BETWEEN 2 AND 6
        )
        OR (
          LOWER(TRIM(vp.availability)) = 'weekends'
          AND DAYOFWEEK(o.start_date) IN (1, 7)
        )
        OR (
          LOWER(TRIM(vp.availability)) = 'evenings'
          AND HOUR(o.start_date) >= 17
        )
      )
    ORDER BY score DESC, o.start_date ASC
    LIMIT ${Math.max(1, Math.min(Number(limit) || 5, 50))}
  `;

  const [rows] = await pool.execute(sql, [userId, userId]);
  const mapped = rows.map((row) => {
    row.id = row.opportunity_id;
    row.tag_overlap = Number(row.tag_overlap) || 0;
    row.availability_match = Number(row.availability_match) === 1;
    row.score = Number(row.score) || 0;
    return row;
  });
  return attachTags(mapped);
}

/**
 * Queue digest notifications for approved volunteers whose tags overlap.
 * Returns number of queue rows inserted (ignoring duplicates).
 */
async function queueMatchNotifications(opportunityIds = []) {
  const ids = [...new Set(
    (Array.isArray(opportunityIds) ? opportunityIds : [opportunityIds])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];
  if (!ids.length) return 0;

  let inserted = 0;
  for (const opportunityId of ids) {
    const sql = `
      INSERT IGNORE INTO opportunity_match_queue (opportunity_id, user_id)
      SELECT DISTINCT ot.opportunity_id, vt.user_id
      FROM opportunity_tags ot
      INNER JOIN volunteer_tags vt ON vt.tag_id = ot.tag_id
      INNER JOIN volunteer_profiles vp ON vp.user_id = vt.user_id AND vp.approved = 1
      INNER JOIN users u ON u.user_id = vt.user_id AND u.role = 'volunteer'
      WHERE ot.opportunity_id = ?
    `;
    const [result] = await pool.execute(sql, [opportunityId]);
    inserted += Number(result.affectedRows) || 0;
  }
  return inserted;
}

/**
 * Whether a volunteer may receive a digest today (not already logged).
 */
function shouldSendDigestToday(alreadySentDates = [], digestDate) {
  const day = toDateOnly(digestDate);
  return !alreadySentDates.some((d) => toDateOnly(d) === day);
}

async function hasDigestBeenSent(userId, digestDate = new Date()) {
  const day = toDateOnly(digestDate);
  const [rows] = await pool.execute(
    `SELECT 1 AS ok FROM tag_digest_log WHERE user_id = ? AND digest_date = ? LIMIT 1`,
    [userId, day]
  );
  return rows.length > 0;
}

async function markDigestSent(userId, digestDate = new Date()) {
  const day = toDateOnly(digestDate);
  await pool.execute(
    `INSERT IGNORE INTO tag_digest_log (user_id, digest_date) VALUES (?, ?)`,
    [userId, day]
  );
}

/**
 * Load pending queue rows grouped by user, excluding users already digests today.
 */
async function findPendingDigests(digestDate = new Date(), { maxUsers = null } = {}) {
  const day = toDateOnly(digestDate);
  let sql = `
    SELECT
      q.id AS queue_id,
      q.user_id,
      q.opportunity_id,
      u.email,
      u.first_name,
      o.title AS opportunity_title,
      o.start_date,
      o.location
    FROM opportunity_match_queue q
    INNER JOIN users u ON u.user_id = q.user_id
    INNER JOIN opportunities o ON o.opportunity_id = q.opportunity_id
    LEFT JOIN tag_digest_log d
      ON d.user_id = q.user_id AND d.digest_date = ?
    WHERE d.user_id IS NULL
    ORDER BY q.user_id ASC, o.start_date ASC
  `;
  const params = [day];
  const [rows] = await pool.execute(sql, params);

  const byUser = new Map();
  for (const row of rows) {
    if (!byUser.has(row.user_id)) {
      if (maxUsers != null && byUser.size >= maxUsers) continue;
      byUser.set(row.user_id, {
        user_id: row.user_id,
        email: row.email,
        first_name: row.first_name,
        queue_ids: [],
        opportunities: [],
      });
    }
    const entry = byUser.get(row.user_id);
    if (!entry) continue;
    entry.queue_ids.push(row.queue_id);
    entry.opportunities.push({
      opportunity_id: row.opportunity_id,
      title: row.opportunity_title,
      start_date: row.start_date,
      location: row.location,
    });
  }

  return Array.from(byUser.values());
}

async function clearQueueIds(queueIds = []) {
  const ids = queueIds.map(Number).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  const [result] = await pool.execute(
    `DELETE FROM opportunity_match_queue WHERE id IN (${placeholders})`,
    ids
  );
  return Number(result.affectedRows) || 0;
}

module.exports = {
  TAG_OVERLAP_WEIGHT,
  AVAILABILITY_MATCH_WEIGHT,
  INLINE_DIGEST_CAP,
  matchesAvailability,
  computeMatchScore,
  compareRecommendationScore,
  toDateOnly,
  normalizeTagIds,
  shouldSendDigestToday,
  findAll,
  findByUserId,
  setVolunteerTags,
  findForOpportunity,
  setOpportunityTags,
  attachTags,
  findRecommendedForUser,
  queueMatchNotifications,
  hasDigestBeenSent,
  markDigestSent,
  findPendingDigests,
  clearQueueIds,
};
